import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('dist/server', {recursive:true});
await mkdir('dist/.openai', {recursive:true});
const [html, css, baseJs, worker] = await Promise.all(['web/index.html','web/style.css','web/app.js','worker/index.mjs'].map(path => readFile(path,'utf8')));
const js=baseJs+'\n'+await readFile('web/study.js','utf8');
const studyWorker=await readFile('worker/study.mjs','utf8');
const digest = content => createHash('sha256').update(content).digest('hex').slice(0, 12);
const cssPath = '/style.' + digest(css) + '.css';
const jsPath = '/app.' + digest(js) + '.js';
const page = html.replace('<link rel="stylesheet" href="/style.css">', '<style>'+css+'</style>')
  .replace('<script src="/app.js" defer></script>', '')
  .replace('</body>', '<!--BOOT_STATE--><script>'+js.replaceAll('</script', '<\\/script')+'</script></body>');
const assets = {'/':page, [cssPath]:css, [jsPath]:js, '/style.css':css, '/app.js':js};
const content = JSON.parse(await readFile('content/course.json','utf8'));
const chapterOverviews=JSON.parse(await readFile('content/chapter-overviews.json','utf8'));
const essayGuides=JSON.parse(await readFile('content/essay-guides.json','utf8'));
const explanations = JSON.parse(await readFile('content/explanations.json','utf8'));
const importer = (await readFile('worker/content.mjs','utf8')).replaceAll('export async function','async function');
await writeFile('dist/server/index.js', 'const assets = ' + JSON.stringify(assets) + ';\nconst courseContent = '+JSON.stringify(content)+';\nconst courseExplanations = '+JSON.stringify(explanations)+';\nconst essayGuides = '+JSON.stringify(essayGuides)+';\nconst chapterOverviews = '+JSON.stringify(chapterOverviews)+';\n'+importer+'\n'+studyWorker+'\n'+worker);
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
