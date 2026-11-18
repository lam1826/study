// Added questions (content/added/): two kinds, "main" (from a chapter's quiz
// file) and "extra" (advanced, written from the textbook).
// 1. Validates the real content so a new file fails here, not on the site.
// 2. Checks the loader (stable IDs, content-based revision).
// 3. Runs the real worker import against fixtures (tests/fixtures/added).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { loadAddedQuestions, normalize } from '../scripts/added-questions.mjs';

const helpers = {};
vm.createContext(helpers);
vm.runInContext(readFileSync('web/answer-key.js', 'utf8'), helpers);
const {explanationParts, noteParts} = helpers;
const course = JSON.parse(readFileSync('content/course.json', 'utf8'));

// 1. Real content.
const added = await loadAddedQuestions();
const subjects = new Set(course.chapters.map(c => c.subject));
const chapters = new Map(course.chapters.map(c => [c.id, c]));
for (const c of added.chapters) {
  assert.ok(c.id && c.title && subjects.has(c.subject), 'index.json: chapter needs id, title and a known subject: ' + JSON.stringify(c));
  assert.ok(!chapters.has(c.id) || chapters.get(c.id).subject === c.subject, 'index.json: ' + c.id + ' already exists under another subject');
  assert.ok(!course.chapters.some(x => x.subject === c.subject && x.title === c.title && x.id !== c.id), 'index.json: ' + c.id + ' repeats the title of another chapter');
  chapters.set(c.id, c);
}
const docChapter = new Map(course.documents.map(d => [d.id, d.chapter]));
const seen = new Map(course.questions.filter(q => q.kind === 'quiz').map(q => [q.chapter + '|' + q.normalized, 'content/course.json']));
const perChapter = {};
for (const q of added.questions) {
  const where = q.chapter + ': ' + q.prompt.slice(0, 60);
  assert.ok(chapters.has(q.chapter), 'unknown chapter (file name must be a chapter id or be listed in index.json): ' + q.chapter);
  assert.ok(['main', 'extra'].includes(q.tier), 'tier must be "main" or "extra": ' + where);
  assert.ok(q.prompt.length >= 10, 'prompt too short: ' + where);
  assert.ok(q.options.length >= 2 && q.options.length <= 6 && q.options.every(o => o.text), '2–6 non-empty options: ' + where);
  assert.equal(new Set(q.options.map(o => normalize(o.text))).size, q.options.length, 'options must differ: ' + where);
  const keys = Array.isArray(q.correct) ? q.correct : [q.correct];
  assert.ok(keys.length >= 1 && keys.every(Boolean) && new Set(keys).size === keys.length, '"correct" must point at existing options (index or [indices]): ' + where);
  const parts = explanationParts(q.explanation, q.options.filter(o => keys.includes(o.id)).map(o => o.text));
  assert.ok(parts.why.length >= 40, 'explanation needs the reasoning: ' + where);
  assert.ok(parts.source.length >= 3, 'explanation needs a last line "Nguồn đối chiếu: …": ' + where);
  for (const paragraph of parts.why.split(/\n\s*\n/)) assert.equal(noteParts(paragraph).map(p => p.text).join(' ').replace(/\s/g, ''), paragraph.replace(/\s/g, ''), where);
  for (const id of q.sources) if (docChapter.has(id)) assert.equal(docChapter.get(id), q.chapter, 'source document belongs to another chapter: ' + where);
  const key = q.chapter + '|' + q.normalized;
  assert.ok(!seen.has(key), 'same prompt already in ' + seen.get(key) + ' (the site would skip it): ' + where);
  seen.set(key, 'content/added');
  perChapter[q.chapter + ' ' + q.tier] = (perChapter[q.chapter + ' ' + q.tier] || 0) + 1;
}
console.log('PASS: content/added has ' + added.questions.length + ' valid questions ' + JSON.stringify(perChapter) + ' (tier, options, key, explanation + source, no repeated prompt).');

// 2. Loader: IDs depend on chapter + prompt; the revision on the content.
const fixtures = 'tests/fixtures/added';
const a = await loadAddedQuestions(fixtures), b = await loadAddedQuestions(fixtures);
assert.deepEqual(a, b);
assert.ok(a.questions.every(q => /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(q.id)));
assert.equal(new Set(a.questions.map(q => q.id)).size, a.questions.length);
const multi = a.questions.find(q => q.chapter === 'history-3');
assert.deepEqual(multi.correct, [multi.options[0].id, multi.options[2].id]);
assert.equal(typeof a.questions.find(q => q.tier === 'extra').correct, 'string');
const changed = mkdtempSync(join(tmpdir(), 'added-'));
cpSync(fixtures, changed, {recursive:true});
writeFileSync(join(changed, 'lan-2.json'), JSON.stringify([{tier:'extra', prompt:'Một câu mới?', options:['A', 'B'], correct:0, explanation:'x'.repeat(50) + '\n\nNguồn đối chiếu: y.'}]));
const c = await loadAddedQuestions(changed);
assert.notEqual(c.revision, a.revision, 'adding a file changes the revision');
assert.equal(c.questions.find(q => q.chapter === 'lan-1' && q.tier === 'extra').id, a.questions.find(q => q.chapter === 'lan-1' && q.tier === 'extra').id, 'existing IDs stay the same');
console.log('PASS: added-question IDs are stable and the revision follows the content.');

// 3. Worker import with the fixtures: the built worker with its added set replaced.
const bundle = readFileSync('dist/server/index.js', 'utf8');
const marker = /^const addedQuestions = .*;$/m;
assert.ok(marker.test(bundle), 'dist/server/index.js carries the added questions');
const fixtureSet = {...a, questions:a.questions.map(({from, ...q}) => q)};
const dir = mkdtempSync(join(tmpdir(), 'worker-'));
const file = join(dir, 'index.mjs');
writeFileSync(file, bundle.replace(marker, 'const addedQuestions = ' + JSON.stringify(fixtureSet) + ';'));
const sqlite = new DatabaseSync(':memory:');
for (const migration of ['0000_quiz', '0001_content_imports', '0002_study_workspace']) sqlite.exec(readFileSync('drizzle/' + migration + '.sql', 'utf8'));
let trips = 0;
const db = {prepare(query) { return {bind(...params) {
  const s = sqlite.prepare(query);
  const exec = () => /^\s*(SELECT|PRAGMA)/i.test(query) ? {results:s.all(...params)} : {meta:s.run(...params)};
  return {all:async () => { trips++; return {results:s.all(...params)}; }, first:async () => { trips++; return s.get(...params); }, run:async () => { trips++; return exec(); }, exec};
}}; }, async batch(statements) {
  trips++; sqlite.exec('BEGIN');
  try { const result = statements.map(s => s.exec()); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
}};
const env = {DB:db, BUCKET:{get:async () => null, put:async () => {}, delete:async () => {}}, QUIZ_OWNER_EMAIL:'owner@example.test'};
const state = async worker => {
  const res = await worker.fetch(new Request('https://example.test/api/state?compact=1', {headers:{'oai-authenticated-user-id':'u', 'oai-authenticated-user-email':'owner@example.test'}}), env);
  assert.equal(res.status, 200);
  return res.json();
};
const worker = (await import(pathToFileURL(file).href)).default;
const first = await state(worker);
assert.equal(first.questions.length, course.questions.length + 2, 'one new extra question in lan-1 and one main question in the new chapter');
assert.ok(first.chapters.some(ch => ch.id === 'history-3' && ch.title === 'Bài 3. Chương thử nghiệm'));
assert.ok(!first.chapters.some(ch => ch.id === 'history-x'), 'a chapter repeating another title is not created');
assert.equal(first.questions.filter(q => q.chapter === 'lan-1' && normalize(q.prompt) === normalize('Loại băng thông nào được đề cập đến trong Ethernet 10BASE-T?')).length, 1, 'an existing prompt is not duplicated');
assert.equal(first.questions.filter(q => q.tier === 'extra').length, 1);
const stored = sqlite.prepare('SELECT tier, correct, explanation, sources FROM questions WHERE chapter=?').get('history-3');
assert.equal(stored.tier, 'main');
assert.deepEqual(JSON.parse(stored.correct), multi.correct);
assert.ok(sqlite.prepare('SELECT 1 FROM content_imports WHERE revision=?').get(fixtureSet.revision), 'revision recorded');
const kept = sqlite.prepare("SELECT explanation FROM questions WHERE chapter='lan-1' AND normalized=?").get(normalize('Loại băng thông nào được đề cập đến trong Ethernet 10BASE-T?'));
assert.ok(!kept.explanation.includes('tệp thử nghiệm'), 'the existing question keeps its own explanation');
// Imported once: a fresh isolate on the same database checks revisions in one query.
const fresh = (await import(pathToFileURL(file).href + '?fresh')).default;
const before = trips;
const again = await state(fresh);
assert.equal(again.questions.length, first.questions.length);
assert.equal(trips - before, 2, 'cold isolate: one revision query + one state batch');
console.log('PASS: the worker imports added questions once (new chapter created, existing prompt and conflicting chapter skipped, 2 D1 round trips afterwards).');
