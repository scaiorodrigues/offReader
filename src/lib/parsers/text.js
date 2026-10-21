import { decodeEntities } from './xml.js';

export function decodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(u8); }
}

/** Remove a sintaxe do Markdown mantendo o conteúdo legível em voz alta. */
export function markdownToText(md) {
  return md
    .replace(/^```[\s\S]*?^```/gm, ' ')
    .replace(/^~~~[\s\S]*?^~~~/gm, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/gm, '$1.\n')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/^\|?[\s:|-]{3,}\|?$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/&[a-z]+;/gi, (m) => decodeEntities(m));
}

export function parseTxt(bytes) { return { text: decodeBytes(bytes) }; }
export function parseMd(bytes) { return { text: markdownToText(decodeBytes(bytes)) }; }
