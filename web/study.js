const studyStatuses={unseen:'Chưa học',learning:'Đang học',viewed:'Đã xem đáp án',answered:'Đã tự trả lời',mastered:'Đã thuộc',review:'Cần ôn tập'};
let studyStatusFilter='all';
const inlineStudy=text=>esc(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
function richAnswer(text) {
  let code=false;return String(text||'').split('\n').map(line=>{
    if(line.startsWith('```')){code=!code;return code?'<pre><code>':'</code></pre>';}
    if(code)return esc(line)+'\n';
    const h=line.match(/^(#{1,4})\s+(.+)/);if(h)return '<h'+Math.min(4,Math.max(3,h[1].length))+'>'+inlineStudy(h[2])+'</h'+Math.min(4,Math.max(3,h[1].length))+'>';
    if(/^\s*[-*]\s/.test(line))return '<p class="answer-bullet">• '+inlineStudy(line.replace(/^\s*[-*]\s/,''))+'</p>';
    const label=line.match(/^(Đáp án đúng|Vì sao đúng|Nguồn đối chiếu):\s*(.*)$/);
    if(label)return '<p class="answer-part"><strong>'+esc(label[1])+':</strong> '+inlineStudy(label[2])+'</p>';
    // A line that is only **bold text** works as a small sub-heading.
    const sub=line.match(/^\s*\*\*([^*]+)\*\*\s*$/);if(sub)return '<h4 class="answer-subhead">'+esc(sub[1])+'</h4>';
    return line.trim()?'<p>'+inlineStudy(line)+'</p>':'';
  }).join('')+(code?'</code></pre>':'');
}
// Model answer laid out by section: the answer itself first and strongest,
// explanation and example after it, sources small and quiet.
// `level` keeps heading order valid: 2 under a page h1, 3 under a card h2.
function studyAnswer(text,level=3) {
  return answerSections(text).map(section=>`<section class="answer-section answer-${section.kind}">${section.title?`<h${level}>${inlineStudy(section.title)}</h${level}>`:''}${richAnswer(section.body)}</section>`).join('');
}
function keyPointsBlock(points,level=3) {
  if(!points?.length)return '';
  return `<section class="key-points" aria-label="Ý chính cần nhớ"><h${level}>Ý chính cần nhớ <small>${points.length} ý</small></h${level}><ol>${points.map((point,i)=>`<li><span class="kp-num" aria-hidden="true">${i+1}</span><span>${inlineStudy(point)}</span></li>`).join('')}</ol></section>`;
}
// Answer pages are read-only for learners: keep them for the session (and
// prefetch neighbours) so moving between questions needs no waiting.
const essayCache=new Map(), chapterAnswerCache=new Map(), quizAnswerCache=new Map(), studyCacheTtl=5*60*1000;
function clearStudyCaches(){essayCache.clear();chapterAnswerCache.clear();quizAnswerCache.clear();}
function cachedApi(cache,key,path) {
  const hit=cache.get(key);
  if(hit&&Date.now()-hit.at<studyCacheTtl)return hit.promise;
  const entry={at:Date.now(),promise:api(path)};cache.set(key,entry);
  entry.promise.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
  return entry.promise;
}
const canPrefetch=()=>navigator.onLine!==false&&!navigator.connection?.saveData;
function essayStatusOf(id){const row=state.essays.find(e=>e.question===id);return row?.learned?'mastered':row?.status||'unseen';}
function setEssayProgress(id,patch) {
  let row=state.essays.find(e=>e.question===id);
  if(!row){row={question:id,learned:0,status:'unseen',viewed_at:null,answered_at:null,updated_at:0};state.essays.push(row);}
  Object.assign(row,patch,{updated_at:Date.now()});
  row.learned=row.status==='mastered'?1:0;
  if(row.learned)learnedQuestions.add(id);else learnedQuestions.delete(id);
}
function chapterEssays(chapter){return state.questions.filter(q=>q.kind==='essay'&&q.chapter===chapter).sort((a,b)=>(a.tier==='extra')-(b.tier==='extra'));}
function essayList() {
  const control=controls('essay');
  if(!filter.chapter){
    const chapters=state.chapters.filter(c=>(!filter.subject||c.subject===filter.subject)&&state.questions.some(q=>q.chapter===c.id&&q.kind==='essay'));
    main.innerHTML=title('Học tự luận','Chọn chương để đọc đáp án, học từng ý hoặc tự viết bài.')+'<section class="card">'+control.html+'</section><div class="grid section">'+chapters.map(c=>{const qs=state.questions.filter(q=>q.chapter===c.id&&q.kind==='essay');return `<article class="card"><small>${esc(subjectName(c.subject))}</small><h2>${esc(c.title)}</h2><p>${qs.filter(q=>q.tier==='main').length} câu chính · ${qs.filter(q=>q.tier==='extra').length} câu bổ sung</p>${bar(coverage([c]))}<div class="actions">${link('essay/'+c.id,'Vào học','primary')}${link('essayanswers/'+c.id,'Đáp án cả chương')}</div></article>`;}).join('')+'</div>'+(chapters.length?'':empty('Chưa có câu tự luận trong môn này.'));bindFilters();return;
  }
  const tier=filter.tier==='extra'?'extra':'main';filter.tier=tier;
  const tiers=['main','extra'].filter(t=>t===tier||state.questions.some(q=>q.kind==='essay'&&q.chapter===filter.chapter&&q.tier===t));
  main.innerHTML=title('Tự luận',chapterName(filter.chapter))+`<section class="card">${control.html}<div class="actions section">${link('essayanswers/'+filter.chapter,'Xem toàn bộ đáp án chương','primary')}</div>${tiers.length>1?`<div class="study-tabs" role="tablist" aria-label="Nhóm câu hỏi tự luận">${tiers.map(t=>`<button role="tab" aria-selected="${t===tier}" data-study-tier="${t}">${tierLabel(t)}</button>`).join('')}</div>`:''}<div class="filters">${field('Tìm nội dung câu hỏi',input('essay-search',filter.search,'search'))}${field('Trạng thái học',select('essay-status',opt('all','Tất cả',studyStatusFilter)+Object.entries(studyStatuses).map(([v,t])=>opt(v,t,studyStatusFilter)).join('')))}</div></section><div id="essay-cards" class="list section"></div>`;
  let limit=20;
  function update(){
    const term=filter.search.toLocaleLowerCase('vi');
    const qs=chapterEssays(filter.chapter).filter(q=>q.tier===tier&&q.prompt.toLocaleLowerCase('vi').includes(term)&&(studyStatusFilter==='all'||essayStatusOf(q.id)===studyStatusFilter));
    main.querySelector('#essay-cards').innerHTML=qs.slice(0,limit).map((q,i)=>{const status=essayStatusOf(q.id);return `<article class="card essay-row"><small>${esc(q.code||'Câu '+(i+1))} · <span class="status-chip status-${status}">${status==='mastered'?'✓ ':''}${studyStatuses[status]}</span></small><h3><a href="#essayitem/${esc(q.id)}?mode=question">${esc(q.prompt)}</a></h3><div class="actions">${link('essayitem/'+q.id+'?mode=answer','Xem đáp án','primary')}${link('essayitem/'+q.id+'?mode=write','Tự viết bài')}<button data-mastered="${esc(q.id)}" ${status==='mastered'?'disabled aria-pressed="true"':''}>${status==='mastered'?'✓ Đã thuộc':'Đánh dấu đã thuộc'}</button></div></article>`;}).join('')||empty('Chưa có câu hỏi phù hợp với bộ lọc.');
    main.querySelector('#essay-cards').insertAdjacentHTML('beforeend',`<p class="muted">${Math.min(limit,qs.length)}/${qs.length} câu</p>${limit<qs.length?'<button id="more-study">Xem thêm</button>':''}`);
    on('#more-study','click',()=>{limit+=20;update();});
    // Update the local copy instead of reloading every subject and question.
    on('[data-mastered]','click',async(_,b)=>{b.disabled=true;try{await api('essay/'+b.dataset.mastered,{status:'mastered'});setEssayProgress(b.dataset.mastered,{status:'mastered'});const s=draftSessions.get(b.dataset.mastered);if(s)s.q.status='mastered';update();}catch(error){b.disabled=false;throw error;}});
  }
  update();bindFilters();on('[data-study-tier]','click',(_,b)=>{filter.tier=b.dataset.studyTier;essayList();});
  on('[name=essay-search]','input',(_,el)=>{filter.search=el.value;limit=20;update();});on('[name=essay-status]','change',(_,el)=>{studyStatusFilter=el.value;limit=20;update();});
}
const draftSessions=new Map();
const essayModes={answer:['read',true],question:['read',false],memorize:['memorize',false],write:['write',false],compare:['compare',false]};
async function loadEssay(id) {
  const session=draftSessions.get(id);
  if(session&&(session.saving||Object.keys(session.pending).length||Date.now()-session.loadedAt<studyCacheTtl))return session;
  const q=await cachedApi(essayCache,id,'essay/'+id);
  const current=draftSessions.get(id)||{q,pending:{},saving:null,timer:null,error:''};
  if(!current.saving&&!Object.keys(current.pending).length)current.q=q;
  current.loadedAt=Date.now();essayCache.delete(id);draftSessions.set(id,current);
  return current;
}
function prefetchEssay(id){if(id&&canPrefetch()&&!draftSessions.has(id))cachedApi(essayCache,id,'essay/'+id).catch(()=>{});}
async function essayItem(rawId,generation){
  const [id,query='']=rawId.split('?');
  const [initialMode,initialShown]=essayModes[new URLSearchParams(query).get('mode')]||essayModes.question;
  const session=await loadEssay(id);if(generation!==viewGeneration)return;
  const item=session.q, points=item.key_points||[];
  const siblings=chapterEssays(item.chapter), index=siblings.findIndex(q=>q.id===id);
  const previous=siblings[index-1], next=siblings[index+1];
  let mode=initialMode,shown=initialShown;
  document.body.classList.add('focus-study');
  const tabs=[['read','Đáp án'],['memorize','Học từng ý'],['write','Tự viết'],['compare','Đối chiếu']];
  main.innerHTML=`<div class="essay-view">
  <nav class="study-crumbs" aria-label="Vị trí câu hỏi">${link('essay/'+item.chapter,'← Danh sách câu','link')}<span>${esc(chapterName(item.chapter))}${index>=0?' · Câu '+(index+1)+'/'+siblings.length:''}</span>${link('essayanswers/'+item.chapter,'Đáp án cả chương','link')}</nav>
  <article class="card essay-sheet">
    <div class="question-top"><span class="badge">${esc(item.code||'Tự luận')}</span><small>${tierLabel(item.tier)} · <span id="essay-status-label"></span></small></div>
    <h1 class="question-title" id="essay-title" tabindex="-1">${esc(item.prompt)}</h1>
    <div class="study-tabs mode-tabs" role="group" aria-label="Cách học câu này">${tabs.map(([value,label])=>`<button type="button" data-study-mode="${value}">${label}</button>`).join('')}</div>
    <div id="answer-gate" class="reveal-box"><p>Tự nhớ hoặc viết dàn ý trước, rồi mở đáp án để đối chiếu.</p><div class="actions"><button type="button" id="toggle-answer" class="primary">Xem đáp án</button></div></div>
    <div id="model-answer" class="model-answer" hidden>${keyPointsBlock(points,2)}<div class="answer-content answer-body">${studyAnswer(item.explanation,2)}</div>
      <div class="answer-tools"><button type="button" id="hide-answer" class="link">Ẩn đáp án</button></div></div>
    <div id="recall-points" hidden><p class="muted">Đọc câu hỏi, tự nói lại từng ý rồi chạm để kiểm tra.</p>${points.map((p,i)=>`<details class="recall-point"><summary><span class="kp-num" aria-hidden="true">${i+1}</span> Ý ${i+1} — chạm để hiện</summary><p>${inlineStudy(p)}</p></details>`).join('')||'<p>Chưa có ý chính riêng; hãy dùng đáp án đầy đủ.</p>'}<div class="actions"><button type="button" id="show-all">Hiện tất cả ý</button><button type="button" id="memorize-answer">Xem đáp án đầy đủ</button></div></div>
    <div id="essay-compare" hidden><p class="muted">Bạn tự đánh dấu từng ý đã có; website không tự chấm theo từ khóa.</p><table class="compare-table"><thead><tr><th>Ý cần đạt</th><th>Bài của bạn</th></tr></thead><tbody>${points.map((p,i)=>`<tr><td><span class="kp-num" aria-hidden="true">${i+1}</span> ${inlineStudy(p)}</td><td><label><input type="checkbox" data-assessment="${i}" ${item.assessment[i]?'checked':''}> Đã có</label></td></tr>`).join('')}</tbody></table><div id="missing-points"></div><div class="compare-columns"><section><h2>Bài làm của bạn</h2><div id="your-answer" class="content"></div></section><section><h2>Đáp án tham khảo</h2><div class="answer-content">${studyAnswer(item.explanation,3)}</div></section></div></div>
    <div id="essay-editor" hidden><label>Bài làm của bạn<textarea id="essay-draft" rows="12" maxlength="500000" placeholder="Viết câu trả lời của bạn…">${esc(item.draft)}</textarea></label><div class="actions"><button type="button" id="save-essay">Lưu bài làm</button><button type="button" id="go-compare" class="primary">Đối chiếu với đáp án →</button></div></div>
    <div class="essay-status-row"><div class="status-toggles" role="group" aria-label="Đánh dấu câu này"><button type="button" data-status-toggle="mastered" aria-pressed="false">✓ Đã thuộc</button><button type="button" data-status-toggle="review" aria-pressed="false">↻ Cần ôn lại</button></div><p class="save-status" id="essay-save" role="status">Bài làm và trạng thái được tự động lưu.</p><button type="button" id="retry-essay" hidden>Thử lưu lại</button>
      <details class="more-tools"><summary>Thêm thao tác</summary><div class="more-panel"><div class="actions"><button type="button" id="copy-answer">Sao chép đáp án</button><button type="button" id="print-answer">In đáp án</button></div>${field('Trạng thái chi tiết',select('study-state',Object.entries(studyStatuses).map(([v,t])=>opt(v,t,item.status)).join('')))}</div></details></div>
    ${item.sources.length?`<section class="related-docs"><h2>Tài liệu liên quan</h2><div class="actions">${item.sources.map(sid=>state.documents.find(d=>d.id===sid)).filter(Boolean).map(d=>`<a class="btn link" target="_blank" rel="noopener" href="#doc/${esc(d.id)}">${esc(docLabel(d))}</a>`).join('')}</div></section>`:''}
  </article>
  <nav class="answer-navigation study-nav" aria-label="Chuyển câu tự luận">${previous?`<a class="btn" data-essay-step="${esc(previous.id)}" data-key-prev href="#essayitem/${esc(previous.id)}"><span class="nav-long">← Câu trước</span><span class="nav-short">← Trước</span></a>`:'<span class="btn" aria-disabled="true"><span class="nav-long">← Câu trước</span><span class="nav-short">← Trước</span></span>'}<span class="question-position">${index+1}/${siblings.length}</span>${next?`<a class="btn primary" data-essay-step="${esc(next.id)}" data-key-next href="#essayitem/${esc(next.id)}"><span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span></a>`:'<span class="btn" aria-disabled="true"><span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span></span>'}</nav></div>`;
  const statusLabel=()=>{if(!location.hash.startsWith('#essayitem/'+id))return;const e=main.querySelector('#essay-save');if(e)e.textContent=session.error||(session.saving||Object.keys(session.pending).length?'Đang lưu…':'Đã lưu vào tài khoản');const retry=main.querySelector('#retry-essay');if(retry)retry.hidden=!session.error;const status=main.querySelector('#essay-status-label');if(status)status.textContent=(item.status==='mastered'?'✓ ':'')+studyStatuses[item.status||'unseen'];main.querySelectorAll('[data-status-toggle]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.statusToggle===item.status)));const select=main.querySelector('[name=study-state]');if(select)select.value=item.status||'unseen';};session.notify=statusLabel;
  function save(patch){Object.assign(item,patch);Object.assign(session.pending,patch);session.error='';setEssayProgress(id,{status:item.status,viewed_at:item.viewed_at,answered_at:item.draft?.trim()?item.answered_at||Date.now():item.answered_at});statusLabel();clearTimeout(session.timer);session.timer=setTimeout(()=>flushEssay(session).catch(()=>{}),700);}
  function viewed(){if(!item.viewed_at){item.viewed_at=Date.now();save({viewed:true,...(item.status==='unseen'?{status:'viewed'}:{})});main.querySelector('[name=study-state]').value=item.status;}}
  function assess(){const values=points.map((_,i)=>!!main.querySelector('[data-assessment="'+i+'"]')?.checked);const missing=points.filter((_,i)=>!values[i]);main.querySelector('#missing-points').innerHTML=missing.length?'<h4>Ý còn thiếu</h4><ul>'+missing.map(p=>'<li>'+inlineStudy(p)+'</li>').join('')+'</ul>':'<p class="verdict good"><strong>✓ Đủ ý</strong><span>Bạn đã đánh dấu đủ các ý chính.</span></p>';return values;}
  function navigationMode(){return mode==='read'?(shown?'answer':'question'):mode==='compare'?'write':mode;}
  function draw(){
    const reading=mode==='read';
    main.querySelector('#answer-gate').hidden=!reading||shown;
    main.querySelector('#model-answer').hidden=!reading||!shown;
    main.querySelector('#recall-points').hidden=mode!=='memorize';
    main.querySelector('#essay-editor').hidden=!['write','compare'].includes(mode);
    main.querySelector('#essay-compare').hidden=mode!=='compare';
    main.querySelector('#your-answer').textContent=item.draft||'Bạn chưa viết bài.';
    main.querySelectorAll('.mode-tabs [data-study-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.studyMode===mode)));
    main.querySelectorAll('[data-essay-step]').forEach(a=>{a.href='#essayitem/'+a.dataset.essayStep+'?mode='+navigationMode();});
    if((reading&&shown)||mode==='compare')viewed();
    assess();statusLabel();
  }
  function setMode(value,reveal=value==='read'){mode=value;shown=reveal;main.querySelectorAll('.recall-point').forEach(d=>d.open=false);draw();}
  on('[data-study-mode]','click',(_,b)=>setMode(b.dataset.studyMode));
  on('#toggle-answer,#memorize-answer','click',()=>setMode('read',true));
  on('#hide-answer','click',()=>setMode('read',false));
  on('#go-compare','click',()=>{setMode('compare');main.querySelector('#essay-compare').scrollIntoView({block:'start'});});
  on('#show-all','click',()=>{main.querySelectorAll('.recall-point').forEach(d=>d.open=true);viewed();});
  on('#essay-draft','input',(_,el)=>{save({draft:el.value,...(['unseen','viewed','learning'].includes(item.status)&&el.value.trim()?{status:'answered'}:{})});main.querySelector('[name=study-state]').value=item.status;main.querySelector('#your-answer').textContent=el.value;});
  on('#save-essay,#retry-essay','click',()=>flushEssay(session));on('[name=study-state]','change',(_,el)=>save({status:el.value}));// Two toggles cover the statuses a learner sets by hand; turning one off
  // returns to the status the page tracks itself (answered / viewed / learning).
  on('[data-status-toggle]','click',(_,el)=>{const wanted=el.dataset.statusToggle,off=item.status===wanted;save({status:off?(item.draft?.trim()?'answered':item.viewed_at?'viewed':'learning'):wanted});toast(off?'Đã bỏ đánh dấu.':wanted==='mastered'?'Đã đánh dấu đã thuộc.':'Đã thêm vào danh sách cần ôn.');});on('[data-assessment]','change',()=>save({assessment:assess()}));
  on('#copy-answer','click',async()=>{try{await navigator.clipboard.writeText(item.explanation);toast('Đã sao chép đáp án.');}catch{toast('Không truy cập được bộ nhớ tạm. Hãy chọn và sao chép nội dung đáp án.');}});
  on('#print-answer','click',()=>{setMode('read',true);document.body.classList.add('printing-answer');window.print();document.body.classList.remove('printing-answer');});
  on('.recall-point','toggle',(_,d)=>{if(d.open)viewed();});
  draw();
  if(mode==='write')main.querySelector('#essay-draft').focus();
  prefetchEssay(next?.id);prefetchEssay(previous?.id);
}
async function flushEssay(session){
  clearTimeout(session.timer);if(session.saving)return session.saving;
  // Local state is already updated by save(); no full state reload is needed.
  session.error='';session.saving=(async()=>{while(Object.keys(session.pending).length){const patch={...session.pending};session.pending={};try{const saved=await api('essay/'+session.q.id,patch);Object.assign(session.q,{viewed_at:saved.viewed_at,answered_at:saved.answered_at});setEssayProgress(session.q.id,{viewed_at:saved.viewed_at,answered_at:saved.answered_at});}catch(error){session.pending={...patch,...session.pending};session.error='Chưa lưu được. Giữ trang mở và thử lại khi có mạng.';throw error;}}})().finally(()=>{session.saving=null;session.notify?.();});session.notify?.();return session.saving;
}
window.addEventListener('beforeunload',event=>{if([...draftSessions.values()].some(s=>s.saving||Object.keys(s.pending).length)){event.preventDefault();event.returnValue='';}});
window.addEventListener('online',()=>{for(const s of draftSessions.values())if(Object.keys(s.pending).length)flushEssay(s).catch(()=>{});});
function chapterPage(id){
  const c=chapterLookup.get(id);if(!c)return main.innerHTML=empty('Không tìm thấy chương.')+`<div class="actions section">${link('subjects','← Danh sách môn học')}</div>`;
  const n=chapterCounts(id), docs=state.documents.filter(d=>d.chapter===id), progress=coverage([c]);
  // Actions first so the learner reaches practice or answers in one tap;
  // the long overview follows (closed on phones).
  main.innerHTML=`<nav class="study-crumbs" aria-label="Điều hướng">${link('subject/'+c.subject,'← '+subjectName(c.subject),'link')}</nav>`+title(c.title,'')+`<section class="card chapter-start"><div class="chapter-row-head"><h2>Bắt đầu học</h2>${n.quiz||n.essay?`<span class="row-progress">${bar(progress)}<small>${progress}% đã học</small></span>`:''}</div>${chapterActions(id,n)}</section>
  <details class="card section chapter-overview" ${matchMedia('(min-width: 681px)').matches?'open':''}><summary><h2>Tổng quan kiến thức</h2></summary><div class="answer-content">${c.overview?richAnswer(c.overview):'<p>Đọc tài liệu của chương để ôn kiến thức nền, sau đó luyện trắc nghiệm và tự luận.</p>'}</div></details>
  ${docs.length?`<section class="card section"><h2>Tài liệu học tập</h2><div class="actions">${sourceLinks(docs.map(d=>d.id))}</div></section>`:''}`;
}
function studyStats(){const rows=state.essays;return '<section class="section"><h2>Tiến độ tự luận</h2><div class="grid metrics">'+metric('Đã bắt đầu học',rows.filter(e=>e.status!=='unseen'||e.learned).length)+metric('Đã xem đáp án',rows.filter(e=>e.viewed_at).length)+metric('Đã tự trả lời',rows.filter(e=>e.answered_at||e.status==='answered').length)+metric('Đã thuộc',rows.filter(e=>e.learned||e.status==='mastered').length)+metric('Cần ôn tập',rows.filter(e=>e.status==='review').length)+'</div><div class="list section">'+state.chapters.map(c=>{const qs=state.questions.filter(q=>q.kind==='essay'&&q.chapter===c.id);if(!qs.length)return '';const learned=qs.filter(q=>rows.some(e=>e.question===q.id&&(e.learned||e.status==='mastered'))).length;return '<article class="card"><h3>'+esc(c.title)+'</h3><p>'+learned+'/'+qs.length+' câu đã thuộc</p>'+bar(Math.round(learned/qs.length*100))+link('essay/'+c.id,'Tiếp tục học')+'</article>';}).join('')+'</div></section>';}
async function settingsPage(generation){main.innerHTML=title('Cài đặt','Tài khoản, dữ liệu và sao lưu')+`<section class="card"><h2>Tài khoản ChatGPT</h2><p>Đăng ký, đăng nhập, đăng xuất và mật khẩu do tài khoản ChatGPT quản lý. Website không lưu mật khẩu riêng.</p><div class="actions">${link('account','Hồ sơ và đăng xuất')}<a class="btn" href="https://chatgpt.com/" target="_blank" rel="noopener">Mở tài khoản ChatGPT</a></div></section>`;if(!state.user.isAdmin)return;const backups=await api('backups');if(generation!==viewGeneration)return;main.insertAdjacentHTML('beforeend',`<section class="card section"><h2>Sao lưu và khôi phục</h2><p>Sao lưu dữ liệu và bản sao các tệp gốc vào kho lưu trữ lâu dài. Khôi phục gộp theo ID, không xóa các mục mới; tự tạo thêm bản sao trước khi khôi phục.</p><button id="make-backup" class="primary">Tạo bản sao lưu đầy đủ</button><div class="list section">${backups.map(b=>`<article class="listitem"><div><strong>${esc(date(b.created))}</strong><small> · ${b.file_count} tệp</small></div><div class="actions"><a class="btn" href="/api/backups/${b.id}">Tải dữ liệu JSON</a><button data-restore="${b.id}">Khôi phục</button></div></article>`).join('')||'<p>Chưa có bản sao lưu.</p>'}</div><p class="muted">Tệp JSON chứa dữ liệu và tham chiếu đến các bản sao tệp đã lưu trên máy chủ.</p></section>`);on('#make-backup','click',async(_,b)=>{b.disabled=true;try{await api('backups',{});await render();toast('Đã sao lưu cả dữ liệu và tệp.');}finally{b.disabled=false;}});on('[data-restore]','click',async(_,b)=>{if(!confirm('Khôi phục dữ liệu trong bản sao? Các bản ghi trùng ID sẽ được thay thế; hệ thống tạo điểm khôi phục trước khi thực hiện.'))return;b.disabled=true;try{await api('backups/'+b.dataset.restore+'/restore',{});await refresh();toast('Đã khôi phục dữ liệu.');}finally{b.disabled=false;}});}
function mountStudyAdmin(){
 const panel=main.querySelector('#admin-panel-2');
 panel.insertAdjacentHTML('beforeend','<div class="section">'+state.subjects.map(s=>`<details class="card section"><summary>${esc(s.title)}</summary><form data-edit-subject="${s.id}" class="section">${field('Tên môn',input('title',s.title,'text','required'))}${field('Biểu tượng',input('icon',s.icon||'▤','text','maxlength="8"'))}${field('Mô tả',area('description',s.description||''))}<div class="actions"><button>Lưu môn học</button><button type="button" data-delete-subject="${s.id}">Xóa môn trống</button></div></form>${state.chapters.filter(c=>c.subject===s.id).map((c,i)=>`<details class="section"><summary>${i+1}. ${esc(c.title)}</summary><form data-edit-chapter="${c.id}">${field('Tên chương',input('title',c.title,'text','required'))}${field('Tổng quan kiến thức (Markdown)',area('overview',c.overview||'','maxlength="100000"'))}<div class="actions"><button>Lưu chương</button><button type="button" data-move="${c.id}" data-direction="-1">↑ Lên</button><button type="button" data-move="${c.id}" data-direction="1">↓ Xuống</button><button type="button" data-delete-chapter="${c.id}">Xóa chương trống</button></div></form></details>`).join('')}</details>`).join('')+'</div>');
 on('[data-edit-subject],[data-edit-chapter]','submit',async(event,form)=>{event.preventDefault();const id=form.dataset.editSubject||form.dataset.editChapter;await api((form.dataset.editSubject?'subjects/':'chapters/')+id,Object.fromEntries(new FormData(form)),'PATCH');await refresh();toast('Đã lưu nội dung.');});
 on('[data-delete-subject],[data-delete-chapter]','click',async(_,button)=>{if(!confirm('Xóa mục trống này? Mục còn dữ liệu sẽ được giữ lại.'))return;await api((button.dataset.deleteSubject?'subjects/':'chapters/')+(button.dataset.deleteSubject||button.dataset.deleteChapter),undefined,'DELETE');await refresh();});
 on('[data-move]','click',async(_,button)=>{const c=chapterLookup.get(button.dataset.move),ids=state.chapters.filter(x=>x.subject===c.subject).map(x=>x.id),i=ids.indexOf(c.id),j=i+Number(button.dataset.direction);if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await api('chapters/order',{subject:c.subject,ids},'PATCH');await refresh();});
 main.querySelectorAll('[data-deldoc]').forEach(b=>b.insertAdjacentHTML('beforebegin',`<button data-rename-doc="${b.dataset.deldoc}">Đổi tên</button>`));
 on('[data-rename-doc]','click',async(_,b)=>{const d=state.documents.find(x=>x.id===b.dataset.renameDoc),name=prompt('Tên tài liệu',d.title);if(!name?.trim())return;await api('documents/'+d.id,{title:name},'PATCH');await refresh();});
}

async function chapterAnswers(id,generation){
 const chapter=chapterLookup.get(id);if(!chapter){main.innerHTML=empty('Không tìm thấy chương.');return;}
 const questions=await cachedApi(chapterAnswerCache,id,'essay-answers?chapter='+encodeURIComponent(id));if(generation!==viewGeneration)return;
 main.innerHTML=title('Đáp án tự luận cả chương',chapter.title,'compact-heading')+`<nav class="study-crumbs" aria-label="Điều hướng">${link('essay/'+id,'← Danh sách câu hỏi','link')}${link('chapter/'+id,'Tổng quan chương','link')}</nav>`;
 if(!questions.length){main.insertAdjacentHTML('beforeend',empty('Chương này chưa có câu tự luận.'));return;}
 main.insertAdjacentHTML('beforeend',`<section class="card section answer-toolbar"><p>${questions.length} câu, mỗi câu mở sẵn <strong>ý chính cần nhớ</strong> rồi đến đáp án đầy đủ. Thu gọn để chỉ ôn câu hỏi và ý chính.</p><div class="actions"><button id="expand-chapter-answers">Hiện tất cả đáp án</button><button id="collapse-chapter-answers">Chỉ xem câu hỏi + ý chính</button></div>${field('Chuyển đến câu',select('jump-answer',opt('','Chọn câu hỏi')+questions.map((q,i)=>opt(q.id,'Câu '+(i+1)+' · '+(q.code?q.code+' · ':'')+q.prompt)).join('')))}</section><div id="chapter-answer-list" class="section">${['main','extra'].map(t=>{const group=questions.filter(q=>q.tier===t);if(!group.length)return '';return `<section class="section"><h2>${tierLabel(t)} · ${group.length} câu</h2>${group.map(q=>{const i=questions.indexOf(q);return `<article class="card section chapter-answer" id="answer-${esc(q.id)}"><div class="question-top"><span class="badge">Câu ${i+1}${q.code?' · '+esc(q.code):''}</span></div><h2 class="question-title">${esc(q.prompt)}</h2>${keyPointsBlock(q.key_points)}<details class="chapter-answer-content" open><summary>Đáp án đầy đủ — bấm để hiện / ẩn</summary><div class="answer-content">${studyAnswer(q.explanation)}</div>${q.sources.length?`<div class="actions section">${sourceLinks(q.sources)}</div>`:''}</details><div class="actions section">${link('essayitem/'+q.id+'?mode=answer','Học riêng câu này')}${link('essayitem/'+q.id+'?mode=write','Tự viết bài')}</div></article>`;}).join('')}</section>`;}).join('')}</div><div class="actions section"><button id="answers-top">↑ Về đầu trang</button>${link('essay/'+id,'Về danh sách câu hỏi')}</div>`);
 on('#expand-chapter-answers','click',()=>main.querySelectorAll('.chapter-answer-content').forEach(d=>d.open=true));
 on('#collapse-chapter-answers','click',()=>main.querySelectorAll('.chapter-answer-content').forEach(d=>d.open=false));
 on('[name=jump-answer]','change',(_,el)=>{const article=document.getElementById('answer-'+el.value);if(!article)return;article.querySelector('details').open=true;article.scrollIntoView({block:'start'});article.setAttribute('tabindex','-1');article.focus({preventScroll:true});});
 on('#answers-top','click',()=>{window.scrollTo({top:0});main.focus({preventScroll:true});});
}

async function quizAnswers(rawId,generation){
 const [id,query='']=rawId.split('?');const chapter=chapterLookup.get(id);
 if(!chapter){main.innerHTML=empty('Không tìm thấy chương.');return;}
 const questions=await cachedApi(quizAnswerCache,id,'quiz-answers?chapter='+encodeURIComponent(id));if(generation!==viewGeneration)return;
 const requestedTier=new URLSearchParams(query).get('tier');
 let tier=['main','extra'].includes(requestedTier)?requestedTier:'all',index=0;
 // Phones default to one question at a time; the last choice is remembered.
 let mode=preference('quiz-answer-view',matchMedia('(max-width: 680px)').matches?'single':'all');if(!['single','all'].includes(mode))mode='all';
 let hideKeys=preference('quiz-answer-hide','0')==='1';const revealed=new Set();
 main.innerHTML=title('Đáp án trắc nghiệm',chapter.title,'compact-heading')+`<nav class="study-crumbs" aria-label="Điều hướng">${link('quiz/'+id,'← Luyện trắc nghiệm','link')}${link('chapter/'+id,'Tổng quan chương','link')}</nav>
 <section class="card answer-toolbar"><div class="toolbar-row"><div class="segmented" role="group" aria-label="Cách xem đáp án"><button type="button" data-quiz-view="single">Từng câu</button><button type="button" data-quiz-view="all">Cả chương</button></div>
 <label class="toggle"><input type="checkbox" id="hide-keys" ${hideKeys?'checked':''}> Che đáp án để tự kiểm tra</label></div>
 ${questions.some(q=>q.tier==='extra')?`<div class="filters">${field('Nhóm câu hỏi',select('quiz-answer-tier',opt('all','Cả hai nhóm',tier)+opt('main','Câu hỏi chính',tier)+opt('extra','Câu hỏi bổ sung',tier)))}</div>`:''}
 <p class="muted toolbar-note">Đáp án đúng có nhãn <strong class="key-inline">✓ Đáp án đúng</strong>; câu nhiều đáp án hiện đủ các phương án đúng.</p></section>
 <div id="quiz-answer-list" class="section"></div>`;
 const list=main.querySelector('#quiz-answer-list');
 function card(q,i,total){
  const shown=!hideKeys||revealed.has(q.id), keys=answerIds(q.correct).length;
  return `<article class="card quiz-answer-card" id="qa-${esc(q.id)}"><div class="question-top"><span class="badge">Câu ${i+1}/${total}</span>${keys>1?`<span class="badge multi-badge">${keys} đáp án đúng</span>`:''}${questions.some(x=>x.tier==='extra')?`<small>${tierLabel(q.tier)}</small>`:''}</div>
  <h2 class="question-title">${esc(q.prompt)}</h2>
  <ol class="options study-options" aria-label="Các phương án">${lettered(q).map(o=>`<li class="option ${shown?(o.correct?'is-key':'is-dim'):''}"><span class="option-letter" aria-hidden="true">${o.letter}</span><span class="option-text"><span class="sr-only">${o.letter}. </span>${esc(o.text)}${shown&&o.correct?'<span class="option-status">✓ Đáp án đúng</span>':''}</span></li>`).join('')}</ol>
  ${shown?whyBlock(q):`<div class="reveal-box"><button type="button" class="primary" data-reveal="${esc(q.id)}">Xem đáp án câu này</button></div>`}
  ${q.sources.length?`<div class="actions source-links">${sourceLinks(q.sources)}</div>`:''}</article>`;
 }
 function draw(){
  const rows=questions.filter(q=>tier==='all'||q.tier===tier);index=Math.min(index,Math.max(0,rows.length-1));
  document.body.classList.toggle('focus-study',mode==='single'&&rows.length>0);
  main.querySelectorAll('[data-quiz-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.quizView===mode)));
  if(!rows.length){list.innerHTML=empty('Chưa có câu trắc nghiệm trong nhóm này.');return;}
  if(mode==='single'){
   const current=rows[index], hidden=hideKeys&&!revealed.has(current.id);
   list.innerHTML=card(current,index,rows.length)+`<nav class="answer-navigation study-nav" aria-label="Chuyển câu trắc nghiệm"><button type="button" data-answer-step="-1" data-key-prev ${index===0?'disabled':''}><span class="nav-long">← Câu trước</span><span class="nav-short">← Trước</span></button>${hidden?`<button type="button" class="reveal-nav" data-reveal="${esc(current.id)}">Xem đáp án</button>`:`<label class="jump"><span class="sr-only">Chọn câu</span><select data-answer-jump>${rows.map((_,i)=>`<option value="${i}" ${i===index?'selected':''}>Câu ${i+1}/${rows.length}</option>`).join('')}</select></label>`}<button type="button" class="primary" data-answer-step="1" data-key-next ${index===rows.length-1?'disabled':''}><span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span></button></nav>`;
  } else list.innerHTML=`<p class="muted">Hiển thị đầy đủ ${rows.length} câu${hideKeys?'; đáp án đang được che':''}.</p>`+['main','extra'].map(t=>{const group=rows.filter(q=>q.tier===t);return group.length?'<section class="section"><h2>'+tierLabel(t)+'</h2>'+group.map(q=>card(q,rows.indexOf(q),rows.length)).join('')+'</section>':'';}).join('');
 }
 function go(next){index=next;draw();const target=list.querySelector('.quiz-answer-card');target?.scrollIntoView({block:'start'});}
 // Delegated listeners: the list is redrawn but the container stays.
 list.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.answerStep)go(index+Number(button.dataset.answerStep));
  else if(button.dataset.reveal){revealed.add(button.dataset.reveal);const at=window.scrollY;draw();if(mode==='all')window.scrollTo(0,at);(list.querySelector('#qa-'+CSS.escape(button.dataset.reveal)+' .why')||list.querySelector('.why'))?.scrollIntoView({block:'nearest'});}
 });
 list.addEventListener('change',event=>{if(event.target.matches('[data-answer-jump]'))go(Number(event.target.value));});
 on('[data-quiz-view]','click',(_,b)=>{mode=b.dataset.quizView;savePreference('quiz-answer-view',mode);draw();});
 on('#hide-keys','change',(_,el)=>{hideKeys=el.checked;revealed.clear();savePreference('quiz-answer-hide',hideKeys?'1':'0');draw();});
 on('[name=quiz-answer-tier]','change',(_,el)=>{tier=el.value;index=0;draw();});
 draw();
}
