const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
const uid = () => crypto.randomUUID();
const parse = JSON.parse;
const selectedIds = value => Array.isArray(value) ? value : !value ? [] : typeof value==='string' && value.startsWith('[') ? parse(value) : [value];
const matchesAnswer = (answer, correct) => {
  const a=selectedIds(answer), b=selectedIds(correct);
  return a.length===b.length && a.length>0 && a.every(id=>b.includes(id));
};
const decodedCorrect = value => selectedIds(value).length>1 ? selectedIds(value) : value;
const needed = (condition, message, status = 400) => { if (!condition) throw Object.assign(new Error(message), {status}); };
const str = (value, max = 16000) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const norm = value => value.normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g,' ');
const list = async statement => (await statement.all()).results;
const shuffle = items => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const seed = [
  ['history','Lịch sử Đảng Cộng sản Việt Nam',['Chương 1. Đảng Cộng sản Việt Nam ra đời và lãnh đạo đấu tranh giành chính quyền','Chương 2. Lãnh đạo hai cuộc kháng chiến và hoàn thành giải phóng dân tộc','Chương 3. Lãnh đạo xây dựng, bảo vệ Tổ quốc và thực hiện đổi mới']],
  ['lan','Công nghệ mạng LAN',Array.from({length:9},(_,i)=>'Chương '+(i+1))],
  ['distributed','Phát triển ứng dụng phân tán',['Chương 1. Tổng quan hệ thống và các mô hình trao đổi thông điệp (MEP)']]
];
const fileKinds = {pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain; charset=utf-8',md:'text/plain; charset=utf-8',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
const graded = attempt => {
  const items = parse(attempt.items), answers = parse(attempt.answers);
  const correct = items.filter(q => matchesAnswer(answers[q.id],q.correct)).length;
  const unanswered = items.filter(q => !selectedIds(answers[q.id]).length).length;
  return {correct, unanswered, wrong:items.length-correct-unanswered, total:items.length, seconds:Math.max(0, Math.round((Math.min(attempt.deadline || attempt.finished, attempt.finished)-attempt.created)/1000)), score:Math.round(correct/items.length*100)/10};
};
const publicAttempt = result => {
  const config=parse(result.config);
  // Practice can grade locally as soon as an option is selected. Exam keys
  // remain server-only until submission (including PATCH responses).
  const reveal=!!result.finished || config.mode!=='exam';
  return {
    ...result, config,
    flags:parse(result.flags), answers:parse(result.answers),
    result:result.result ? parse(result.result) : null,
    items:parse(result.items).map(({correct,explanation,...q})=>reveal
      ? {...q,correct:decodedCorrect(correct),explanation:explanation?.startsWith('Đáp án theo phần được đánh dấu') && courseExplanations[q.id] ? courseExplanations[q.id] : explanation,selectionCount:selectedIds(correct).length}
      : {...q,selectionCount:selectedIds(correct).length})
  };
};

async function api(request, env, path, owner) {
  const db = env.DB;
  const sql = (query,...args) => db.prepare(query).bind(...args);
  const method = request.method;
  const email = request.headers.get('oai-authenticated-user-email') || '';
  const isAdmin = !!env.QUIZ_OWNER_EMAIL && email.toLowerCase() === env.QUIZ_OWNER_EMAIL.toLowerCase();
  const group = path.split('/')[0];
  const managesContent = group === 'bank' || (['subjects', 'chapters', 'documents'].includes(group) && method !== 'GET');
  if (managesContent) needed(isAdmin, 'Chỉ chủ website có quyền quản lý nội dung.', 403);
  if (method !== 'GET') needed(request.headers.get('Origin') === new URL(request.url).origin,'Yêu cầu phải đến từ trang ôn tập.',403);
  const extended=await studyApi(request,env,path,owner,isAdmin);
  if(extended) return extended;
  const body = () => request.json();
  const chaptersExist = async chapter => needed(await sql('SELECT id FROM chapters WHERE id=?',chapter).first(),'Chương không tồn tại.',404);
  if (path === 'state' && method === 'GET') {
    await ensureCourseContent(env);
    // One D1 batch = one round trip for the whole catalog and learner state.
    const readState = async () => (await db.batch([
      sql('SELECT * FROM subjects ORDER BY rowid'),sql('SELECT * FROM chapters ORDER BY position,rowid'),
      sql('SELECT id,chapter,kind,tier,prompt,code FROM questions ORDER BY rowid'),
      sql('SELECT id,chapter,title,filename,mime FROM documents ORDER BY rowid'),
      // mode/total/answered/deadline let the home page name the attempt to resume.
      sql("SELECT id,chapter,created,finished,result,deadline,json_extract(config,'$.mode') AS mode,json_array_length(attempts.items) AS total, CASE WHEN finished IS NULL THEN (SELECT count(*) FROM json_each(attempts.answers) AS a WHERE (a.type='text' AND a.value<>'') OR (a.type='array' AND json_array_length(a.value)>0)) END AS answered, CASE WHEN finished IS NOT NULL THEN (SELECT json_group_array(json_object('id',json_extract(value,'$.id'),'correct',json_extract(value,'$.correct'))) FROM json_each(attempts.items)) END AS items, CASE WHEN finished IS NOT NULL THEN answers END AS answers FROM attempts WHERE owner=? ORDER BY created DESC,rowid DESC",owner),
      sql('SELECT question,learned,status,viewed_at,answered_at,updated_at FROM essays WHERE owner=?',owner),sql('SELECT name FROM profiles WHERE id=?',owner)
    ])).map(result => result.results || []);
    let rows = await readState();
    if (!rows[0].some(subject => subject.id === 'lan')) {
      await db.batch(seed.flatMap(([id,title,chapters]) => [
        sql('INSERT OR IGNORE INTO subjects (id,title) VALUES (?,?)',id,title),
        ...chapters.map((name,i) => sql('INSERT OR IGNORE INTO chapters (id,subject,title) VALUES (?,?,?)',id+'-'+(i+1),id,name))
      ]));
      rows = await readState();
    }
    const [subjects,chapters,questions,documents,history,essays,[profile]] = rows;
    let name = request.headers.get('oai-authenticated-user-full-name') || '';
    if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
      try {name=decodeURIComponent(name);} catch {name='';}
    }
    const compact = new URL(request.url).searchParams.get('compact') === '1';
    const learned = new Set(essays.filter(essay => essay.learned).map(essay => essay.question));
    const mistakes = {}, latestSeen=new Set(), unresolved=new Set();
    const summaries = history.map(({items, answers, result, ...entry}) => {
      const options = answers ? parse(answers) : {};
      const questions = items ? parse(items).map(question => ({id:question.id, correct:question.correct})) : [];
      for (const question of questions) {
        if(selectedIds(options[question.id]).length && !latestSeen.has(question.id)){latestSeen.add(question.id);if(!matchesAnswer(options[question.id],question.correct))unresolved.add(question.id);}
        if (matchesAnswer(options[question.id],question.correct)) learned.add(question.id);
        else if (selectedIds(options[question.id]).length) mistakes[question.id] = (mistakes[question.id] || 0) + 1;
      }
      return {...entry, result:result && parse(result), ...(compact ? {} : {answers:answers && options, items:items && questions})};
    });
    return json({subjects, chapters, questions, documents, history:summaries, essays,
      progress:{learned:[...learned], mistakes,unresolved:[...unresolved]}, user:{name:profile?.name || name || 'bạn', email, isAdmin}});
  }
  if (path === 'profile' && method === 'POST') {
    const name = str((await body()).name,80);
    needed(name,'Hãy nhập tên hiển thị.');
    await sql('INSERT INTO profiles VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',owner,name).run();
    return json({ok:true});
  }
  if ((path === 'subjects' || path === 'chapters') && method === 'POST') {
    const data = await body(), title = str(data.title,180);
    needed(title,'Hãy nhập tên.');
    if (path === 'subjects') await sql('INSERT INTO subjects (id,title) VALUES (?,?)',uid(),title).run();
    else {
      needed(await sql('SELECT id FROM subjects WHERE id=?',data.subject).first(),'Môn học không tồn tại.');
      await sql('INSERT INTO chapters (id,subject,title,position) VALUES (?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM chapters WHERE subject=?))',uid(),data.subject,title,data.subject).run();
    }
    return json({ok:true});
  }
  if (path === 'bank' && method === 'GET') {
    return json((await list(sql('SELECT * FROM questions ORDER BY rowid'))).map(q=>({...q,correct:decodedCorrect(q.correct),options:parse(q.options),sources:parse(q.sources),key_points:parse(q.key_points)})));
  }
  if (path === 'bank' && method === 'POST') {
    const data = await body(), records = Array.isArray(data) ? data : [data];
    needed(records.length > 0 && records.length <= 100,'Mỗi lần nhập từ 1 đến 100 câu.');
    const chapters = new Set((await list(sql('SELECT id FROM chapters'))).map(c=>c.id));
    const docs = new Map((await list(sql('SELECT id,chapter FROM documents'))).map(d=>[d.id,d.chapter]));
    const prior = !Array.isArray(data) && data?.id
      ? await sql('SELECT * FROM questions WHERE id=?',data.id).first() : null;
    if (!Array.isArray(data) && data?.id) needed(prior,'Không tìm thấy câu hỏi.',404);
    const previousOptions = prior ? parse(prior.options) : [];
    const statements = records.map((q,i)=>{
      needed(q && typeof q==='object','Câu hỏi phải là một đối tượng JSON.');
      const prompt = str(q.prompt), kind = q.kind, tier = q.tier;
      needed(prompt && chapters.has(q.chapter) && ['quiz','essay'].includes(kind) && ['main','extra'].includes(tier),'Kiểm tra nội dung, môn/chương và phân loại của câu '+(i+1)+'.');
      const options = kind === 'quiz' && Array.isArray(q.options) ? q.options.map(option => {
        const text=str(typeof option==='string'?option:option?.text,3000);
        return {id:previousOptions.find(o=>o.text===text)?.id || uid(), text};
      }) : [];
      const correctIndices = Array.isArray(q.correctIndices) ? q.correctIndices : Number.isInteger(q.correctIndex) ? [q.correctIndex] : selectedIds(q.correct).map(id=>q.options?.findIndex?.(option=>option?.id===id));
      if (kind === 'quiz') needed(options.length>=2 && options.length<=6 && options.every(o=>o.text) && new Set(options.map(o=>norm(o.text))).size===options.length && correctIndices.length>0 && new Set(correctIndices).size===correctIndices.length && correctIndices.every(i=>Number.isInteger(i)&&options[i]),'Câu '+(i+1)+' cần 2–6 phương án khác nhau và ít nhất một đáp án đúng.');
      const correctIds = correctIndices.map(i=>options[i]?.id).filter(Boolean);
      const sources = Array.isArray(q.sources) ? [...new Set(q.sources)] : [];
      needed(sources.every(id=>docs.get(id)===q.chapter),'Tài liệu nguồn phải thuộc cùng chương.');
      const explanation = longText(q.explanation||'');
      const code=str(q.code??prior?.code??'',100)||(kind==='essay'?'TL-'+uid().slice(0,8):'');
      const points=q.key_points??parse(prior?.key_points||'[]');
      needed(Array.isArray(points)&&points.length<=100&&points.every(v=>typeof v==='string'&&v.trim()&&v.length<=10000),'Các ý chính phải là danh sách văn bản.');
      if (kind === 'essay') needed(explanation,'Câu tự luận cần nội dung trả lời tham khảo.');
      const fields = [q.chapter,kind,tier,prompt,norm(prompt),explanation,JSON.stringify(options),correctIds.length>1?JSON.stringify(correctIds):correctIds[0] ?? null,JSON.stringify(sources),code,JSON.stringify(points)];
      if (!Array.isArray(data) && q.id) return sql('UPDATE questions SET chapter=?,kind=?,tier=?,prompt=?,normalized=?,explanation=?,options=?,correct=?,sources=?,code=?,key_points=? WHERE id=?',...fields,q.id);
      return sql('INSERT INTO questions (id,chapter,kind,tier,prompt,normalized,explanation,options,correct,sources,code,key_points) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'+(Array.isArray(data)?' ON CONFLICT(chapter,kind,normalized) DO NOTHING':''),uid(),...fields);
    });
    const result=await db.batch(statements);
    return json({saved:result.reduce((n,row)=>n+(row.meta.changes||0),0)});
  }
  const [,id] = path.split('/');
  if (group === 'bank' && id && method === 'DELETE') {
    await sql('DELETE FROM questions WHERE id=?',id).run();
    return json({ok:true});
  }
  if (path==='attempt' && method==='POST') {
    const data=await body();
    needed(['practice','exam','review'].includes(data.mode) && ['main','extra','all'].includes(data.tier) && Number.isInteger(data.count) && data.count>=1 && data.count<=100,'Cấu hình bài làm không hợp lệ.');
    if (data.mode==='exam') needed(Number.isInteger(data.minutes) && data.minutes>=1 && data.minutes<=180,'Thời gian thi từ 1 đến 180 phút.');
    if (Array.isArray(data.ids)) needed(data.previous,'Cần chọn bài để ôn lại.');
    // Optional explicit question list (self-test "Luyện lại các câu đoán sai"):
    // unique IDs of quiz questions in this chapter, practice/exam only.
    if (data.questionIds!==undefined) needed(Array.isArray(data.questionIds) && data.questionIds.length>=1 && data.questionIds.length<=100 && data.questionIds.every(qid=>typeof qid==='string' && qid) && new Set(data.questionIds).size===data.questionIds.length && data.mode!=='review' && !Array.isArray(data.ids) && data.count===data.questionIds.length,'Danh sách câu hỏi không hợp lệ.');
    // Chapter, question pool and the previous attempt load in one round trip.
    const [chapterRows,questionRows,previousRows=[]]=(await db.batch([
      sql('SELECT id FROM chapters WHERE id=?',data.chapter),
      sql("SELECT id,tier,prompt,options,correct,explanation,sources FROM questions WHERE chapter=? AND kind='quiz'",data.chapter),
      ...(data.previous ? [sql('SELECT chapter,items,answers,finished FROM attempts WHERE id=? AND owner=?',String(data.previous),owner)] : [])
    ])).map(result=>result.results || []);
    needed(chapterRows.length,'Chương không tồn tại.',404);
    const previous=previousRows[0];
    let qs=questionRows;
    if(data.mode==='review'){const wrong=new Set(await unresolvedQuestions(db,owner,data.chapter));qs=qs.filter(q=>wrong.has(q.id)&&(data.tier==='all'||q.tier===data.tier));}
    else if (Array.isArray(data.ids)) {
      needed(previous && previous.chapter===data.chapter && previous.finished!==null,'Không tìm thấy bài đã chấm.',404);
      const answers=parse(previous.answers);
      const misses=new Set(parse(previous.items).filter(q=>!matchesAnswer(answers[q.id],q.correct)).map(q=>q.id));
      qs=qs.filter(q=>misses.has(q.id));
    } else if (Array.isArray(data.questionIds)) {
      const wanted=new Set(data.questionIds);
      qs=qs.filter(q=>wanted.has(q.id));
      needed(qs.length===wanted.size,'Có câu hỏi không thuộc chương này.');
    } else if (data.tier!=='all') qs=qs.filter(q=>q.tier===data.tier);
    needed(qs.length,'Chương này chưa có câu hỏi phù hợp.');
    const pick=data.tier==='all'&&!data.ids ? [...shuffle(qs.filter(q=>q.tier==='main')),...shuffle(qs.filter(q=>q.tier==='extra'))] : shuffle(qs);
    // Options are shuffled as whole {id,text} objects: the key stays on the option ID.
    const items=shuffle(pick.slice(0,data.count)).map(q=>({...q,sources:parse(q.sources),options:shuffle(parse(q.options))}));
    if (previous) {
      const prior=parse(previous.items);
      if(items.length>1 && items.every((q,i)=>q.id===prior[i]?.id)) items.push(items.shift());
      for(const q of items) {
        const old=prior.find(x=>x.id===q.id);
        if(old && q.options.every((o,i)=>o.id===old.options[i]?.id)) q.options.push(q.options.shift());
      }
    }
    const attempt=uid(), now=Date.now(), deadline=data.mode==='exam'?now+data.minutes*60000:null;
    const config=JSON.stringify({chapter:data.chapter,tier:data.tier,mode:data.mode,count:data.count,minutes:data.minutes});
    await sql('INSERT INTO attempts (id,owner,chapter,created,deadline,config,items) VALUES (?,?,?,?,?,?,?)',attempt,owner,data.chapter,now,deadline,config,JSON.stringify(items)).run();
    // Return the new attempt so the browser can open it without a second request.
    return json({id:attempt, attempt:publicAttempt({id:attempt,owner,chapter:data.chapter,created:now,deadline,config,items:JSON.stringify(items),answers:'{}',flags:'[]',finished:null,result:null})});
  }
  if (group==='attempt' && id) {
    let entry=await sql('SELECT * FROM attempts WHERE id=? AND owner=?',id,owner).first();
    needed(entry,'Không tìm thấy bài làm.',404);
    let reread=false, saved=false;
    if (method==='PATCH' && !entry.finished && (!entry.deadline || Date.now()<entry.deadline)) {
      const payload=await body();
      const changes=Array.isArray(payload.changes)?payload.changes:[payload];
      needed(changes.length>0 && changes.length<=100,'Mỗi lượt lưu tối đa 100 câu.');
      const items=parse(entry.items), updates=[];
      for(const {question,option,flag} of changes) {
        const q=items.find(q=>q.id===question);
        needed(q,'Câu hỏi không thuộc bài làm.');
        if (option!==undefined) {
          const selected=selectedIds(option);
          needed((typeof option==='string'||Array.isArray(option)) && new Set(selected).size===selected.length && selected.every(id=>q.options.some(o=>o.id===id)) && (selectedIds(q.correct).length>1 || selected.length<=1),'Phương án không hợp lệ.');
          updates.push(sql('UPDATE attempts SET answers=json_set(answers,?,json(?)) WHERE id=? AND owner=? AND finished IS NULL AND (deadline IS NULL OR deadline>?)','$."'+question+'"',JSON.stringify(option),id,owner,Date.now()));
        }
        if (typeof flag==='boolean') {
          updates.push(sql('UPDATE attempts SET flags=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(flags) WHERE value<>? UNION ALL SELECT ? WHERE ?=1)) WHERE id=? AND owner=? AND finished IS NULL AND (deadline IS NULL OR deadline>?)',question,question,flag?1:0,id,owner,Date.now()));
        }
      }
      if (updates.length) {
        // Every guarded UPDATE changes one row while the attempt is open; a
        // zero means it was submitted elsewhere, so read the final state.
        saved=(await db.batch(updates)).every(result=>result.meta?.changes>0);
        reread=true;
      }
    }
    if (!entry.finished && (method==='POST' || (entry.deadline && Date.now()>=entry.deadline))) {
      for (let retry=0; retry<5; retry++) {
        entry=await sql('SELECT * FROM attempts WHERE id=? AND owner=?',id,owner).first();
        if (entry.finished) break;
        const finished=Date.now();
        const result=await sql('UPDATE attempts SET finished=?,result=? WHERE id=? AND owner=? AND finished IS NULL AND answers=?',finished,JSON.stringify(graded({...entry,finished})),id,owner,entry.answers).run();
        if (result.meta.changes) break;
        needed(retry<4,'Bài làm vừa thay đổi. Hãy nộp lại.',409);
      }
      reread=true; saved=false;
    }
    if(method==='PATCH' && saved && new URL(request.url).searchParams.get('compact')==='1') return json({ok:true,id:entry.id,finished:null});
    if(reread) entry=await sql('SELECT * FROM attempts WHERE id=? AND owner=?',id,owner).first();
    if(method==='PATCH' && !entry.finished && new URL(request.url).searchParams.get('compact')==='1') return json({ok:true,id:entry.id,finished:null});
    return json(publicAttempt(entry));
  }
  if (path==='documents' && method==='POST') {
    const form=await request.formData(), file=form.get('file'), chapter=form.get('chapter'), title=str(form.get('title'),180), existing=form.get('id');
    await chaptersExist(chapter);
    const ext=file?.name?.split('.').pop().toLowerCase();
    needed(title && file instanceof File && file.size>0 && file.size<=15*1024*1024 && Object.hasOwn(fileKinds,ext),'Chọn tài liệu hợp lệ, tối đa 15 MB.');
    const prior=existing && await sql('SELECT * FROM documents WHERE id=?',existing).first();
    if(existing) needed(prior && prior.chapter===chapter,'Tài liệu không thuộc chương này.');
    const key=uid();
    await env.BUCKET.put(key,await file.arrayBuffer());
    try {
      if (prior) await sql('UPDATE documents SET title=?,filename=?,mime=?,storage_key=? WHERE id=?',title,file.name,fileKinds[ext],key,existing).run();
      else await sql('INSERT INTO documents VALUES (?,?,?,?,?,?)',uid(),chapter,title,file.name,fileKinds[ext],key).run();
    } catch(error) {
      await env.BUCKET.delete(key);
      throw error;
    }
    if(prior) await env.BUCKET.delete(prior.storage_key);
    return json({ok:true});
  }
  if(group==='documents' && id) {
    const doc=await sql('SELECT * FROM documents WHERE id=?',id).first();
    needed(doc,'Không tìm thấy tài liệu.',404);
    if(method==='DELETE') {
      await sql('DELETE FROM documents WHERE id=?',id).run();
      await env.BUCKET.delete(doc.storage_key);
      return json({ok:true});
    }
    if(method==='GET') {
      const object=await env.BUCKET.get(doc.storage_key);
      needed(object,'Không tìm thấy tệp.',404);
      const attachment=new URL(request.url).searchParams.has('download') || doc.mime.includes('wordprocessingml');
      return new Response(object.body,{headers:{'Content-Type':doc.mime,'Content-Disposition':(attachment?'attachment':'inline')+"; filename*=UTF-8''"+encodeURIComponent(doc.filename).replace(/'/g,'%27'),'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
    }
  }
  return json({error:'Không tìm thấy chức năng.'},404);
}

export default {async fetch(request,env,ctx) {
  const path=new URL(request.url).pathname;
  const owner=request.headers.get('oai-authenticated-user-id');
  try {
    if(path==='/api/content-import') return await importSourceDocument(request,env);
    if(path==='/' && ctx?.waitUntil) ctx.waitUntil(ensureCourseContent(env).catch(error=>console.error('Content import failed',error)));
    if(path.startsWith('/api/')) {
      if(!owner) return json({error:'Vui lòng đăng nhập ChatGPT để tiếp tục.'},401);
      return await api(request,env,path.slice(5),owner);
    }
    if(path==='/') {
      // Stream the shell (with links to the cached CSS/JS) before reading the
      // learner's state, then append the state in the same response.
      const [head,tail]=assets['/'].split('<!--BOOT_STATE-->');
      const {readable,writable}=new TransformStream();
      const writer=writable.getWriter(), encoder=new TextEncoder();
      // A closed tab must not surface as an unhandled stream error.
      const write=chunk=>writer.write(encoder.encode(chunk)).catch(()=>{});
      const send=(async()=>{
        try {
          write(head);
          let boot;
          try {
            boot=owner ? await (await api(new Request(new URL('/api/state?compact=1',request.url),{headers:request.headers}),env,'state',owner)).json() : {signedOut:true};
          } catch(error) {
            console.error(error);
            boot={error:error.status ? error.message : 'Không thể tải dữ liệu học tập. Hãy thử lại.'};
          }
          const serialized=JSON.stringify(boot).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
          await write('<script type="application/json" id="initial-state">'+serialized+'</script>'+tail);
        } finally { await writer.close().catch(()=>{}); }
      })();
      ctx?.waitUntil?.(send);
      return new Response(readable,{headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
    }
    if(Object.hasOwn(assets,path)) {
      const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';
      const versionedAsset = /^\/(style|app)\.[a-f0-9]{12}\.(css|js)$/.test(path);
      return new Response(assets[path],{headers:{'Content-Type':type+'; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':versionedAsset ? 'public, max-age=31536000, immutable' : 'no-cache'}});
    }
    return new Response('Không tìm thấy trang.',{status:404});
  } catch(error) {
    if(error.status) return json({error:error.message},error.status);
    if(String(error).includes('UNIQUE constraint')) return json({error:'Tên hoặc câu hỏi này đã có trong cùng nhóm.'},409);
    console.error(error);
    return json({error:'Không thể lưu hoặc tải dữ liệu. Hãy thử lại.'},500);
  }
}};
