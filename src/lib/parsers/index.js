import { cleanText } from '../normalize.js';
import { parseTxt, parseMd } from './text.js';
import { parseDocx } from './docx.js';
import { parseEpub } from './epub.js';
import { parsePdf } from './pdf.js';

export const SUPPORTED = ['.txt', '.md', '.markdown', '.pdf', '.docx', '.epub'];

const extOf = (name) => (/\.[^.]+$/.exec(name.toLowerCase()) ?? [''])[0];
const baseName = (name) => name.replace(/\.[^.]+$/, '');

/**
 * @param {{name: string, bytes: Uint8Array}} input
 * @param {{pdfjs?: any, onProgress?: Function}} deps  `pdfjs` é carregado sob demanda pelo chamador.
 * @returns {Promise<{title: string, text: string}>}
 */
export async function extractDocument({ name, bytes }, deps = {}) {
  const ext = extOf(name);
  let parsed;
  if (ext === '.txt') parsed = parseTxt(bytes);
  else if (ext === '.md' || ext === '.markdown') parsed = parseMd(bytes);
  else if (ext === '.docx') parsed = parseDocx(bytes);
  else if (ext === '.epub') parsed = parseEpub(bytes);
  else if (ext === '.pdf') parsed = await parsePdf(bytes, deps);
  else throw new Error(`Formato não suportado: ${ext || name}. Use ${SUPPORTED.join(', ')}.`);
  const text = cleanText(parsed.text);
  if (!text) throw new Error('O arquivo não tem texto legível.');
  return { title: (parsed.title || baseName(name)).trim(), text };
}
