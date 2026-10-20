// Utilidades de XML/HTML sem DOM (funcionam no navegador, no worker e no Node/testes).

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', acirc: 'â', ecirc: 'ê', ocirc: 'ô',
  atilde: 'ã', otilde: 'õ', ccedil: 'ç', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return ''; }
    }
    return NAMED[e] ?? m;
  });
}

const BLOCK = /<\/?(?:p|div|br|li|ul|ol|tr|h[1-6]|section|article|blockquote|pre|table|header|footer|figure|figcaption)\b[^>]*>/gi;

/** HTML/XHTML -> texto com parágrafos separados por linha em branco. */
export function htmlToText(html) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const t = body
    .replace(/<(script|style|head|svg|nav)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(BLOCK, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ');
  return decodeEntities(t).replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const attr = (tag, name) => new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find(Boolean) ?? null;
