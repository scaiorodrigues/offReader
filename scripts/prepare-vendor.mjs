// Copia para public/vendor os binários de que o app precisa em tempo de execução (mesma origem => funciona offline):
//  - onnxruntime-web 1.18.0: ort-wasm-simd.wasm (+ variantes)
//  - piper-wasm: fonemizador espeak-ng (wasm + dados) e o loader convertido para ESM.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = (...p) => path.join(root, 'public', 'vendor', ...p);

const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
fs.mkdirSync(out('ort'), { recursive: true });
for (const f of ['ort-wasm-simd.wasm', 'ort-wasm.wasm']) {
  fs.copyFileSync(path.join(ortDist, f), out('ort', f));
}

const piperBuild = path.join(root, 'node_modules', '@diffusionstudio', 'piper-wasm', 'build');
fs.mkdirSync(out('piper'), { recursive: true });
for (const f of ['piper_phonemize.wasm', 'piper_phonemize.data']) fs.copyFileSync(path.join(piperBuild, f), out('piper', f));
const src = fs.readFileSync(path.join(piperBuild, 'piper_phonemize.js'), 'utf8')
  .replace(/if \(typeof exports === 'object'[\s\S]*$/, '');
fs.writeFileSync(out('piper', 'piper_phonemize.mjs'), `${src}\nexport default createPiperPhonemize;\n`);
console.log('vendor pronto em public/vendor');
