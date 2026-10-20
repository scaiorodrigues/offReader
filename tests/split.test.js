import { describe, it, expect } from 'vitest';
import { splitIntoChunks } from '../src/lib/split.js';

describe('splitIntoChunks', () => {
  it('agrupa frases até o limite e marca fim de parágrafo', () => {
    const c = splitIntoChunks('Primeira frase. Segunda frase.\n\nOutro parágrafo.', { maxLen: 60 });
    expect(c.map((x) => x.text)).toEqual(['Primeira frase. Segunda frase.', 'Outro parágrafo.']);
    expect(c.map((x) => x.endsParagraph)).toEqual([true, true]);
    expect(c.map((x) => x.paragraph)).toEqual([0, 1]);
  });
  it('respeita o limite máximo', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Esta é a frase número ${i}.`).join(' ');
    const chunks = splitIntoChunks(text, { maxLen: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
    expect(chunks.map((c) => c.text).join(' ')).toBe(text);
  });
  it('não quebra depois de abreviações nem de decimais', () => {
    const c = splitIntoChunks('O Sr. Silva chegou. Custa 3.5 reais.', { maxLen: 22 });
    expect(c[0].text).toBe('O Sr. Silva chegou.');
  });
  it('quebra frases longas sem pontuação em vírgulas ou espaços', () => {
    const long = `${'palavra '.repeat(80)}fim`;
    const chunks = splitIntoChunks(long, { maxLen: 100 });
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
    expect(chunks.map((c) => c.text).join(' ')).toBe(long);
  });
  it('texto vazio não gera trechos', () => {
    expect(splitIntoChunks('   \n\n  ')).toEqual([]);
  });
});
