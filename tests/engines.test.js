import { describe, it, expect, beforeEach } from 'vitest';
import { VOICES, voiceById, voiceUrls, voiceBytes, SUPERTONIC_MODEL_MB, DEFAULT_VOICE_ID } from '../src/lib/engines/voices.js';
import { registerEngine, clearEngines, allVoices, engineForVoice, cachedMapAll } from '../src/lib/engines/registry.js';
import { createWorkerEngine } from '../src/lib/engines/worker-engine.js';
import { fetchCached, isCached, fetchAll } from '../src/lib/engines/cache.js';
import { fakeEngine, fakeCaches } from './helpers.js';

describe('catálogo de vozes', () => {
  it('cada voz declara id, nome, gênero, motor e tamanho', () => {
    for (const v of VOICES) {
      expect(v.id).toMatch(/^(piper|supertonic):/);
      expect(v.name).toBeTruthy();
      expect(['feminina', 'masculina']).toContain(v.gender);
      expect(['piper', 'supertonic']).toContain(v.engine);
      expect(v.sizeMB).toBeGreaterThan(0);
      expect(voiceUrls(v).every((u) => u.startsWith('https://huggingface.co/'))).toBe(true);
    }
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length);
  });
  it('há vozes femininas e masculinas, e a padrão existe', () => {
    expect(VOICES.filter((v) => v.gender === 'feminina').length).toBe(5);
    expect(VOICES.filter((v) => v.gender === 'masculina').length).toBe(9);
    expect(voiceById(DEFAULT_VOICE_ID)?.engine).toBe('piper');
  });
  it('Supertonic: gênero segue a letra do estilo e o modelo é compartilhado', () => {
    for (const v of VOICES.filter((x) => x.engine === 'supertonic')) {
      expect(v.gender).toBe(v.style[0] === 'F' ? 'feminina' : 'masculina');
      expect(v.sharedFiles.length).toBe(6);
    }
    expect(SUPERTONIC_MODEL_MB).toBeGreaterThan(390);
    expect(voiceBytes(voiceById('supertonic:F1'))).toBeGreaterThan(SUPERTONIC_MODEL_MB * 1e6);
  });
  it('URLs são fixadas em revisão (não "main")', () => {
    for (const v of VOICES) for (const u of voiceUrls(v)) expect(u).not.toContain('/resolve/main/');
  });
});

describe('registro de motores', () => {
  beforeEach(() => clearEngines());
  it('lista vozes de todos os motores e resolve o motor da voz', async () => {
    const a = registerEngine(fakeEngine({ id: 'a' }));
    registerEngine(fakeEngine({ id: 'b' }));
    expect(allVoices().map((v) => v.id)).toEqual(['a:f', 'a:m', 'b:f', 'b:m']);
    expect(engineForVoice('a:m')).toBe(a);
    await a.load('a:f');
    expect(await cachedMapAll()).toEqual({ 'a:f': true, 'a:m': false, 'b:f': false, 'b:m': false });
  });
});

describe('cache de modelos', () => {
  beforeEach(() => { globalThis.caches = fakeCaches(); });
  const fakeFetch = (counter) => async (url) => {
    counter.n++;
    const body = new Uint8Array(1000).fill(7);
    return new Response(body, { status: 200, headers: { 'content-length': '1000' } });
  };

  it('baixa uma vez e depois lê do cache (offline)', async () => {
    const counter = { n: 0 };
    globalThis.fetch = fakeFetch(counter);
    const progress = [];
    const a = await fetchCached('https://x/y.onnx', { onProgress: (r, t) => progress.push([r, t]) });
    expect(a.length).toBe(1000);
    expect(progress.at(-1)).toEqual([1000, 1000]);
    globalThis.fetch = async () => { throw new Error('sem rede'); };
    const b = await fetchCached('https://x/y.onnx');
    expect(b.length).toBe(1000);
    expect(counter.n).toBe(1);
    expect(await isCached('https://x/y.onnx')).toBe(true);
  });

  it('tenta de novo em caso de falha e reporta erro HTTP', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return calls < 2 ? new Response('x', { status: 503 }) : new Response(new Uint8Array(5)); };
    expect((await fetchCached('https://x/z')).length).toBe(5);
    globalThis.fetch = async () => new Response('x', { status: 404 });
    await expect(fetchCached('https://x/w')).rejects.toThrow(/404/);
  }, 20000);

  it('fetchAll agrega o progresso de vários arquivos', async () => {
    globalThis.fetch = fakeFetch({ n: 0 });
    const fr = [];
    await fetchAll([{ url: 'https://x/1', bytes: 1000 }, { url: 'https://x/2', bytes: 1000 }], { onProgress: (p) => fr.push(p.fraction) });
    expect(fr.at(-1)).toBeCloseTo(1);
    expect(fr.every((v, i) => i === 0 || v >= fr[i - 1])).toBe(true);
  });

  it('motor de worker: cachedMap e remove (arquivos compartilhados saem com a última voz)', async () => {
    globalThis.fetch = fakeFetch({ n: 0 });
    const voices = [
      { id: 'w:a', engine: 'w', files: [{ url: 'https://x/a', bytes: 1 }], sharedFiles: [{ url: 'https://x/shared', bytes: 1 }] },
      { id: 'w:b', engine: 'w', files: [{ url: 'https://x/b', bytes: 1 }], sharedFiles: [{ url: 'https://x/shared', bytes: 1 }] },
    ];
    const engine = createWorkerEngine({ id: 'w', name: 'W', voices, maxChunk: 100, makeWorker: () => { throw new Error('não deveria criar worker'); }, getBase: () => '/' });
    expect(await engine.cachedMap()).toEqual({ 'w:a': false, 'w:b': false });
    await fetchAll([...voices[0].sharedFiles, ...voices[0].files, ...voices[1].files]);
    expect(await engine.cachedMap()).toEqual({ 'w:a': true, 'w:b': true });
    await engine.remove('w:a');
    expect(await engine.cachedMap()).toEqual({ 'w:a': false, 'w:b': true });
    expect(await isCached('https://x/shared')).toBe(true);
    await engine.remove('w:b');
    expect(await isCached('https://x/shared')).toBe(false);
  });
});
