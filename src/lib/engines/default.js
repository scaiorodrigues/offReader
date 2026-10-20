import { createWorkerEngine } from './worker-engine.js';
import { registerEngine } from './registry.js';
import { VOICES } from './voices.js';

const getBase = () => new URL(import.meta.env.BASE_URL, document.baseURI).href;

export function registerDefaultEngines() {
  registerEngine(createWorkerEngine({
    id: 'piper', name: 'Piper', voices: VOICES, maxChunk: 220, getBase,
    makeWorker: () => new Worker(new URL('../../workers/piper.worker.js', import.meta.url), { type: 'module' }),
  }));
  registerEngine(createWorkerEngine({
    id: 'supertonic', name: 'Supertonic', voices: VOICES, maxChunk: 280, getBase,
    makeWorker: () => new Worker(new URL('../../workers/supertonic.worker.js', import.meta.url), { type: 'module' }),
  }));
}
