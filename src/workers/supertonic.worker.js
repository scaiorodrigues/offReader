import * as ort from 'onnxruntime-web/wasm';
import { serve, withTransfer } from '../lib/engines/rpc.js';
import { fetchAll, fetchCached } from '../lib/engines/cache.js';
import { createSupertonic, loadSupertonicSessions, parseStyle } from '../lib/engines/supertonic/core.js';
import { SUPERTONIC_MODEL_FILES, voiceById } from '../lib/engines/voices.js';

let base = null;
let tts = null;
const styles = new Map();
let loadedVoice = null;

function initRuntime(b) {
  if (base) return;
  base = b;
  ort.env.wasm.wasmPaths = `${b}vendor/ort/`;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
}

serve(self, {
  async load({ voiceId, base: b }, progress) {
    initRuntime(b);
    const meta = voiceById(voiceId);
    if (!meta) throw new Error(`Voz desconhecida: ${voiceId}`);
    const files = [...(tts ? [] : SUPERTONIC_MODEL_FILES), ...meta.files];
    const bytes = await fetchAll(files, { onProgress: (p) => progress({ phase: 'baixando', ...p }) });
    if (!tts) {
      progress({ phase: 'preparando', fraction: 1 });
      const [dp, textEnc, vectorEst, vocoder, cfg, idx] = bytes;
      const sessions = await loadSupertonicSessions(ort, { dp, textEnc, vectorEst, vocoder });
      tts = await createSupertonic({
        ort, sessions,
        cfgs: JSON.parse(new TextDecoder().decode(cfg)),
        indexer: JSON.parse(new TextDecoder().decode(idx)),
      });
    }
    if (!styles.has(voiceId)) {
      const styleBytes = bytes[bytes.length - 1] ?? await fetchCached(meta.files[0].url);
      styles.set(voiceId, parseStyle(ort, JSON.parse(new TextDecoder().decode(styleBytes))));
    }
    loadedVoice = voiceId;
    return { sampleRate: tts.sampleRate };
  },
  async download({ voiceId }, progress) {
    const meta = voiceById(voiceId);
    await fetchAll([...SUPERTONIC_MODEL_FILES, ...meta.files], { onProgress: (p) => progress({ phase: 'baixando', ...p }) });
  },
  async synth({ voiceId, text, speed, steps }) {
    if (!tts || !styles.has(voiceId)) throw new Error('Voz não carregada');
    const { pcm, sampleRate } = await tts.synth(text, { style: styles.get(voiceId), steps, speed });
    return withTransfer({ pcm, sampleRate }, [pcm.buffer]);
  },
  async unload({ voiceId }) {
    styles.delete(voiceId);
    if (loadedVoice === voiceId) loadedVoice = null;
    if (!styles.size && tts) { await tts.dispose(); tts = null; }
  },
});
