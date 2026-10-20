// PDF via pdf.js. O módulo é injetado (`pdfjs`) para funcionar no navegador (worker próprio) e nos testes (Node).

/**
 * Junta os itens de texto de uma página em linhas (mesma posição vertical) e decide onde há quebra de parágrafo:
 * um salto vertical bem maior que o espaçamento mediano entre linhas da página.
 */
export function pageItemsToText(items) {
  const lines = [];
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform?.[5] ?? 0;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) <= 1) last.text += it.str;
    else lines.push({ y, text: it.str });
  }
  const gaps = lines.slice(1).map((l, i) => Math.abs(lines[i].y - l.y)).filter((g) => g > 0).sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  let out = '';
  lines.forEach((l, i) => {
    if (i > 0) out += median && Math.abs(lines[i - 1].y - l.y) > median * 1.5 ? '\n\n' : '\n';
    out += l.text;
  });
  return out;
}

export async function parsePdf(bytes, { pdfjs, onProgress } = {}) {
  const doc = await pdfjs.getDocument({ data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = pageItemsToText(content.items).trim();
    if (text) pages.push(text);
    onProgress?.(i, doc.numPages);
  }
  let title;
  try { title = (await doc.getMetadata()).info?.Title || undefined; } catch { /* sem metadados */ }
  await doc.destroy();
  if (!pages.length) throw new Error('Nenhum texto encontrado. O PDF pode ser digitalizado (imagem), o que o app não reconhece.');
  return { text: pages.join('\n\n'), title };
}
