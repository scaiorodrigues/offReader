import * as ort from 'onnxruntime-web/wasm';
import { serve, withTransfer } from '../lib/engines/rpc.js';
import { fetchAll } from '../lib/engines/cache.js';
import { createPhonemizer, createPiperVoice } from '../lib/engines/piper/core.js';
import { voiceById, voiceFiles } from '../lib/engines/voices.js';

let base = null;
let phonemizer = null;
let current = null; // { id, voice, gain }

function initRuntime(b) {
  if (base) return;
  base = b;
  ort.env.wasm.wasmPaths = `${base}vendor/ort/`;
  ort.env.wasm.numThreads = 1; // GitHub Pages/Netlify sem COOP/COEP: sem SharedArrayBuffer
  ort.env.wasm.proxy = false;
}

serve(self, {
  async load({ voiceId, base: b }, progress) {
    initRuntime(b);
    if (current?.id === voiceId) return { sampleRate: current.voice.sampleRate, timings: { ready: true } };
    const meta = voiceById(voiceId);
    if (!meta) throw new Error(`Voz desconhecida: ${voiceId}`);
    const timings = {};
    const lap = (name, t0) => { timings[name] = Math.round(performance.now() - t0); };
    let t = performance.now();
    const [modelBytes, configBytes] = await fetchAll(voiceFiles(meta), { onProgress: (p) => progress({ phase: 'baixando', ...p }) });
    lap('arquivos', t);
    progress({ phase: 'preparando', fraction: 1 });
    if (!phonemizer) {
      t = performance.now();
      const mod = await import(/* @vite-ignore */ `${base}vendor/piper/piper_phonemize.mjs`);
      phonemizer = await createPhonemizer(mod.default, { locateFile: (name) => `${base}vendor/piper/${name}` });
      lap('fonemizador', t);
    }
    await current?.voice.dispose();
    current = null;
    t = performance.now();
    const voice = await createPiperVoice({ ort, modelBytes, config: JSON.parse(new TextDecoder().decode(configBytes)), phonemizer });
    lap('sessao', t);
    current = { id: voiceId, voice, gain: meta.gain ?? 1 };
    return { sampleRate: voice.sampleRate, timings };
  },
  async download({ voiceId }, progress) {
    const meta = voiceById(voiceId);
    await fetchAll(voiceFiles(meta), { onProgress: (p) => progress({ phase: 'baixando', ...p }) });
  },
  async synth({ voiceId, text, speed }) {
    if (current?.id !== voiceId) throw new Error('Voz não carregada');
    const { pcm, sampleRate } = await current.voice.synth(text, { speed });
    if (current.gain !== 1) for (let i = 0; i < pcm.length; i++) pcm[i] *= current.gain;
    return withTransfer({ pcm, sampleRate }, [pcm.buffer]);
  },
  async unload({ voiceId }) {
    if (current?.id === voiceId) { await current.voice.dispose(); current = null; }
  },
});
