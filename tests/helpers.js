// Dublês de teste: motor falso (interface comum), <audio> falso e CacheStorage em memória.
export class FakeAudio extends EventTarget {
  constructor() { super(); this.src = ''; this.played = []; this.paused = true; }
  removeAttribute() { this.src = ''; }
  async play() { this.paused = false; this.played.push(this.src); }
  pause() { this.paused = true; }
  end() { this.dispatchEvent(new Event('ended')); }
}

export function fakeEngine({ id = 'fake', voices, delay = 0, failOn = null, loadDelay = 0 } = {}) {
  const calls = { load: [], synth: [] };
  const list = voices ?? [
    { id: `${id}:f`, name: 'Fake F', gender: 'feminina', engine: id, sizeMB: 1, sharedFiles: [], files: [] },
    { id: `${id}:m`, name: 'Fake M', gender: 'masculina', engine: id, sizeMB: 1, sharedFiles: [], files: [] },
  ];
  const cached = new Set();
  return {
    id, name: 'Fake', maxChunk: 100, calls,
    listVoices: () => list,
    async load(voiceId, onProgress) { calls.load.push(voiceId); if (loadDelay) await new Promise((r) => setTimeout(r, loadDelay)); onProgress?.({ phase: 'baixando', fraction: 1 }); cached.add(voiceId); return { sampleRate: 8000 }; },
    async download(voiceId, onProgress) { onProgress?.({ phase: 'baixando', fraction: 1 }); cached.add(voiceId); },
    async synth(text, opts) {
      calls.synth.push({ text, ...opts });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (failOn && text.includes(failOn)) throw new Error('falha simulada');
      return { pcm: new Float32Array(800).fill(0.1), sampleRate: 8000 };
    },
    async cachedMap() { return Object.fromEntries(list.map((v) => [v.id, cached.has(v.id)])); },
    async remove(voiceId) { cached.delete(voiceId); },
  };
}

export function fakeCaches() {
  const stores = new Map();
  return {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async match(u) { const r = m.get(String(u)); return r ? r.clone() : undefined; },
        async put(u, r) { m.set(String(u), r); },
        async delete(u) { return m.delete(String(u)); },
      };
    },
    stores,
  };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
export async function until(cond, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout aguardando condição'); await tick(2); }
}
