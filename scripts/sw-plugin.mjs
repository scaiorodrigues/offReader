// Gera dist/sw.js (service worker) com a lista de arquivos do build. O SW só existe no build, nunca no `npm run dev`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function swPlugin() {
  return {
    name: 'leitor-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const precache = ['./', ...files];
      const version = crypto.createHash('sha1').update(files.map((f) => f + (bundle[f].code?.length ?? bundle[f].source?.length ?? 0)).join('|')).digest('hex').slice(0, 10);
      const tpl = fs.readFileSync(path.resolve('scripts/sw-template.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: tpl.replace('__PRECACHE__', JSON.stringify(precache)).replace('__VERSION__', version),
      });
    },
  };
}
