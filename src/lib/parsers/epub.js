import { unzipSync, strFromU8 } from 'fflate';
import { attr, decodeEntities, htmlToText } from './xml.js';

const resolve = (base, href) => {
  const parts = (base ? `${base}/${href}` : href).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return decodeURIComponent(out.join('/').split('#')[0]);
};

export function parseEpub(bytes) {
  const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const read = (name) => (files[name] ? strFromU8(files[name]) : null);
  const container = read('META-INF/container.xml');
  const opfPath = container && attr(/<rootfile\b[^>]*>/i.exec(container)?.[0] ?? '', 'full-path');
  if (!opfPath || !read(opfPath)) throw new Error('Arquivo EPUB inválido (sem pacote OPF).');
  const opf = read(opfPath);
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  const manifest = new Map();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attr(m[0], 'id'); const href = attr(m[0], 'href');
    if (id && href) manifest.set(id, { href, type: attr(m[0], 'media-type') ?? '' });
  }
  const order = [...opf.matchAll(/<itemref\b[^>]*>/gi)].map((m) => attr(m[0], 'idref')).filter(Boolean);
  const chapters = [];
  for (const idref of order) {
    const item = manifest.get(idref);
    if (!item || !/html|xml/i.test(item.type)) continue;
    const content = read(resolve(dir, item.href));
    if (content) {
      const text = htmlToText(content);
      if (text) chapters.push(text);
    }
  }
  const title = /<dc:title[^>]*>([^<]+)<\/dc:title>/i.exec(opf)?.[1];
  return { text: chapters.join('\n\n'), title: title ? decodeEntities(title.trim()) : undefined };
}
