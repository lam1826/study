// Builds the "added questions" set from content/added/: index.json lists
// chapters to create, and each other file (named after its chapter ID) holds
// that chapter's added quiz questions:
//   {"tier": "main" | "extra", "prompt": "...", "options": ["...", ...],
//    "correct": 1 | [0, 2], "explanation": "...\n\nNguồn đối chiếu: ...",
//    "sources": ["<document id of the same chapter>"], "from": "where it came from"}
// tier "main" = a question from the owner's quiz file; "extra" = an advanced
// question written from the textbook. IDs come from the chapter and prompt,
// and the revision from the content itself, so adding a file or a question is
// enough for the site to import the new questions once (an existing question
// with the same prompt in its chapter is never overwritten).
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = seed => {
  const h = hash(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${(8 + parseInt(h[16], 16) % 4).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
// Same normalisation as the worker uses for its UNIQUE(chapter, kind, normalized).
export const normalize = value => String(value).normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ');

export async function loadAddedQuestions(dir = 'content/added') {
  const index = JSON.parse(await readFile(dir + '/index.json', 'utf8'));
  const files = (await readdir(dir)).filter(name => name.endsWith('.json') && name !== 'index.json').sort();
  const raw = [JSON.stringify(index)], questions = [];
  for (const file of files) {
    const text = await readFile(dir + '/' + file, 'utf8');
    raw.push(file, text);
    const chapter = file.replace(/\.json$/, '');
    for (const q of JSON.parse(text)) {
      const prompt = String(q.prompt).trim();
      const id = uuid('added:' + chapter + ':' + normalize(prompt));
      const options = q.options.map(option => ({id:uuid(id + ':' + String(option).trim()), text:String(option).trim()}));
      const keys = (Array.isArray(q.correct) ? q.correct : [q.correct]).map(i => options[i]?.id);
      questions.push({id, chapter, kind:'quiz', tier:q.tier, prompt, normalized:normalize(prompt), explanation:String(q.explanation).trim(),
        options, correct:keys.length > 1 ? keys : keys[0], sources:q.sources || [], from:q.from || ''});
    }
  }
  return {revision:'added-' + hash(raw.join('\n')).slice(0, 16), chapters:index.chapters || [], questions};
}
