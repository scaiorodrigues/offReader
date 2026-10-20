// Persistência local: configurações (localStorage) e documentos recentes (IndexedDB).
const SETTINGS_KEY = 'leitor.settings.v1';

export const DEFAULT_SETTINGS = {
  voiceId: 'piper:pt_BR-cadu-medium',
  speed: 1,
  steps: 5,
  sentencePause: 0.35,
  paragraphPause: 0.8,
  theme: 'auto',
  fontSize: 20,
};

export function loadSettings(storage = globalThis.localStorage) {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings, storage = globalThis.localStorage) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* armazenamento indisponível */ }
}

const DB = 'leitor';
const STORE = 'docs';
let dbPromise;
const open = () => (dbPromise ??= new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
}));
const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
  });
};

export const saveDoc = (doc) => run('readwrite', (s) => s.put(doc));
export const getDoc = (id) => run('readonly', (s) => s.get(id));
export const deleteDoc = (id) => run('readwrite', (s) => s.delete(id));
export const listDocs = async () => ((await run('readonly', (s) => s.getAll())) ?? []).sort((a, b) => b.updated - a.updated);

/** id estável a partir do conteúdo (FNV-1a), para reabrir o mesmo texto na posição onde parou. */
export function docId(title, text) {
  let h = 0x811c9dc5;
  const s = `${title}\u0000${text.length}\u0000${text.slice(0, 2000)}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
