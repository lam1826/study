// Idempotent source import. Dataset lives outside schema migrations.
let contentReady;
const explanationsRevision='explanations-2026-11-16-v1', essayGuidesRevision='study-guides-2026-11-17-v1';
export async function ensureCourseContent(env) {
  if (contentReady) return contentReady;
  // A new isolate checks every revision in one D1 round trip; each import
  // still re-checks its own marker, so concurrent isolates stay idempotent.
  contentReady = (async () => {
    const revisions = [courseContent.revision, explanationsRevision, essayGuidesRevision];
    const done = new Set((await env.DB.prepare('SELECT revision FROM content_imports WHERE revision IN (?,?,?)').bind(...revisions).all()).results.map(row => row.revision));
    if (!done.has(revisions[0])) await importCourse(env);
    if (!done.has(revisions[1])) await updateExplanations(env);
    if (!done.has(revisions[2])) await updateEssayGuides(env);
  })().catch(error => {contentReady = null; throw error;});
  return contentReady;
}
async function importCourse(env) {
  const sql = (q,...args) => env.DB.prepare(q).bind(...args);
  if (await sql('SELECT revision FROM content_imports WHERE revision=?',courseContent.revision).first()) return;
  const subjects = [['history','Lịch sử Đảng Cộng sản Việt Nam'],['lan','Công nghệ mạng LAN'],['distributed','Phát triển ứng dụng phân tán']];
  await env.DB.batch(subjects.map(([id,title])=>sql('INSERT OR IGNORE INTO subjects (id,title) VALUES (?,?)',id,title)));
  await env.DB.batch(courseContent.chapters.map(c=>sql('INSERT INTO chapters (id,subject,title) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title',c.id,c.subject,c.title)));
  const statements = courseContent.questions.map(q=>sql('INSERT INTO questions (id,chapter,kind,tier,prompt,normalized,explanation,options,correct,sources) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chapter,kind,normalized) DO NOTHING',q.id,q.chapter,q.kind,q.tier,q.prompt,q.normalized,q.explanation,JSON.stringify(q.options),Array.isArray(q.correct)?JSON.stringify(q.correct):q.correct,JSON.stringify(q.sources)));
  for(let start=0;start<statements.length;start+=50) await env.DB.batch(statements.slice(start,start+50));
  await sql('INSERT OR IGNORE INTO content_imports VALUES (?,?)',courseContent.revision,Date.now()).run();
}
export async function importSourceDocument(request,env) {
  // No visitor impersonation: a dedicated service secret only authorizes these
  // exact source files, checked against their SHA-256 fingerprints.
  const header = request.headers.get('Authorization') || '';
  const expected = env.CONTENT_IMPORT_TOKEN ? 'Bearer '+env.CONTENT_IMPORT_TOKEN : '';
  if (!expected || Date.now()>=Number(env.CONTENT_IMPORT_EXPIRES_AT || 0) || header.length!==expected.length) return Response.json({error:'Không được phép.'},{status:403});
  let mismatch=0;
  for(let i=0;i<expected.length;i++) mismatch |= header.charCodeAt(i)^expected.charCodeAt(i);
  if(mismatch) return Response.json({error:'Không được phép.'},{status:403});
  const id = new URL(request.url).searchParams.get('id');
  const doc = courseContent.documents.find(d=>d.id===id);
  if(!doc || request.method!=='PUT') return Response.json({error:'Tài liệu không hợp lệ.'},{status:400});
  const length = Number(request.headers.get('Content-Length'));
  if(length!==doc.size) return Response.json({error:'Kích thước tệp không đúng.'},{status:400});
  const bytes = await request.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==doc.sha256) return Response.json({error:'Nội dung tệp không khớp nguồn.'},{status:400});
  await ensureCourseContent(env);
  const present = await env.DB.prepare('SELECT id FROM documents WHERE id=?').bind(doc.id).first();
  if(present) return Response.json({ok:true,id:doc.id,alreadyImported:true});
  await env.BUCKET.put(doc.storage_key,bytes,{httpMetadata:{contentType:doc.mime}});
  await env.DB.prepare('INSERT OR IGNORE INTO documents VALUES (?,?,?,?,?,?)').bind(doc.id,doc.chapter,doc.title,doc.filename,doc.mime,doc.storage_key).run();
  return Response.json({ok:true,id:doc.id,sha256:hash});
}

async function updateExplanations(env) {
  const revision=explanationsRevision;
  const sql=(q,...args)=>env.DB.prepare(q).bind(...args);
  if(await sql('SELECT revision FROM content_imports WHERE revision=?',revision).first()) return;
  const statements=courseContent.questions.filter(q=>q.kind==='quiz' && courseExplanations[q.id]).map(q=>sql('UPDATE questions SET explanation=? WHERE id=? AND normalized=?',courseExplanations[q.id],q.id,q.normalized));
  for(let i=0;i<statements.length;i+=50) await env.DB.batch(statements.slice(i,i+50));
  await env.DB.batch(Object.entries(chapterOverviews).map(([id,overview])=>sql("UPDATE chapters SET overview=? WHERE id=? AND overview=''",overview,id)));
 await env.DB.batch([['history','Các giai đoạn lịch sử, chủ trương và vai trò lãnh đạo của Đảng.','▤'],['lan','Mạng chuyển mạch, VLAN, cấu hình và vận hành mạng LAN.','⌘'],['distributed','Mô hình giao tiếp, API và vận hành ứng dụng phân tán.','◇']].map(([id,description,icon])=>sql("UPDATE subjects SET description=?,icon=? WHERE id=? AND description=''",description,icon,id)));
 await sql('INSERT OR IGNORE INTO content_imports VALUES (?,?)',revision,Date.now()).run();
}

async function updateEssayGuides(env) {
 const revision=essayGuidesRevision;
 const sql=(q,...args)=>env.DB.prepare(q).bind(...args);
 if(await sql('SELECT revision FROM content_imports WHERE revision=?',revision).first())return;
 await sql("UPDATE essays SET status=CASE WHEN learned=1 THEN 'mastered' WHEN length(trim(draft))>0 THEN 'answered' ELSE status END WHERE status='unseen'").run();
 const statements=courseContent.questions.filter(q=>q.kind==='essay'&&essayGuides[q.id]).map(q=>{const g=essayGuides[q.id];return sql('UPDATE questions SET explanation=?,code=?,key_points=? WHERE id=? AND normalized=?',g.explanation,g.code,JSON.stringify(g.key_points),q.id,q.normalized);});
 for(let i=0;i<statements.length;i+=40)await env.DB.batch(statements.slice(i,i+40));
 await env.DB.batch(Object.entries(chapterOverviews).map(([id,overview])=>sql("UPDATE chapters SET overview=? WHERE id=? AND overview=''",overview,id)));
 await env.DB.batch([['history','Các giai đoạn lịch sử, chủ trương và vai trò lãnh đạo của Đảng.','▤'],['lan','Mạng chuyển mạch, VLAN, cấu hình và vận hành mạng LAN.','⌘'],['distributed','Mô hình giao tiếp, API và vận hành ứng dụng phân tán.','◇']].map(([id,description,icon])=>sql("UPDATE subjects SET description=?,icon=? WHERE id=? AND description=''",description,icon,id)));
 await sql('INSERT OR IGNORE INTO content_imports VALUES (?,?)',revision,Date.now()).run();
}
