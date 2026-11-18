"""Rebuild the curated question dataset from the owner's supplied Word files.

Usage: python3 scripts/extract-content.py <source-directory>
Requires python-docx. Red answer markings are authoritative; never infer keys.
"""
from pathlib import Path
from docx import Document
import sys, re, json, hashlib, uuid, unicodedata, collections

root = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / 'content'
out.mkdir(exist_ok=True)
norm = lambda s: ' '.join(unicodedata.normalize('NFC', s).lower().split())
stable = lambda s: str(uuid.uuid5(uuid.NAMESPACE_URL, 'ontap-source-v1:' + s))
documents, questions = [], []
doc_ids = {}
answer_file = 'Dap_an_tu_luan_Phat_trien_ung_dung_phan_tan_9_chuong.docx'
chapter_titles = {
 'history-1': 'Bài 1. Nhập môn và sự ra đời của Đảng Cộng sản Việt Nam',
 'history-2': 'Bài 2. Đấu tranh giành chính quyền (1930–1945)',
}
lan_titles = ['Công nghệ mạng chuyển mạch','Tìm hiểu cấu hình Switch','Mạng LAN ảo (VLAN)','Cấu hình MAC tĩnh, cổng bảo mật','Giao thức VLAN Trunking – VTP','Kỹ thuật gộp đường – EtherChannel','Giao thức và kỹ thuật định tuyến giữa các VLAN','Triển khai định tuyến giữa các VLAN','Spanning Tree Protocol']
distributed_titles = ['Tổng quan hệ thống và các mô hình trao đổi thông điệp (MEP)','RESTful API','Truyền thông thời gian thực với SignalR','GraphQL','RPC và gRPC','Xử lý bất đồng bộ với hàng đợi','Pub/Sub và kiến trúc hướng sự kiện','Vận hành hệ thống phân tán','Kiến trúc tổng thể hệ thống phân tán']
for subject, titles in [('lan', lan_titles), ('distributed', distributed_titles)]:
 for i, title in enumerate(titles, 1): chapter_titles[f'{subject}-{i}'] = f'Chương {i}. {title}'

def add_document(file, chapter):
 data = file.read_bytes()
 mime = {'.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'}[file.suffix]
 id = stable('document:' + chapter + ':' + file.name)
 doc_ids[(chapter, file.name)] = id
 documents.append(dict(id=id, chapter=chapter, title=file.stem, filename=file.name, mime=mime, storage_key='course-v1/'+id, sha256=hashlib.sha256(data).hexdigest(), size=len(data)))
 return id

for file in sorted(root.iterdir()):
 name = file.name
 if file.suffix not in ['.pdf','.docx','.pptx']: continue
 if name == answer_file:
  for i in range(1,10): add_document(file, f'distributed-{i}')
  continue
 if name.startswith('chapter'):
  chapter = ('lan' if '(1)' in name else 'distributed') + '-' + str(int(re.search(r'\d+',name)[0]))
 elif name.startswith(('Lịch-sử','Bài ', 'pp bài')): chapter = 'history-' + re.search(r'\d+',name)[0]
 elif name.startswith(('Công-nghệ','CCNA')): chapter = 'lan-1'
 elif name.startswith('Phân-tán'): chapter = 'distributed-2'
 elif name.startswith(('Phát-triển','Bai1')): chapter = 'distributed-1'
 elif name.startswith('Chương'): chapter = 'distributed-' + str(int(re.search(r'\d+',name)[0]))
 else: raise ValueError('Unmapped source: '+name)
 add_document(file, chapter)

def make_question(chapter, kind, prompt, explanation, sources, options=None, keys=None):
 id = stable(chapter + ':' + kind + ':' + norm(prompt))
 opts = [dict(id=stable(id+':'+norm(text)),text=text) for text in options or []]
 correct = [opts[i]['id'] for i in keys or []]
 assert not opts or (2<=len(opts)<=6 and len(set(norm(o['text']) for o in opts))==len(opts) and correct)
 questions.append(dict(id=id, chapter=chapter, kind=kind, tier='main', prompt=prompt, normalized=norm(prompt), explanation=explanation, options=opts, correct=correct[0] if len(correct)==1 else correct if correct else None, sources=sources))

quiz_files = [('Lịch-sử-đảng-bài-1.docx','history-1',30),('Lịch-sử-đảng-bài-2.docx','history-2',28),('Công-nghệ-mạng-Lan-bài-1.docx','lan-1',30),('Phát-triển-phân-tán-bài-1.docx','distributed-1',15),('Phân-tán-bài-2.docx','distributed-2',15)]
for name, chapter, count in quiz_files:
 ps = [p for p in Document(root/name).paragraphs if p.text.strip() and p.text.strip()!='Các lựa chọn:' and not re.fullmatch(r'Câu\s+\d+\s*[:.]?',p.text.strip())]
 groups = []
 if name=='Lịch-sử-đảng-bài-1.docx':
  for p in ps:
   if not re.match(r'^[ABCD](?:\s*:|\s+)',p.text.strip()): groups.append([p])
   else: groups[-1].append(p)
 else:
  assert len(ps)==count*5, (name,len(ps))
  groups = [ps[i:i+5] for i in range(0,len(ps),5)]
 assert len(groups)==count
 for number, group in enumerate(groups,1):
  prompt = re.sub(r'^Câu\s+\d+\s*:?\s*','',group[0].text.strip())
  options, keys = [], []
  for j, p in enumerate(group[1:]):
   text = p.text.strip()
   if name=='Lịch-sử-đảng-bài-1.docx': text = re.sub(r'^[ABCD](?:\s*:\s*|\s+)', '', text)
   options.append(text)
   if any(str(r.font.color.rgb) in ['EE0000','C00000','FF0000'] for r in p.runs if r.text.strip()): keys.append(j)
  assert keys, (name,number,'Missing marked key')
  assert len(keys)==(2 if 'chọn 2' in prompt.lower() else 1), (name,number,keys)
  explanation = 'Đáp án theo phần được đánh dấu màu đỏ trong tài liệu bạn cung cấp:\n'+'\n'.join('• '+options[k] for k in keys)
  explanation += f'\n\nNguồn: {name}, câu {number}.'
  make_question(chapter,'quiz',prompt,explanation,[doc_ids[(chapter,name)]],options,keys)

ps = [p.text.strip() for p in Document(root/answer_file).paragraphs if p.text.strip()]
chapter, count = None, 0
for i, text in enumerate(ps):
 match = re.match(r'^Chương (\d)(?:\n|$)',text)
 if match: chapter = 'distributed-'+match[1]
 match = re.match(r'^((?:S[12]|[BH][2-9]|LT[2-9])-\d{2})\s+(.+)', text)
 if not match: continue
 assert ps[i+1].startswith('Trả lời:'), text
 answer = ps[i+1].removeprefix('Trả lời:').strip()
 assert answer
 sources = [d['id'] for d in documents if d['chapter']==chapter and (d['filename']==answer_file or d['filename'].startswith('Chương') and d['filename'].endswith('.docx'))]
 sources += [doc_ids[(chapter,f'chapter0{chapter[-1]}.pdf')]]
 make_question(chapter,'essay',match[2],answer+'\n\nMã câu: '+match[1]+'. Nguồn: '+answer_file+'.',sources)
 count += 1
assert count==228, count
assert len(questions)==346
assert len({q['id'] for q in questions})==len(questions), 'Duplicate questions'
assert all(s in {d['id'] for d in documents if d['chapter']==q['chapter']} for q in questions for s in q['sources'])
dataset = dict(revision='provided-materials-2026-11-15-v1',chapters=[dict(id=id,subject=id.rsplit('-',1)[0],title=title) for id,title in chapter_titles.items()],documents=documents,questions=questions)
(out/'course.json').write_text(json.dumps(dataset,ensure_ascii=False,indent=2))
print(json.dumps({'questions':len(questions),'quiz':118,'essay':228,'multi_answer':sum(isinstance(q['correct'],list) for q in questions),'documents':len(documents),'by_chapter':dict(collections.Counter(q['chapter'] for q in questions))},ensure_ascii=False))
