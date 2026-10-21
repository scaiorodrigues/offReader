import { describe, it, expect } from 'vitest';
import { splitIntoChunks, splitHead } from '../src/lib/split.js';

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
  it('agrupa só até o tamanho-alvo: trechos curtos tocam mais cedo', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Esta é a frase número ${i} do texto.`).join(' ');
    const chunks = splitIntoChunks(text); // alvo 110, limite 220
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(110);
    expect(chunks[0].text.length).toBeGreaterThan(40);
    expect(chunks.map((c) => c.text).join(' ')).toBe(text);
  });
  it('uma frase maior que o alvo (mas ≤ limite) fica inteira num trecho', () => {
    const sentence = `${'palavra '.repeat(20)}fim.`; // ~ 165 caracteres
    const chunks = splitIntoChunks(`Curta. ${sentence} Outra curta.`);
    expect(chunks.map((c) => c.text)).toContain(sentence);
  });
  it('quebra simples (item de lista/verso) é fronteira de trecho', () => {
    const chunks = splitIntoChunks('Compras\nPão\nLeite\nCafé\n\nFim.');
    expect(chunks.map((c) => c.text)).toEqual(['Compras', 'Pão', 'Leite', 'Café', 'Fim.']);
    expect(chunks.map((c) => c.endsParagraph)).toEqual([false, false, false, true, true]);
  });
});

describe('splitHead (início curto para o primeiro som sair cedo)', () => {
  it('corta numa vírgula perto do meio, sem perder texto', () => {
    const t = 'Uma noite destas, vindo da cidade para o Engenho Novo, encontrei num trem da Central um rapaz aqui do bairro.';
    const [head, tail] = splitHead(t);
    expect(head.endsWith(',')).toBe(true);
    expect(`${head} ${tail}`).toBe(t);
    expect(head.length).toBeGreaterThanOrEqual(25);
    expect(tail.length).toBeGreaterThanOrEqual(25);
  });
  it('prefere o ponto entre duas frases agrupadas', () => {
    const [head, tail] = splitHead('Esta é a primeira frase do trecho agrupado. E esta é a segunda frase que veio junto com ela.');
    expect(head).toBe('Esta é a primeira frase do trecho agrupado.');
    expect(tail.startsWith('E esta')).toBe(true);
  });
  it('não divide texto curto nem sem fronteira natural (nunca corta no meio de uma oração)', () => {
    expect(splitHead('Frase curta, com vírgula.')).toBeNull();
    expect(splitHead('palavra '.repeat(15).trim())).toBeNull();
    expect(splitHead('a, b ' + 'palavra '.repeat(14).trim())).toBeNull(); // só há corte colado na borda
  });
});
