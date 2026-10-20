// Motor genérico que fala com um worker. Implementa a interface comum:
//   listVoices(), load(voiceId, onProgress), synth(text, {speed, voiceId, steps}) -> {pcm, sampleRate},
//   cachedMap() -> {voiceId: boolean}, remove(voiceId), dispose()
// Extra: download(voiceId, onProgress) baixa para o cache sem carregar o modelo na memória.
import { createRpc } from './rpc.js';
import { MODEL_CACHE, isCached, removeCached } from './cache.js';
import { voiceUrls } from './voices.js';

export function createWorkerEngine({ id, name, voices, makeWorker, maxChunk, getBase }) {
  let rpc = null;
  const rpcOf = () => (rpc ??= createRpc(makeWorker()));
  const ownVoices = () => voices.filter((v) => v.engine === id);

  const engine = {
    id, name, maxChunk,
    listVoices: () => ownVoices(),

    async load(voiceId, onProgress) {
      return rpcOf().call('load', { voiceId, base: getBase() }, onProgress);
    },

    /** Só baixa e guarda no cache (sem carregar na memória): usado pelo botão "Baixar". */
    async download(voiceId, onProgress) {
      return rpcOf().call('download', { voiceId }, onProgress);
    },

    async synth(text, { speed = 1, voiceId, steps } = {}) {
      return rpcOf().call('synth', { text, speed, voiceId, steps });
    },

    async cachedMap() {
      const map = {};
      for (const v of ownVoices()) {
        map[v.id] = (await Promise.all(voiceUrls(v).map((u) => isCached(u)))).every(Boolean);
      }
      return map;
    },

    /** Remove os arquivos da voz; os arquivos compartilhados saem quando nenhuma outra voz do motor depende deles. */
    async remove(voiceId) {
      const voice = ownVoices().find((v) => v.id === voiceId);
      if (!voice) return;
      if (rpc) await rpc.call('unload', { voiceId }).catch(() => {});
      await removeCached(voice.files.map((f) => f.url));
      const stillUsed = (await Promise.all(ownVoices().filter((v) => v.id !== voiceId)
        .map((v) => Promise.all(v.files.map((f) => isCached(f.url))).then((r) => r.every(Boolean))))).some(Boolean);
      if (!stillUsed) await removeCached(voice.sharedFiles.map((f) => f.url));
    },

    dispose() { rpc?.terminate(); rpc = null; },
  };
  return engine;
}

export { MODEL_CACHE };
