import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadAddedQuestions } from './added-questions.mjs';
await mkdir('dist/server', {recursive:true});
await mkdir('dist/.openai', {recursive:true});
const [html, css, worker] = await Promise.all(['web/index.html','web/style.css','worker/index.mjs'].map(path => readFile(path,'utf8')));
// Shared pure helpers first, then the app and the study views (one classic script).
const js=(await Promise.all(['web/answer-key.js','web/app.js','web/study.js'].map(path=>readFile(path,'utf8')))).join('\n');
const studyWorker=await readFile('worker/study.mjs','utf8');
const digest = content => createHash('sha256').update(content).digest('hex').slice(0, 12);
const cssPath = '/style.' + digest(css) + '.css';
const jsPath = '/app.' + digest(js) + '.js';
// The page links content-hashed CSS/JS (cached as immutable) and the worker
// streams everything before BOOT_STATE at once, so the browser fetches or
// reuses them while the learner's data is still being read from D1.
const page = html.replace('<link rel="stylesheet" href="/style.css">', '<link rel="stylesheet" href="'+cssPath+'">')
  .replace('<script src="/app.js" defer></script>', '<script src="'+jsPath+'" defer></script>')
  .replace('</body>', '<!--BOOT_STATE--></body>');
if (!page.includes(cssPath) || !page.includes(jsPath) || page.split('<!--BOOT_STATE-->').length !== 2) throw new Error('web/index.html must link /style.css and /app.js once.');
const assets = {'/':page, [cssPath]:css, [jsPath]:js, '/style.css':css, '/app.js':js};
const content = JSON.parse(await readFile('content/course.json','utf8'));
const chapterOverviews=JSON.parse(await readFile('content/chapter-overviews.json','utf8'));
const essayGuides=JSON.parse(await readFile('content/essay-guides.json','utf8'));
const explanations = JSON.parse(await readFile('content/explanations.json','utf8'));
// Questions added after the first import (missing main questions and advanced
// "extra" questions), imported once under their own revision.
const added = await loadAddedQuestions();
const addedQuestions = {...added, questions:added.questions.map(({from, ...question}) => question)};
const importer = (await readFile('worker/content.mjs','utf8')).replaceAll('export async function','async function');
await writeFile('dist/server/index.js', 'const assets = ' + JSON.stringify(assets) + ';\nconst courseContent = '+JSON.stringify(content)+';\nconst courseExplanations = '+JSON.stringify(explanations)+';\nconst essayGuides = '+JSON.stringify(essayGuides)+';\nconst chapterOverviews = '+JSON.stringify(chapterOverviews)+';\nconst addedQuestions = '+JSON.stringify(addedQuestions)+';\n'+importer+'\n'+studyWorker+'\n'+worker);
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
