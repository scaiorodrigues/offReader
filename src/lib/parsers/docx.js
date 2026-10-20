import { unzipSync, strFromU8 } from 'fflate';
import { decodeEntities } from './xml.js';

/** Extrai parágrafos de word/document.xml (texto, tabulações e quebras de linha). */
export function docxXmlToText(xml) {
  const paragraphs = [];
  for (const p of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    let text = '';
    for (const tok of p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/>/g)) {
      if (tok[1] !== undefined) text += tok[1];
      else text += tok[0].startsWith('<w:tab') ? ' ' : '\n';
    }
    paragraphs.push(decodeEntities(text).trim());
  }
  return paragraphs.filter(Boolean).join('\n\n');
}

export function parseDocx(bytes) {
  const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {
    filter: (f) => f.name === 'word/document.xml' || f.name === 'docProps/core.xml',
  });
  if (!files['word/document.xml']) throw new Error('Arquivo DOCX inválido (sem word/document.xml).');
  const title = /<dc:title>([^<]+)<\/dc:title>/.exec(files['docProps/core.xml'] ? strFromU8(files['docProps/core.xml']) : '')?.[1];
  return { text: docxXmlToText(strFromU8(files['word/document.xml'])), title: title ? decodeEntities(title) : undefined };
}
