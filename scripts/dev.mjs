// Local preview of dist/server/index.js. Not deployed.
// D1 is simulated with node:sqlite, R2 with an in-memory map, and the
// ChatGPT identity with fixed test headers. Data stays in .dev/ only.
//   npm run dev                      learner account
//   DEV_ADMIN=1 npm run dev          owner (admin) account
//   DEV_DB_LATENCY_MS=120 npm run dev  add latency to every D1 round trip
//   node scripts/dev.mjs --port=8788 --latency=120 --admin --db=.dev/x.sqlite
//   --host=0.0.0.0 opens it to the local network (phone testing). Anyone on
//   that network then acts as the test account; the default is this machine only.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const arg = name => {
  const inline = process.argv.find(value => value.startsWith('--' + name + '='));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const port = Number(arg('port') || process.env.PORT || 8787);
const latency = Number(arg('latency') || process.env.DEV_DB_LATENCY_MS || 0);
const file = arg('db') || process.env.DEV_DB || '.dev/local.sqlite';
const ownerEmail = 'owner@example.test';
const identity = process.env.DEV_ADMIN === '1' || process.argv.includes('--admin')
  ? {id:'dev-owner', email:ownerEmail, name:'Chủ trang (thử)'}
  : {id:process.env.DEV_USER || 'dev-student', email:'student@example.test', name:'Sinh viên (thử)'};

mkdirSync('.dev', {recursive:true});
const fresh = !existsSync(file);
const sqlite = new DatabaseSync(file);
if (fresh) {
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  for (const entry of journal.entries) sqlite.exec(readFileSync('drizzle/' + entry.tag + '.sql', 'utf8'));
}
const sleep = ms => ms ? new Promise(resolve => setTimeout(resolve, ms)) : null;
let trips = 0;
const db = {
  prepare(query) {
    return {bind(...params) {
      const statement = sqlite.prepare(query);
      const run = () => /^\s*(SELECT|PRAGMA)/i.test(query) ? {results:statement.all(...params)} : {meta:statement.run(...params)};
      return {
        run: async () => { trips++; await sleep(latency); return run(); },
        all: async () => { trips++; await sleep(latency); return {results:statement.all(...params)}; },
        first: async () => { trips++; await sleep(latency); return statement.get(...params); },
        local: run
      };
    }};
  },
  async batch(statements) {
    trips++; await sleep(latency);
    sqlite.exec('BEGIN');
    try { const results = statements.map(s => s.local()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
};
const files = new Map();
const bucket = {
  put: async (key, value) => { files.set(key, value instanceof ArrayBuffer ? new Uint8Array(value) : value); },
  get: async key => files.has(key) ? {body:files.get(key)} : null,
  delete: async key => { files.delete(key); }
};
// Reload the worker after `npm run build` without restarting the server.
const bundle = new URL('../dist/server/index.js', import.meta.url);
let worker, loadedAt = 0;
async function currentWorker() {
  const changed = statSync(bundle).mtimeMs;
  if (changed !== loadedAt) { worker = (await import(bundle.href + '?v=' + changed)).default; loadedAt = changed; }
  return worker;
}
await currentWorker();
const env = {DB:db, BUCKET:bucket, QUIZ_OWNER_EMAIL:ownerEmail};
const ctx = {waitUntil: promise => promise.catch(error => console.error(error))};
// Import the course once (as the hosted site does on first visit), then
// register the source documents with a placeholder body: the real files
// live in R2 on the hosted site, but chapter links can still be followed.
await worker.fetch(new Request('http://localhost/api/state', {headers:{'oai-authenticated-user-id':'dev-setup'}}), env, ctx);
const course = JSON.parse(readFileSync('content/course.json', 'utf8'));
for (const doc of course.documents) {
  sqlite.prepare('INSERT OR IGNORE INTO documents VALUES (?,?,?,?,?,?)').run(doc.id, doc.chapter, doc.title, doc.filename, doc.mime, doc.storage_key);
  if (!files.has(doc.storage_key)) files.set(doc.storage_key, 'Bản local không có tệp gốc: ' + doc.filename);
}

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost:' + port));
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value !== undefined && !key.startsWith('oai-')) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  if (process.env.DEV_SIGNED_OUT !== '1') {
    headers.set('oai-authenticated-user-id', identity.id);
    headers.set('oai-authenticated-user-email', identity.email);
    headers.set('oai-authenticated-user-full-name', encodeURIComponent(identity.name));
    headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
  }
  const started = performance.now(), before = trips;
  try {
    const response = await (await currentWorker()).fetch(new Request(url, {method:req.method, headers, body:chunks.length ? Buffer.concat(chunks) : undefined}), env, ctx);
    const out = Object.fromEntries(response.headers);
    // Headers leave before a streamed body finishes, so the D1 count covers
    // the work done before the first byte (the whole request for JSON APIs).
    out['server-timing'] = 'worker;dur=' + (performance.now() - started).toFixed(1) + ', d1;desc="round trips ' + (trips - before) + '"';
    out['x-dev-d1-round-trips'] = String(trips - before);
    res.writeHead(response.status, out);
    let size = 0;
    if (response.body) for await (const chunk of response.body) { size += chunk.length; res.write(chunk); }
    res.end();
    if (url.pathname === '/' || url.pathname.startsWith('/api/')) console.log(req.method, url.pathname + url.search, response.status, size + ' B', (trips - before) + ' D1', (performance.now() - started).toFixed(0) + ' ms');
  } catch (error) {
    console.error(error);
    res.writeHead(500); res.end('Dev server error');
  }
}).listen(port, arg('host') || '127.0.0.1', () => console.log('Ôn Tập Việt Quiz (local): http://' + (arg('host') || 'localhost') + ':' + port + ' as ' + identity.email + (latency ? ', D1 latency ' + latency + ' ms' : '')));
