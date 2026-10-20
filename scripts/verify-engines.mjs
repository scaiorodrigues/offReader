// Verificação com MODELOS REAIS, fora do navegador (Node + onnxruntime-web 1.18.0).
// Uso: node scripts/verify-engines.mjs [--only=piper|supertonic] [--out=DIR] [--cache=DIR]
// Baixa os modelos do Hugging Face (Piper ~63 MB; Supertonic ~400 MB) e grava WAVs + relatório.
// Mede apenas coisas objetivas (duração, pico, RMS, F0). NÃO avalia qualidade nem naturalidade.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as ort from 'onnxruntime-web';
import { VOICES, SUPERTONIC_MODEL_FILES, voiceById } from '../src/lib/engines/voices.js';
import { createPhonemizer, createPiperVoice } from '../src/lib/engines/piper/core.js';
import { createSupertonic, loadSupertonicSessions, parseStyle } from '../src/lib/engines/supertonic/core.js';
import { pcmToWav, pcmStats } from '../src/lib/wav.js';
import { prepareForSpeech } from '../src/lib/normalize.js';
import { medianF0 } from './f0.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const OUT = path.resolve(args.out ?? 'verify-out');
const CACHE = path.resolve(args.cache ?? path.join(OUT, '.cache'));
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
ort.env.wasm.numThreads = 1;

const TEXT = 'Em 2024, o Sr. Silva leu 3 livros. A leitura em voz alta ajuda a descansar os olhos, e custa apenas R$ 12,50 por mês.';
const report = [];

async function get(url) {
  const file = path.join(CACHE, url.replace(/[^a-z0-9._-]/gi, '_').slice(-120));
  if (!fs.existsSync(file)) {
    process.stdout.write(`baixando ${url.split('/').slice(-2).join('/')} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log('ok');
  }
  return new Uint8Array(fs.readFileSync(file));
}

function record(id, pcm, sampleRate, ms) {
  const stats = pcmStats(pcm);
  const f0 = medianF0(pcm, sampleRate);
  const row = { voice: id, seconds: +(pcm.length / sampleRate).toFixed(2), synthMs: Math.round(ms), ...stats, f0Hz: f0 ? Math.round(f0.median) : null };
  fs.writeFileSync(path.join(OUT, `${id.replace(':', '_')}.wav`), pcmToWav(pcm, sampleRate));
  console.log(row);
  report.push(row);
}

if (!args.only || args.only === 'piper') {
  const require = createRequire(import.meta.url);
  const dir = path.dirname(require.resolve('@diffusionstudio/piper-wasm/build/piper_phonemize.js'));
  const factory = require('@diffusionstudio/piper-wasm/build/piper_phonemize.js');
  const phonemizer = await createPhonemizer(factory, { locateFile: (n) => path.join(dir, n) });
  for (const v of VOICES.filter((x) => x.engine === 'piper')) {
    const [model, cfg] = v.files.map((f) => f.url);
    const voice = await createPiperVoice({ ort, modelBytes: await get(model), config: JSON.parse(Buffer.from(await get(cfg))), phonemizer });
    const t0 = performance.now();
    const { pcm, sampleRate } = await voice.synth(prepareForSpeech(TEXT), { speed: 1 });
    record(v.id, pcm, sampleRate, performance.now() - t0);
    // segunda chamada: confirma que o fonemizador reaproveitado funciona
    const again = await voice.synth('Segunda frase de teste.', { speed: 1.2 });
    console.log('  2ª chamada (fonemizador reutilizado):', again.pcm.length, 'amostras');
    await voice.dispose();
  }
}

if (!args.only || args.only === 'supertonic') {
  const by = (name) => SUPERTONIC_MODEL_FILES.find((f) => f.url.endsWith(name)).url;
  const bytes = {
    dp: await get(by('duration_predictor.onnx')), textEnc: await get(by('text_encoder.onnx')),
    vectorEst: await get(by('vector_estimator.onnx')), vocoder: await get(by('vocoder.onnx')),
  };
  const cfgs = JSON.parse(Buffer.from(await get(by('tts.json'))));
  const indexer = JSON.parse(Buffer.from(await get(by('unicode_indexer.json'))));
  const t0 = performance.now();
  const sessions = await loadSupertonicSessions(ort, bytes);
  console.log('sessões Supertonic criadas em', Math.round(performance.now() - t0), 'ms');
  const tts = await createSupertonic({ ort, sessions, cfgs, indexer });
  const ids = (args.styles ?? 'F1,M1').split(',');
  for (const s of ids) {
    const v = voiceById(`supertonic:${s}`);
    const style = parseStyle(ort, JSON.parse(Buffer.from(await get(v.files[0].url))));
    const t1 = performance.now();
    const { pcm, sampleRate } = await tts.synth(prepareForSpeech(TEXT), { style, steps: 8, speed: 1 });
    record(v.id, pcm, sampleRate, performance.now() - t1);
  }
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('relatório em', path.join(OUT, 'report.json'));
