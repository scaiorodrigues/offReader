// Divide o texto limpo em trechos de leitura (frases agrupadas até `maxLen`).
// Cada trecho sabe se termina um parágrafo, para aplicar uma pausa maior.

const NO_BREAK_AFTER = /(?:\b(?:Sr|Sra|Srta|Dr|Dra|Prof|Profa|Av|pág|págs|etc|ex|Ltda|Cia|Exmo|Exma|Min|Gen|Cel|Cap)\.|\b[A-ZÁÉÍÓÚ]\.|\d\.)$/;

function splitSentences(paragraph) {
  const parts = paragraph.split(/(?<=[.!?…]["'”’)\]]*)\s+/u);
  const out = [];
  for (const part of parts) {
    if (!part) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && NO_BREAK_AFTER.test(prev)) out[out.length - 1] = `${prev} ${part}`;
    else out.push(part);
  }
  return out;
}

// Quebra um trecho maior que maxLen em vírgulas/ponto e vírgula e, em último caso, em espaços.
function breakLong(sentence, maxLen) {
  if (sentence.length <= maxLen) return [sentence];
  const out = [];
  let rest = sentence;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '));
    if (cut < maxLen * 0.4) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = maxLen - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** @returns {{text: string, endsParagraph: boolean, paragraph: number}[]} */
export function splitIntoChunks(text, { maxLen = 240 } = {}) {
  const chunks = [];
  const paragraphs = String(text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  paragraphs.forEach((paragraph, pIndex) => {
    const pieces = splitSentences(paragraph).flatMap((s) => breakLong(s, maxLen));
    let current = '';
    const flush = () => {
      if (current) chunks.push({ text: current, endsParagraph: false, paragraph: pIndex });
      current = '';
    };
    for (const piece of pieces) {
      if (current && current.length + 1 + piece.length > maxLen) flush();
      current = current ? `${current} ${piece}` : piece;
    }
    flush();
    if (chunks.length) chunks[chunks.length - 1].endsParagraph = true;
  });
  return chunks;
}
