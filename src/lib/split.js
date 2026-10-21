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

/**
 * @param {string} text texto limpo (parágrafos separados por linha em branco; "\n" simples = fim de item/verso)
 * @param {{maxLen?: number, targetLen?: number}} opts
 *   maxLen: limite rígido por trecho. targetLen: tamanho "ideal" — frases só são agrupadas até aqui.
 *   Trechos curtos tocam mais cedo (a primeira fala começa assim que o 1º trecho fica pronto).
 * @returns {{text: string, endsParagraph: boolean, paragraph: number}[]}
 */
export function splitIntoChunks(text, { maxLen = 220, targetLen = 110 } = {}) {
  const target = Math.min(targetLen, maxLen);
  const chunks = [];
  const paragraphs = String(text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  paragraphs.forEach((paragraph, pIndex) => {
    let current = '';
    const flush = () => {
      if (current) chunks.push({ text: current, endsParagraph: false, paragraph: pIndex });
      current = '';
    };
    // cada linha (quebra simples) é uma fronteira: itens de lista, títulos e versos não se fundem
    for (const line of paragraph.split('\n').map((l) => l.trim()).filter(Boolean)) {
      for (const piece of splitSentences(line).flatMap((s) => breakLong(s, maxLen))) {
        if (current && current.length + 1 + piece.length > target) flush();
        current = current ? `${current} ${piece}` : piece;
      }
      flush();
    }
    if (chunks.length && chunks[chunks.length - 1].paragraph === pIndex) chunks[chunks.length - 1].endsParagraph = true;
  });
  return chunks;
}

const CLAUSE = /(?<=[,;:.!?…—–])\s+/g;

/**
 * Divide um trecho em [início, resto] numa fronteira de oração perto do meio, para o início tocar
 * enquanto o resto ainda está sendo gerado. Devolve null se não houver um corte natural (nunca corta no meio de uma oração).
 */
export function splitHead(text, { minLen = 80, minPart = 25 } = {}) {
  if (text.length < minLen) return null;
  let best = null;
  for (const m of text.matchAll(CLAUSE)) {
    const cut = m.index; // fim da pontuação
    const rest = text.length - cut - m[0].length;
    if (cut < minPart || rest < minPart) continue;
    const score = Math.abs(cut - text.length * 0.45);
    if (!best || score < best.score) best = { cut, skip: m[0].length, score };
  }
  return best ? [text.slice(0, best.cut).trim(), text.slice(best.cut + best.skip).trim()] : null;
}
