import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../dist/server/index.js';
import { loadAddedQuestions } from '../scripts/added-questions.mjs';
// The original course (346 questions, 118 quiz) plus content/added/ (checked by tests/added.mjs).
const added=await loadAddedQuestions();
const addedIds=new Set(added.questions.map(q=>q.id));
const TOTAL=346+added.questions.length, QUIZ=118+added.questions.length, MULTI=7+added.questions.filter(q=>Array.isArray(q.correct)).length;
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync('drizzle/0000_quiz.sql','utf8'));
sqlite.exec(readFileSync('drizzle/0001_content_imports.sql','utf8'));
sqlite.exec(readFileSync('drizzle/0002_study_workspace.sql','utf8'));
// D1 shim. `trips` counts network round trips as on Cloudflare: one per
// statement call, one per batch (however many statements it carries).
let trips=0;
const db={prepare(query){return {bind(...params){
  const s=sqlite.prepare(query);
  const exec=()=>/^\s*(SELECT|PRAGMA)/i.test(query)?{results:s.all(...params)}:{meta:s.run(...params)};
  return {all:async()=>{trips++;return {results:s.all(...params)};},first:async()=>{trips++;return s.get(...params);},run:async()=>{trips++;return exec();},exec};
}};},async batch(statements){
  trips++;
  sqlite.exec('BEGIN');
  try {const result=statements.map(s=>s.exec());sqlite.exec('COMMIT');return result;}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
}};
const files=new Map();
const bucket={put:async(k,v)=>files.set(k,v),get:async k=>files.has(k)?{body:files.get(k)}:null,delete:async k=>files.delete(k)};
async function call(path,method='GET',data,identity='u',expected=200){
  const res=await worker.fetch(new Request('https://example.test/'+path,{method,headers:{...(identity?{'oai-authenticated-user-id':identity,'oai-authenticated-user-email':identity==='u'?'owner@example.test':'student@example.test'}:{}),Origin:'https://example.test'},body:data instanceof FormData?data:data===undefined?undefined:JSON.stringify(data)}),{DB:db,BUCKET:bucket,QUIZ_OWNER_EMAIL:'owner@example.test'});
  const text=await res.text();
  assert.equal(res.status,expected,text.slice(0,400));
  return res.headers.get('content-type').includes('application/json')?JSON.parse(text):text;
}
const state=await call('api/state?compact=1');
assert.equal(state.questions.length,TOTAL);
assert.equal(state.questions.filter(q=>q.kind==='quiz').length,QUIZ);
assert.equal(state.questions.filter(q=>q.kind==='essay').length,228);
assert.ok(state.questions.every(q=>!('correct' in q)&&!('options' in q)));
await call('api/state','GET',undefined,'',401);
await call('api/bank','GET',undefined,'other',403);
const bank=await call('api/bank');
const courseBank=bank.filter(q=>!addedIds.has(q.id));
assert.equal(courseBank.length,346);
assert.ok(courseBank.filter(q=>q.kind==='quiz').every(q=>q.explanation.length>200 && !q.explanation.startsWith('Đáp án theo phần được đánh dấu')));
const multi=bank.filter(q=>Array.isArray(q.correct));
assert.equal(multi.length,MULTI);
assert.equal(courseBank.filter(q=>q.kind==='quiz' && q.options.length===3).length,1);
assert.ok(courseBank.every(q=>q.explanation && q.sources.length));
// Four import markers: course, reviewed explanations, essay guides, added questions.
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM content_imports').get().n,4);
await call('api/state');
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM questions').get().n,TOTAL);
// A complete chapter includes all seven types of saved option IDs regardless of order.
const cfg={chapter:'distributed-2',tier:'main',mode:'practice',count:15};
const start=await call('api/attempt','POST',cfg);
const attempt=await call('api/attempt/'+start.id);
assert.equal(attempt.items.length,15);
assert.ok(attempt.items.every(q=>q.correct && q.explanation));
assert.equal(attempt.items.filter(q=>q.selectionCount===2).length,4);
await call('api/attempt/'+start.id,'GET',undefined,'other',404);
const keys=new Map(bank.map(q=>[q.id,q.correct]));
const changes=attempt.items.map(q=>({question:q.id,option:Array.isArray(keys.get(q.id))?[...keys.get(q.id)].reverse():keys.get(q.id)}));
const ack=await call('api/attempt/'+start.id+'?compact=1','PATCH',{changes});
assert.deepEqual(ack,{ok:true,id:start.id,finished:null});
assert.ok(JSON.stringify(ack).length<120);
const result=await call('api/attempt/'+start.id,'POST',{});
assert.equal(result.result.score,10);
assert.equal(result.result.correct,15);
assert.equal((await call('api/state?compact=1')).progress.learned.length,15);
// Selecting only one of two answers is wrong, not partially correct.
const partial=await call('api/attempt','POST',cfg);
const partialItems=await call('api/attempt/'+partial.id);
const m=partialItems.items.find(q=>q.selectionCount===2);
await call('api/attempt/'+partial.id,'PATCH',{question:m.id,option:[keys.get(m.id)[0]]});
const graded=await call('api/attempt/'+partial.id,'POST',{});
assert.equal(graded.result.wrong,1);
assert.equal(graded.result.unanswered,14);
assert.equal(graded.result.correct,0);
const retry=await call('api/attempt','POST',{...cfg,previous:partial.id,ids:[]});
assert.equal((await call('api/attempt/'+retry.id)).items.length,15);
// Deselecting everything is unanswered; foreign and duplicate options are rejected.
const blank=await call('api/attempt','POST',cfg);
const blankItems=await call('api/attempt/'+blank.id);
const mq=blankItems.items.find(q=>q.selectionCount===2);
await call('api/attempt/'+blank.id,'PATCH',{question:mq.id,option:[]});
await call('api/attempt/'+blank.id,'PATCH',{question:mq.id,option:['foreign']},'u',400);
await call('api/attempt/'+blank.id,'PATCH',{question:mq.id,option:[mq.options[0].id,mq.options[0].id]},'u',400);
assert.equal((await call('api/attempt/'+blank.id,'POST',{})).result.unanswered,15);
const source=JSON.parse(readFileSync('content/course.json','utf8'));
for(const doc of source.documents) sqlite.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(doc.id,doc.chapter,doc.title,doc.filename,doc.mime,doc.storage_key);
// Admin roundtrip retains both keys and option identities.
const original=multi[0];
await call('api/bank','POST',original);
const edited=(await call('api/bank')).find(q=>q.id===original.id);
assert.deepEqual(edited.correct,original.correct);
assert.deepEqual(edited.options,original.options);
// Source answers and student drafts are isolated.
const essay=bank.find(q=>q.kind==='essay');
assert.ok((await call('api/essay/'+essay.id)).explanation.includes('Nguồn'));
assert.ok(bank.filter(q=>q.kind==='essay').every(q=>q.key_points.length>=2&&q.code&&q.explanation.includes('##')));
await call('api/essay/'+essay.id,'POST',{draft:'Nội dung cá nhân',learned:true});
assert.equal((await call('api/essay/'+essay.id,'GET',undefined,'other')).draft,'');
await call('api/content-import?id=x','PUT',undefined,'',403);
console.log('PASS: '+TOTAL+' imported questions (346 + '+added.questions.length+' added), source-marked answers, '+MULTI+' multi-answer questions, batch saves, grading, retry, admin roundtrip, source authorization and private drafts.');

// Practice feedback uses snapshot keys immediately, but an active exam never
// exposes keys or explanations, even through non-compact save responses.
const examStart=await call('api/attempt','POST',{...cfg,mode:'exam',minutes:10});
const exam=await call('api/attempt/'+examStart.id);
assert.ok(exam.items.every(q=>!('correct' in q)&&!('explanation' in q)));
const examSaved=await call('api/attempt/'+examStart.id,'PATCH',{question:exam.items[0].id,option:exam.items[0].options[0].id});
assert.ok(examSaved.items.every(q=>!('correct' in q)&&!('explanation' in q)));
const examFinished=await call('api/attempt/'+examStart.id,'POST',{});
assert.ok(examFinished.items.every(q=>q.correct && q.explanation));
assert.deepEqual(attempt.items.find(q=>q.selectionCount===2).correct,keys.get(attempt.items.find(q=>q.selectionCount===2).id));
console.log('PASS: instant practice feedback keys, correct multi-answer IDs, exam keys hidden until submission.');
// Partial progress writes must never erase a long draft or another account's work.
const longDraft='Bài tự luận đầy đủ. '.repeat(1500);
await call('api/essay/'+essay.id,'POST',{draft:longDraft,status:'answered'});
await call('api/essay/'+essay.id,'POST',{status:'review',viewed:true});
let restoredEssay=await call('api/essay/'+essay.id);
assert.equal(restoredEssay.draft,longDraft.trim());assert.equal(restoredEssay.status,'review');assert.ok(restoredEssay.answered_at&&restoredEssay.viewed_at);
await call('api/essay/'+essay.id,'POST',{draft:'x'.repeat(500001)},'u',400);
assert.equal((await call('api/essay/'+essay.id)).draft,longDraft.trim());
assert.equal((await call('api/essay/'+essay.id,'GET',undefined,'other')).draft,'');
const completeAnswer='## Nội dung đầy đủ\n'+('Giải thích có căn cứ. '.repeat(2000));
await call('api/bank','POST',{...essay,explanation:completeAnswer,code:'QA-1',key_points:['Nêu khái niệm','Phân tích ví dụ']});
restoredEssay=await call('api/essay/'+essay.id);assert.equal(restoredEssay.explanation,completeAnswer.trim());assert.equal(restoredEssay.key_points.length,2);
await call('api/essay/'+essay.id,'POST',{assessment:[true,false]});assert.deepEqual((await call('api/essay/'+essay.id)).assessment,[true,false]);
await call('api/essay/'+essay.id,'POST',{assessment:[true,false,true]},'u',400);
// Global mistake review contains only unresolved mistakes and clears correct retries.
const reviewStart=await call('api/attempt','POST',{...cfg,mode:'review',count:100});
const review=await call('api/attempt/'+reviewStart.id);const wrongIds=(await call('api/mistakes?chapter='+cfg.chapter)).ids;
assert.ok(review.items.length>0&&review.items.every(q=>wrongIds.includes(q.id)));
await call('api/attempt/'+review.id,'PATCH',{changes:review.items.map(q=>({question:q.id,option:keys.get(q.id)}))});
await call('api/attempt/'+review.id,'POST',{});assert.equal((await call('api/mistakes?chapter='+cfg.chapter)).ids.length,0);
await call('api/attempt','POST',{...cfg,mode:'review'},'u',400);
// Ordering and editing cannot cross subjects; nonempty chapters are protected.
const originalChapters=state.chapters.filter(c=>c.subject==='distributed').map(c=>c.id);
await call('api/chapters/order','PATCH',{subject:'distributed',ids:[...originalChapters].reverse()});
assert.deepEqual((await call('api/state')).chapters.filter(c=>c.subject==='distributed').map(c=>c.id),[...originalChapters].reverse());
await call('api/chapters/order','PATCH',{subject:'distributed',ids:['history-1',...originalChapters.slice(1)]},'u',400);
await call('api/chapters/distributed-1','DELETE',undefined,'u',409);
await call('api/chapters/distributed-1','PATCH',{title:'Chương QA',overview:'## Kiến thức\nÝ chính'});
await call('api/subjects/distributed','PATCH',{title:'Phát triển ứng dụng phân tán',description:'Môn học về hệ thống phân tán',icon:'◇'});
await call('api/subjects/distributed','DELETE',undefined,'u',409);
await call('api/documents/'+source.documents[0].id,'PATCH',{title:'Tài liệu QA'});
await call('api/backups','GET',undefined,'other',403);
// A backup preserves every file body and restores original records without deleting new ones.
for(const d of source.documents)files.set(d.storage_key,'original-file-'+d.id);
const backup=await call('api/backups','POST',{});
const manifest=await call('api/backups/'+backup.id);
assert.equal(Object.keys(manifest.files).length,47);
assert.equal(manifest.data.questions.length,TOTAL);
await call('api/essay/'+essay.id,'POST',{draft:'bị thay đổi',status:'learning'});
await call('api/chapters/distributed-1','PATCH',{title:'Đổi sau sao lưu',overview:''});
await call('api/backups/'+backup.id+'/restore','POST',{});
assert.equal((await call('api/essay/'+essay.id)).draft,longDraft.trim());
assert.equal((await call('api/state')).chapters.find(c=>c.id==='distributed-1').title,'Chương QA');
const restoredDoc=sqlite.prepare('SELECT storage_key FROM documents WHERE id=?').get(source.documents[0].id);
assert.equal(files.get(restoredDoc.storage_key),'original-file-'+source.documents[0].id);
assert.equal((await call('api/backups')).length,2);
assert.equal((await call('api/state')).questions.length,TOTAL);
console.log('PASS: long essays without truncation, partial autosave, checklist, account isolation, global mistake resolution, chapter protection/order, complete file backup and checkpointed restore.');
const chapterAnswers=await call('api/essay-answers?chapter=distributed-1','GET',undefined,'other');
assert.equal(chapterAnswers.length,36);
assert.ok(chapterAnswers.every(q=>Array.isArray(q.key_points)&&Array.isArray(q.sources)));
assert.equal(chapterAnswers.find(q=>q.id===essay.id).explanation,completeAnswer.trim());
assert.ok(chapterAnswers.every(q=>q.explanation&&!('draft' in q)&&!('correct' in q)));
assert.equal((await call('api/essay-answers?chapter=history-1')).length,0);
await call('api/essay-answers?chapter=missing','GET',undefined,'u',404);
await call('api/essay-answers?chapter=distributed-1','GET',undefined,'',401);
console.log('PASS: chapter answer view only exposes that chapter’s essay model answers to signed-in learners.');
// Study answer view keeps source option IDs, supports multiple correct answers,
// stays within its chapter, and never changes attempts or scores.
const attemptsBefore=sqlite.prepare('SELECT count(*) AS n FROM attempts').get().n;
let answerTotal=0;
for(const chapter of state.chapters){
 const answers=await call('api/quiz-answers?chapter='+chapter.id,'GET',undefined,'other');
 const expected=bank.filter(q=>q.kind==='quiz'&&q.chapter===chapter.id);
 assert.equal(answers.length,expected.length);answerTotal+=answers.length;
 for(const q of answers){const source=expected.find(x=>x.id===q.id);assert.deepEqual(q.correct,source.correct);assert.deepEqual(q.options,source.options);assert.ok(q.explanation);assert.equal(q.chapter,chapter.id);assert.ok(!('draft' in q));}
}
assert.equal(answerTotal,QUIZ);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM attempts').get().n,attemptsBefore);
await call('api/quiz-answers?chapter=missing','GET',undefined,'u',404);
await call('api/quiz-answers?chapter=distributed-2','GET',undefined,'',401);
console.log('PASS: all '+QUIZ+' quiz answer keys and option IDs match the bank, chapter scope, learner access and no progress mutations.');

// Shuffled attempts keep every option's text with its own ID and the stored
// key on the same IDs, including multi-answer questions.
const bankById=new Map(bank.map(q=>[q.id,q]));
const ids=value=>(Array.isArray(value)?value:[value]).slice().sort();
let shuffledItems=0;
for(let round=0;round<20;round++) for(const chapter of ['distributed-1','distributed-2','history-1']){
  const created=await call('api/attempt','POST',{chapter,tier:'all',mode:'practice',count:100});
  for(const q of created.attempt.items){
    const source=bankById.get(q.id);
    assert.deepEqual(new Map(q.options.map(o=>[o.id,o.text])),new Map(source.options.map(o=>[o.id,o.text])));
    assert.deepEqual(ids(q.correct),ids(source.correct));
    assert.equal(q.selectionCount,ids(source.correct).length);
    shuffledItems++;
  }
}
assert.equal(shuffledItems,20*(15+15+30));
console.log('PASS: '+shuffledItems+' shuffled attempt items keep option text, IDs and (multi-)answer keys together.');

// Creating an attempt returns it (no second request); an exam still hides keys.
const createdNow=await call('api/attempt','POST',cfg);
const openedNow=await call('api/attempt/'+createdNow.id);
assert.deepEqual(createdNow.attempt.items,openedNow.items);
assert.deepEqual(createdNow.attempt.config,openedNow.config);
const examNow=await call('api/attempt','POST',{...cfg,mode:'exam',minutes:5});
assert.ok(examNow.attempt.items.every(q=>!('correct' in q)&&!('explanation' in q)&&q.selectionCount>=1));
assert.equal(examNow.attempt.items.filter(q=>q.selectionCount===2).length,4);
// A save that arrives after submission reports the finished attempt, not "saved".
await call('api/attempt/'+examNow.id,'POST',{});
const late=await call('api/attempt/'+examNow.id+'?compact=1','PATCH',{changes:[{question:examNow.attempt.items[0].id,option:examNow.attempt.items[0].options[0].id}]});
assert.ok(late.finished&&late.items.every(q=>q.correct&&q.explanation));
assert.deepEqual(late.answers,{});
console.log('PASS: new attempts are returned on creation; exam keys stay hidden until submission; late saves see the submitted result.');

// D1 round trips per request (each is a network hop on Cloudflare).
const roundTrips=async(...args)=>{const before=trips;const result=await call(...args);return {count:trips-before,result};};
assert.equal((await roundTrips('api/state?compact=1')).count,1);
assert.equal((await roundTrips('api/essay/'+essay.id)).count,1);
assert.equal((await roundTrips('api/quiz-answers?chapter=distributed-1')).count,1);
assert.equal((await roundTrips('api/essay-answers?chapter=distributed-1')).count,1);
const timedCreate=await roundTrips('api/attempt','POST',cfg);
assert.equal(timedCreate.count,2);
assert.equal((await roundTrips('api/attempt/'+timedCreate.result.id)).count,1);
const first=timedCreate.result.attempt.items[0];
const patched=await roundTrips('api/attempt/'+timedCreate.result.id+'?compact=1','PATCH',{changes:[{question:first.id,option:first.options[0].id}]});
assert.equal(patched.count,2);
assert.deepEqual(patched.result,{ok:true,id:timedCreate.result.id,finished:null});
console.log('PASS: one D1 round trip for state, essay, quiz/essay answer pages and opening an attempt; two for creating or saving.');

// The page streams the shell with cached, content-hashed CSS/JS, then the state.
const page=await call('');
const css=page.match(/<link rel="stylesheet" href="(\/style\.[a-f0-9]{12}\.css)">/)?.[1], js=page.match(/<script src="(\/app\.[a-f0-9]{12}\.js)" defer><\/script>/)?.[1];
assert.ok(css&&js,'page links hashed assets');
assert.ok(!page.includes('<style>')&&page.indexOf('id="initial-state"')>page.indexOf('<main'));
const boot=JSON.parse(page.match(/<script type="application\/json" id="initial-state">(.*?)<\/script>/s)[1]);
assert.equal(boot.questions.length,TOTAL);
assert.equal(boot.history.length,sqlite.prepare("SELECT count(*) AS n FROM attempts WHERE owner='u'").get().n);
assert.ok(boot.questions.every(q=>!('correct' in q)&&!('explanation' in q)));
const signedOutPage=await call('','GET',undefined,'');
assert.deepEqual(JSON.parse(signedOutPage.match(/id="initial-state">(.*?)<\/script>/s)[1]),{signedOut:true});
for(const asset of [css,js]){
  const res=await worker.fetch(new Request('https://example.test'+asset),{DB:db,BUCKET:bucket});
  assert.equal(res.status,200);assert.match(res.headers.get('cache-control'),/immutable/);
  assert.ok((await res.text()).length>1000);
}
console.log('PASS: the page streams its shell with immutable hashed CSS/JS and embeds the private state without answer keys.');
// A fresh isolate checks all content revisions in one query before the state batch.
const coldWorker=(await import('../dist/server/index.js?cold-isolate')).default;
const coldBefore=trips;
const coldState=await coldWorker.fetch(new Request('https://example.test/api/state?compact=1',{headers:{'oai-authenticated-user-id':'u','oai-authenticated-user-email':'owner@example.test'}}),{DB:db,BUCKET:bucket,QUIZ_OWNER_EMAIL:'owner@example.test'});
assert.equal(coldState.status,200);assert.equal((await coldState.json()).questions.length,TOTAL);
assert.equal(trips-coldBefore,2);
console.log('PASS: a cold isolate loads the page state in two D1 round trips (was 11 calls, 5 of them sequential).');
// The home review queue names unfinished attempts: mode, size, answers given, deadline.
const homeExam=await call('api/attempt','POST',{...cfg,mode:'exam',minutes:7,count:5});
await call('api/attempt/'+homeExam.id+'?compact=1','PATCH',{changes:homeExam.attempt.items.slice(0,2).map(q=>({question:q.id,option:q.selectionCount>1?q.options.slice(0,2).map(o=>o.id):q.options[0].id}))});
const homeEntry=(await call('api/state?compact=1')).history.find(entry=>entry.id===homeExam.id);
assert.equal(homeEntry.mode,'exam');assert.equal(homeEntry.total,5);assert.equal(homeEntry.answered,2);assert.ok(homeEntry.deadline>Date.now());assert.equal(homeEntry.finished,null);
assert.ok(!('items' in homeEntry)&&!('answers' in homeEntry),'compact state carries no answer keys');
console.log('PASS: unfinished attempts in the state carry mode, size, answered count and deadline (no keys).');

// Self-test retry ("Luyện lại các câu đoán sai"): an explicit list of quiz
// questions from one chapter, still two D1 round trips; anything else is refused.
const ownQuiz=bank.filter(q=>q.kind==='quiz'&&q.chapter==='distributed-1'), otherQuiz=bank.find(q=>q.kind==='quiz'&&q.chapter!=='distributed-1');
const ownEssay=bank.find(q=>q.kind==='essay'&&q.chapter==='distributed-1');
const pickedIds=[ownQuiz[3].id,ownQuiz[0].id,ownQuiz.at(-1).id];
const guessRetry=await roundTrips('api/attempt','POST',{chapter:'distributed-1',tier:'all',mode:'practice',count:3,questionIds:pickedIds});
assert.equal(guessRetry.count,2);
assert.deepEqual(guessRetry.result.attempt.items.map(q=>q.id).sort(),[...pickedIds].sort());
for(const q of guessRetry.result.attempt.items){const source=ownQuiz.find(x=>x.id===q.id);assert.ok(q.options.every(o=>source.options.find(x=>x.id===o.id)?.text===o.text));assert.deepEqual(q.correct,source.correct);}
const examRetry=await call('api/attempt','POST',{chapter:'distributed-1',tier:'all',mode:'exam',minutes:5,count:2,questionIds:pickedIds.slice(0,2)});
assert.ok(examRetry.attempt.items.every(q=>!('correct' in q)&&!('explanation' in q)));
const refused=[
  {questionIds:[otherQuiz.id],count:1},
  {questionIds:[ownEssay.id],count:1},
  {questionIds:[pickedIds[0],pickedIds[0]],count:2},
  {questionIds:pickedIds,count:2},
  {questionIds:[],count:1},
  {questionIds:'x',count:1},
  {questionIds:pickedIds,count:3,mode:'review'}
];
for(const extra of refused) await call('api/attempt','POST',{chapter:'distributed-1',tier:'all',mode:'practice',...extra},'u',400);
console.log('PASS: a practice attempt can be built from an explicit list of the chapter’s quiz questions (2 D1 round trips); other chapters, essays, duplicates, a wrong count and review mode are refused.');
