import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { phonemesToIds, createPhonemizer } from '../src/lib/engines/piper/core.js';

const require = createRequire(import.meta.url);
const build = path.resolve('node_modules/@diffusionstudio/piper-wasm/build');
const cfg = (n) => JSON.parse(fs.readFileSync(path.resolve('tests/fixtures', n), 'utf8'));
const faber = cfg('pt_BR-faber-medium.onnx.json');
const edresson = cfg('pt_BR-edresson-low.onnx.json');

describe('phonemesToIds', () => {
  it('BOS, pad entre fonemas e EOS', () => {
    const map = { '^': [1], $: [2], _: [0], a: [10], b: [11] };
    expect(phonemesToIds(['a', 'b'], map)).toEqual([1, 0, 10, 0, 11, 0, 2]);
  });
  it('ignora fonemas desconhecidos e separa sentenças', () => {
    const map = { '^': [1], $: [2], _: [0], a: [10], '.': [12], ' ': [3] };
    expect(phonemesToIds(['a', 'x', '.', ' ', 'a', '.'], map)).toEqual([1, 0, 10, 0, 12, 0, 2, 1, 0, 10, 0, 12, 0, 2]);
  });
  it('lista vazia não gera ids', () => {
    expect(phonemesToIds([], { '^': [1], $: [2], _: [0] })).toEqual([]);
  });
  it('mapas diferentes dão ids diferentes para os mesmos fonemas (Faber x Edresson)', () => {
    const differing = Object.keys(faber.phoneme_id_map).filter((k) => JSON.stringify(faber.phoneme_id_map[k]) !== JSON.stringify(edresson.phoneme_id_map[k]));
    expect(differing.length).toBeGreaterThan(20);
  });
});

describe('fonemizador real (espeak-ng/WASM) + mapa do modelo', () => {
  it('reproduz exatamente os ids do CLI quando o mapa é o padrão (Faber), em chamadas repetidas', async () => {
    const factory = require(path.join(build, 'piper_phonemize.js'));
    const ph = await createPhonemizer(factory, { locateFile: (n) => path.join(build, n) });
    for (const text of ['Olá, mundo! Tudo bem?', 'A leitura em voz alta ajuda a descansar os olhos.']) {
      const out = await ph.phonemize(text, faber.espeak.voice);
      expect(out.phonemes.length).toBeGreaterThan(5);
      expect(phonemesToIds(out.phonemes, faber.phoneme_id_map)).toEqual(out.phoneme_ids);
    }
  });
  it('com o mapa da Edresson todos os ids ficam dentro do embedding (130 símbolos)', async () => {
    const factory = require(path.join(build, 'piper_phonemize.js'));
    const ph = await createPhonemizer(factory, { locateFile: (n) => path.join(build, n) });
    const out = await ph.phonemize('Olá, mundo! Tudo bem? Ação, coração e pão.', edresson.espeak.voice);
    const ids = phonemesToIds(out.phonemes, edresson.phoneme_id_map);
    expect(Math.max(...ids)).toBeLessThan(edresson.num_symbols);
    expect(Math.max(...out.phoneme_ids)).toBeGreaterThanOrEqual(edresson.num_symbols); // o CLI estourava o limite
  });
});
