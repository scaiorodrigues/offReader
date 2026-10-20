// E2E sem rede: abre TXT, MD, DOCX, EPUB e PDF pelo seletor de arquivos e confere o texto exibido.
// Não usa modelos de voz. Uso: npm run build && node tests/e2e/files-ui.mjs
import { zipSync, strToU8 } from 'fflate';
import { startPreview, launch } from './helpers.mjs';

const enc = strToU8;
function tinyPdf(lines) {
  const stream = `BT /F1 14 Tf 72 720 Td 18 TL ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const files = {
  'exemplo.txt': { buf: Buffer.from('Primeira linha do arquivo de texto.\n\nSegundo parágrafo.'), expect: ['Primeira linha', 'Segundo parágrafo'] },
  'exemplo.md': { buf: Buffer.from('# Título do documento\n\nTexto com **negrito** e [link](http://x.y).'), expect: ['Título do documento.', 'Texto com negrito e link.'], not: ['**', 'http'] },
  'exemplo.docx': { buf: Buffer.from(zipSync({ 'word/document.xml': enc('<w:document><w:body><w:p><w:r><w:t>Parágrafo do Word.</w:t></w:r></w:p><w:p><w:r><w:t>Outro parágrafo.</w:t></w:r></w:p></w:body></w:document>') })), expect: ['Parágrafo do Word.', 'Outro parágrafo.'] },
  'exemplo.epub': { buf: Buffer.from(zipSync({
    'META-INF/container.xml': enc('<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>'),
    'c.opf': enc('<package><metadata><dc:title>Livro EPUB</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>'),
    'a.xhtml': enc('<html><body><h1>Capítulo Um</h1><p>Texto do capítulo no EPUB.</p></body></html>'),
  })), expect: ['Capítulo Um', 'Texto do capítulo no EPUB.'], title: 'Livro EPUB' },
  'exemplo.pdf': { buf: tinyPdf(['Texto extra\\355do do PDF.', 'Segunda linha.']), expect: ['Texto extraído do PDF.'] },
};

const server = await startPreview();
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 420, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name} ${ok ? '' : extra}`); };

await page.goto(server.url);
await page.waitForFunction(() => !!window.__leitor);
for (const [name, f] of Object.entries(files)) {
  await page.setInputFiles('#file', { name, mimeType: 'application/octet-stream', buffer: f.buf });
  try {
    await page.waitForFunction((t) => !document.getElementById('reader').hidden && document.getElementById('doc-title').textContent === t, f.title ?? name.replace(/\.[^.]+$/, ''), { timeout: 15000 });
    const text = await page.$eval('#text', (e) => e.textContent);
    const okAll = f.expect.every((s) => text.includes(s)) && !(f.not ?? []).some((s) => text.includes(s));
    check(`${name}: texto exibido`, okAll, okAll ? '' : JSON.stringify(text.slice(0, 200)));
  } catch (e) { check(`${name}: abriu`, false, e.message.slice(0, 120)); }
  await page.click('#btn-close');
}
await page.setInputFiles('#file', { name: 'ruim.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
await page.waitForSelector('#toast:not([hidden])');
check('formato inválido mostra aviso', (await page.textContent('#toast')).includes('não suportado'));
check('sem erros inesperados', errors.filter((e) => !/standardFontDataUrl|405|Formato não suportado/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.stop();
console.log(failed ? `\n${failed} falha(s)` : '\ntudo certo');
process.exit(failed ? 1 : 0);
