const essayStatuses=['unseen','learning','viewed','answered','mastered','review'];
const longText=(value,max=500000)=>{needed(typeof value==='string' && value.length<=max,'Nội dung vượt giới hạn '+max+' ký tự; chưa lưu, không cắt bớt.');return value.trim();};
async function unresolvedQuestions(db,owner,chapter) {
  const rows=await list(db.prepare('SELECT items,answers FROM attempts WHERE owner=? AND finished IS NOT NULL'+(chapter?' AND chapter=?':'')+' ORDER BY created ASC,rowid ASC').bind(...(chapter?[owner,chapter]:[owner])));
  const wrong=new Set();
  for(const row of rows){const answers=parse(row.answers);for(const q of parse(row.items)){if(matchesAnswer(answers[q.id],q.correct))wrong.delete(q.id);else if(selectedIds(answers[q.id]).length)wrong.add(q.id);}}
  return [...wrong];
}
async function studyApi(request,env,path,owner,isAdmin) {
  const method=request.method, [group,id,action]=path.split('/');
  const sql=(q,...args)=>env.DB.prepare(q).bind(...args);
  if(group==='quiz-answers'&&method==='GET'){
    const chapter=new URL(request.url).searchParams.get('chapter');
    needed(await sql('SELECT id FROM chapters WHERE id=?',chapter).first(),'Không tìm thấy chương.',404);
    const rows=await list(sql("SELECT id,chapter,tier,prompt,options,correct,explanation,sources FROM questions WHERE chapter=? AND kind='quiz' ORDER BY CASE tier WHEN 'main' THEN 0 ELSE 1 END,rowid",chapter));
    return json(rows.map(q=>({...q,options:parse(q.options),correct:decodedCorrect(q.correct),sources:parse(q.sources)})));
  }
  if(group==='essay-answers'&&method==='GET'){
    const chapter=new URL(request.url).searchParams.get('chapter');
    needed(await sql('SELECT id FROM chapters WHERE id=?',chapter).first(),'Không tìm thấy chương.',404);
    return json((await list(sql("SELECT id,code,tier,prompt,explanation,key_points,sources FROM questions WHERE chapter=? AND kind='essay' ORDER BY CASE tier WHEN 'main' THEN 0 ELSE 1 END,rowid",chapter))).map(q=>({...q,key_points:parse(q.key_points),sources:parse(q.sources)})));
  }
  if(group==='essay'&&id){
    const q=await sql("SELECT * FROM questions WHERE id=? AND kind='essay'",id).first();needed(q,'Không tìm thấy câu tự luận.',404);
    const old=await sql('SELECT * FROM essays WHERE owner=? AND question=?',owner,id).first();
    if(method==='GET')return json({...q,key_points:parse(q.key_points),sources:parse(q.sources),draft:old?.draft||'',learned:old?.learned||0,status:old?.learned?'mastered':old?.status||'unseen',viewed_at:old?.viewed_at,answered_at:old?.answered_at,assessment:parse(old?.assessment||'[]')});
    if(method==='POST'){
      const data=await request.json(), now=Date.now();
      const status=data.status??(data.learned!==undefined?(data.learned?'mastered':'learning'):old?.status||'unseen');needed(essayStatuses.includes(status),'Trạng thái không hợp lệ.');
      const draft=data.draft===undefined?old?.draft||'':longText(data.draft);
      const assessment=data.assessment===undefined?parse(old?.assessment||'[]'):data.assessment;
      const points=parse(q.key_points);needed(Array.isArray(assessment)&&assessment.length<=points.length&&assessment.every(v=>typeof v==='boolean'),'Bảng tự đánh giá không hợp lệ.');
      const viewed=data.viewed?old?.viewed_at||now:old?.viewed_at||null;
      const answered=draft.trim()?old?.answered_at||now:old?.answered_at||null;
      await sql('INSERT INTO essays (owner,question,draft,learned,status,viewed_at,answered_at,assessment,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,question) DO UPDATE SET draft=excluded.draft,learned=excluded.learned,status=excluded.status,viewed_at=excluded.viewed_at,answered_at=excluded.answered_at,assessment=excluded.assessment,updated_at=excluded.updated_at',owner,id,draft,status==='mastered'?1:0,status,viewed,answered,JSON.stringify(assessment),now).run();
      return json({ok:true,updated_at:now,status,viewed_at:viewed,answered_at:answered});
    }
  }
  if(group==='mistakes'&&method==='GET')return json({ids:await unresolvedQuestions(env.DB,owner,new URL(request.url).searchParams.get('chapter'))});
  if(['subjects','chapters','documents'].includes(group)&&['PATCH','DELETE'].includes(method)){
    needed(isAdmin,'Chỉ chủ website có quyền quản lý nội dung.',403);
    if(group==='chapters'&&id==='order'&&method==='PATCH'){
      const {subject,ids}=await request.json();const actual=await list(sql('SELECT id FROM chapters WHERE subject=?',subject));
      needed(Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.length===actual.length&&actual.every(c=>ids.includes(c.id)),'Thứ tự phải chứa đủ chương của cùng môn.');
      await env.DB.batch(ids.map((id,i)=>sql('UPDATE chapters SET position=? WHERE id=? AND subject=?',i,id,subject)));return json({ok:true});
    }
    if(group==='documents'&&method==='DELETE')return null;
    const existing=await sql('SELECT * FROM '+group+' WHERE id=?',id).first();needed(existing,'Không tìm thấy mục.',404);
    if(method==='PATCH'){
      const d=await request.json(),title=str(d.title,180);needed(title,'Hãy nhập tên.');
      if(group==='subjects')await sql('UPDATE subjects SET title=?,description=?,icon=? WHERE id=?',title,longText(d.description||'',20000),str(d.icon||'▤',8),id).run();
      if(group==='chapters')await sql('UPDATE chapters SET title=?,overview=? WHERE id=?',title,longText(d.overview||'',100000),id).run();
      if(group==='documents')await sql('UPDATE documents SET title=? WHERE id=?',title,id).run();
    }else{
      if(group==='subjects')needed(!(await sql('SELECT id FROM chapters WHERE subject=? LIMIT 1',id).first()),'Môn còn chương; hãy chuyển hoặc xóa các chương trống trước.',409);
      if(group==='chapters')for(const table of ['questions','documents','attempts'])needed(!(await sql('SELECT id FROM '+table+' WHERE chapter=? LIMIT 1',id).first()),'Chương còn câu hỏi, tài liệu hoặc lịch sử. Không xóa để tránh mất dữ liệu.',409);
      await sql('DELETE FROM '+group+' WHERE id=?',id).run();
    }return json({ok:true});
  }
  if(group==='backups'){
    needed(isAdmin,'Chỉ chủ website được sao lưu và khôi phục.',403);
    const tables=['profiles','subjects','chapters','documents','questions','attempts','essays','content_imports'];
    if(method==='GET'&&!id)return json(await list(sql('SELECT id,title,created,file_count FROM backups ORDER BY created DESC')));
    if(method==='POST'&&!id){
      const id=uid(),key='backups/'+id+'/data.json';
      const snapshot=await env.DB.batch(tables.map(t=>sql('SELECT * FROM '+t)));
      const data=Object.fromEntries(tables.map((t,i)=>[t,snapshot[i].results]));
      const files={};
      for(const doc of data.documents){const object=await env.BUCKET.get(doc.storage_key);needed(object,'Thiếu tệp nguồn: '+doc.filename,409);const copy='backups/'+id+'/'+doc.id;await env.BUCKET.put(copy,object.body);files[doc.id]=copy;}
      const manifest={version:1,created:Date.now(),data,files};await env.BUCKET.put(key,JSON.stringify(manifest));
      await sql('INSERT INTO backups VALUES (?,?,?,?,?,?)',id,manifest.created,owner,'Bản sao '+new Date(manifest.created).toISOString(),key,data.documents.length).run();return json({ok:true,id});
    }
    const backup=await sql('SELECT * FROM backups WHERE id=?',id).first();needed(backup,'Không tìm thấy bản sao.',404);
    const object=await env.BUCKET.get(backup.storage_key);needed(object,'Không tìm thấy dữ liệu sao lưu.',404);
    if(method==='GET')return new Response(object.body,{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="viet-quiz-backup-'+id+'.json"','Cache-Control':'no-store'}});
    if(method==='POST'&&action==='restore'){
      const manifest=await new Response(object.body).json();needed(manifest.version===1,'Bản sao không tương thích.');
      // Keep a recovery point before restoring; imported records merge by ID.
      const checkpoint=await studyApi(new Request(new URL('/api/backups',request.url),{method:'POST',headers:request.headers}),env,'backups',owner,isAdmin);needed(checkpoint.ok,'Không tạo được bản sao trước khôi phục.',409);
      for(const doc of manifest.data.documents){const file=await env.BUCKET.get(manifest.files[doc.id]);needed(file,'Thiếu tệp trong bản sao.',409);doc.storage_key='restored/'+uid();await env.BUCKET.put(doc.storage_key,file.body);}
      const statements=[];
      for(const table of tables){const info=await list(sql('PRAGMA table_info('+table+')'));const columns=info.map(c=>c.name);const keys=info.filter(c=>c.pk).map(c=>c.name);
        for(const row of manifest.data[table]){const cols=columns.filter(c=>Object.hasOwn(row,c));statements.push(sql('INSERT INTO '+table+' ('+cols.join(',')+') VALUES ('+cols.map(()=>'?').join(',')+') ON CONFLICT('+keys.join(',')+') DO UPDATE SET '+cols.filter(c=>!keys.includes(c)).map(c=>c+'=excluded.'+c).join(','),...cols.map(c=>row[c])));}}
      await env.DB.batch(statements);return json({ok:true});
    }
  }
  return null;
}
