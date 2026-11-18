const main = document.querySelector('main');
const nav = document.querySelector('#primary-nav');
const links = [['home','⌂','Tổng quan'],['subjects','▤','Môn học'],['quiz','◈','Trắc nghiệm'],['essay','✎','Tự luận'],['docs','▱','Tài liệu'],['stats','▥','Thống kê'],['settings','⚙','Cài đặt'],['admin','⚙','Quản trị dữ liệu']];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link = (route,label,cls='') => `<a class="btn ${cls}" href="#${route}">${esc(label)}</a>`;
const opt = (value,label,current) => `<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
const field = (label,control) => `<label>${label}${control}</label>`;
const input = (name,value='',type='text',attrs='') => `<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>`;
const select = (name,options) => `<select name="${name}">${options}</select>`;
const area = (name,value='',attrs='') => `<textarea name="${name}" ${attrs}>${esc(value)}</textarea>`;
const title = (heading,desc='',cls='') => `<div class="heading ${cls}"><h1>${esc(heading)}</h1>${desc?`<p class="muted">${esc(desc)}</p>`:''}</div>`;
const empty = msg => `<div class="card empty">${esc(msg)}</div>`;
const date = value => new Date(value).toLocaleString('vi-VN');
// Main = the questions in the owner's quiz files; extra = advanced questions
// written from the course textbooks.
const tierLabel = tier => tier==='main'?'Câu hỏi chính':'Câu hỏi nâng cao';
const bar = n => `<div class="bar" role="progressbar" aria-label="Tiến độ" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n}"><i style="width:${n}%"></i></div>`;
let state, toastTimer, tick, viewGeneration=0, attemptIndex=0, wrongOnly=false, lastAttempt='';
let filter={subject:'',chapter:'',tier:'all',search:''};
const quizSettings = {mode:'practice', count:20, minutes:20};
const filterMemory = {};
let activeAttempt = null;
let stateRequest = null;
let stateLoadedAt = 0;
let learnedQuestions = new Set();
let chapterLookup = new Map();
let questionLookup = new Map();
const attemptSessions = new Map();
function sessionFor(attempt) {
  if(!attemptSessions.has(attempt.id)) {
    // A two-answer question saved with a full selection counts as checked, so
    // it stays revealed and locked after a reload.
    const checked=new Set(attempt.items.filter(q=>q.selectionCount>1&&answerIds(attempt.answers[q.id]).length===q.selectionCount).map(q=>q.id));
    attemptSessions.set(attempt.id,{attempt,pending:new Map(),saving:null,error:'',finishing:false,checked,warned:new Set()});
  }
  return attemptSessions.get(attempt.id);
}
let historyLimit = 20;
let essayLimit = 20;
let essayFilterKey = '';
let adminPanel = 1;

let bootState;
try {bootState=JSON.parse(document.querySelector('#initial-state')?.textContent || 'null');} catch {}
document.querySelector('#initial-state')?.remove();
function applyState(data) {
  state=data;
  stateLoadedAt=Date.now();
  learnedQuestions=new Set(data.progress.learned);
  chapterLookup=new Map(data.chapters.map(chapter=>[chapter.id,chapter]));
  questionLookup=new Map(data.questions.map(question=>[question.id,question]));
  return data;
}
async function loadState(force = false) {
  if(bootState) {
    const initial=bootState;bootState=null;
    if(initial.signedOut) throw Object.assign(new Error('Vui lòng đăng nhập ChatGPT để tiếp tục.'),{status:401});
    if(initial.error) throw new Error(initial.error);
    return applyState(initial);
  }
  if (!force && state && Date.now() - stateLoadedAt < 120000) return state;
  if (stateRequest) return stateRequest;
  stateRequest = api('state?compact=1').then(applyState).finally(() => { stateRequest = null; });
  return stateRequest;
}


async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
  const form = data instanceof FormData;
  let response;
  try {
    response = await fetch('/api/' + path, {
      method,
      headers:form || data === undefined ? {} : {'Content-Type':'application/json'},
      body:data === undefined ? undefined : form ? data : JSON.stringify(data),
      signal:AbortSignal.timeout(path.startsWith('backups') ? 300000 : form ? 120000 : 30000)
    });
  } catch (error) {
    throw new Error(navigator.onLine
      ? 'Kết nối bị gián đoạn. Hãy thử lại để xác nhận dữ liệu đã lưu.'
      : 'Bạn đang mất kết nối mạng. Kết nối lại để tiếp tục lưu bài.');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Máy chủ chưa phản hồi đầy đủ. Hãy thử lại.'); }
  if (!response.ok) throw Object.assign(new Error(result.error || 'Đã xảy ra lỗi.'), {status:response.status});
  return result;
}
function toast(message) {
  document.querySelector('#toast').textContent=message;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>document.querySelector('#toast').textContent='',4500);
}
function on(selector,event,handler) {
  main.querySelectorAll(selector).forEach(el=>el.addEventListener(event,async ev=>{
    try {await handler(ev,el);} catch (error) {toast(error.message);}
  }));
}
function submit(selector,handler) {
  on(selector,'submit',async (ev,form)=>{
    ev.preventDefault();
    if(form.dataset.busy) return;
    form.dataset.busy='1';
    const submitter=ev.submitter;
    if(submitter) submitter.disabled=true;
    try {await handler(new FormData(form),form,submitter);} finally {
      delete form.dataset.busy;
      if(submitter) submitter.disabled=false;
    }
  });
}
function controls(route) {
  const all=route!=='quiz';
  const subjects=state.subjects;
  const subject=all?filter.subject:filter.subject||subjects[0]?.id;
  const chapters=state.chapters.filter(c=>!subject||c.subject===subject);
  // Quiz and essay pickers mark chapters that have nothing of that kind yet
  // and default to the first chapter that does.
  const kind={quiz:'quiz',essay:'essay'}[route];
  const has=id=>!kind||state.questions.some(q=>q.chapter===id&&q.kind===kind);
  const chapter=all?filter.chapter:chapters.some(c=>c.id===filter.chapter)?filter.chapter:(chapters.find(c=>has(c.id))||chapters[0])?.id;
  const hasExtra=route==='quiz'&&state.questions.some(q=>q.chapter===chapter&&q.kind==='quiz'&&q.tier==='extra');
  if(route==='quiz'&&!hasExtra)filter.tier='all';
  return {chapter,html:`<div class="filters content-filters">
    ${field('Môn học',select('subject',(all?opt('','Tất cả môn học',subject):'')+subjects.map(s=>opt(s.id,s.title,subject)).join('')))}
    ${field('Chương',select('chapter',(all?opt('','Tất cả chương',chapter):'')+chapters.map(c=>opt(c.id,c.title+(has(c.id)?'':' — chưa có câu'),chapter)).join('')))}</div>`};
}
function bindFilters() {
  on('.content-filters select','change',(_,el)=>{
    filter[el.name]=el.value;
    if(el.name==='subject') filter.chapter='';
    render();
  });
}
function chapterName(id) {return chapterLookup.get(id)?.title || 'Chương';}
function subjectName(id) {return state.subjects.find(sub=>sub.id===id)?.title||'Môn học';}
function matches(q) {
  const chapter=chapterLookup.get(q.chapter);
  return (!filter.subject||chapter?.subject===filter.subject)&&(!filter.chapter||filter.chapter===q.chapter);
}
function history() {return state.history.filter(a=>a.result);}
function metrics() {
  const h=history();
  const scores=h.map(a=>a.result);
  const answered=scores.reduce((n,s)=>n+s.correct+s.wrong,0);
  const correct=scores.reduce((n,s)=>n+s.correct,0);
  return {h,answered,correct,wrong:answered-correct,accuracy:answered?Math.round(correct/answered*100):0,average:h.length?(scores.reduce((n,s)=>n+s.score,0)/h.length).toFixed(1):'0'};
}
function coverage(chapters) {
  const ids = new Set(chapters.map(chapter => chapter.id));
  const questions = state.questions.filter(question => ids.has(question.chapter));
  return questions.length
    ? Math.round(questions.filter(question => learnedQuestions.has(question.id)).length / questions.length * 100)
    : 0;
}
// Scores use the Vietnamese decimal comma (7,5/10).
const scoreText = value => String(value).replace('.', ',');
const shortDate = value => { const d = new Date(value), two = n => String(n).padStart(2, '0'); return two(d.getHours()) + ':' + two(d.getMinutes()) + ' ' + two(d.getDate()) + '/' + two(d.getMonth() + 1); };
const chapterShort = chapter => (chapter?.title || 'Chương').split(/[.:]/)[0].trim().slice(0, 32);
// A whole-row link: title, detail line, and the action it leads to.
const taskRow = (href, heading, detail, action, cls = '') => `<a class="task-row ${cls}" href="#${esc(href)}"><span class="row-main"><strong>${heading}</strong><small>${detail}</small></span><span class="row-end">${action}<span aria-hidden="true"> →</span></span></a>`;
function subjectCards() {
  return `<div class="panel subject-list">${state.subjects.map(subject => {
    const chapters = state.chapters.filter(chapter => chapter.subject === subject.id);
    const ids = new Set(chapters.map(chapter => chapter.id));
    const questions = state.questions.filter(question => ids.has(question.chapter));
    const quizCount = questions.filter(question => question.kind === 'quiz').length, essayCount = questions.length - quizCount;
    const progress = coverage(chapters);
    return `<a class="task-row subject-row" href="#subject/${esc(subject.id)}">
      <span class="row-main"><strong>${esc(subject.title)}</strong>
      <small>${[chapters.length + ' chương', quizCount && quizCount + ' trắc nghiệm', essayCount && essayCount + ' tự luận'].filter(Boolean).join(' · ')}</small>
      <span class="row-progress">${bar(progress)}<small>${progress}% đã học</small></span></span>
      <span class="row-end">Mở<span aria-hidden="true"> →</span></span></a>`;
  }).join('')}</div>`;
}
// One row per attempt: mode and score first, then chapter, answers and time.
function historyList(entries) {
  return entries.length?`<div class="panel">${entries.map(a=>{
    const mode=esc(attemptModes[a.mode]||'Bài làm');
    const head=a.result?`${mode} · ${scoreText(a.result.score)}/10`:`${mode} · đang làm`;
    const detail=a.result?`${a.result.correct}/${a.result.total} câu đúng`:a.total?`${a.answered||0}/${a.total} câu đã trả lời`:'';
    return taskRow('attempt/'+a.id,head,[esc(chapterName(a.chapter)),detail,shortDate(a.created)].filter(Boolean).join(' · '),a.result?'Xem kết quả':'Làm tiếp');
  }).join('')}</div>`:empty('Các bài làm sẽ xuất hiện ở đây.');
}
// Home leads with what to review now: unfinished attempts, unresolved quiz
// mistakes and essays marked for review, each one tap from the work itself.
function home() {
  const now = Date.now(), summary = metrics();
  // All unfinished attempts are counted; the two most recent get a row.
  const unfinished = state.history.filter(entry => !entry.finished), open = unfinished.slice(0, 2);
  const mistakes = new Map(), essaysDue = new Map();
  for (const id of state.progress.unresolved) { const question = questionLookup.get(id); if (question) mistakes.set(question.chapter, (mistakes.get(question.chapter) || 0) + 1); }
  for (const row of state.essays) if (row.status === 'review' && !row.learned) { const question = questionLookup.get(row.question); if (question) essaysDue.set(question.chapter, (essaysDue.get(question.chapter) || 0) + 1); }
  const mistakeTotal = [...mistakes.values()].reduce((a, b) => a + b, 0), essayTotal = [...essaysDue.values()].reduce((a, b) => a + b, 0);
  const section = (heading, rows) => `<section class="home-section"><h2>${heading}</h2><div class="panel">${rows}</div></section>`;
  const resume = open.map(entry => {
    const session = attemptSessions.get(entry.id);
    const total = session ? session.attempt.items.length : entry.total;
    const answered = session ? Object.values(session.attempt.answers).filter(value => answerIds(value).length).length : entry.answered || 0;
    const expired = entry.deadline && entry.deadline <= now;
    const left = entry.deadline && !expired ? ' · còn ' + Math.ceil((entry.deadline - now) / 60000) + ' phút' : '';
    return taskRow('attempt/' + entry.id, esc(attemptModes[entry.mode] || 'Bài làm') + ' · ' + esc(chapterName(entry.chapter)),
      (total ? answered + '/' + total + ' câu đã trả lời' : 'Đang làm') + left + ' · bắt đầu ' + shortDate(entry.created), expired ? 'Xem kết quả' : 'Làm tiếp', 'is-resume');
  }).join('') + (unfinished.length > open.length ? taskRow('stats', 'Còn ' + (unfinished.length - open.length) + ' bài đang làm dở khác', 'Xem tất cả trong lịch sử học tập', 'Xem') : '');
  const byCount = map => [...map].sort((a, b) => b[1] - a[1]);
  const mistakeRows = byCount(mistakes).map(([chapter, n]) => taskRow('quiz/' + chapter + '?mode=review', esc(chapterName(chapter)), n + ' câu còn sai · ' + esc(subjectName(chapterLookup.get(chapter)?.subject)), 'Ôn câu sai')).join('');
  const essayRows = byCount(essaysDue).map(([chapter, n]) => taskRow('essay/' + chapter + '?status=review', esc(chapterName(chapter)), n + ' câu đánh dấu cần ôn · ' + esc(subjectName(chapterLookup.get(chapter)?.subject)), 'Ôn lại')).join('');
  const lastResult = state.history.find(entry => entry.result);
  const recentEssays = [...state.essays].filter(row => row.updated_at && questionLookup.has(row.question)).sort((a, b) => b.updated_at - a.updated_at).slice(0, 3);
  const recentRows = (lastResult ? taskRow('attempt/' + lastResult.id, 'Kết quả gần nhất: ' + esc(attemptModes[lastResult.mode] || 'Bài làm') + ' · ' + scoreText(lastResult.result.score) + '/10', esc(chapterName(lastResult.chapter)) + ' · ' + lastResult.result.correct + '/' + lastResult.result.total + ' câu đúng · ' + shortDate(lastResult.created), 'Xem lại') : '')
    + recentEssays.map(row => { const question = questionLookup.get(row.question); const status = row.learned ? 'mastered' : row.status || 'unseen';
      return taskRow('essayitem/' + question.id + '?mode=answer', esc((question.code ? question.code + ' · ' : '') + question.prompt), esc(chapterName(question.chapter)) + ' · ' + studyStatuses[status], 'Mở', 'is-clamped'); }).join('');
  const due = [unfinished.length && unfinished.length + ' bài đang làm dở', mistakeTotal && mistakeTotal + ' câu trắc nghiệm còn sai', essayTotal && essayTotal + ' câu tự luận cần ôn'].filter(Boolean);
  const name = state.user.name && state.user.name !== 'bạn' ? state.user.name : 'bạn';
  main.innerHTML = `<div class="home">
    <div class="heading home-head"><h1>Chào ${esc(name)}</h1><p class="muted">${due.length ? 'Hôm nay cần ôn: ' + due.join(' · ') + '.' : 'Chưa có gì cần ôn lại. Chọn một môn để bắt đầu.'}</p></div>
    <div class="home-grid"><div class="home-main">
      ${resume ? section('Làm tiếp', resume) : ''}
      ${mistakeRows ? section('Câu trắc nghiệm còn sai', mistakeRows) : ''}
      ${essayRows ? section('Tự luận cần ôn', essayRows) : ''}
      ${due.length ? '' : `<section class="home-section"><h2>Bắt đầu</h2><div class="panel start-panel"><p>Chọn môn rồi chọn chương. <strong>Luyện tập</strong> cho biết đúng/sai và lý do ngay khi chọn; <strong>Đáp án tự luận</strong> mở sẵn các ý chính cần nhớ.</p><div class="actions">${link('subjects', 'Chọn môn học', 'primary')}${link('quiz', 'Làm trắc nghiệm')}</div></div></section>`}
      ${recentRows ? section('Học gần đây', recentRows) : ''}
    </div>
    <aside class="home-side"><section class="home-section"><h2>Môn học</h2>${subjectCards()}</section>
      <p class="home-stats">${summary.h.length ? summary.h.length + ' bài đã nộp · đúng ' + summary.accuracy + '% · điểm trung bình ' + scoreText(summary.average) + '/10' : 'Chưa nộp bài nào.'} <a href="#stats">Xem thống kê</a></p></aside>
    </div></div>`;
}
function subject(id) {
  const sub=state.subjects.find(s=>s.id===id);
  if(!sub) return main.innerHTML=empty('Không tìm thấy môn học.')+`<div class="actions section">${link('subjects','← Danh sách môn học')}</div>`;
  const chapters=state.chapters.filter(c=>c.subject===id);
  const ready=chapters.filter(c=>{const n=chapterCounts(c.id);return n.quiz||n.essay;}), waiting=chapters.filter(c=>!ready.includes(c));
  main.innerHTML=`<nav class="study-crumbs" aria-label="Điều hướng">${link('subjects','← Môn học','link')}</nav>${title(sub.title,sub.description||'Chọn chương, rồi làm bài hoặc xem đáp án.')}
    <div class="list chapter-list">${ready.map(chapterRow).join('')||empty('Môn này chưa có chương nào có câu hỏi.')}</div>
    ${waiting.length?`<details class="card section empty-chapters"><summary>${waiting.length} chương chưa có câu hỏi</summary><ul>${waiting.map(c=>{const n=chapterCounts(c.id);return `<li><a href="#chapter/${esc(c.id)}">${esc(c.title)}</a>${n.docs?` <small>· ${n.docs} tài liệu</small>`:''}</li>`;}).join('')}</ul></details>`:''}`;
}
function chapterRow(c) {
  const n=chapterCounts(c.id), progress=coverage([c]);
  return `<article class="card chapter-row"><div class="chapter-row-head"><h2><a href="#chapter/${esc(c.id)}">${esc(c.title)}</a></h2><span class="row-progress">${bar(progress)}<small>${progress}% đã học</small></span></div>${chapterActions(c.id,n,false)}</article>`;
}
function chapterCounts(id) {
  const questions=state.questions.filter(q=>q.chapter===id);
  const count=(kind,tier)=>questions.filter(q=>q.kind===kind&&(!tier||q.tier===tier)).length;
  return {quiz:count('quiz'), quizExtra:count('quiz','extra'), essay:count('essay'), essayExtra:count('essay','extra'), docs:state.documents.filter(d=>d.chapter===id).length};
}
// Actions grouped by kind (quiz, essay, documents). The chapter page gets one
// primary action; a list of several chapters (subject page) gets none.
function chapterActions(id,n=chapterCounts(id),primary=true) {
  const lead=primary?'primary':'';
  // "30 câu", or "30 chính · 10 nâng cao" once a chapter has advanced questions.
  const split=(total,extra)=>extra?(total-extra)+' chính · '+extra+' nâng cao':total+' câu';
  const row=(label,count,buttons,cls='')=>`<div class="action-row ${cls}"><span class="action-label">${label}<small>${count}</small></span><div class="action-buttons">${buttons}</div></div>`;
  const rows=[
    n.quiz&&row('Trắc nghiệm',split(n.quiz,n.quizExtra||0),link('quiz/'+id,'Làm bài',lead)+link('quizanswers/'+id,'Xem đáp án')),
    n.essay&&row('Tự luận',split(n.essay,n.essayExtra||0),link('essay/'+id,'Học từng câu',n.quiz?'':lead)+link('essayanswers/'+id,'Đáp án cả chương')),
    n.docs&&row('Tài liệu',n.docs+' tệp',link('docs/'+id,'Mở tài liệu','link'),'docs-row')
  ].filter(Boolean);
  return `<div class="chapter-actions">${rows.join('')||'<p class="muted">Chương đang chờ bổ sung nội dung.</p>'}</div>`;
}
function quiz() {
  const selection = controls('quiz');
  const chapter = chapterLookup.get(selection.chapter);
  const count = state.questions.filter(question => question.chapter === selection.chapter && question.kind === 'quiz'
    && (filter.tier === 'all' || question.tier === filter.tier) && (quizSettings.mode!=='review'||state.progress.unresolved.includes(question.id))).length;
  const selectedCount = Math.min(quizSettings.count, count);
  const isExam = quizSettings.mode === 'exam';
  const chapterQuiz = state.questions.filter(question => question.chapter === selection.chapter && question.kind === 'quiz').length;
  const modes = [['practice','Luyện tập','Biết đúng/sai và đọc giải thích ngay khi chọn; lựa chọn đầu tiên được tính.'],['review','Ôn câu sai','Chỉ các câu bạn vẫn còn làm sai trong chương.'],['exam','Thi thử','Đếm giờ; đáp án chỉ hiện sau khi nộp bài.']];
  // Two kinds of questions: main (from the chapter's quiz file) and advanced
  // (written from the textbook). The choice shows once a chapter has both.
  const inChapter = tier => state.questions.filter(question => question.chapter === selection.chapter && question.kind === 'quiz' && (tier === 'all' || question.tier === tier)).length;
  const tiers = [['main','Câu hỏi chính','Câu trong file đề của chương.'],['extra','Câu hỏi nâng cao','Câu bổ sung theo giáo trình.'],['all','Cả hai nhóm','Câu chính trước, câu nâng cao sau.']];
  const tierChoice = inChapter('extra') ? `<fieldset class="mode-choices tier-choices"><legend>Nhóm câu hỏi</legend>${tiers.map(([value,label,hint]) => `<label class="mode-choice"><input type="radio" name="tier" value="${value}" ${filter.tier === value ? 'checked' : ''}><span><strong>${label} · ${inChapter(value)}</strong><small>${hint}</small></span></label>`).join('')}</fieldset>` : '';
  document.body.classList.add('has-start-bar');
  // The chapter shows as one line; the subject/chapter pickers open on demand.
  main.innerHTML = `<nav class="study-crumbs" aria-label="Điều hướng">${chapter ? link('chapter/'+chapter.id,'← '+chapterShort(chapter),'link') : link('subjects','← Môn học','link')}</nav>
    ${title('Trắc nghiệm', '', 'compact-heading')}
    <section class="card form-card quiz-setup">
      <details class="chapter-pick" ${filter.chapter ? '' : 'open'}>
        <summary><span class="pick-text"><small>${esc(subjectName(chapter?.subject))}</small><strong>${esc(chapter?.title || 'Chọn chương')}</strong></span><span class="pick-change">Đổi chương</span></summary>
        <div class="pick-body">${selection.html}</div>
      </details>
      <form id="start" class="form-section">
        <fieldset class="mode-choices"><legend>Cách làm bài</legend>
          ${modes.map(([value,label,hint]) => `<label class="mode-choice"><input type="radio" name="mode" value="${value}" ${quizSettings.mode === value ? 'checked' : ''}><span><strong>${label}</strong><small>${hint}</small></span></label>`).join('')}
          <p class="mode-hint">${modes.find(([value]) => value === quizSettings.mode)?.[2] || ''}</p>
        </fieldset>
        ${tierChoice}
        <div class="filters">
          ${field('Số câu hỏi', input('count', selectedCount || '', 'number', `min="1" max="${Math.min(100, count) || 1}" inputmode="numeric" required ${count ? '' : 'disabled'}`))}
          <label id="time-field" ${isExam ? '' : 'hidden'}>Thời gian thi (phút)
            ${input('minutes', quizSettings.minutes, 'number', `min="1" max="180" inputmode="numeric" required ${isExam ? '' : 'disabled'}`)}
          </label>
        </div>
        <p class="form-note">${count
          ? count + ' câu phù hợp. Câu hỏi và phương án được xáo trộn mỗi lượt; đáp án đúng luôn đi cùng nội dung của nó.'
          : quizSettings.mode==='review'?'Bạn không còn câu sai cần ôn trong chương này.':'Chương này đang chờ bổ sung câu hỏi.'}</p>
        <div class="start-bar"><button class="primary" ${count ? '' : 'disabled'}>Bắt đầu làm bài →</button>
          ${chapterQuiz ? link('quizanswers/'+selection.chapter+'?tier='+filter.tier,'Xem đáp án') : ''}</div>
      </form>
      <p class="setup-links">${state.user.isAdmin ? link('admin', 'Quản trị câu hỏi', 'link') : ''}${state.documents.some(d=>d.chapter===selection.chapter) ? link('docs/' + selection.chapter, 'Tài liệu của chương', 'link') : ''}</p>
    </section>`;
  bindFilters();
  on('#start [name=tier]', 'change', (_, element) => {
    filter.tier = element.value;
    quiz();
  });
  on('#start [name=mode]', 'change', (_, element) => {
    quizSettings.mode = element.value;
    quiz();
  });
  on('#start [name=count], #start [name=minutes]', 'input', (_, element) => {
    if (element.validity.valid) quizSettings[element.name] = Number(element.value);
  });
  submit('#start', async data => {
    const previous = state.history.find(attempt => attempt.chapter === selection.chapter)?.id;
    const result = await api('attempt', {
      chapter:selection.chapter, tier:filter.tier, mode:data.get('mode'),
      count:Number(data.get('count')), minutes:Number(data.get('minutes') || quizSettings.minutes), previous
    });
    // The new attempt comes back with the response; opening it needs no extra request.
    rememberAttempt(result);
    location.hash = 'attempt/' + result.id;
  });
}
// Readable name for a source document: titles imported from file names
// ("Phát-triển-phân-tán-bài-1", "chapter08") get spaces and their file type.
// The stored title is unchanged; the owner can rename it in Quản trị.
function docLabel(doc) {
  const kind = doc.mime === 'application/pdf' ? 'PDF' : doc.mime?.includes('wordprocessingml') ? 'Word' : doc.mime?.startsWith('image/') ? 'Ảnh' : 'Văn bản';
  const name = String(doc.title || doc.filename || 'Tài liệu').replace(/\.(pdf|docx?|txt|md|png|jpe?g|webp)$/i, '').replace(/[_-]+/g, ' ').replace(/(\p{L})(\d)/gu, '$1 $2').replace(/\s+/g, ' ').trim();
  return name.charAt(0).toLocaleUpperCase('vi') + name.slice(1) + ' · ' + kind;
}
function sourceLinks(ids) {
  return ids.map(id=>state.documents.find(d=>d.id===id)).filter(Boolean).map(doc=>link('doc/'+doc.id,docLabel(doc),'link')).join('');
}
async function attempt(id, generation) {
  const cached = attemptSessions.get(id);
  const result = cached?.attempt || await api('attempt/' + id);
  if (generation !== viewGeneration) return;
  if (id !== lastAttempt) {
    lastAttempt = id;
    attemptIndex = 0;
    wrongOnly = false;
  }
  activeAttempt = result;
  sessionFor(result);
  drawAttempt(result);
}
const attemptModes = {practice:'Luyện tập', review:'Ôn câu sai', exam:'Thi thử'};
// Keep the new attempt locally (session + history) instead of reloading all state.
function rememberAttempt(result) {
  if (!result.attempt) { stateLoadedAt = 0; return; }
  sessionFor(result.attempt);
  if (!state.history.some(entry => entry.id === result.id)) state.history.unshift({id:result.id, chapter:result.attempt.chapter, created:result.attempt.created, finished:null, result:null, mode:result.attempt.config.mode, total:result.attempt.items.length, answered:0, deadline:result.attempt.deadline});
}
function attemptItems(attempt) {
  return wrongOnly ? attempt.items.filter(question => !answerMatches(attempt.answers[question.id],question.correct)) : attempt.items;
}
function attemptMounted(attempt) {
  return main.querySelector('#attempt-view')?.dataset.attempt === attempt?.id;
}
// Options with their reveal state. Labels carry the meaning; colour only repeats it.
function optionList(question, chosenValue, revealed, disabled) {
  const chosen = answerIds(chosenValue);
  return lettered(question).map(option => {
    const picked = chosen.includes(option.id);
    const state = revealed ? option.correct ? 'is-key' : picked ? 'is-wrong' : 'is-dim' : picked ? 'is-chosen' : '';
    const status = revealed
      ? option.correct ? '✓ Đáp án đúng' + (picked ? ' · Bạn chọn' : '') : picked ? '✕ Bạn chọn · Sai' : ''
      : picked ? '● Đã chọn' : '';
    return `<button type="button" class="option ${state}" aria-pressed="${picked}" data-option="${esc(option.id)}" ${disabled ? 'disabled' : ''}>
      <span class="option-letter" aria-hidden="true">${option.letter}</span>
      <span class="option-text">${esc(option.text)}${status ? `<span class="option-status">${status}</span>` : ''}</span>
    </button>`;
  }).join('');
}
// One colour per kind of content, the same on every page, always with a
// written label: Đáp án (green), Giải thích (blue), Ví dụ (amber),
// Lưu ý (orange), Nguồn (grey).
const contentKinds = {answer:'Đáp án', explain:'Giải thích', example:'Ví dụ', note:'Lưu ý', source:'Nguồn'};
// `title` is trusted HTML (already escaped); it is shown under the label only
// when it says more than the label itself ("Trả lời trọng tâm", "Vì sao…").
function contentBlock(kind, level, title, body) {
  const label = contentKinds[kind] || '';
  const plainTitle = title ? title.replace(/<[^>]+>/g, '') : '';
  const extra = plainTitle && !(label && plainKey(plainTitle).startsWith(plainKey(label)));
  const head = extra && label ? `<p class="cblock-tag">${label}</p><h${level} class="cblock-title">${title}</h${level}>`
    : `<h${level} class="cblock-tag">${label || title || ''}</h${level}>`;
  return `<section class="cblock cblock-${label ? kind : 'other'}">${head}${body}</section>`;
}
function contentLegend() {
  return `<p class="content-legend"><span class="legend-label">Màu nội dung:</span>${Object.entries(contentKinds).map(([kind, label]) => `<span class="legend-chip cblock-${kind}">${label}</span>`).join('')}</p>`;
}
// Reasoning ("Vì sao … đúng?"), any "Lưu ý:" note and the sources of a quiz
// question, as separate labelled blocks. Text is only regrouped, never cut.
function whyBlock(question, level = 3) {
  const keys = lettered(question).filter(option => option.correct);
  const parts = explanationParts(question.explanation, keys.map(option => option.text));
  const letters = joinLetters(keys.map(option => option.letter));
  let reasoning = '', notes = '';
  for (const paragraph of parts.why ? parts.why.split(/\n\s*\n/) : []) {
    for (const part of noteParts(paragraph)) {
      if (part.kind === 'note') notes += `<p>${esc(part.text)}</p>`;
      else reasoning += `<p>${esc(part.text)}</p>`;
    }
  }
  const heading = 'Vì sao ' + (letters ? (keys.length > 1 ? 'các đáp án ' : 'đáp án ') + letters : 'đáp án này') + ' đúng?';
  const links = sourceLinks(question.sources || []);
  return contentBlock('explain', level, heading, reasoning || '<p>Chưa có giải thích cho câu này.</p>')
    + (notes ? contentBlock('note', level, '', notes) : '')
    + (parts.source || links ? contentBlock('source', level, '', (parts.source ? `<p>${esc(parts.source)}</p>` : '') + (links ? `<div class="actions source-links">${links}</div>` : '')) : '');
}
function verdict(question, value, completed) {
  const picked = chosenLetters(question, value), key = joinLetters(keyLetters(question));
  if (!picked.length) return `<div class="verdict neutral" role="status"><strong>— Chưa trả lời</strong><span>Đáp án đúng: ${key}.</span></div>`;
  return answerMatches(value, question.correct)
    ? `<div class="verdict good" role="status"><strong>✓ Chính xác</strong><span>Bạn chọn ${joinLetters(picked)}${completed ? '' : ' — đúng đáp án'}.</span></div>`
    : `<div class="verdict bad" role="status"><strong>✕ Chưa đúng</strong><span>Bạn chọn ${joinLetters(picked)}; đáp án đúng: ${key}.</span></div>`;
}
function drawAttempt(attempt) {
  clearInterval(tick);
  activeAttempt = attempt;
  const completed = !!attempt.finished;
  const result = attempt.result;
  document.body.classList.toggle('taking-quiz', !completed);
  document.body.classList.toggle('review-quiz', completed);
  const items = attemptItems(attempt);
  if (attemptIndex >= items.length) attemptIndex = 0;
  const previousSheet = main.querySelector('#answer-sheet');
  const sheetOpen = previousSheet ? previousSheet.open : matchMedia('(min-width: 681px)').matches;
  // Results read like a tutor's note: the score, one line of what to do next,
  // and reviewing the missed questions as the main action.
  const missed = completed ? result.wrong + result.unanswered : 0;
  const advice = !completed ? '' : !missed ? 'Bạn trả lời đúng tất cả. Có thể thử Thi thử hoặc chuyển sang chương khác.'
    : result.score >= 8 ? `Rất tốt. Xem lại ${missed} câu chưa đúng để chắc chắn trước khi thi.`
    : result.score >= 5 ? `Khá. Đọc phần “Vì sao” của ${missed} câu chưa đúng rồi luyện lại riêng các câu đó.`
    : `Cần ôn thêm. Bắt đầu với ${missed} câu chưa đúng: đọc phần “Vì sao”, rồi luyện lại riêng các câu này.`;
  const summary = completed ? `<section class="result-panel card" aria-labelledby="result-title">
      <h1 id="result-title" tabindex="-1">Kết quả <span class="score">${scoreText(result.score)}<small>/10</small></span></h1>
      <p class="result-line">${result.correct}/${result.total} câu đúng (${Math.round(result.correct/result.total*100)}%)${result.wrong ? ' · ' + result.wrong + ' sai' : ''}${result.unanswered ? ' · ' + result.unanswered + ' chưa trả lời' : ''} · ${Math.floor(result.seconds / 60)} phút ${result.seconds % 60} giây</p>
      <p class="result-advice">${advice}</p>
      <div class="actions result-actions">
        ${missed ? `<button id="wrong-only" class="${wrongOnly ? '' : 'primary'}" aria-pressed="${wrongOnly}">${wrongOnly ? 'Xem toàn bài' : 'Xem lại ' + missed + ' câu chưa đúng'}</button><button id="retry-wrong" class="${wrongOnly ? 'primary' : ''}">Luyện lại câu chưa đúng</button>` : ''}
        <button id="retry" class="${missed ? '' : 'primary'}">Làm lại bài</button>${link('chapter/'+attempt.chapter,'Về chương','link')}
      </div>
    </section>` : '';
  main.innerHTML = `<div id="attempt-view" data-attempt="${esc(attempt.id)}">${summary}
    <div class="attempt-bar ${!completed && attempt.deadline ? 'has-timer' : ''}">
      <div class="attempt-meta">${completed ? `<strong>${attemptModes[attempt.config.mode] || 'Bài làm'} · Xem lại</strong>` : `<h1 class="attempt-heading">${attemptModes[attempt.config.mode] || 'Bài làm'}</h1>`}<small class="attempt-chapter">${esc(chapterName(attempt.chapter))}</small><small id="attempt-count"></small></div>
      <div class="attempt-progress" aria-hidden="true"><div class="bar"><i id="attempt-fill"></i></div></div>
      ${!completed && attempt.deadline ? '<p class="timer" id="timer" role="timer" aria-label="Thời gian còn lại"></p>' : ''}
      ${completed ? '' : '<button id="finish" type="button">Nộp bài</button>'}
    </div>
    ${items.length ? `<div class="quizgrid">
      <div class="question-column">
      <section class="card question-card" id="question-card"></section>
      <nav class="question-actions" aria-label="Chuyển câu">
        <button type="button" id="prev" data-key-prev><span class="nav-long">← Câu trước</span><span class="nav-short">← Trước</span></button>
        <span class="question-position" id="question-position" aria-live="polite"></span>
        <button type="button" id="next" class="primary" data-key-next><span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span></button>
      </nav>
      <p class="kbd-hint">Phím tắt: <kbd>1</kbd>–<kbd>4</kbd> hoặc <kbd>A</kbd>–<kbd>D</kbd> chọn · <kbd>Enter</kbd> nút chính · <kbd>←</kbd> <kbd>→</kbd> chuyển câu · <kbd>M</kbd> đánh dấu</p>
      </div>
      <aside class="card attempt-side">
        <details id="answer-sheet" ${sheetOpen ? 'open' : ''}>
          <summary>${completed ? 'Xem lại từng câu' : 'Danh sách câu hỏi'} · ${items.length}</summary>
          <div class="tiles">${items.map((_, index) => `<button type="button" data-index="${index}">${index + 1}</button>`).join('')}</div>
          <div class="tile-legend">${completed || attempt.config.mode !== 'exam' ? '<span class="legend-good">✓ Đúng</span><span class="legend-bad">✕ Sai</span>' : ''}<span class="legend-chosen">● Đã chọn</span><span class="legend-flag">⚑ Đánh dấu</span></div>
        </details>
      </aside>
    </div>` : empty('Không có câu nào trong danh sách này.')}
  </div>`;
  const view = main.querySelector('#attempt-view');
  // One delegated listener per drawn attempt; switching questions only
  // replaces the question card and updates the tiles in place.
  view.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target || target.disabled || !view.contains(target)) return;
    const session = sessionFor(activeAttempt);
    const current = attemptItems(activeAttempt)[attemptIndex];
    try {
      if (target.dataset.index !== undefined) moveAttempt(Number(target.dataset.index));
      else if (target.id === 'prev') moveAttempt(attemptIndex - 1);
      else if (target.id === 'next') {
        // The bar's main button follows the situation: next, check, submit, back to results.
        const action = target.dataset.action;
        if (action === 'check') revealChecked(current);
        else if (action === 'finish') openSubmitSheet();
        else if (action === 'top') { window.scrollTo(0, 0); main.querySelector('#result-title')?.focus({preventScroll:true}); }
        else moveAttempt(attemptIndex + 1);
      }
      else if (target.dataset.jump !== undefined) { main.querySelector('#submit-sheet')?.close(); moveAttempt(Number(target.dataset.jump)); }
      else if (target.id === 'confirm-submit') { main.querySelector('#submit-sheet')?.close(); await saveAttempt({}, 'POST'); }
      else if (target.dataset.option !== undefined) {
        const id = target.dataset.option, selected = answerIds(activeAttempt.answers[current.id]);
        const option = current.selectionCount > 1 ? selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] : id;
        await saveAttempt({question:current.id, option}, 'PATCH');
      }
      else if (target.id === 'check-answer') revealChecked(current);
      else if (target.id === 'retry-save') await flushAttempt(session);
      else if (target.id === 'flag') await saveAttempt({question:current.id, flag:!activeAttempt.flags.includes(current.id)}, 'PATCH');
      else if (target.id === 'finish') openSubmitSheet();
      else if (target.id === 'wrong-only') { wrongOnly = !wrongOnly; attemptIndex = 0; drawAttempt(activeAttempt); }
      else if (target.id === 'retry' || target.id === 'retry-wrong') await retryAttempt(target.id === 'retry-wrong', target);
    } catch (error) { toast(error.message); }
  });
  renderQuestion();
  if (!completed && attempt.deadline) {
    const session = sessionFor(attempt);
    const show = seconds => {
      const timer = main.querySelector('#timer');
      if (!timer) return;
      timer.textContent = '⏱ ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      timer.classList.toggle('warn', seconds <= 300);
      timer.classList.toggle('urgent', seconds <= 60);
    };
    // Spoken/visible warnings once at 5 and 1 minutes left (toast is a live region).
    // A mark is skipped when the whole exam is not much longer than it.
    const duration = (attempt.deadline - attempt.created) / 1000;
    const warn = seconds => {
      for (const [limit, message] of [[60, 'Còn 1 phút. Bài sẽ tự nộp khi hết giờ.'], [300, 'Còn 5 phút. Xem lại các câu chưa trả lời hoặc đã đánh dấu.']]) {
        if (duration > limit + 30 && seconds > 0 && seconds <= limit && !session.warned.has(limit)) { session.warned.add(limit); if (limit === 60) session.warned.add(300); toast(message); break; }
      }
    };
    const update = () => {
      const seconds = Math.max(0, Math.ceil((attempt.deadline - Date.now()) / 1000));
      show(seconds); warn(seconds);
      if (!seconds && !session.finishing && !session.error) {
        clearInterval(tick);
        main.querySelector('#submit-sheet')?.close();
        saveAttempt({}, 'POST').then(() => toast('Hết giờ. Bài thi đã được nộp tự động.')).catch(() => {});
      }
    };
    tick = setInterval(update, 1000);
    // Show the time at once; expiry is submitted by the interval after the controls exist.
    const seconds = Math.max(0, Math.ceil((attempt.deadline - Date.now()) / 1000));
    show(seconds); warn(seconds);
  }
}
function renderQuestion() {
  const attempt = activeAttempt;
  if (!attemptMounted(attempt)) return;
  const session = sessionFor(attempt);
  const completed = !!attempt.finished, submitting = session.finishing, practice = attempt.config.mode !== 'exam';
  const items = attemptItems(attempt);
  const question = items[attemptIndex];
  const answered = Object.values(attempt.answers).filter(value => answerIds(value).length).length;
  main.querySelector('#attempt-count').textContent = answered + '/' + attempt.items.length + ' câu đã trả lời';
  main.querySelector('#attempt-fill').style.width = Math.round(answered / attempt.items.length * 100) + '%';
  const finish = main.querySelector('#finish');
  if (finish) finish.disabled = submitting;
  if (!question) return;
  const selected = answerIds(attempt.answers[question.id]);
  const feedback = !completed && practice && (question.selectionCount > 1 ? session.checked.has(question.id) : selected.length > 0);
  const revealed = completed || feedback;
  const flagged = attempt.flags.includes(question.id);
  const saveText = session.error || (session.saving || session.pending.size ? 'Đang lưu… Bạn có thể tiếp tục làm bài.' : answered ? 'Đã lưu bài làm' : 'Chọn phương án để trả lời');
  main.querySelector('#question-card').innerHTML = `
    <div class="qa-main"><div class="question-top"><span class="badge">Câu ${attemptIndex + 1}/${items.length}</span>
      ${question.selectionCount > 1 ? `<span class="badge multi-badge">Chọn ${question.selectionCount} đáp án</span>` : ''}
      ${question.tier === 'extra' ? '<span class="badge tier-badge">Nâng cao</span>' : ''}
      ${completed ? `<small>${tierLabel(question.tier)}</small>` : `<button type="button" class="icon flag-button" id="flag" aria-pressed="${flagged}" ${submitting ? 'disabled' : ''}>${flagged ? '⚑ Đã đánh dấu' : '⚐ Đánh dấu'}</button>`}
    </div>
    <h2 class="question-title" id="question-title" tabindex="-1">${esc(question.prompt)}</h2>
    ${question.selectionCount > 1 && !revealed ? `<p class="multi-hint">Câu này có ${question.selectionCount} đáp án đúng. Chỉ tính đúng khi chọn đủ và không chọn thừa.</p>` : ''}
    <div class="options" role="group" aria-labelledby="question-title">${optionList(question, attempt.answers[question.id], revealed, completed || submitting || feedback)}</div>
    ${!completed && practice && question.selectionCount > 1 && !feedback ? `<div class="actions practice-check"><button type="button" id="check-answer" ${selected.length !== question.selectionCount ? 'disabled' : ''}>Kiểm tra đáp án</button><small class="muted">Đã chọn ${selected.length}/${question.selectionCount}</small></div>` : ''}
    ${!completed ? `<span class="save-status ${session.error ? 'notice' : ''}" role="status">${esc(saveText)}</span>${session.error ? '<button type="button" id="retry-save" class="link">Thử lưu lại</button>' : ''}` : ''}
    ${!revealed && question.sources?.length ? `<div class="actions source-links">${sourceLinks(question.sources)}</div>` : ''}</div>
    ${revealed ? `<div class="qa-aside">${verdict(question, attempt.answers[question.id], completed) + (feedback ? `<p class="lock-note">Lựa chọn đã được ghi và không đổi được.${answerMatches(attempt.answers[question.id], question.correct) ? '' : ' Câu này sẽ vào “Ôn câu sai” sau khi nộp bài.'}</p>` : '') + whyBlock(question)}</div>` : ''}`;
  main.querySelector('#question-card').classList.toggle('is-revealed', revealed);
  main.querySelectorAll('.tiles [data-index]').forEach(button => {
    const index = Number(button.dataset.index), entry = items[index];
    const chosen = answerIds(attempt.answers[entry.id]).length > 0;
    const checked = completed || (practice && chosen && (entry.selectionCount <= 1 || session.checked.has(entry.id)));
    const status = checked ? answerMatches(attempt.answers[entry.id], entry.correct) ? 'correct' : 'wrong' : chosen ? 'selected' : '';
    const flaggedEntry = attempt.flags.includes(entry.id);
    button.className = [status, index === attemptIndex ? 'current' : '', flaggedEntry ? 'flagged' : ''].filter(Boolean).join(' ');
    button.setAttribute('aria-label', 'Câu ' + (index + 1) + ({correct:', đúng', wrong:', sai', selected:', đã trả lời'}[status] || ', chưa trả lời') + (flaggedEntry ? ', đã đánh dấu' : ''));
    if (index === attemptIndex) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    button.disabled = submitting;
  });
  main.querySelector('#question-position').textContent = (attemptIndex + 1) + '/' + items.length;
  main.querySelector('#prev').disabled = attemptIndex === 0 || submitting;
  // Main button: check a completed two-answer pick, submit on the last
  // question, return to the results when reviewing, otherwise go next.
  const last = attemptIndex === items.length - 1;
  const action = !completed && practice && question.selectionCount > 1 && !feedback && selected.length === question.selectionCount ? 'check'
    : last ? (completed ? 'top' : 'finish') : 'next';
  const next = main.querySelector('#next');
  if (next.dataset.action !== action) {
    next.dataset.action = action;
    next.innerHTML = {check:'Kiểm tra đáp án', finish:'Nộp bài', top:'↑ Về kết quả', next:'<span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span>'}[action];
    next.classList.toggle('is-check', action === 'check');
    if (action === 'next') next.setAttribute('data-key-next', ''); else next.removeAttribute('data-key-next');
  }
  next.disabled = submitting;
}
// Two-answer questions reveal on an explicit check; the pick is then locked.
function revealChecked(question) {
  const session = sessionFor(activeAttempt);
  if (answerIds(activeAttempt.answers[question.id]).length !== question.selectionCount) return;
  session.checked.add(question.id);
  renderQuestion();
  showVerdict();
}
// After an answer is shown, bring the verdict and the start of "Vì sao" into
// view (on phones it otherwise sits under the bottom bar). Wide screens show
// them beside the options, so they only scroll when still out of view.
function showVerdict() {
  const box = main.querySelector('#question-card .verdict');
  if (!box) return;
  box.scrollIntoView({block:matchMedia('(min-width: 1200px)').matches ? 'nearest' : 'start'});
}
// In-page submit sheet: what is unanswered or flagged, with jumps back to it.
function openSubmitSheet() {
  const attempt = activeAttempt, practice = attempt.config.mode !== 'exam';
  const view = main.querySelector('#attempt-view');
  if (!view || attempt.finished) return;
  const indexed = attempt.items.map((question, index) => [question, index]);
  const unanswered = indexed.filter(([question]) => !answerIds(attempt.answers[question.id]).length);
  const flagged = indexed.filter(([question]) => attempt.flags.includes(question.id));
  const chips = list => list.map(([, index]) => `<button type="button" class="chip" data-jump="${index}">Câu ${index + 1}</button>`).join('');
  const seconds = attempt.deadline ? Math.max(0, Math.ceil((attempt.deadline - Date.now()) / 1000)) : null;
  let sheet = view.querySelector('#submit-sheet');
  if (!sheet) { view.insertAdjacentHTML('beforeend', '<dialog id="submit-sheet" class="sheet" aria-labelledby="submit-title"></dialog>'); sheet = view.querySelector('#submit-sheet'); }
  sheet.innerHTML = `<form method="dialog" class="sheet-body">
    <h2 id="submit-title">${practice ? 'Nộp lượt luyện tập?' : 'Nộp bài thi?'}</h2>
    <p>Đã trả lời <strong>${attempt.items.length - unanswered.length}/${attempt.items.length}</strong> câu${seconds !== null ? ' · còn ' + Math.floor(seconds / 60) + ' phút ' + (seconds % 60) + ' giây' : ''}.</p>
    ${unanswered.length ? `<div class="sheet-group"><h3>Chưa trả lời (${unanswered.length})</h3><div class="chips">${chips(unanswered)}</div></div>` : '<p class="verdict good"><strong>✓ Đã trả lời tất cả các câu</strong></p>'}
    ${flagged.length ? `<div class="sheet-group"><h3>⚑ Đã đánh dấu để xem lại (${flagged.length})</h3><div class="chips">${chips(flagged)}</div></div>` : ''}
    <p class="muted">${practice ? 'Kết quả tính theo lựa chọn đã ghi của từng câu.' : 'Sau khi nộp, bạn sẽ thấy điểm, đáp án đúng và giải thích của từng câu. Bài đã nộp không sửa được.'}</p>
    <div class="sheet-actions"><button type="submit" value="cancel" autofocus>Làm tiếp</button><button type="button" class="primary" id="confirm-submit">Nộp bài</button></div>
  </form>`;
  sheet.showModal();
}
function moveAttempt(index) {
  const items = attemptItems(activeAttempt);
  if (index < 0 || index >= items.length) return;
  attemptIndex = index;
  renderQuestion();
  const card = main.querySelector('#question-card');
  document.querySelector('#question-title')?.focus({preventScroll:true});
  if (card && (matchMedia('(max-width: 680px)').matches || card.getBoundingClientRect().top < 0)) card.scrollIntoView({block:'start'});
}
async function retryAttempt(wrong, element) {
  element.disabled = true;
  try {
    const config = activeAttempt.config;
    const result = await api('attempt', {...config, previous:activeAttempt.id, ...(wrong ? {ids:[], mode:'practice', count:activeAttempt.items.length} : {})});
    rememberAttempt(result);
    location.hash = 'attempt/' + result.id;
  } finally { element.disabled = false; }
}
function updateSaveStatus(session) {
  if(!attemptMounted(session.attempt) || location.hash!=='#attempt/'+session.attempt.id) return;
  const label=main.querySelector('.save-status');
  if(label) {
    label.textContent=session.error || (session.saving || session.pending.size ? 'Đang lưu… Bạn có thể tiếp tục làm bài.' : 'Đã lưu bài làm');
    label.classList.toggle('notice',!!session.error);
  }
}
async function flushAttempt(session) {
  clearTimeout(session.timer);
  if(session.saving) return session.saving;
  session.error='';
  session.saving=(async()=>{
    while(session.pending.size) {
      const changes=[...session.pending.values()];
      session.pending.clear();
      try {
        const saved=await api('attempt/'+session.attempt.id+'?compact=1',{changes},'PATCH');
        if(saved.finished) {
          session.attempt=saved;
          session.pending.clear();
          if(location.hash==='#attempt/'+saved.id) {activeAttempt=saved;drawAttempt(saved);}
        }
      } catch(error) {
        for(const change of changes) session.pending.set(change.question,{...change,...session.pending.get(change.question)});
        session.error='Chưa lưu được. Bài làm vẫn ở đây; hãy thử lưu lại.';
        if(location.hash==='#attempt/'+session.attempt.id) renderQuestion();
        toast(error.message);
        throw error;
      }
    }
  })().finally(()=>{session.saving=null;updateSaveStatus(session);});
  updateSaveStatus(session);
  return session.saving;
}
async function saveAttempt(data, method) {
  const session=sessionFor(activeAttempt);
  if(session.finishing || session.attempt.finished) return;
  if(method==='PATCH') {
    let revealNow=false;
    if(data.option!==undefined) {
      // Practice locks a question once its answer is shown: the first pick counts.
      const question=session.attempt.items.find(q=>q.id===data.question), practice=session.attempt.config.mode!=='exam';
      if(practice&&question&&(question.selectionCount>1?session.checked.has(question.id):answerIds(session.attempt.answers[question.id]).length>0)) return;
      revealNow=practice&&!!question&&question.selectionCount<=1&&answerIds(data.option).length>0;
      session.attempt.answers[data.question]=data.option;
    }
    if(typeof data.flag==='boolean') session.attempt.flags=data.flag?[...new Set([...session.attempt.flags,data.question])]:session.attempt.flags.filter(id=>id!==data.question);
    session.pending.set(data.question,{...session.pending.get(data.question),...data});
    session.error='';
    renderQuestion();
    if(revealNow) {
      // The answer and "why" appear below the options: bring the verdict into view.
      showVerdict();
      main.querySelector('#next')?.focus({preventScroll:true});
    } else if(data.option!==undefined) {
      const focused=Array.isArray(data.option)?data.option.at(-1):data.option;
      if(focused) main.querySelector('[data-option="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
    } else main.querySelector('#flag')?.focus({preventScroll:true});
    clearTimeout(session.timer);
    session.timer=setTimeout(()=>flushAttempt(session).catch(()=>{}),120);
    return;
  }
  session.finishing=true;
  renderQuestion();
  try {
    await flushAttempt(session);
    const saved=session.attempt.finished?session.attempt:await api('attempt/'+session.attempt.id,{},'POST');
    session.attempt=saved;
    session.finishing=false;
    stateLoadedAt=0;
    loadState(true).catch(()=>{});
    if(location.hash==='#attempt/'+saved.id) {
      activeAttempt=saved;
      drawAttempt(saved);
      main.focus({preventScroll:true});
      window.scrollTo(0,0);
    }
  } finally {
    if(session.finishing) {
      session.finishing=false;
      if(location.hash==='#attempt/'+session.attempt.id) renderQuestion();
    }
  }
}


// Documents: the search box always shows, subject/chapter/sort open on demand;
// compact rows grouped by chapter (or one A–Z list).
let docSort='chapter';
function docs() {
  const c=controls('docs');
  const chapter=chapterLookup.get(filter.chapter), sub=state.subjects.find(s=>s.id===filter.subject);
  const scope=chapter?chapterShort(chapter)+' · '+subjectName(chapter.subject):sub?sub.title:'Tất cả môn học';
  main.innerHTML=`<nav class="study-crumbs" aria-label="Điều hướng">${chapter?link('chapter/'+chapter.id,'← '+chapterShort(chapter),'link'):link('home','← Tổng quan','link')}</nav>${title('Thư viện tài liệu','','compact-heading')}<section class="card filter-card"><label class="search-field"><span class="sr-only">Tìm tài liệu</span>${input('search',filter.search,'search','placeholder="Tìm theo tên tài liệu hoặc tên tệp"')}</label><details class="filter-more"><summary>Lọc và sắp xếp<small>${esc(scope)}</small></summary><div class="filter-more-body">${c.html}<div class="filters">${field('Sắp xếp',select('doc-sort',opt('chapter','Theo chương',docSort)+opt('title','Tên tài liệu A–Z',docSort)))}</div></div></details></section><div id="doclist" class="section"></div>`;
  const order=new Map(state.chapters.map((chapter,i)=>[chapter.id,i]));
  const row=(d,detail)=>`<div class="list-row"><a class="row-link" href="#doc/${esc(d.id)}"><strong>${esc(docLabel(d))}</strong><small>${detail}</small></a><a class="row-side" href="/api/documents/${esc(d.id)}?download" aria-label="Tải xuống: ${esc(docLabel(d))}">Tải xuống</a></div>`;
  const update=()=>{
    const term=filter.search.toLocaleLowerCase('vi');
    const docs=state.documents.filter(q=>matches(q)&&[q.title,q.filename].some(s=>s.toLocaleLowerCase('vi').includes(term))).sort((a,b)=>a.title.localeCompare(b.title,'vi',{numeric:true}));
    let html;
    if(docSort==='chapter'){
      const groups=new Map();for(const d of docs){if(!groups.has(d.chapter))groups.set(d.chapter,[]);groups.get(d.chapter).push(d);}
      html=[...groups].sort((a,b)=>(order.get(a[0])??1e9)-(order.get(b[0])??1e9)).map(([id,list])=>`<section class="doc-group"><h2>${esc(chapterName(id))}<small>${list.length} tài liệu</small></h2><div class="panel">${list.map(d=>row(d,esc(d.filename))).join('')}</div></section>`).join('');
    } else html=docs.length?`<div class="panel">${docs.map(d=>row(d,esc(chapterName(d.chapter))+' · '+esc(d.filename))).join('')}</div>`:'';
    main.querySelector('#doclist').innerHTML=html||empty('Chưa có tài liệu phù hợp.');
  };
  update();bindFilters();on('[name=doc-sort]','change',(_,el)=>{docSort=el.value;update();});
  on('[name=search]','input',(_,el)=>{filter.search=el.value;update();});
}
async function readDocx(path) {
  const response=await fetch(path);
  if(!response.ok) throw new Error('Không thể mở tài liệu Word.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  const view=new DataView(bytes.buffer);
  const u16=i=>view.getUint16(i,true), u32=i=>view.getUint32(i,true);
  let end=bytes.length-22;
  while(end>=Math.max(0,bytes.length-65557)&&u32(end)!==0x06054b50) end--;
  if(end<Math.max(0,bytes.length-65557)) throw new Error('Tệp Word không hợp lệ.');
  let offset=u32(end+16);
  for(let i=0;i<u16(end+10)&&offset+46<=end;i++) {
    if(u32(offset)!==0x02014b50) break;
    const length=u16(offset+28);
    const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+length));
    if(name==='word/document.xml') {
      const compressed=u32(offset+20), size=u32(offset+24), local=u32(offset+42), method=u16(offset+10);
      if(size>8*1024*1024||local+30>bytes.length||u32(local)!==0x04034b50) break;
      const start=local+30+u16(local+26)+u16(local+28);
      if(start+compressed>offset||![0,8].includes(method)) break;
      let xmlBytes=bytes.subarray(start,start+compressed);
      if(method===8) {
        const reader=new Blob([xmlBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        xmlBytes=new Uint8Array(size);
        let written=0;
        try {
          while(true) {
            const {done,value}=await reader.read();
            if(done) break;
            if(written+value.length>size) throw new Error('Kích thước nội dung Word không hợp lệ.');
            xmlBytes.set(value,written);written+=value.length;
          }
        } finally {await reader.cancel();}
        if(written!==size) break;
      }
      const xml=new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes),'application/xml');
      const paragraphs=[...xml.getElementsByTagNameNS('*','p')].map(p=>[...p.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join(''));
      return paragraphs.join('\n');
    }
    offset+=46+length+u16(offset+30)+u16(offset+32);
  }
  throw new Error('Không thể đọc văn bản từ tệp Word này.');
}
async function doc(id,generation) {
  const d=state.documents.find(q=>q.id===id);
  if(!d)return main.innerHTML=empty('Không tìm thấy tài liệu.');
  const path='/api/documents/'+d.id;
  let preview='';
  if(d.mime==='application/pdf') preview=`<iframe class="preview" title="${esc(d.title)}" src="${path}"></iframe>`;
  if(d.mime.startsWith('image/')) preview=`<img class="preview-image" src="${path}" alt="${esc(d.title)}">`;
  if(d.mime.startsWith('text/')) {
    const res=await fetch(path);
    if(!res.ok) throw new Error('Không thể mở nội dung tài liệu.');
    preview=`<div class="card content">${esc(await res.text())}</div>`;
  }
  if(d.mime.includes('wordprocessingml')) {
    try {preview=`<div class="card content">${esc(await readDocx(path)||'Tài liệu không có văn bản để xem trước.')}</div>`;}
    catch(error) {preview=empty(error.message+' Bạn có thể tải xuống để mở tệp.');}
  }
  if(generation!==viewGeneration) return;
  main.innerHTML=`${title(docLabel(d),chapterName(d.chapter))}<div class="actions"><a class="btn primary" href="${path}?download">Tải xuống</a>${link('docs','Về thư viện')}</div><div class="section">${preview||empty('Tải tệp DOCX xuống để đọc trong Word hoặc trình đọc tương thích.')}</div>`;
}
function stats() {
  const m=metrics();
  const misses = new Map(Object.entries(state.progress.mistakes));
  const frequent=[...misses].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]);
  // One summary line instead of number tiles; each frequent mistake opens its
  // answer and the chapter's "Ôn câu sai" practice.
  const summary=m.h.length?`${m.h.length} bài đã nộp · ${m.answered} câu đã trả lời · đúng ${m.accuracy}% (${m.correct}/${m.answered} câu) · điểm trung bình ${scoreText(m.average)}/10`:'Chưa nộp bài nào.';
  const mistakeRow=([id,n])=>{const q=questionLookup.get(id);
    return q?`<div class="list-row"><a class="row-link is-clamped" href="#quizanswers/${esc(q.chapter)}?q=${esc(q.id)}"><strong>${esc(q.prompt)}</strong><small>Sai ${n} lần · ${esc(chapterName(q.chapter))}</small></a><a class="row-side" href="#quiz/${esc(q.chapter)}?mode=review">Ôn câu sai</a></div>`
      :`<div class="list-row"><span class="row-link"><strong>Câu hỏi đã xóa</strong><small>Sai ${n} lần</small></span></div>`;};
  const progress=state.subjects.map(s=>{const chapters=state.chapters.filter(c=>c.subject===s.id), n=coverage(chapters);
    return `<details class="progress-group"><summary><span>${esc(s.title)}</span><span class="progress-value">${bar(n)}<small>${n}%</small></span></summary><ul class="progress-list">${chapters.map(c=>{const v=coverage([c]);return `<li><a href="#chapter/${esc(c.id)}">${esc(c.title)}</a><span class="progress-value">${bar(v)}<small>${v}%</small></span></li>`;}).join('')}</ul></details>`;}).join('');
  main.innerHTML=`<nav class="study-crumbs" aria-label="Điều hướng">${link('home','← Tổng quan','link')}</nav>${title('Thống kê học tập','','compact-heading')}<p class="stats-summary">${summary}${frequent.length?` · ${frequent.length} câu sai từ 2 lần`:''}</p>
  <div class="split stats-split"><section><h2>Tiến độ theo môn và chương</h2><div class="panel progress-panel">${progress}</div></section><section><h2>Câu thường trả lời sai</h2>${frequent.length?`<div class="panel">${frequent.map(mistakeRow).join('')}</div>`:'<p class="muted">Chưa có câu nào sai từ hai lần.</p>'}</section></div>
  ${studyStats()}
  <section class="section"><h2>Lịch sử học tập</h2>${historyList(state.history.slice(0,historyLimit))}${state.history.length>historyLimit?'<div class="pager"><button id="more-history">Xem thêm bài làm</button></div>':''}</section>`;
  on('#more-history','click',()=>{historyLimit+=20;stats();});
}
function account() {
  main.innerHTML=`${title('Tài khoản')}<section class="card"><form id="profileform">${field('Tên hiển thị',input('name',state.user.name,'text','required maxlength="80"'))}${field('Email ChatGPT',input('email',state.user.email,'email','readonly'))}<div class="actions"><button class="primary">Lưu hồ sơ</button><a class="btn" href="/signout-with-chatgpt?return_to=/" target="_top">Đăng xuất</a></div><p class="muted">Đăng nhập, đăng ký và quản lý mật khẩu qua tài khoản ChatGPT.</p></form></section>`;
  submit('#profileform',async data=>{await api('profile',{name:data.get('name')});await refresh();toast('Đã lưu hồ sơ.');});
}
const chapterOptions = current => state.subjects.map(s=>`<optgroup label="${esc(s.title)}">${state.chapters.filter(c=>c.subject===s.id).map(c=>opt(c.id,c.title,current)).join('')}</optgroup>`).join('');
const fileFormats='.pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp';
const csvCell = value => {
  const raw=String(value ?? '');
  const safe=/^[\s]*[=+@-]/.test(raw)?"'"+raw:raw;
  return '"'+safe.replaceAll('"','""')+'"';
};
function downloadFile(name,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');
  a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function admin(id,generation) {
  if (!state.user.isAdmin) {
    main.innerHTML = empty('Chỉ chủ website có quyền quản lý nội dung.');
    return;
  }
  const bank=await api('bank');
  if(generation!==viewGeneration)return;
  const q=bank.find(q=>q.id===id);
  main.innerHTML=`${title('Quản trị dữ liệu','Thêm môn học, câu hỏi và tài liệu theo chương.')}
  <div class="admin-tabs" role="tablist" aria-label="Quản lý nội dung">${['Soạn câu hỏi','Ngân hàng','Môn học','Tài liệu'].map((label,index)=>`<button role="tab" id="admin-tab-${index}" data-admin-tab="${index}" aria-controls="admin-panel-${index}">${label}</button>`).join('')}</div>
  <section class="card form-card"><h2>${q?'Sửa câu hỏi':'Thêm câu hỏi'}</h2><form id="question">
  <div class="filters">${field('Chương',select('chapter',chapterOptions(q?.chapter)))}
  ${field('Loại',select('kind',opt('quiz','Trắc nghiệm',q?.kind)+opt('essay','Tự luận',q?.kind)))}
  ${field('Nhóm',select('tier',opt('main','Câu hỏi chính',q?.tier)+opt('extra','Câu hỏi nâng cao',q?.tier)))}</div>
  ${field('Nội dung câu hỏi',area('prompt',q?.prompt,'required maxlength="16000"'))}
  <div id="options-fields" class="filters">${Array.from({length:Math.max(4,q?.options.length||0)},(_,i)=>i).map(i=>field('Phương án '+'ABCDEF'[i],input('option'+i,q?.options[i]?.text,'text','maxlength="3000"'))).join('')}
  <fieldset class="correct-choices"><legend>Đáp án đúng (có thể chọn nhiều)</legend>${Array.from({length:Math.max(4,q?.options.length||0)},(_,i)=>`<label><input type="checkbox" name="correct" value="${i}" ${q && answerIds(q.correct).includes(q.options[i]?.id)?'checked':''}> ${'ABCDEF'[i]}</label>`).join('')}</fieldset></div>
  ${field('Giải thích hoặc đáp án mẫu, các ý chính và tham khảo',area('explanation',q?.explanation,'maxlength="500000"'))}
  ${field('Mã câu hỏi',input('code',q?.code||'','text','maxlength="100"'))}${field('Ý chính (mỗi dòng một ý)',area('key_points',(q?.key_points||[]).join('\n'),'maxlength="100000"'))}
  ${field('Tài liệu nguồn',`<select multiple name="sources" size="4"></select>`)}
  <div class="actions"><button class="primary">Lưu câu hỏi</button>${q?link('admin','Hủy sửa'):''}</div></form></section>
  <section class="card section"><h2>Ngân hàng câu hỏi</h2>
  <div class="actions"><button id="export-json">Xuất JSON</button><button id="export-csv">Xuất CSV</button></div>
  <details class="section"><summary>Nhập hàng loạt từ JSON</summary><form id="import" class="section">
  <p class="muted">Dùng cấu trúc tệp JSON xuất ra từ ngân hàng. Tệp lớn được chia thành từng lượt 100 câu. Câu có nội dung trùng trong cùng chương và loại được bỏ qua.</p>
  ${field('Chương nhập',select('chapter',opt('','Giữ chương theo JSON')+chapterOptions('')))}
  ${field('Tệp JSON',input('file','','file','accept=".json,application/json" required'))}<div><button>Nhập câu hỏi</button></div></form></details>
  <div class="section">${field('Tìm câu hỏi',input('findq','','search','placeholder="Nhập nội dung câu hỏi"'))}</div><div id="bank-list" class="list section"></div></section>
  <section class="card section"><h2>Môn học và chương</h2><div class="split"><form id="new-subject">${field('Tên môn học',input('title','','text','required maxlength="180"'))}<div><button>Thêm môn</button></div></form><form id="new-chapter">${field('Môn học',select('subject',state.subjects.map(s=>opt(s.id,s.title)).join('')))}${field('Tên chương',input('title','','text','required maxlength="180"'))}<div><button>Thêm chương</button></div></form></div></section>
  <section class="card section"><h2>Quản lý tài liệu</h2><form id="upload">
  <div class="filters">${field('Tệp cần thay thế',select('id',opt('','Thêm tài liệu mới')+state.documents.map(d=>opt(d.id,d.title)).join('')))}
  ${field('Chương',select('chapter',chapterOptions('')))}${field('Tiêu đề',input('title','','text','required maxlength="180"'))}</div>
  ${field('Tệp (tối đa 15 MB)',input('file','','file',`accept="${fileFormats}" required`))}<div><button class="primary">Lưu tài liệu</button></div></form>
  <div class="list section">${state.documents.map(d=>`<article class="listitem"><div>${esc(d.title)} <small>· ${esc(chapterName(d.chapter))}</small></div><button type="button" class="danger" data-deldoc="${d.id}">Xóa</button></article>`).join('')||'<p class="muted">Chưa có tài liệu.</p>'}</div></section>`;
  const panels = [...main.querySelectorAll(':scope > section')];
  panels.forEach((panel,index) => {
    panel.id = 'admin-panel-' + index;
    panel.classList.add('admin-panel');
    panel.setAttribute('role','tabpanel');
    panel.setAttribute('aria-labelledby','admin-tab-' + index);
  });
  function selectAdminPanel(index, focus = false) {
    adminPanel = index;
    panels.forEach((panel,i) => {panel.hidden = i !== index;});
    main.querySelectorAll('[data-admin-tab]').forEach((button,i) => {
      button.setAttribute('aria-selected',String(i === index));
      button.tabIndex = i === index ? 0 : -1;
      if (focus && i === index) button.focus();
    });
  }
  selectAdminPanel(q ? 0 : adminPanel);
  on('[data-admin-tab]','click',(_,button)=>selectAdminPanel(Number(button.dataset.adminTab)));
  on('[data-admin-tab]','keydown',(event,button)=>{
    const index = Number(button.dataset.adminTab);
    const next = {ArrowRight:(index+1)%4, ArrowLeft:(index+3)%4, Home:0, End:3}[event.key];
    if (next !== undefined) {event.preventDefault();selectAdminPanel(next,true);}
  });
  mountStudyAdmin();
  let bankPage = 0;
  main.querySelector('#bank-list').insertAdjacentHTML('beforebegin',`<div class="filters">${field('Nhóm',select('bank-tier',opt('main','Câu chính')+opt('extra','Câu nâng cao')))}${field('Chương',select('bank-chapter',opt('','Tất cả')+chapterOptions('')))}${field('Loại',select('bank-kind',opt('','Tất cả')+opt('quiz','Trắc nghiệm')+opt('essay','Tự luận')))}</div>`);
  on('[name=bank-tier],[name=bank-chapter],[name=bank-kind]','change',()=>{bankPage=0;renderBank();});
  let bankTerm = '';
  function renderBank(term = bankTerm) {
    if (term !== bankTerm) bankPage = 0;
    bankTerm = term;
    const matching = bank.filter(question => question.tier===main.querySelector('[name=bank-tier]').value && (!main.querySelector('[name=bank-chapter]').value||question.chapter===main.querySelector('[name=bank-chapter]').value) && (!main.querySelector('[name=bank-kind]').value||question.kind===main.querySelector('[name=bank-kind]').value) && question.prompt.toLocaleLowerCase('vi').includes(term.toLocaleLowerCase('vi')));
    const pageCount = Math.max(1, Math.ceil(matching.length / 20));
    bankPage = Math.min(bankPage, pageCount - 1);
    document.querySelector('#bank-list').innerHTML=matching.slice(bankPage * 20, (bankPage + 1) * 20).map(q=>`<article class="card listitem"><div><small>${esc(chapterName(q.chapter))} · ${q.kind==='quiz'?'Trắc nghiệm':'Tự luận'} · ${tierLabel(q.tier)}</small><h3>${esc(q.prompt)}</h3></div><div class="actions">${link('admin/'+q.id,'Sửa')}<button class="danger" data-delq="${q.id}">Xóa</button></div></article>`).join('')||empty('Không có câu hỏi phù hợp.');
    if (pageCount > 1) document.querySelector('#bank-list').insertAdjacentHTML('beforeend',
      `<div class="pager"><button id="bank-prev" ${bankPage ? '' : 'disabled'}>Trang trước</button><small>${bankPage + 1}/${pageCount} · ${matching.length} câu</small><button id="bank-next" ${bankPage === pageCount - 1 ? 'disabled' : ''}>Trang sau</button></div>`);
    on('#bank-prev','click',()=>{bankPage--;renderBank();});
    on('#bank-next','click',()=>{bankPage++;renderBank();});
    on('[data-delq]','click',async(_,el)=>{if(confirm('Xóa câu hỏi này khỏi ngân hàng?')){await api('bank/'+el.dataset.delq,undefined,'DELETE');await refresh();toast('Đã xóa câu hỏi.');}});
  }
  const form=main.querySelector('#question');
  function questionFields() {
    form.querySelector('#options-fields').hidden=form.elements.kind.value!=='quiz';
    const sources=form.elements.sources;
    const picked=new Set([...sources.selectedOptions].map(o=>o.value));
    if(!sources.options.length&&q) for(const id of q.sources) picked.add(id);
    sources.innerHTML=state.documents.filter(d=>d.chapter===form.elements.chapter.value).map(d=>opt(d.id,d.title,picked.has(d.id)?d.id:null)).join('');
  }
  questionFields();renderBank();
  on('#question [name=chapter],#question [name=kind]','change',questionFields);
  on('[name=findq]','input',(_,el)=>renderBank(el.value));
  on('#upload [name=id]','change',(_,el)=>{
    const d=state.documents.find(d=>d.id===el.value);
    if(d){el.form.elements.chapter.value=d.chapter;el.form.elements.title.value=d.title;}
  });
  submit('#question',async data=>{
    const rawOptions=Array.from({length:Math.max(4,q?.options.length||0)},(_,i)=>({index:i,text:String(data.get('option'+i)||'').trim()})).filter(o=>o.text);
    const selected=data.getAll('correct').map(Number);
    if(data.get('kind')==='quiz' && selected.some(i=>!rawOptions.some(o=>o.index===i))) throw new Error('Đáp án đúng phải có nội dung.');
    await api('bank',{id:q?.id,chapter:data.get('chapter'),kind:data.get('kind'),tier:data.get('tier'),prompt:data.get('prompt'),explanation:data.get('explanation'),code:data.get('code'),key_points:String(data.get('key_points')||'').split('\n').map(x=>x.trim()).filter(Boolean),options:rawOptions.map(o=>o.text),correctIndices:rawOptions.map((o,i)=>selected.includes(o.index)?i:-1).filter(i=>i>=0),sources:data.getAll('sources')});
    if(q) location.hash='admin';
    await refresh();toast('Đã lưu câu hỏi.');
  });
  submit('#import',async data=>{
    let records;
    try {records=JSON.parse(await data.get('file').text());}catch{throw new Error('Tệp JSON không hợp lệ.');}
    if(!Array.isArray(records)) throw new Error('Tệp JSON phải chứa một danh sách câu hỏi.');
    if(data.get('chapter')) records=records.map(q=>({...q,chapter:data.get('chapter'),sources:q.chapter===data.get('chapter')?q.sources:[]}));
    let result={saved:0};for(let i=0;i<records.length;i+=100){const batch=await api('bank',records.slice(i,i+100));result.saved+=batch.saved;}
    await refresh();toast(`Đã nhập ${result.saved}/${records.length} câu hỏi.`);
  });
  on('#export-json','click',()=>downloadFile('ngan-hang-cau-hoi.json',JSON.stringify(bank,null,2),'application/json'));
  on('#export-csv','click',()=>{
    const header=['Chương','Loại','Nhóm','Câu hỏi','A','B','C','D','E','F','Đáp án đúng','Giải thích'];
    const rows=bank.map(q=>[chapterName(q.chapter),q.kind,q.tier,q.prompt,...Array.from({length:6},(_,i)=>q.options[i]?.text),q.options.flatMap((o,i)=>answerIds(q.correct).includes(o.id)?['ABCDEF'[i]]:[]).join(', '),q.explanation]);
    downloadFile('ngan-hang-cau-hoi.csv','\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
  });
  submit('#new-subject',async data=>{await api('subjects',Object.fromEntries(data));await refresh();toast('Đã thêm môn học.');});
  submit('#new-chapter',async data=>{await api('chapters',Object.fromEntries(data));await refresh();toast('Đã thêm chương.');});
  submit('#upload',async data=>{await api('documents',data);await refresh();toast('Đã lưu tài liệu.');});
  on('[data-deldoc]','click',async(_,el)=>{if(confirm('Xóa tệp tài liệu này?')){await api('documents/'+el.dataset.deldoc,undefined,'DELETE');await refresh();toast('Đã xóa tài liệu.');}});
}

const parents = {subject:'subjects', chapter:'subjects', settings:'settings', attempt:'quiz', quizanswers:'quiz', essayitem:'essay', essayanswers:'essay', doc:'docs'};
const page = () => location.hash.slice(1).split('/')[0] || 'home';
let previousHash;
let previousGroup;
const mobileQuery = matchMedia('(max-width: 900px)');
const sidebar = document.querySelector('#sidebar');
const mobileNav = document.querySelector('#mobile-nav');
const menuButton = document.querySelector('#menu');
let menuTrigger = null;

function setMenu(open, restoreFocus = true) {
  const expanded = open && mobileQuery.matches;
  document.body.classList.toggle('open', expanded);
  document.querySelector('#menu-backdrop').hidden = !expanded;
  menuButton.setAttribute('aria-expanded', String(expanded));
  document.querySelector('#more-menu')?.setAttribute('aria-expanded', String(expanded));
  sidebar.inert = mobileQuery.matches && !expanded;
  document.querySelector('.layout').inert = expanded;
  mobileNav.inert = expanded;
  if (expanded) {
    menuTrigger = document.activeElement;
    document.querySelector('#close-menu').focus();
  } else if (restoreFocus && menuTrigger) {
    menuTrigger.focus();
    menuTrigger = null;
  }
}
function renderNavigation(group) {
  document.querySelector('#crumb').textContent = links.find(([key]) => key === group)?.[2] || 'Tài khoản';
  document.querySelector('#profile').textContent = state.user.name === 'bạn' ? 'Hồ sơ cá nhân' : state.user.name;
  document.querySelector('#avatar').textContent = (state.user.name || 'V').charAt(0).toUpperCase();
  const visibleLinks = links.filter(([key]) => key !== 'admin' || state.user.isAdmin);
  nav.innerHTML = visibleLinks.map(([key, icon, label]) => `<a href="#${key}" ${group === key ? 'aria-current="page"' : ''}><b aria-hidden="true">${icon}</b>${label}</a>`).join('');
  mobileNav.innerHTML = links.filter(([key]) => ['home','subjects','quiz','essay'].includes(key)).map(([key, icon, label]) =>
    `<a href="#${key}" ${group === key ? 'aria-current="page"' : ''}><b aria-hidden="true">${icon}</b>${label}</a>`).join('')
    + '<button id="more-menu" aria-label="Mở tất cả chức năng" aria-controls="sidebar" aria-expanded="false"><b aria-hidden="true">☰</b>Thêm</button>';
  document.querySelector('#more-menu').onclick = () => setMenu(true);
}
function loading() {
  main.innerHTML = '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Đang tải…</div>';
}
async function render() {
  const generation = ++viewGeneration;
  clearInterval(tick);
  const [current, id] = location.hash.slice(1).split('/');
  const route = current || 'home';
  const group = parents[route] || route;
  document.body.classList.toggle('taking-quiz', route === 'attempt' && activeAttempt?.id === id && !activeAttempt.finished);
  document.body.classList.remove('review-quiz', 'focus-study', 'has-start-bar', 'reading-page');
  renderNavigation(group);
  if (previousHash !== location.hash) {
    if (['quiz','essay','docs'].includes(previousGroup)) filterMemory[previousGroup] = {...filter};
    if (['quiz','essay','docs'].includes(route)) {
      const [chapterId,params='']=(id||'').split('?');
      const selected = chapterLookup.get(chapterId);
      const selectedTier=new URLSearchParams(params).get('tier');
      filter = selected
        ? {subject:selected.subject, chapter:selected.id, tier:['main','extra'].includes(selectedTier)?selectedTier:'all', search:''}
        : {...(filterMemory[route] || {subject:'', chapter:'', tier:'all', search:''})};
      // Links from the home review queue preselect a mode or status filter.
      const wanted=new URLSearchParams(params);
      if(route==='quiz'&&['practice','review','exam'].includes(wanted.get('mode')))quizSettings.mode=wanted.get('mode');
      if(route==='essay'&&Object.hasOwn(studyStatuses,wanted.get('status')||''))studyStatusFilter=wanted.get('status');
    }
  }
  previousHash = location.hash;
  previousGroup = group;
  if (['attempt','quizanswers','essayitem','essayanswers','doc','admin'].includes(route)) loading();
  try {
    if (route === 'home') home();
    else if (route === 'subjects') main.innerHTML = title('Môn học', 'Chọn môn để xem nội dung theo chương.') + subjectCards();
    else if (route === 'subject') subject(id);
    else if (route === 'quiz') quiz();
    else if (route === 'quizanswers') await quizAnswers(id,generation);
    else if (route === 'attempt') await attempt(id, generation);
    else if (route === 'essay') essayList();
    else if (route === 'essayitem') await essayItem(id, generation);
    else if (route === 'essayanswers') await chapterAnswers(id, generation);
    else if (route === 'docs') docs();
    else if (route === 'doc') await doc(id, generation);
    else if (route === 'stats') stats();
    else if (route === 'chapter') chapterPage(id);
    else if (route === 'settings') await settingsPage(generation);
    else if (route === 'admin') await admin(id, generation);
    else if (route === 'account') account();
    else main.innerHTML = title('Không tìm thấy trang') + link('home', 'Về tổng quan');
  } catch (error) {
    if (generation === viewGeneration) main.innerHTML = empty(error.message) + '<div class="actions section"><button id="retry-view">Thử lại</button></div>';
  }
}
async function refresh() {
  clearStudyCaches();
  await loadState(true);
  await render();
}
window.addEventListener('hashchange', async () => {
  if (location.hash === '#main') {
    main.focus();
    return;
  }
  setMenu(false, false);
  document.querySelector('#appearance').open = false;
  if (!state) return;
  // Route changes use the loaded catalog immediately; refresh in the background.
  await render();
  if(Date.now()-stateLoadedAt>=120000) loadState().catch(error=>toast(error.message));
  main.focus({preventScroll:true});
  window.scrollTo(0, 0);
});
const root = document.documentElement;
// ChatGPT Sites can inject its own floating widget (e.g. "Edit site") into a
// shadow root at the bottom-right. On phone layouts, when it sits over the
// bottom bars, grow the bars by its height (CSS --site-lift) so "Câu tiếp" and
// the navigation stay tappable. The widget itself is left untouched.
function siteWidgetLift() {
  let lift = 0;
  if (innerWidth <= 900) {
    for (const host of document.body.children) {
      if (!host.shadowRoot) continue;
      for (const element of host.shadowRoot.querySelectorAll('*')) {
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height || box.width * box.height > innerWidth * innerHeight * 0.4) continue;
        if (box.top < innerHeight && box.bottom > innerHeight - 140) lift = Math.max(lift, innerHeight - box.top + 6);
      }
    }
  }
  root.style.setProperty('--site-lift', Math.min(Math.round(lift), 96) + 'px');
}
let liftTimer;
const scheduleLift = () => { clearTimeout(liftTimer); liftTimer = setTimeout(siteWidgetLift, 120); };
const watchedHosts = new WeakSet();
function watchSiteWidgets() {
  for (const host of document.body.children) {
    if (host.shadowRoot && !watchedHosts.has(host)) {
      watchedHosts.add(host);
      new MutationObserver(scheduleLift).observe(host.shadowRoot, {subtree:true, childList:true, attributes:true});
    }
  }
  scheduleLift();
}
new MutationObserver(watchSiteWidgets).observe(document.body, {childList:true});
window.addEventListener('resize', scheduleLift);
watchSiteWidgets();
setTimeout(siteWidgetLift, 1500);
setTimeout(siteWidgetLift, 4000);
function preference(name, fallback) {
  try { return localStorage.getItem(name) || fallback; }
  catch { return fallback; }
}
function savePreference(name, value) {
  try { localStorage.setItem(name, value); } catch {}
}
root.dataset.theme = preference('quiz-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let size = Math.min(22, Math.max(14, Number(preference('quiz-font', 16)) || 16));
function updateAppearance() {
  root.style.fontSize = size + 'px';
  document.querySelector('#font-size').value = size;
  document.querySelector('#smaller').disabled = size <= 14;
  document.querySelector('#larger').disabled = size >= 22;
  const dark = root.dataset.theme === 'dark';
  document.querySelector('#theme').setAttribute('aria-label', dark ? 'Bật chế độ sáng' : 'Bật chế độ tối');
  document.querySelector('#theme').setAttribute('aria-pressed', String(dark));
  document.querySelector('meta[name="theme-color"]').content = dark ? '#101726' : '#f4f7fc';
}
updateAppearance();
setMenu(false, false);
menuButton.onclick = () => setMenu(true);
document.querySelector('#close-menu').onclick = () => setMenu(false);
document.querySelector('#menu-backdrop').onclick = () => setMenu(false);
sidebar.addEventListener('click', event => {
  if (event.target.closest('a')) setMenu(false, false);
});
mobileQuery.addEventListener('change', () => setMenu(false, false));
document.addEventListener('click', event => {
  if (!event.target.closest('#appearance')) document.querySelector('#appearance').open = false;
});
window.addEventListener('keydown', event => {
  // ← / → move between questions when focus is not in a form field.
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
    && !event.target.closest?.('input, textarea, select, [contenteditable="true"]') && !document.body.classList.contains('open')) {
    const control = main.querySelector(event.key === 'ArrowLeft' ? '[data-key-prev]' : '[data-key-next]');
    if (control && !control.disabled && !control.hasAttribute('aria-disabled')) { event.preventDefault(); control.click(); }
  }
  // Desktop shortcuts on question screens: 1–6 or A–F pick an option, Enter
  // presses the main button (check / next / submit / reveal), M flags.
  if (!event.target.closest?.('input, textarea, select, [contenteditable="true"]') && !event.altKey && !event.ctrlKey && !event.metaKey
    && !document.body.classList.contains('open') && !document.querySelector('dialog[open]')) {
    const attemptCard = main.querySelector('#question-card');
    const scope = attemptCard || (main.querySelector('#quiz-answer-list[data-mode="single"]') && main.querySelector('.quiz-answer-card'));
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const pick = '123456'.includes(key) ? '123456'.indexOf(key) : 'abcdef'.includes(key) ? 'abcdef'.indexOf(key) : -1;
    if (scope && pick >= 0 && !event.shiftKey) {
      const option = scope.querySelectorAll('[data-option], [data-guess-option]')[pick];
      if (option && !option.disabled) { event.preventDefault(); option.click(); }
    } else if (scope && key === 'Enter' && (!event.target.closest?.('button, a, summary') || event.target.closest('[data-option], [data-guess-option]'))) {
      const action = attemptCard ? main.querySelector('#next') : (main.querySelector('.study-nav [data-reveal]') || main.querySelector('.study-nav [data-key-next]'));
      if (action && !action.disabled) { event.preventDefault(); action.click(); }
    } else if (attemptCard && key === 'm') {
      const flag = main.querySelector('#flag');
      if (flag && !flag.disabled) { event.preventDefault(); flag.click(); }
    }
  }
  if (event.key === 'Escape') {
    setMenu(false);
    document.querySelector('#appearance').open = false;
  }
  if (event.key !== 'Tab' || !document.body.classList.contains('open')) return;
  const controls = [...sidebar.querySelectorAll('a, button:not(:disabled)')];
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
document.querySelector('#theme').onclick = () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  savePreference('quiz-theme', root.dataset.theme);
  updateAppearance();
};
for (const [id, delta] of [['smaller', -1], ['larger', 1]]) {
  document.querySelector('#' + id).onclick = () => {
    size = Math.min(22, Math.max(14, size + delta));
    savePreference('quiz-font', size);
    updateAppearance();
  };
}
window.addEventListener('offline', () => toast('Mất kết nối mạng. Bài làm mới sẽ được lưu khi bạn kết nối và thử lại.'));
window.addEventListener('online', () => {
  toast('Đã kết nối lại. Đang lưu các đáp án còn chờ.');
  for(const session of attemptSessions.values()) if(session.pending.size) flushAttempt(session).catch(()=>{});
});
window.addEventListener('beforeunload', event => {
  if ([...attemptSessions.values()].some(s=>s.pending.size||s.saving||s.finishing)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
// First render: nothing cached yet, and study.js declarations finish loading
// before the awaited state resolves.
loadState(true).then(render).catch(error => {
  if (error.status === 401) {
    document.body.classList.add('signed-out');
    document.querySelector('#crumb').textContent = 'Ôn Tập Việt Quiz';
    main.innerHTML = '<section class="card sign-in"><span class="brand" aria-hidden="true">V</span>'
      + '<h1>Không gian ôn tập<br>của bạn</h1>'
      + '<p class="muted">Luyện trắc nghiệm, viết tự luận và đọc tài liệu theo từng môn học. Đăng nhập để lưu bài làm và theo dõi tiến độ.</p>'
      + '<a class="btn primary" target="_top" href="/signin-with-chatgpt?return_to=/">Tiếp tục với ChatGPT →</a></section>';
    return;
  }
  main.innerHTML = title('Ôn Tập Việt Quiz', error.message) + '<button id="reload">Thử lại</button>';
});
main.addEventListener('click', event => {
  if (event.target.id === 'reload') location.reload();
  if (event.target.id === 'retry-view') render();
});
