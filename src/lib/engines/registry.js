// Registro de motores. A interface e o player só falam com isto, nunca com Piper/Supertonic diretamente.
const engines = new Map();

export function registerEngine(engine) { engines.set(engine.id, engine); return engine; }
export function clearEngines() { engines.clear(); }
export const getEngine = (id) => engines.get(id) ?? null;
export const listEngines = () => [...engines.values()];
export const allVoices = () => listEngines().flatMap((e) => e.listVoices());
export const voiceMeta = (voiceId) => allVoices().find((v) => v.id === voiceId) ?? null;
export const engineForVoice = (voiceId) => getEngine(voiceMeta(voiceId)?.engine);

export async function cachedMapAll() {
  const maps = await Promise.all(listEngines().map((e) => e.cachedMap()));
  return Object.assign({}, ...maps);
}
