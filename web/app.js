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
const tierLabel = tier => tier==='main'?'Câu hỏi chính':'Câu hỏi bổ sung';
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
  if(!attemptSessions.has(attempt.id)) attemptSessions.set(attempt.id,{attempt,pending:new Map(),saving:null,error:'',finishing:false,checked:new Set()});
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
    ${field('Chương',select('chapter',(all?opt('','Tất cả chương',chapter):'')+chapters.map(c=>opt(c.id,c.title+(has(c.id)?'':' — chưa có câu'),chapter)).join('')))}
    ${hasExtra?field('Nhóm câu hỏi',select('tier',opt('all','Cả hai nhóm',filter.tier)+opt('main','Câu hỏi chính',filter.tier)+opt('extra','Câu hỏi bổ sung',filter.tier))):''}</div>`};
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
const metric = (name, value, detail = '') => `<article class="card metric"><small>${name}</small><strong>${value}</strong>${detail ? `<small class="metric-detail">${detail}</small>` : ''}</article>`;
function subjectCards() {
  return `<div class="grid">${state.subjects.map((subject, index) => {
    const chapters = state.chapters.filter(chapter => chapter.subject === subject.id);
    const chapterIds = new Set(chapters.map(chapter => chapter.id));
    const questions = state.questions.filter(question => chapterIds.has(question.chapter));
    const progress = coverage(chapters);
    return `<article class="card subject">
      <div class="subject-head"><span class="subject-icon" aria-hidden="true">${esc(subject.icon||['▤','⌘','◇'][index % 3])}</span><small>${chapters.length} chương</small></div>
      <h3>${esc(subject.title)}</h3><small>${questions.filter(q=>q.kind==='quiz').length} trắc nghiệm · ${questions.filter(q=>q.kind==='essay').length} tự luận</small><p>${esc(subject.description||'')}</p>
      <div class="subject-footer"><div class="subject-progress"><span>Tiến độ học tập</span><span>${progress}%</span></div>${bar(progress)}
      ${link('subject/' + subject.id, 'Tiếp tục học →', 'link')}</div></article>`;
  }).join('')}</div>`;
}
function historyList(entries) {
  return entries.length?`<div class="list">${entries.map(a=>`<article class="card listitem"><div><h3>${esc(chapterName(a.chapter))}</h3><small>${date(a.created)} · ${a.result?`${a.result.score}/10 · ${a.result.correct}/${a.result.total} câu đúng`:'Đang làm'}</small></div>${link('attempt/'+a.id,a.result?'Xem kết quả':'Tiếp tục','link')}</article>`).join('')}</div>`:empty('Các bài làm sẽ xuất hiện ở đây.');
}
function home() {
  const summary = metrics();
  const active = state.history.find(attempt => !attempt.finished);
  const quizCount = state.questions.filter(question => question.kind === 'quiz').length;
  const essayCount = state.questions.length - quizCount;
  const progress = coverage(state.chapters);
  main.innerHTML = `<section class="hero">
    <div><div class="eyebrow">ÔN TẬP VIỆT QUIZ</div><h1>Chào ${esc(state.user.name)}!</h1>
    <p>Luyện trắc nghiệm, viết tự luận và theo dõi tiến độ theo từng chương.</p>
    <div class="actions">${link(active ? 'attempt/' + active.id : 'quiz', active ? 'Tiếp tục làm bài →' : 'Bắt đầu ôn tập →')}
    ${link('docs', 'Đọc tài liệu', 'hero-secondary')}</div></div>
    <div class="hero-progress"><small>Tiến độ học tập</small><strong>${progress}%</strong>${bar(progress)}<small>Trên tất cả môn học</small></div>
    </section>
    <div class="grid metrics">
      ${metric('Môn học', state.subjects.length, state.chapters.length + ' chương')}
      ${metric('Ngân hàng câu hỏi', state.questions.length, quizCount + ' trắc nghiệm · ' + essayCount + ' tự luận')}
      ${metric('Bài hoàn thành', summary.h.length, summary.answered + ' câu đã trả lời')}
      ${metric('Tỷ lệ đúng', summary.accuracy + '%', summary.h.length ? 'Điểm trung bình ' + summary.average + '/10' : 'Bắt đầu một bài để theo dõi')}
    </div>
    <div class="section-head"><h2>Môn học của bạn</h2><a href="#subjects">Xem tất cả →</a></div>
    ${subjectCards()}
    <section class="section"><div class="section-head"><h2>Bài làm gần đây</h2><a href="#stats">Lịch sử học tập →</a></div>
    ${historyList(state.history.slice(0, 3))}<div class="actions section">${[...state.essays].sort((a,b)=>(b.updated_at||0)-(a.updated_at||0)).slice(0,3).map(e=>link('essayitem/'+e.question,questionLookup.get(e.question)?.code||'Tiếp tục tự luận')).join('')}</div></section>`;
}
function subject(id) {
  const sub=state.subjects.find(s=>s.id===id);
  if(!sub) return main.innerHTML=empty('Không tìm thấy môn học.');
  const chapters=state.chapters.filter(c=>c.subject===id);
  main.innerHTML=`${title(sub.title,'Chọn chương, rồi làm bài hoặc xem đáp án.')}<div class="list chapter-list">${chapters.map(c=>{
    const n=chapterCounts(c.id), progress=coverage([c]);
    return `<article class="card chapter-row"><div class="chapter-row-head"><h3><a href="#chapter/${esc(c.id)}">${esc(c.title)}</a></h3>
      <small>${[n.quiz&&n.quiz+' trắc nghiệm',n.essay&&n.essay+' tự luận',n.docs&&n.docs+' tài liệu'].filter(Boolean).join(' · ')||'Chưa có câu hỏi'}${n.quiz||n.essay?' · Tiến độ '+progress+'%':''}</small>
      ${n.quiz||n.essay?bar(progress):''}</div>${chapterActions(c.id,n)}</article>`;
  }).join('')||empty('Môn này chưa có chương.')}</div>`;
}
function chapterCounts(id) {
  const questions=state.questions.filter(q=>q.chapter===id);
  return {quiz:questions.filter(q=>q.kind==='quiz').length, essay:questions.filter(q=>q.kind==='essay').length, docs:state.documents.filter(d=>d.chapter===id).length};
}
// Only offer what the chapter actually has, most direct actions first.
function chapterActions(id,n=chapterCounts(id)) {
  const actions=[
    n.quiz&&link('quiz/'+id,'Làm trắc nghiệm','primary'), n.quiz&&link('quizanswers/'+id,'Đáp án trắc nghiệm'),
    n.essay&&link('essay/'+id,'Học tự luận',n.quiz?'':'primary'), n.essay&&link('essayanswers/'+id,'Đáp án tự luận'),
    n.docs&&link('docs/'+id,'Tài liệu ('+n.docs+')','link')
  ].filter(Boolean);
  return `<div class="actions chapter-actions">${actions.join('')||'<small class="muted">Chương đang chờ bổ sung nội dung.</small>'}</div>`;
}
function quiz() {
  const selection = controls('quiz');
  const count = state.questions.filter(question => question.chapter === selection.chapter && question.kind === 'quiz'
    && (filter.tier === 'all' || question.tier === filter.tier) && (quizSettings.mode!=='review'||state.progress.unresolved.includes(question.id))).length;
  const selectedCount = Math.min(quizSettings.count, count);
  const isExam = quizSettings.mode === 'exam';
  const chapterQuiz = state.questions.filter(question => question.chapter === selection.chapter && question.kind === 'quiz').length;
  const modes = [['practice','Luyện tập','Biết đúng/sai và đọc giải thích ngay khi chọn.'],['review','Ôn câu sai','Chỉ các câu bạn vẫn còn làm sai trong chương.'],['exam','Thi thử','Đếm giờ; đáp án chỉ hiện sau khi nộp bài.']];
  main.innerHTML = `${title('Trắc nghiệm', 'Chọn chương, rồi làm bài hoặc xem đáp án.')}
    <section class="card form-card">
      <div class="form-section">${selection.html}</div>
      <form id="start" class="form-section">
        <fieldset class="mode-choices"><legend>Cách làm bài</legend>
          ${modes.map(([value,label,hint]) => `<label class="mode-choice"><input type="radio" name="mode" value="${value}" ${quizSettings.mode === value ? 'checked' : ''}><span><strong>${label}</strong><small>${hint}</small></span></label>`).join('')}
          <p class="mode-hint">${modes.find(([value]) => value === quizSettings.mode)?.[2] || ''}</p>
        </fieldset>
        <div class="filters">
          ${field('Số câu hỏi', input('count', selectedCount || '', 'number', `min="1" max="${Math.min(100, count) || 1}" inputmode="numeric" required ${count ? '' : 'disabled'}`))}
          <label id="time-field" ${isExam ? '' : 'hidden'}>Thời gian thi (phút)
            ${input('minutes', quizSettings.minutes, 'number', `min="1" max="180" inputmode="numeric" required ${isExam ? '' : 'disabled'}`)}
          </label>
        </div>
        <p class="muted">${count
          ? count + ' câu phù hợp. Câu hỏi và phương án được xáo trộn mỗi lượt; đáp án đúng luôn đi cùng nội dung của nó.'
          : quizSettings.mode==='review'?'Bạn không còn câu sai cần ôn trong bộ lọc này.':'Chương này đang chờ bổ sung câu hỏi.'}</p>
        <div class="actions form-submit"><button class="primary" ${count ? '' : 'disabled'}>Bắt đầu làm bài →</button>
          ${chapterQuiz ? link('quizanswers/'+selection.chapter+'?tier='+filter.tier,'Xem đáp án trắc nghiệm') : ''}
          ${state.user.isAdmin ? link('admin', 'Quản trị câu hỏi', 'link') : link('docs/' + selection.chapter, 'Đọc tài liệu', 'link')}</div>
      </form>
    </section>`;
  bindFilters();
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
function sourceLinks(ids) {
  return ids.map(id=>state.documents.find(d=>d.id===id)).filter(Boolean).map(doc=>link('doc/'+doc.id,doc.title,'link')).join('');
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
  if (!state.history.some(entry => entry.id === result.id)) state.history.unshift({id:result.id, chapter:result.attempt.chapter, created:result.attempt.created, finished:null, result:null});
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
// "Vì sao đúng" block shared by practice feedback, results and answer pages.
function whyBlock(question) {
  const keys = lettered(question).filter(option => option.correct);
  const parts = explanationParts(question.explanation, keys.map(option => option.text));
  const letters = joinLetters(keys.map(option => option.letter));
  const paragraphs = parts.why ? parts.why.split(/\n\s*\n/).map(text => `<p>${esc(text.trim())}</p>`).join('') : '<p>Chưa có giải thích cho câu này.</p>';
  return `<section class="why" aria-label="Giải thích đáp án">
    <h3><span class="why-mark" aria-hidden="true">✓</span>Vì sao ${letters ? (keys.length > 1 ? 'các đáp án ' : 'đáp án ') + letters : 'đáp án này'} đúng?</h3>
    ${paragraphs}
    ${parts.source ? `<p class="why-source"><strong>Nguồn đối chiếu:</strong> ${esc(parts.source)}</p>` : ''}
  </section>`;
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
  const summary = completed ? `<section class="result-summary">
      ${title('Kết quả bài làm', chapterName(attempt.chapter))}
      <div class="grid metrics">${metric('Điểm', result.score + '/10')}${metric('Đúng', result.correct)}${metric('Sai', result.wrong)}${metric('Chưa trả lời', result.unanswered)}${metric('Chính xác',Math.round(result.correct/result.total*100)+'%')}</div>
      <p class="muted">${result.total} câu · ${Math.floor(result.seconds / 60)} phút ${result.seconds % 60} giây</p>
      <div class="actions"><button id="retry" class="primary">Làm lại bài</button>
      <button id="retry-wrong" ${result.wrong + result.unanswered ? '' : 'disabled'}>Luyện lại câu chưa đúng</button>
      <button id="wrong-only" aria-pressed="${wrongOnly}">${wrongOnly ? 'Xem toàn bài' : 'Chỉ xem câu chưa đúng'}</button>${link('chapter/'+attempt.chapter,'Về chương')}</div>
    </section>` : '';
  main.innerHTML = `<div id="attempt-view" data-attempt="${esc(attempt.id)}">${summary}
    <div class="attempt-bar ${!completed && attempt.deadline ? 'has-timer' : ''}">
      <div class="attempt-meta">${completed ? `<strong>${attemptModes[attempt.config.mode] || 'Bài làm'} · Xem lại</strong>` : `<h1 class="attempt-heading">${attemptModes[attempt.config.mode] || 'Bài làm'}</h1>`}<small class="attempt-chapter">${esc(chapterName(attempt.chapter))}</small><small id="attempt-count"></small></div>
      <div class="attempt-progress" aria-hidden="true"><div class="bar"><i id="attempt-fill"></i></div></div>
      ${!completed && attempt.deadline ? '<p class="timer" id="timer" role="timer" aria-label="Thời gian còn lại"></p>' : ''}
      ${completed ? '' : '<button class="primary" id="finish" type="button">Nộp bài</button>'}
    </div>
    ${items.length ? `<div class="quizgrid">
      <div class="question-column">
      <section class="card question-card" id="question-card"></section>
      <nav class="question-actions" aria-label="Chuyển câu">
        <button type="button" id="prev" data-key-prev><span class="nav-long">← Câu trước</span><span class="nav-short">← Trước</span></button>
        <span class="question-position" id="question-position" aria-live="polite"></span>
        <button type="button" id="next" class="primary" data-key-next><span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span></button>
      </nav>
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
      else if (target.id === 'next') moveAttempt(attemptIndex + 1);
      else if (target.dataset.option !== undefined) {
        const id = target.dataset.option, selected = answerIds(activeAttempt.answers[current.id]);
        const option = current.selectionCount > 1 ? selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] : id;
        await saveAttempt({question:current.id, option}, 'PATCH');
      }
      else if (target.id === 'check-answer') { session.checked.add(current.id); renderQuestion(); main.querySelector('.verdict')?.scrollIntoView({block:'nearest'}); }
      else if (target.id === 'retry-save') await flushAttempt(session);
      else if (target.id === 'flag') await saveAttempt({question:current.id, flag:!activeAttempt.flags.includes(current.id)}, 'PATCH');
      else if (target.id === 'finish') {
        const remaining = activeAttempt.items.length - Object.values(activeAttempt.answers).filter(value => answerIds(value).length).length;
        if (confirm(remaining ? `Bạn còn ${remaining} câu chưa trả lời. Nộp bài để xem kết quả?` : 'Nộp bài và xem kết quả?')) await saveAttempt({}, 'POST');
      }
      else if (target.id === 'wrong-only') { wrongOnly = !wrongOnly; attemptIndex = 0; drawAttempt(activeAttempt); }
      else if (target.id === 'retry' || target.id === 'retry-wrong') await retryAttempt(target.id === 'retry-wrong', target);
    } catch (error) { toast(error.message); }
  });
  renderQuestion();
  if (!completed && attempt.deadline) {
    const update = () => {
      const seconds = Math.max(0, Math.ceil((attempt.deadline - Date.now()) / 1000));
      const timer = main.querySelector('#timer');
      if (timer) {
        timer.textContent = '⏱ ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        timer.classList.toggle('urgent', seconds <= 60);
      }
      const session = sessionFor(attempt);
      if (!seconds && !session.finishing && !session.error) {
        clearInterval(tick);
        saveAttempt({}, 'POST').catch(() => {});
      }
    };
    tick = setInterval(update, 1000);
    // Show the time at once; expiry is submitted by the interval after the controls exist.
    const seconds = Math.max(0, Math.ceil((attempt.deadline - Date.now()) / 1000));
    const timer = main.querySelector('#timer');
    if (timer) timer.textContent = '⏱ ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
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
    <div class="question-top"><span class="badge">Câu ${attemptIndex + 1}/${items.length}</span>
      ${question.selectionCount > 1 ? `<span class="badge multi-badge">Chọn ${question.selectionCount} đáp án</span>` : ''}
      ${completed ? `<small>${tierLabel(question.tier)}</small>` : `<button type="button" class="icon flag-button" id="flag" aria-pressed="${flagged}" ${submitting ? 'disabled' : ''}>${flagged ? '⚑ Đã đánh dấu' : '⚐ Đánh dấu'}</button>`}
    </div>
    <h2 class="question-title" id="question-title" tabindex="-1">${esc(question.prompt)}</h2>
    ${question.selectionCount > 1 && !revealed ? `<p class="multi-hint">Câu này có ${question.selectionCount} đáp án đúng. Chỉ tính đúng khi chọn đủ và không chọn thừa.</p>` : ''}
    <div class="options" role="group" aria-labelledby="question-title">${optionList(question, attempt.answers[question.id], revealed, completed || submitting)}</div>
    ${!completed && practice && question.selectionCount > 1 && !feedback ? `<div class="actions practice-check"><button type="button" id="check-answer" class="primary" ${selected.length !== question.selectionCount ? 'disabled' : ''}>Kiểm tra đáp án</button><small class="muted">Đã chọn ${selected.length}/${question.selectionCount}</small></div>` : ''}
    ${revealed ? verdict(question, attempt.answers[question.id], completed) + whyBlock(question) : ''}
    ${!completed ? `<span class="save-status ${session.error ? 'notice' : ''}" role="status">${esc(saveText)}</span>${session.error ? '<button type="button" id="retry-save" class="link">Thử lưu lại</button>' : ''}` : ''}
    ${question.sources?.length ? `<div class="actions source-links">${sourceLinks(question.sources)}</div>` : ''}`;
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
  main.querySelector('#next').disabled = attemptIndex === items.length - 1 || submitting;
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
    if(data.option!==undefined) {
      session.attempt.answers[data.question]=data.option;
      session.checked.delete(data.question);
    }
    if(typeof data.flag==='boolean') session.attempt.flags=data.flag?[...new Set([...session.attempt.flags,data.question])]:session.attempt.flags.filter(id=>id!==data.question);
    session.pending.set(data.question,{...session.pending.get(data.question),...data});
    session.error='';
    renderQuestion();
    if(data.option!==undefined) {
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


function docs() {
  const c=controls('docs');
  main.innerHTML=`${title('Thư viện tài liệu','Tìm và đọc tài liệu theo môn học và chương.')}<section class="card">${c.html}${field('Tìm tài liệu',input('search',filter.search,'search','placeholder="Tên tài liệu hoặc tên tệp"'))}${field('Sắp xếp',select('doc-sort',opt('title','Tên tài liệu A–Z')+opt('chapter','Theo chương')))}</section><div id="doclist" class="list section"></div>`;
  const update=()=>{
    const term=filter.search.toLocaleLowerCase('vi');
    const docs=state.documents.filter(q=>matches(q)&&[q.title,q.filename].some(s=>s.toLocaleLowerCase('vi').includes(term))).sort((a,b)=>(main.querySelector('[name=doc-sort]').value==='chapter'?chapterName(a.chapter).localeCompare(chapterName(b.chapter),'vi',{numeric:true}):0)||a.title.localeCompare(b.title,'vi',{numeric:true}));
    main.querySelector('#doclist').innerHTML=docs.map(q=>`<article class="card listitem"><div><h3>${esc(q.title)}</h3><small>${esc(chapterName(q.chapter))} · ${esc(q.filename)}</small></div><div class="actions">${link('doc/'+q.id,'Xem tài liệu','link')}<a class="btn" href="/api/documents/${q.id}?download">Tải xuống</a></div></article>`).join('')||empty('Chưa có tài liệu phù hợp.');
  };
  update();bindFilters();on('[name=doc-sort]','change',update);
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
  main.innerHTML=`${title(d.title,chapterName(d.chapter))}<div class="actions"><a class="btn primary" href="${path}?download">Tải xuống</a>${link('docs','Về thư viện')}</div><div class="section">${preview||empty('Tải tệp DOCX xuống để đọc trong Word hoặc trình đọc tương thích.')}</div>`;
}
function stats() {
  const m=metrics();
  const misses = new Map(Object.entries(state.progress.mistakes));
  const frequent=[...misses].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]);
  main.innerHTML=`${title('Thống kê học tập')}<div class="grid metrics">${metric('Bài đã làm',m.h.length)}${metric('Câu đã trả lời',m.answered)}${metric('Tổng câu đúng',m.correct)}${metric('Tổng câu sai',m.wrong)}${metric('Tỷ lệ chính xác',m.accuracy+'%')}${metric('Điểm trung bình',m.average+'/10')}${metric('Câu sai từ 2 lần',frequent.length)}</div>
  <div class="split"><section class="card"><h2>Tiến độ theo môn và chương</h2>${state.subjects.map(s=>{const chapters=state.chapters.filter(c=>c.subject===s.id), n=coverage(chapters);return `<details class="section"><summary>${esc(s.title)} · ${n}%</summary>${bar(n)}${chapters.map(c=>`<small>${esc(c.title)} · ${coverage([c])}%</small>${bar(coverage([c]))}`).join('')}</details>`;}).join('')}</section><section class="card"><h2>Câu thường trả lời sai</h2>${frequent.length?`<ol>${frequent.map(([id,n])=>`<li>${esc(questionLookup.get(id)?.prompt||'Câu hỏi đã xóa')} · ${n} lần</li>`).join('')}</ol>`:'<p class="muted">Chưa có câu nào sai từ hai lần.</p>'}</section></div>
  <section class="section"><h2>Lịch sử học tập</h2>${historyList(state.history.slice(0,historyLimit))}${state.history.length>historyLimit?'<div class="pager"><button id="more-history">Xem thêm bài làm</button></div>':''}</section>`;
  main.insertAdjacentHTML('beforeend',studyStats());
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
  ${field('Nhóm',select('tier',opt('main','Câu hỏi chính',q?.tier)+opt('extra','Câu hỏi bổ sung',q?.tier)))}</div>
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
  main.querySelector('#bank-list').insertAdjacentHTML('beforebegin',`<div class="filters">${field('Nhóm',select('bank-tier',opt('main','Câu chính')+opt('extra','Câu bổ sung')))}${field('Chương',select('bank-chapter',opt('','Tất cả')+chapterOptions('')))}${field('Loại',select('bank-kind',opt('','Tất cả')+opt('quiz','Trắc nghiệm')+opt('essay','Tự luận')))}</div>`);
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
  mobileNav.innerHTML = links.filter(([key]) => ['home','quiz','essay','docs'].includes(key)).map(([key, icon, label]) =>
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
  document.body.classList.remove('review-quiz', 'focus-study');
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
