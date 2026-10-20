// Núcleo do Supertonic 3 (port do exemplo web oficial, com arrays tipados).
// Fluxo: texto -> duração -> codificação -> N passos de remoção de ruído -> vocoder (44,1 kHz).

import { splitIntoChunks } from '../../split.js';

export const LANG = 'pt';

const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
const REPLACEMENTS = {
  '–': '-', '‑': '-', '—': '-', _: ' ', '“': '"', '”': '"', '‘': "'", '’': "'",
  '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ',
};

export function preprocessText(text, lang = LANG) {
  let t = text.normalize('NFKD').replace(EMOJI, '');
  for (const [k, v] of Object.entries(REPLACEMENTS)) t = t.replaceAll(k, v);
  t = t.replace(/[♥☆♡©\\]/g, '');
  t = t.replace(/ ([,.!?;:'])/g, '$1');
  while (t.includes('""')) t = t.replace('""', '"');
  while (t.includes("''")) t = t.replace("''", "'");
  t = t.replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(t)) t += '.';
  return `<${lang}>${t}</${lang}>`;
}

export function encodeText(text, indexer, lang = LANG) {
  const s = preprocessText(text, lang);
  const ids = new BigInt64Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i);
    ids[i] = BigInt(cp < indexer.length ? indexer[cp] : -1);
  }
  return ids;
}

function gaussian() {
  const u1 = Math.max(1e-4, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function parseStyle(ort, json) {
  const mk = (s) => new ort.Tensor('float32', Float32Array.from(s.data.flat(Infinity)), s.dims);
  return { ttl: mk(json.style_ttl), dp: mk(json.style_dp) };
}

export async function createSupertonic({ ort, sessions, cfgs, indexer }) {
  const sampleRate = cfgs.ae.sample_rate;
  const chunkSize = cfgs.ae.base_chunk_size * cfgs.ttl.chunk_compress_factor;
  const latentDim = cfgs.ttl.latent_dim * cfgs.ttl.chunk_compress_factor;

  async function inferChunk(text, style, steps, speed, signal) {
    const ids = encodeText(text, indexer);
    const n = ids.length;
    const textIds = new ort.Tensor('int64', ids, [1, n]);
    const textMask = new ort.Tensor('float32', new Float32Array(n).fill(1), [1, 1, n]);

    const dp = await sessions.dp.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask });
    const duration = dp.duration.data[0] / Math.max(0.25, speed);
    const enc = await sessions.textEnc.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask });

    const wavLen = Math.floor(duration * sampleRate);
    const latentLen = Math.max(1, Math.floor((wavLen + chunkSize - 1) / chunkSize));
    const xt = new Float32Array(latentDim * latentLen);
    for (let d = 0; d < latentDim; d++) for (let t = 0; t < latentLen; t++) xt[d * latentLen + t] = gaussian();
    const latentMask = new Float32Array(latentLen);
    latentMask.fill(1);
    const latentMaskT = new ort.Tensor('float32', latentMask, [1, 1, latentLen]);
    const totalStep = new ort.Tensor('float32', Float32Array.from([steps]), [1]);

    let current = xt;
    for (let step = 0; step < steps; step++) {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      const out = await sessions.vectorEst.run({
        noisy_latent: new ort.Tensor('float32', current, [1, latentDim, latentLen]),
        text_emb: enc.text_emb,
        style_ttl: style.ttl,
        latent_mask: latentMaskT,
        text_mask: textMask,
        current_step: new ort.Tensor('float32', Float32Array.from([step]), [1]),
        total_step: totalStep,
      });
      current = new Float32Array(out.denoised_latent.data);
    }
    const voc = await sessions.vocoder.run({ latent: new ort.Tensor('float32', current, [1, latentDim, latentLen]) });
    const wav = new Float32Array(voc.wav_tts.data);
    return wav.subarray(0, Math.min(wav.length, wavLen));
  }

  return {
    sampleRate,
    /** O player já entrega trechos curtos; trechos longos são divididos aqui por segurança (limite do modelo: ~300). */
    async synth(text, { style, steps = 8, speed = 1, signal } = {}) {
      const parts = text.length > 300 ? splitIntoChunks(text, { maxLen: 300 }).map((c) => c.text) : [text];
      const wavs = [];
      for (const p of parts) wavs.push(await inferChunk(p, style, steps, speed, signal));
      if (wavs.length === 1) return { pcm: wavs[0], sampleRate };
      const gap = Math.floor(0.2 * sampleRate);
      const total = wavs.reduce((a, w) => a + w.length, 0) + gap * (wavs.length - 1);
      const pcm = new Float32Array(total);
      let off = 0;
      wavs.forEach((w, i) => { pcm.set(w, off); off += w.length + (i < wavs.length - 1 ? gap : 0); });
      return { pcm, sampleRate };
    },
    async dispose() {
      await Promise.all(Object.values(sessions).map((s) => s.release?.()));
    },
  };
}

export async function loadSupertonicSessions(ort, bytes) {
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const sessions = {};
  // Um por vez: reduz o pico de memória em celulares.
  sessions.dp = await ort.InferenceSession.create(bytes.dp, opts);
  sessions.textEnc = await ort.InferenceSession.create(bytes.textEnc, opts);
  sessions.vectorEst = await ort.InferenceSession.create(bytes.vectorEst, opts);
  sessions.vocoder = await ort.InferenceSession.create(bytes.vocoder, opts);
  return sessions;
}
