// Checks the pure display helpers in web/answer-key.js against the real course
// content: answer letters after shuffling, explanation splitting, and essay
// sections that must not lose any text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Values from the vm context have another realm's Array prototype; compare as JSON.
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);
const helpers = {};
vm.createContext(helpers);
vm.runInContext(readFileSync('web/answer-key.js', 'utf8'), helpers);
const {answerIds, answerMatches, lettered, keyLetters, chosenLetters, joinLetters, explanationParts, answerSections, noteParts} = helpers;
const course = JSON.parse(readFileSync('content/course.json', 'utf8'));
const explanations = JSON.parse(readFileSync('content/explanations.json', 'utf8'));
const guides = JSON.parse(readFileSync('content/essay-guides.json', 'utf8'));
const quiz = course.questions.filter(q => q.kind === 'quiz');
const essays = course.questions.filter(q => q.kind === 'essay');
const keyTexts = q => answerIds(q.correct).map(id => q.options.find(o => o.id === id).text).sort();
const shuffle = items => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
};

// 1. Letters follow the shown order; the key travels with its option text.
assert.equal(quiz.length, 118);
assert.equal(quiz.filter(q => Array.isArray(q.correct)).length, 7);
for (let round = 0; round < 200; round++) {
  for (const q of quiz) {
    const shown = {...q, options:shuffle(q.options)};
    const options = lettered(shown);
    same(options.map(o => o.letter), 'ABCDEF'.slice(0, q.options.length).split(''));
    same(options.filter(o => o.correct).map(o => o.text).sort(), keyTexts(q), q.id);
    const letters = keyLetters(shown);
    assert.equal(letters.length, answerIds(q.correct).length);
    for (const letter of letters) assert.ok(keyTexts(q).includes(shown.options['ABCDEF'.indexOf(letter)].text));
  }
}
const multi = quiz.find(q => Array.isArray(q.correct));
assert.ok(answerMatches([...multi.correct].reverse(), multi.correct), 'order of a multi-answer selection does not matter');
assert.ok(!answerMatches([multi.correct[0]], multi.correct), 'one of two answers is not correct');
assert.ok(!answerMatches([...multi.correct, multi.options.find(o => !multi.correct.includes(o.id)).id], multi.correct), 'an extra option is not correct');
assert.ok(!answerMatches([], multi.correct));
same(chosenLetters({options:multi.options, correct:multi.correct}, [multi.options[3].id, multi.options[0].id]), ['A', 'D']);
assert.equal(joinLetters(['A']), 'A');
assert.equal(joinLetters(['A', 'D']), 'A và D');
assert.equal(joinLetters(['A', 'B', 'D']), 'A, B và D');
console.log('PASS: answer letters and keys stay with their option text across 200 shuffles of all 118 questions (7 multi-answer).');

// 2. Explanations: reasoning and source split, nothing else dropped.
let restated = 0;
for (const q of quiz) {
  const text = explanations[q.id];
  const parts = explanationParts(text, keyTexts(q));
  assert.ok(parts.why.length > 80, q.id);
  assert.ok(parts.source.length > 5, 'every reviewed explanation keeps its source: ' + q.id);
  if (/^Đáp án đúng:/m.test(text)) { restated++; assert.ok(!parts.why.includes('Đáp án đúng:'), q.id); }
  // Every word of the original survives, except the restated key line and labels.
  const original = text.replace(/^Đáp án đúng:.*$/m, '').replace(/Vì sao đúng:|Nguồn đối chiếu:/g, '');
  const kept = (parts.why + ' ' + parts.source).replace(/\s+/g, ' ').trim();
  assert.equal(kept.replace(/\s/g, ''), original.replace(/\s/g, ''), 'explanation text preserved: ' + q.id);
}
assert.equal(restated, 30);
// A key line that disagrees with the stored key stays visible.
const odd = explanationParts('Đáp án đúng: Một nội dung khác.\n\nVì sao đúng: Lý do.\n\nNguồn đối chiếu: Bài 1.pdf, tr. 2.', ['Nội dung đúng']);
assert.ok(odd.why.startsWith('Đáp án đúng: Một nội dung khác.'));
assert.equal(odd.source, 'Bài 1.pdf, tr. 2.');
// Legacy explanations ("Nguồn:") still split.
assert.equal(explanationParts('• A\n\nNguồn: Bài-1.docx, câu 1.').source, 'Bài-1.docx, câu 1.');
console.log('PASS: 118 explanations split into reasoning + source without losing text; a mismatching key line is never hidden.');

// 3. Essay answers: answer first, every line kept, sources recognised.
for (const q of essays) {
  const text = guides[q.id].explanation;
  const sections = answerSections(text);
  same(sections.map(s => s.kind), ['main', 'explain', 'example', 'source'], q.id);
  // Bodies together equal the original minus headings and the source label.
  const bodies = sections.map(s => s.body).join('').replace(/\s/g, '');
  const original = text.replace(/^#{1,4}\s+.*$/gm, '').replace(/^\s*\*\*Nguồn(?: đối chiếu)?:?\*\*:?/m, '').replace(/\s/g, '');
  assert.equal(bodies, original, q.id);
  assert.ok(/^Trả lời/.test(sections[0].title), q.id);
  assert.ok(guides[q.id].key_points.length >= 2);
}
// Content without headings stays one "main" section; code fences are not split.
same(answerSections('Chỉ một đoạn.').map(s => s.kind), ['main']);
assert.equal(answerSections('### Trả lời\n```\n### không phải tiêu đề\n```').length, 1);
console.log('PASS: 228 essay answers keep every line and show answer → explanation → example → source.');

// 4. "Lưu ý:" notes get their own block: a display split only, no text lost.
const squash = value => String(value).replace(/\s/g, '');
const checkNotes = (paragraph, label) => {
  const parts = noteParts(paragraph);
  assert.equal(squash(parts.map(part => part.text).join(' ')), squash(paragraph), 'note split keeps every character: ' + label);
  assert.ok(parts.every(part => ['text', 'note'].includes(part.kind) && part.text), label);
  return parts.filter(part => part.kind === 'note').length;
};
// Notes: the two "Lưu ý:" sentences and seven warnings about the question bank
// itself (disputed key kept, question worded too broadly, figure without source).
const noted = ['83c7d4a2', 'f6c3af57', '8175e08c', 'aedf5225', '44c96e78', 'ff928cd4', '8e50f356', 'db8bda76', '43fef432'];
let quizNotes = 0, quizParagraphs = 0;
const withNotes = [];
for (const q of quiz) {
  const paragraphs = explanationParts(explanations[q.id], keyTexts(q)).why.split(/\n\s*\n/);
  let notes = 0;
  for (const paragraph of paragraphs) { quizParagraphs++; notes += checkNotes(paragraph, q.id); }
  if (notes) withNotes.push(q.id.slice(0, 8));
  quizNotes += notes;
  // A note never takes the whole explanation: some reasoning is always left.
  assert.ok(paragraphs.flatMap(paragraph => noteParts(paragraph)).some(part => part.kind === 'text'), 'reasoning kept: ' + q.id);
}
same(withNotes.sort(), [...noted].sort(), 'explanations with a note');
assert.equal(quizNotes, 9);
same(noteParts('Lý do. Có mâu thuẫn về ngày trong đáp án gốc: A. Giữ nguyên khóa chấm.'), [{kind:'text', text:'Lý do.'}, {kind:'note', text:'Có mâu thuẫn về ngày trong đáp án gốc: A. Giữ nguyên khóa chấm.'}]);
same(noteParts('Mâu thuẫn dân tộc là mâu thuẫn chủ yếu.'), [{kind:'text', text:'Mâu thuẫn dân tộc là mâu thuẫn chủ yếu.'}]);
let essayNotes = 0, essayParagraphs = 0;
for (const q of essays) for (const section of answerSections(guides[q.id].explanation)) for (const paragraph of section.body.split(/\n\s*\n/)) { essayParagraphs++; essayNotes += checkNotes(paragraph, q.id); }
assert.equal(essayNotes, 0);
same(noteParts('Lý do chính. Lưu ý: đây là ghi chú.'), [{kind:'text', text:'Lý do chính.'}, {kind:'note', text:'Lưu ý: đây là ghi chú.'}]);
same(noteParts('Lưu ý: chỉ có ghi chú.'), [{kind:'note', text:'Lưu ý: chỉ có ghi chú.'}]);
same(noteParts('Không lưu ý gì ở đây: chữ thường.'), [{kind:'text', text:'Không lưu ý gì ở đây: chữ thường.'}]);
console.log('PASS: "Lưu ý" notes split from ' + quizParagraphs + ' paragraphs of 118 quiz explanations (9 notes: 2 "Lưu ý:" + 7 question-bank warnings) and ' + essayParagraphs + ' paragraphs of 228 essay answers without losing text.');
