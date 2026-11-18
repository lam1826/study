// Pure helpers shared by the quiz, answer and essay views. No DOM access:
// tests/ui-helpers.mjs loads this file in a Node vm to check them.
const optionLetters = 'ABCDEF';
function answerIds(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
function answerMatches(value, correct) {
  const a = answerIds(value), b = answerIds(correct);
  return a.length > 0 && a.length === b.length && a.every(id => b.includes(id));
}
// Letters follow the order the options are shown in. The key is matched by
// option ID, so a shuffled attempt keeps each key with its own text.
function lettered(question) {
  const keys = answerIds(question.correct);
  return question.options.map((option, index) => ({id:option.id, text:option.text, letter:optionLetters[index], correct:keys.includes(option.id)}));
}
function keyLetters(question) {
  return lettered(question).filter(option => option.correct).map(option => option.letter);
}
function chosenLetters(question, value) {
  const chosen = answerIds(value);
  return lettered(question).filter(option => chosen.includes(option.id)).map(option => option.letter);
}
function joinLetters(letters) {
  return letters.length > 1 ? letters.slice(0, -1).join(', ') + ' và ' + letters.at(-1) : letters[0] || '';
}
function plainKey(value) {
  return String(value || '').normalize('NFC').toLocaleLowerCase('vi').replace(/[\s.,;:()"“”]+/g, ' ').trim();
}
// Splits a quiz explanation into the reasoning and its source. A line
// "Đáp án đúng: …" is left out only when it restates every stored key text;
// otherwise it stays visible so a mismatch is never hidden.
function explanationParts(text, keyTexts = []) {
  const why = [], source = [];
  let inSource = false, keyLineSeen = false;
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    const sourceLine = line.match(/^\s*(?:Nguồn đối chiếu|Nguồn)\s*:\s*(.*)$/);
    if (sourceLine) { inSource = true; if (sourceLine[1].trim()) source.push(sourceLine[1].trim()); continue; }
    if (inSource) { if (line.trim()) source.push(line.trim()); continue; }
    const keyLine = line.match(/^\s*Đáp án đúng\s*:\s*(.*)$/);
    if (keyLine && !keyLineSeen) {
      keyLineSeen = true;
      const stated = plainKey(keyLine[1]);
      if (keyTexts.length && keyTexts.every(textValue => stated.includes(plainKey(textValue)))) continue;
    }
    why.push(line.replace(/^\s*Vì sao đúng\s*:\s*/, ''));
  }
  return {why:why.join('\n').trim(), source:source.join(' ')};
}
// Groups a Markdown model answer by its "###" headings so the reading view can
// lead with the answer and keep sources quiet. Unknown headings stay "other".
function answerSections(text) {
  const kindOf = title => /^Trả lời/i.test(title) ? 'main' : /^Giải thích/i.test(title) ? 'explain' : /^Ví dụ/i.test(title) ? 'example' : /^Nguồn/i.test(title) ? 'source' : 'other';
  const sections = [];
  let current = {title:'', kind:'main', lines:[]}, fence = false;
  const close = () => { if (current.title || current.lines.join('').trim()) sections.push(current); };
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    const heading = !fence && line.match(/^#{1,4}\s+(.+?)\s*$/);
    const inlineSource = !fence && line.match(/^\s*\*\*Nguồn(?: đối chiếu)?:?\*\*:?\s*(.*)$/);
    if (heading) {
      close();
      const title = heading[1].replace(/\*\*/g, '');
      current = {title, kind:kindOf(title), lines:[]};
    } else if (inlineSource) {
      close();
      current = {title:'Nguồn đối chiếu', kind:'source', lines:[inlineSource[1]]};
    } else current.lines.push(line);
  }
  close();
  return sections.map(section => ({title:section.title, kind:section.kind, body:section.lines.join('\n').trim()}));
}
