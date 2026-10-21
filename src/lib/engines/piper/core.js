// Núcleo do Piper: fonemização (espeak-ng em WASM) + inferência VITS via onnxruntime.
// Recebe `ort` e a fábrica do fonemizador por parâmetro, para rodar no worker e no Node.

/**
 * @param {Function} factory createPiperPhonemize (Emscripten)
 * @param {{locateFile: (name:string)=>string}} opts
 */
export async function createPhonemizer(factory, { locateFile }) {
  let pending = null;
  const errors = [];
  const mod = await factory({
    locateFile,
    print: (line) => {
      if (!pending) return;
      try { pending.resolve(JSON.parse(line)); } catch (e) { pending.reject(e); }
    },
    printErr: (m) => { errors.push(m); },
  });
  return {
    phonemize(text, espeakVoice) {
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        try {
          mod.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text: text.trim() }]), '--espeak_data', '/espeak-ng-data']);
        } catch (e) { reject(e); }
      }).finally(() => { pending = null; });
    },
    errors,
  };
}

const SENTENCE_END = new Set(['.', '!', '?']);

/**
 * Converte fonemas IPA em ids usando o phoneme_id_map do PRÓPRIO modelo (o CLI usa um mapa padrão
 * que não serve para todas as vozes, p.ex. Edresson). Regra do Piper: BOS, pad após cada fonema, EOS;
 * cada sentença recebe seu BOS/EOS. Fonemas ausentes no mapa são ignorados.
 */
export function phonemesToIds(phonemes, idMap) {
  const first = (k) => idMap[k]?.[0];
  const bos = first('^'); const eos = first('$'); const pad = first('_');
  const ids = [];
  let open = false;
  const begin = () => { ids.push(bos, pad); open = true; };
  for (let i = 0; i < phonemes.length; i++) {
    const ph = phonemes[i];
    if (!open) {
      if (ph === ' ') continue;
      begin();
    }
    for (const id of idMap[ph] ?? []) ids.push(id, pad);
    if (SENTENCE_END.has(ph) && i < phonemes.length - 1) { ids.push(eos); open = false; }
  }
  if (open) ids.push(eos);
  return ids;
}

export async function createPiperVoice({ ort, modelBytes, config, phonemizer }) {
  // 'basic': criar a sessão leva ~metade do tempo de 'all' (medido) sem tornar a síntese mais lenta
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'basic' });
  const sampleRate = config.audio.sample_rate;
  const multiSpeaker = Object.keys(config.speaker_id_map ?? {}).length > 0;
  return {
    sampleRate,
    async synth(text, { speed = 1 } = {}) {
      const { phonemes } = await phonemizer.phonemize(text, config.espeak.voice);
      const ids = phonemesToIds(phonemes ?? [], config.phoneme_id_map);
      if (!ids?.length) return { pcm: new Float32Array(0), sampleRate };
      const inf = config.inference;
      const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids, (n) => BigInt(n)), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale, inf.length_scale / Math.max(0.25, speed), inf.noise_w]), [3]),
      };
      if (multiSpeaker) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
      const out = await session.run(feeds);
      return { pcm: new Float32Array(out.output.data), sampleRate };
    },
    async dispose() { await session.release?.(); },
  };
}
