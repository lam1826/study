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
// Each section of a model answer becomes a labelled block in its kind's
// colour: answer → Đáp án, explanation, example, source; unknown headings stay neutral.
const sectionKinds={main:'answer',explain:'explain',example:'example',source:'source'};
function studyAnswer(text,level=3) {
  return answerSections(text).map(section=>contentBlock(sectionKinds[section.kind]||'other',level,section.title?inlineStudy(section.title):'',richAnswer(section.body))).join('');
}
function keyPointsBlock(points,level=3) {
  if(!points?.length)return '';
  return contentBlock('answer',level,`Ý chính cần nhớ <small>${points.length} ý</small>`,`<ol class="key-list">${points.map((point,i)=>`<li><span class="kp-num" aria-hidden="true">${i+1}</span><span>${inlineStudy(point)}</span></li>`).join('')}</ol>`);
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
// Essay list: chapter line with "Đổi chương", search, then status chips with
// counts; compact rows with secondary actions; one primary action per screen.
function essayList() {
  const control=controls('essay');
  if(!filter.chapter){
    const chapters=state.chapters.filter(c=>(!filter.subject||c.subject===filter.subject)&&state.questions.some(q=>q.chapter===c.id&&q.kind==='essay'));
    main.innerHTML=`<nav class="study-crumbs" aria-label="Điều hướng">${link('home','← Tổng quan','link')}</nav>`+title('Học tự luận','Chọn chương để học từng câu hoặc đọc đáp án cả chương.','compact-heading')
      +`<div class="content-filters filter-line"><label class="inline-field">Môn học${select('subject',opt('','Tất cả môn học',filter.subject)+state.subjects.map(s=>opt(s.id,s.title,filter.subject)).join(''))}</label></div>`
      +(chapters.length?`<div class="panel section">${chapters.map(c=>{const qs=chapterEssays(c.id), extra=qs.filter(q=>q.tier==='extra').length, done=qs.filter(q=>essayStatusOf(q.id)==='mastered').length;
        return `<div class="list-row"><a class="row-link" href="#essay/${esc(c.id)}"><strong>${esc(c.title)}</strong><small>${esc(subjectName(c.subject))} · ${qs.length-extra} câu chính${extra?' · '+extra+' câu bổ sung':''} · ${done}/${qs.length} đã thuộc</small></a><a class="row-side" href="#essayanswers/${esc(c.id)}">Đáp án cả chương</a></div>`;}).join('')}</div>`:empty('Chưa có câu tự luận trong môn này.'));
    bindFilters();return;
  }
  const chapter=chapterLookup.get(filter.chapter);
  const tier=filter.tier==='extra'?'extra':'main';filter.tier=tier;
  const tiers=['main','extra'].filter(t=>t===tier||state.questions.some(q=>q.kind==='essay'&&q.chapter===filter.chapter&&q.tier===t));
  main.innerHTML=`<nav class="study-crumbs" aria-label="Điều hướng">${link('chapter/'+filter.chapter,'← '+chapterShort(chapter),'link')}</nav>`+title('Tự luận','','compact-heading')+`<section class="card pick-card">
    <details class="chapter-pick"><summary><span class="pick-text"><small>${esc(subjectName(chapter?.subject))}</small><strong>${esc(chapter?.title||'Chọn chương')}</strong></span><span class="pick-change">Đổi chương</span></summary><div class="pick-body">${control.html}</div></details>
    <div class="pick-rest">${tiers.length>1?`<div class="study-tabs" role="tablist" aria-label="Nhóm câu hỏi tự luận">${tiers.map(t=>`<button role="tab" aria-selected="${t===tier}" data-study-tier="${t}">${tierLabel(t)}</button>`).join('')}</div>`:''}
    <label class="search-field"><span class="sr-only">Tìm nội dung câu hỏi</span>${input('essay-search',filter.search,'search','placeholder="Tìm trong câu hỏi"')}</label>
    <div class="chips status-chips" id="status-chips" role="group" aria-label="Lọc theo trạng thái học"></div>
    <div class="actions list-primary">${link('essayanswers/'+filter.chapter,'Xem toàn bộ đáp án chương','primary')}</div></div></section><div id="essay-cards" class="section"></div>`;
  const cards=main.querySelector('#essay-cards'), chips=main.querySelector('#status-chips');
  let limit=20;
  const row=(q,number)=>{const status=essayStatusOf(q.id), mastered=status==='mastered';
    return `<div class="list-row essay-row"><a class="row-link is-clamped" href="#essayitem/${esc(q.id)}?mode=question"><strong>${esc(q.prompt)}</strong><small>${esc(q.code||'Câu '+number)} · <span class="status-chip status-${status}">${mastered?'✓ ':''}${studyStatuses[status]}</span></small></a><span class="row-tools"><a href="#essayitem/${esc(q.id)}?mode=answer">Xem đáp án</a><a href="#essayitem/${esc(q.id)}?mode=write">Tự viết</a>${mastered?'':`<button type="button" data-mastered="${esc(q.id)}">Đánh dấu đã thuộc</button>`}</span></div>`;};
  function update(){
    const term=filter.search.toLocaleLowerCase('vi');
    const all=chapterEssays(filter.chapter).filter(q=>q.tier===tier), found=all.filter(q=>q.prompt.toLocaleLowerCase('vi').includes(term));
    const counts=new Map();for(const q of found){const s=essayStatusOf(q.id);counts.set(s,(counts.get(s)||0)+1);}
    if(studyStatusFilter!=='all'&&!Object.hasOwn(studyStatuses,studyStatusFilter))studyStatusFilter='all';
    // Chips show only statuses that occur (plus "Tất cả" and the current one).
    chips.innerHTML=[['all','Tất cả',found.length],...Object.entries(studyStatuses).map(([v,t])=>[v,t,counts.get(v)||0])].filter(([v,,n])=>n||v==='all'||v===studyStatusFilter).map(([v,t,n])=>`<button type="button" class="chip" data-status-filter="${v}" aria-pressed="${v===studyStatusFilter}">${t}<span class="chip-count">${n}</span></button>`).join('');
    const qs=found.filter(q=>studyStatusFilter==='all'||essayStatusOf(q.id)===studyStatusFilter);
    cards.innerHTML=(qs.length?`<div class="panel">${qs.slice(0,limit).map(q=>row(q,all.indexOf(q)+1)).join('')}</div>`:empty('Chưa có câu hỏi phù hợp với bộ lọc.'))+`<div class="pager"><small>${Math.min(limit,qs.length)}/${qs.length} câu</small>${limit<qs.length?'<button type="button" id="more-study">Xem thêm</button>':''}</div>`;
  }
  // Delegated: the rows and chips are redrawn, their containers stay.
  chips.addEventListener('click',event=>{const b=event.target.closest('[data-status-filter]');if(!b)return;studyStatusFilter=b.dataset.statusFilter;limit=20;update();});
  cards.addEventListener('click',async event=>{
    const b=event.target.closest('button');if(!b||b.disabled)return;
    if(b.id==='more-study'){limit+=20;update();return;}
    if(!b.dataset.mastered)return;
    // Update the local copy instead of reloading every subject and question.
    b.disabled=true;
    try{await api('essay/'+b.dataset.mastered,{status:'mastered'});setEssayProgress(b.dataset.mastered,{status:'mastered'});const s=draftSessions.get(b.dataset.mastered);if(s)s.q.status='mastered';update();}
    catch(error){b.disabled=false;toast(error.message);}
  });
  update();bindFilters();on('[data-study-tier]','click',(_,b)=>{filter.tier=b.dataset.studyTier;essayList();});
  on('[name=essay-search]','input',(_,el)=>{filter.search=el.value;limit=20;update();});
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
  <article class="essay-sheet">
    <div class="question-top"><span class="badge">${esc(item.code||'Tự luận')}</span><small>${tierLabel(item.tier)} · <span id="essay-status-label"></span></small></div>
    <h1 class="question-title" id="essay-title" tabindex="-1">${esc(item.prompt)}</h1>
    <div class="study-tabs mode-tabs" role="group" aria-label="Cách học câu này">${tabs.map(([value,label])=>`<button type="button" data-study-mode="${value}">${label}</button>`).join('')}</div>
    <div id="answer-gate" class="reveal-box"><p>Tự nhớ hoặc viết dàn ý trước, rồi mở đáp án để đối chiếu.</p><div class="actions"><button type="button" id="toggle-answer" class="primary">Xem đáp án</button></div></div>
    <div id="model-answer" class="model-answer" hidden>${keyPointsBlock(points,2)}<div class="answer-content answer-body">${studyAnswer(item.explanation,2)}</div>
      <div class="answer-tools"><button type="button" id="hide-answer" class="link">Ẩn đáp án</button></div></div>
    <div id="recall-points" hidden><p class="muted">Đọc câu hỏi, tự nói lại từng ý rồi chạm để kiểm tra.</p>${points.map((p,i)=>`<details class="recall-point"><summary><span class="kp-num" aria-hidden="true">${i+1}</span> Ý ${i+1} — chạm để hiện</summary><p>${inlineStudy(p)}</p></details>`).join('')||'<p>Chưa có ý chính riêng; hãy dùng đáp án đầy đủ.</p>'}<div class="actions"><button type="button" id="show-all">Hiện tất cả ý</button><button type="button" id="memorize-answer">Xem đáp án đầy đủ</button></div></div>
    <div id="essay-compare" hidden><p class="muted">Bạn tự đánh dấu từng ý đã có; website không tự chấm theo từ khóa.</p><table class="compare-table"><thead><tr><th>Ý cần đạt</th><th>Bài của bạn</th></tr></thead><tbody>${points.map((p,i)=>`<tr><td><span class="kp-num" aria-hidden="true">${i+1}</span> ${inlineStudy(p)}</td><td><label><input type="checkbox" data-assessment="${i}" ${item.assessment[i]?'checked':''}> Đã có</label></td></tr>`).join('')}</tbody></table><div id="missing-points"></div><div class="compare-columns"><section><h2>Bài làm của bạn</h2><div id="your-answer" class="content"></div></section><section><h2>Đáp án tham khảo</h2><div class="answer-content">${studyAnswer(item.explanation,3)}</div></section></div></div>
    <div id="essay-editor" hidden><div class="write-grid"><div class="write-main"><label>Bài làm của bạn<textarea id="essay-draft" rows="12" maxlength="500000" placeholder="Viết câu trả lời của bạn…">${esc(item.draft)}</textarea></label><p class="word-count" id="word-count"></p></div>${points.length?`<details class="kp-peek"><summary>Xem ý chính (${points.length})</summary><ol class="key-list">${points.map((point,i)=>`<li><span class="kp-num" aria-hidden="true">${i+1}</span><span>${inlineStudy(point)}</span></li>`).join('')}</ol></details>`:''}</div><div class="actions"><button type="button" id="save-essay">Lưu bài làm</button><button type="button" id="go-compare" class="primary">Đối chiếu với đáp án →</button></div></div>
    <div class="essay-status-row"><div class="status-toggles" role="group" aria-label="Đánh dấu câu này"><button type="button" data-status-toggle="mastered" aria-pressed="false">✓ Đã thuộc</button><button type="button" data-status-toggle="review" aria-pressed="false">↻ Cần ôn lại</button></div><p class="save-status" id="essay-save" role="status">Bài làm và trạng thái được tự động lưu.</p><button type="button" id="retry-essay" hidden>Thử lưu lại</button>
      <details class="more-tools"><summary>Thêm thao tác</summary><div class="more-panel"><div class="actions"><button type="button" id="copy-answer">Sao chép đáp án</button><button type="button" id="print-answer">In đáp án</button></div>${field('Trạng thái chi tiết',select('study-state',Object.entries(studyStatuses).map(([v,t])=>opt(v,t,item.status)).join('')))}</div></details></div>
    ${item.sources.length?contentBlock('source',2,'Tài liệu liên quan',`<div class="actions source-links">${item.sources.map(sid=>state.documents.find(d=>d.id===sid)).filter(Boolean).map(d=>`<a class="btn link" target="_blank" rel="noopener" href="#doc/${esc(d.id)}">${esc(docLabel(d))}</a>`).join('')}</div>`):''}
  </article>
  <nav class="answer-navigation study-nav" aria-label="Chuyển câu tự luận">${previous?`<a class="btn" data-essay-step="${esc(previous.id)}" data-key-prev href="#essayitem/${esc(previous.id)}"><span class="nav-long">← Câu trước</span><span class="nav-short">← Trước</span></a>`:'<span class="btn" aria-disabled="true"><span class="nav-long">← Câu trước</span><span class="nav-short">← Trước</span></span>'}<span class="question-position">${index+1}/${siblings.length}</span>${next?`<a class="btn primary" data-essay-step="${esc(next.id)}" data-key-next href="#essayitem/${esc(next.id)}"><span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span></a>`:'<span class="btn" aria-disabled="true"><span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span></span>'}</nav></div>`;
  const statusLabel=()=>{if(!location.hash.startsWith('#essayitem/'+id))return;const e=main.querySelector('#essay-save');if(e)e.textContent=session.error||(session.saving||Object.keys(session.pending).length?'Đang lưu…':'Đã lưu vào tài khoản');const retry=main.querySelector('#retry-essay');if(retry)retry.hidden=!session.error;const status=main.querySelector('#essay-status-label');if(status)status.textContent=(item.status==='mastered'?'✓ ':'')+studyStatuses[item.status||'unseen'];main.querySelectorAll('[data-status-toggle]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.statusToggle===item.status)));const select=main.querySelector('[name=study-state]');if(select)select.value=item.status||'unseen';};session.notify=statusLabel;
  function save(patch){Object.assign(item,patch);Object.assign(session.pending,patch);session.error='';setEssayProgress(id,{status:item.status,viewed_at:item.viewed_at,answered_at:item.draft?.trim()?item.answered_at||Date.now():item.answered_at});statusLabel();clearTimeout(session.timer);session.timer=setTimeout(()=>flushEssay(session).catch(()=>{}),700);}
  function viewed(){if(!item.viewed_at){item.viewed_at=Date.now();save({viewed:true,...(item.status==='unseen'?{status:'viewed'}:{})});main.querySelector('[name=study-state]').value=item.status;}}
  function assess(){const values=points.map((_,i)=>!!main.querySelector('[data-assessment="'+i+'"]')?.checked);const missing=points.filter((_,i)=>!values[i]);main.querySelector('#missing-points').innerHTML=missing.length?'<h4>Ý còn thiếu</h4><ul>'+missing.map(p=>'<li>'+inlineStudy(p)+'</li>').join('')+'</ul>':'<p class="verdict good"><strong>✓ Đủ ý</strong><span>Bạn đã đánh dấu đủ các ý chính.</span></p>';return values;}
  // Vietnamese is counted per written syllable ("chữ"), split on spaces.
  function countWords(){const n=(main.querySelector('#essay-draft').value.match(/\S+/g)||[]).length;main.querySelector('#word-count').textContent=n?n+' chữ':'Chưa viết chữ nào';}
  function navigationMode(){return mode==='read'?(shown?'answer':'question'):mode==='compare'?'write':mode;}
  function draw(){
    const reading=mode==='read';
    main.querySelector('#answer-gate').hidden=!reading||shown;
    main.querySelector('#model-answer').hidden=!reading||!shown;
    main.querySelector('#recall-points').hidden=mode!=='memorize';
    main.querySelector('#essay-editor').hidden=!['write','compare'].includes(mode);
    main.querySelector('#essay-compare').hidden=mode!=='compare';
    const peek=main.querySelector('.kp-peek');if(peek)peek.hidden=mode==='compare';
    main.querySelector('#your-answer').textContent=item.draft||'Bạn chưa viết bài.';
    countWords();
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
  on('#essay-draft','input',(_,el)=>{save({draft:el.value,...(['unseen','viewed','learning'].includes(item.status)&&el.value.trim()?{status:'answered'}:{})});main.querySelector('[name=study-state]').value=item.status;main.querySelector('#your-answer').textContent=el.value;countWords();});
  on('#save-essay,#retry-essay','click',()=>flushEssay(session));on('[name=study-state]','change',(_,el)=>save({status:el.value}));// Two toggles cover the statuses a learner sets by hand; turning one off
  // returns to the status the page tracks itself (answered / viewed / learning).
  on('[data-status-toggle]','click',(_,el)=>{const wanted=el.dataset.statusToggle,off=item.status===wanted;save({status:off?(item.draft?.trim()?'answered':item.viewed_at?'viewed':'learning'):wanted});toast(off?'Đã bỏ đánh dấu.':wanted==='mastered'?'Đã đánh dấu đã thuộc.':'Đã thêm vào danh sách cần ôn.');});on('[data-assessment]','change',()=>save({assessment:assess()}));
  on('#copy-answer','click',async()=>{try{await navigator.clipboard.writeText(item.explanation);toast('Đã sao chép đáp án.');}catch{toast('Không truy cập được bộ nhớ tạm. Hãy chọn và sao chép nội dung đáp án.');}});
  on('#print-answer','click',()=>{setMode('read',true);document.body.classList.add('printing-answer');window.print();document.body.classList.remove('printing-answer');});
  on('.recall-point,.kp-peek','toggle',(_,d)=>{if(d.open)viewed();});
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
// Essay progress on the statistics page: one summary line, then a row per chapter.
function studyStats(){
  const rows=state.essays, count=test=>rows.filter(test).length;
  const parts=[['đã bắt đầu học',count(e=>e.status!=='unseen'||e.learned)],['đã xem đáp án',count(e=>e.viewed_at)],['đã tự trả lời',count(e=>e.answered_at||e.status==='answered')],['đã thuộc',count(e=>e.learned||e.status==='mastered')],['cần ôn tập',count(e=>e.status==='review')]];
  const chapters=state.chapters.map(c=>{const qs=chapterEssays(c.id);if(!qs.length)return '';const learned=qs.filter(q=>essayStatusOf(q.id)==='mastered').length;
    return `<div class="list-row"><a class="row-link" href="#essay/${esc(c.id)}"><strong>${esc(c.title)}</strong><span class="row-progress">${bar(Math.round(learned/qs.length*100))}<small>${learned}/${qs.length} câu đã thuộc</small></span></a></div>`;}).join('');
  return `<section class="section"><h2>Tiến độ tự luận</h2><p class="stats-summary">${parts.map(([label,n])=>n+' câu '+label).join(' · ')}</p>${chapters?`<div class="panel">${chapters}</div>`:''}</section>`;
}
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

// Whole-chapter essay answers, compact by default: each question shows its
// key points; the full model answer is rendered only when opened, so a long
// chapter stays light. Read-only: nothing here changes study status.
async function chapterAnswers(id,generation){
 const chapter=chapterLookup.get(id);if(!chapter){main.innerHTML=empty('Không tìm thấy chương.')+`<div class="actions section">${link('essay','← Học tự luận')}</div>`;return;}
 const questions=await cachedApi(chapterAnswerCache,id,'essay-answers?chapter='+encodeURIComponent(id));if(generation!==viewGeneration)return;
 main.innerHTML=`<nav class="study-crumbs" aria-label="Điều hướng">${link('essay/'+id,'← Danh sách câu hỏi','link')}${link('chapter/'+id,'Tổng quan chương','link')}</nav>`+title('Đáp án tự luận cả chương',chapter.title,'compact-heading');
 if(!questions.length){main.insertAdjacentHTML('beforeend',empty('Chương này chưa có câu tự luận.'));return;}
 document.body.classList.add('focus-study');
 const byId=new Map(questions.map(q=>[q.id,q]));
 main.insertAdjacentHTML('beforeend',`<section class="card answer-toolbar"><div class="toolbar-row"><p class="toolbar-note-inline">${questions.length} câu · mỗi câu hiện câu hỏi và ý chính; mở đáp án đầy đủ khi cần.</p><button type="button" id="toggle-all-answers" aria-pressed="false">Mở tất cả đáp án</button></div>${contentLegend()}</section>
 <div id="chapter-answer-list">${['main','extra'].map(t=>{const group=questions.filter(q=>q.tier===t);if(!group.length)return '';return `<section class="answer-group"><h2>${tierLabel(t)} · ${group.length} câu</h2>${group.map(q=>{const i=questions.indexOf(q);return `<article class="answer-item chapter-answer" id="answer-${esc(q.id)}" data-index="${i}" tabindex="-1"><div class="question-top"><span class="badge">Câu ${i+1}/${questions.length}${q.code?' · '+esc(q.code):''}</span></div><h3 class="question-title">${esc(q.prompt)}</h3>${keyPointsBlock(q.key_points,4)}<details class="full-answer" data-answer="${esc(q.id)}"><summary><span class="when-closed">Xem đáp án đầy đủ</span><span class="when-open">Ẩn đáp án đầy đủ</span></summary><div class="full-answer-body"></div></details><div class="actions answer-item-actions">${link('essayitem/'+q.id+'?mode=answer','Học riêng câu này','link')}${link('essayitem/'+q.id+'?mode=write','Tự viết bài','link')}</div></article>`;}).join('')}</section>`;}).join('')}</div>
 <nav class="answer-navigation study-nav" aria-label="Chuyển câu tự luận"><button type="button" data-chapter-step="-1" data-key-prev><span class="nav-long">← Câu trước</span><span class="nav-short">← Trước</span></button><label class="jump"><span class="sr-only">Chuyển đến câu</span><select data-chapter-jump>${questions.map((q,i)=>opt(String(i),'Câu '+(i+1)+'/'+questions.length)).join('')}</select></label><button type="button" class="primary" data-chapter-step="1" data-key-next><span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span></button></nav>`);
 const list=main.querySelector('#chapter-answer-list'), items=[...list.querySelectorAll('.answer-item')], nav=main.querySelector('.study-nav'), jump=nav.querySelector('[data-chapter-jump]');
 const fill=details=>{const body=details.querySelector('.full-answer-body');if(body.childElementCount)return;const q=byId.get(details.dataset.answer);const links=sourceLinks(q.sources);body.innerHTML=studyAnswer(q.explanation,4)+(links?contentBlock('source',4,'Tài liệu liên quan',`<div class="actions source-links">${links}</div>`):'');};
 // `toggle` does not bubble; a capturing listener on the list still sees it.
 list.addEventListener('toggle',event=>{if(event.target.matches('details.full-answer')&&event.target.open)fill(event.target);syncToggle();},true);
 const toggleAll=main.querySelector('#toggle-all-answers');
 function syncToggle(){const all=items.every(item=>item.querySelector('details').open);toggleAll.textContent=all?'Thu gọn tất cả':'Mở tất cả đáp án';toggleAll.setAttribute('aria-pressed',String(all));}
 toggleAll.addEventListener('click',()=>{const open=toggleAll.getAttribute('aria-pressed')!=='true';items.forEach(item=>{const details=item.querySelector('details');if(open)fill(details);details.open=open;});syncToggle();});
 // Current question = the last one whose top has passed under the top bar.
 let current=0;
 const offset=()=>(document.querySelector('.topbar')?.getBoundingClientRect().height||0)+16;
 function locate(){let at=0;items.forEach((item,i)=>{if(item.getBoundingClientRect().top-offset()<=4)at=i;});current=at;jump.value=String(at);nav.querySelector('[data-chapter-step="-1"]').disabled=at===0;nav.querySelector('[data-chapter-step="1"]').disabled=at===items.length-1;}
 function goTo(i){const item=items[Math.max(0,Math.min(items.length-1,i))];window.scrollTo(0,window.scrollY+item.getBoundingClientRect().top-offset()+4);item.focus({preventScroll:true});locate();}
 nav.addEventListener('click',event=>{const button=event.target.closest('[data-chapter-step]');if(button&&!button.disabled)goTo(current+Number(button.dataset.chapterStep));});
 jump.addEventListener('change',()=>goTo(Number(jump.value)));
 const watch=new AbortController();let pending;
 window.addEventListener('scroll',()=>{if(!list.isConnected){watch.abort();return;}clearTimeout(pending);pending=setTimeout(locate,80);},{passive:true,signal:watch.signal});
 locate();
}

// Self-test guesses per chapter, kept for this browser session only.
const selfTests=new Map();
async function quizAnswers(rawId,generation){
 const [id,query='']=rawId.split('?');const chapter=chapterLookup.get(id);
 if(!chapter){main.innerHTML=empty('Không tìm thấy chương.')+`<div class="actions section">${link('quiz','← Trắc nghiệm')}</div>`;return;}
 const questions=await cachedApi(quizAnswerCache,id,'quiz-answers?chapter='+encodeURIComponent(id));if(generation!==viewGeneration)return;
 const params=new URLSearchParams(query), requestedTier=params.get('tier'), focus=params.get('q');
 let tier=['main','extra'].includes(requestedTier)?requestedTier:'all',index=0;
 // Phones default to one question at a time; the last choice is remembered.
 let mode=preference('quiz-answer-view',matchMedia('(max-width: 680px)').matches?'single':'all');if(!['single','all'].includes(mode))mode='all';
 // ?q=<id> (from statistics) opens that question on its own.
 const focused=focus?questions.findIndex(q=>q.id===focus):-1;if(focused>=0){mode='single';tier='all';index=focused;}
 let hideKeys=preference('quiz-answer-hide','0')==='1';const revealed=new Set();
 if(!selfTests.has(id))selfTests.set(id,new Map());
 const guesses=selfTests.get(id), picking=new Map();
 main.innerHTML=`<nav class="study-crumbs" aria-label="Điều hướng">${link('quiz/'+id,'← Luyện trắc nghiệm','link')}${link('chapter/'+id,'Tổng quan chương','link')}</nav>`+title('Đáp án trắc nghiệm',chapter.title,'compact-heading')+`
 <section class="card answer-toolbar"><div class="toolbar-row"><div class="segmented" role="group" aria-label="Cách xem đáp án"><button type="button" data-quiz-view="single">Từng câu</button><button type="button" data-quiz-view="all">Cả chương</button></div>
 <label class="toggle"><input type="checkbox" id="hide-keys" ${hideKeys?'checked':''}> Che đáp án để tự kiểm tra</label></div>
 ${questions.some(q=>q.tier==='extra')?`<div class="filters">${field('Nhóm câu hỏi',select('quiz-answer-tier',opt('all','Cả hai nhóm',tier)+opt('main','Câu hỏi chính',tier)+opt('extra','Câu hỏi bổ sung',tier)))}</div>`:''}
 <div class="self-tally" id="self-tally" role="status" hidden></div>${contentLegend()}</section>
 <div id="quiz-answer-list" class="section"></div>`;
 const list=main.querySelector('#quiz-answer-list'), tally=main.querySelector('#self-tally');
 function card(q,i,total){
  const guess=guesses.get(q.id), keys=answerIds(q.correct).length;
  const shown=!hideKeys||revealed.has(q.id)||!!guess, guessing=hideKeys&&!shown;
  const chosen=guess?guess.picked:(picking.get(q.id)||[]);
  const options=lettered(q).map(o=>{
   const picked=chosen.includes(o.id);
   const state=shown?(o.correct?'is-key':picked?'is-wrong':'is-dim'):picked?'is-chosen':'';
   const status=shown?(o.correct?'✓ Đáp án đúng'+(guess&&picked?' · Bạn chọn':''):(guess&&picked?'✕ Bạn chọn · Sai':'')):(picked?'● Đã chọn':'');
   const inner=`<span class="option-letter" aria-hidden="true">${o.letter}</span><span class="option-text"><span class="sr-only">${o.letter}. </span>${esc(o.text)}${status?`<span class="option-status">${status}</span>`:''}</span>`;
   return guessing?`<li class="guess-item"><button type="button" class="option ${state}" data-guess-option="${esc(o.id)}" data-question="${esc(q.id)}" aria-pressed="${picked}">${inner}</button></li>`:`<li class="option ${state}">${inner}</li>`;
  }).join('');
  return `<article class="answer-item quiz-answer-card ${shown?'is-revealed':''}" id="qa-${esc(q.id)}"><div class="qa-main"><div class="question-top"><span class="badge">Câu ${i+1}/${total}</span>${keys>1?`<span class="badge multi-badge">${keys} đáp án đúng</span>`:''}${questions.some(x=>x.tier==='extra')?`<small>${tierLabel(q.tier)}</small>`:''}</div>
  <h2 class="question-title">${esc(q.prompt)}</h2>${guessing&&keys>1?`<p class="multi-hint">Chọn ${keys} phương án; chọn đủ thì tự kiểm tra.</p>`:''}
  <ol class="options study-options" aria-label="Các phương án">${options}</ol>
  ${shown?'':`<div class="reveal-box">${guessing?'<p>Chạm một phương án để tự kiểm tra, hoặc</p>':''}<button type="button" class="primary" data-reveal="${esc(q.id)}">Xem đáp án câu này</button></div>${q.sources.length?`<div class="actions source-links">${sourceLinks(q.sources)}</div>`:''}`}</div>
  ${shown?`<div class="qa-aside">${guess?verdict(q,guess.picked,true):''}${whyBlock(q)}</div>`:''}</article>`;
 }
 function drawTally(){
  const results=[...guesses.entries()], right=results.filter(([,g])=>g.correct).length, wrong=results.filter(([,g])=>!g.correct).map(([qid])=>qid);
  tally.hidden=!results.length&&!hideKeys;
  tally.innerHTML=results.length?`<span><strong>Tự kiểm tra:</strong> đúng ${right}/${results.length} câu đã đoán.</span><span class="actions">${wrong.length?`<button type="button" class="primary" id="practice-guesses">Luyện lại ${wrong.length} câu đoán sai</button>`:''}<button type="button" class="link" id="clear-guesses">Xóa kết quả</button></span>`:'<span>Chạm một phương án để đoán trước khi xem đáp án; kết quả được đếm ở đây.</span>';
 }
 function draw(){
  const rows=questions.filter(q=>tier==='all'||q.tier===tier);index=Math.min(index,Math.max(0,rows.length-1));
  list.dataset.mode=mode;
  document.body.classList.toggle('focus-study',mode==='single'&&rows.length>0);
  main.querySelectorAll('[data-quiz-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.quizView===mode)));
  drawTally();
  if(!rows.length){list.innerHTML=empty('Chưa có câu trắc nghiệm trong nhóm này.');return;}
  if(mode==='single'){
   const current=rows[index], hidden=hideKeys&&!revealed.has(current.id)&&!guesses.has(current.id);
   list.innerHTML=card(current,index,rows.length)+`<nav class="answer-navigation study-nav" aria-label="Chuyển câu trắc nghiệm"><button type="button" data-answer-step="-1" data-key-prev ${index===0?'disabled':''}><span class="nav-long">← Câu trước</span><span class="nav-short">← Trước</span></button>${hidden?`<button type="button" class="reveal-nav" data-reveal="${esc(current.id)}">Xem đáp án</button>`:`<label class="jump"><span class="sr-only">Chọn câu</span><select data-answer-jump>${rows.map((_,i)=>`<option value="${i}" ${i===index?'selected':''}>Câu ${i+1}/${rows.length}</option>`).join('')}</select></label>`}<button type="button" class="primary" data-answer-step="1" data-key-next ${index===rows.length-1?'disabled':''}><span class="nav-long">Câu tiếp →</span><span class="nav-short">Tiếp →</span></button></nav><p class="kbd-hint">Phím tắt: <kbd>1</kbd>–<kbd>4</kbd> hoặc <kbd>A</kbd>–<kbd>D</kbd> đoán (khi che đáp án) · <kbd>Enter</kbd> xem đáp án / câu tiếp · <kbd>←</kbd> <kbd>→</kbd> chuyển câu</p>`;
  } else list.innerHTML=['main','extra'].map(t=>{const group=rows.filter(q=>q.tier===t);return group.length?'<section class="answer-group"><h2>'+tierLabel(t)+' · '+group.length+' câu</h2>'+group.map(q=>card(q,rows.indexOf(q),rows.length)).join('')+'</section>':'';}).join('');
 }
 function go(next){index=next;draw();list.querySelector('.quiz-answer-card')?.scrollIntoView({block:'start'});}
 // Redraw in place (keeps the scroll position on the whole-chapter view), then
 // bring the verdict / explanation of the touched question into view.
 function redrawAround(qid){const at=window.scrollY;draw();if(mode==='all')window.scrollTo(0,at);const card=list.querySelector('#qa-'+CSS.escape(qid));(card?.querySelector('.verdict')||card?.querySelector('.cblock-explain'))?.scrollIntoView({block:matchMedia('(min-width: 1100px)').matches?'nearest':'start'});}
 // Delegated listeners: the list is redrawn but the container stays.
 list.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.answerStep)go(index+Number(button.dataset.answerStep));
  else if(button.dataset.reveal){revealed.add(button.dataset.reveal);redrawAround(button.dataset.reveal);}
  else if(button.dataset.guessOption){
   const qid=button.dataset.question, q=questions.find(x=>x.id===qid), keys=answerIds(q.correct).length, oid=button.dataset.guessOption;
   let picked=picking.get(qid)||[];picked=picked.includes(oid)?picked.filter(x=>x!==oid):[...picked,oid];
   if(picked.length>=keys){guesses.set(qid,{picked,correct:answerMatches(picked,q.correct)});picking.delete(qid);}else picking.set(qid,picked);
   redrawAround(qid);
  }
 });
 list.addEventListener('change',event=>{if(event.target.matches('[data-answer-jump]'))go(Number(event.target.value));});
 tally.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.id==='clear-guesses'){guesses.clear();picking.clear();draw();return;}
  if(button.id==='practice-guesses'){
   const wrong=[...guesses.entries()].filter(([,g])=>!g.correct).map(([qid])=>qid);
   button.disabled=true;
   try{const result=await api('attempt',{chapter:id,tier:'all',mode:'practice',count:wrong.length,questionIds:wrong});rememberAttempt(result);location.hash='attempt/'+result.id;}
   catch(error){toast(error.message);button.disabled=false;}
  }
 });
 on('[data-quiz-view]','click',(_,b)=>{mode=b.dataset.quizView;savePreference('quiz-answer-view',mode);draw();});
 on('#hide-keys','change',(_,el)=>{hideKeys=el.checked;revealed.clear();picking.clear();savePreference('quiz-answer-hide',hideKeys?'1':'0');draw();});
 on('[name=quiz-answer-tier]','change',(_,el)=>{tier=el.value;index=0;draw();});
 draw();
}
