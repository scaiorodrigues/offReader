import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractDocument } from '../src/lib/parsers/index.js';
import { markdownToText } from '../src/lib/parsers/text.js';

const enc = (s) => strToU8(s);

describe('TXT / MD', () => {
  it('lê UTF-8 e cai para windows-1252', async () => {
    expect((await extractDocument({ name: 'a.txt', bytes: enc('Olá, ação!') })).text).toBe('Olá, ação!');
    const latin1 = new Uint8Array([0x4f, 0x6c, 0xe1]); // "Olá" em windows-1252
    expect((await extractDocument({ name: 'b.txt', bytes: latin1 })).text).toBe('Olá');
  });
  it('remove a sintaxe do Markdown', () => {
    const md = '# Título\n\nTexto **forte** e [link](http://x.y) com `código`.\n\n- item um\n- item dois\n\n```js\nconsole.log(1)\n```\n';
    const t = markdownToText(md);
    expect(t).toContain('Título.');
    expect(t).toContain('Texto forte e link com código.');
    expect(t).toContain('item um');
    expect(t).not.toMatch(/console|```|\*\*|http/);
  });
  it('título vem do nome do arquivo', async () => {
    expect((await extractDocument({ name: 'Meu Livro.txt', bytes: enc('x') })).title).toBe('Meu Livro');
  });
});

describe('DOCX', () => {
  it('extrai parágrafos, tabulação e entidades', async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Olá</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">mundo &amp; cia</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Segundo</w:t></w:r></w:p><w:p></w:p></w:body></w:document>';
    const bytes = zipSync({ 'word/document.xml': enc(xml), 'docProps/core.xml': enc('<cp><dc:title>Meu doc</dc:title></cp>') });
    const r = await extractDocument({ name: 'x.docx', bytes });
    expect(r.text).toBe('Olá mundo & cia\n\nSegundo');
    expect(r.title).toBe('Meu doc');
  });
  it('rejeita arquivo inválido', async () => {
    await expect(extractDocument({ name: 'x.docx', bytes: zipSync({ 'a.txt': enc('x') }) })).rejects.toThrow(/DOCX/);
  });
});

describe('EPUB', () => {
  it('segue a ordem do spine e extrai o título', async () => {
    const bytes = zipSync({
      'META-INF/container.xml': enc('<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
      'OEBPS/content.opf': enc('<package><metadata><dc:title>Livro Teste</dc:title></metadata><manifest>'
        + '<item id="b" href="cap2.xhtml" media-type="application/xhtml+xml"/><item id="a" href="text/cap1.xhtml" media-type="application/xhtml+xml"/>'
        + '<item id="img" href="i.png" media-type="image/png"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'),
      'OEBPS/text/cap1.xhtml': enc('<html><head><title>x</title><style>p{}</style></head><body><h1>Capítulo 1</h1><p>Era uma vez&nbsp;um &quot;teste&quot;.</p></body></html>'),
      'OEBPS/cap2.xhtml': enc('<html><body><p>Segundo capítulo.</p></body></html>'),
    });
    const r = await extractDocument({ name: 'l.epub', bytes });
    expect(r.title).toBe('Livro Teste');
    expect(r.text).toBe('Capítulo 1\n\nEra uma vez um "teste".\n\nSegundo capítulo.');
  });
  it('rejeita EPUB sem OPF', async () => {
    await expect(extractDocument({ name: 'x.epub', bytes: zipSync({ a: enc('x') }) })).rejects.toThrow(/EPUB/);
  });
});

function tinyPdf(lines) {
  const stream = `BT /F1 14 Tf 72 720 Td 18 TL ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

describe('PDF', () => {
  it('extrai texto com acentos', async () => {
    const r = await extractDocument({ name: 'x.pdf', bytes: tinyPdf(['Ol\\341 mundo,', 'segunda linha do texto.']) }, { pdfjs });
    expect(r.text).toBe('Olá mundo, segunda linha do texto.');
  });
});

it('formato não suportado', async () => {
  await expect(extractDocument({ name: 'x.exe', bytes: enc('x') })).rejects.toThrow(/não suportado/);
});
