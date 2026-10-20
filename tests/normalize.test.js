import { describe, it, expect } from 'vitest';
import { numberToWords, prepareForSpeech, cleanText } from '../src/lib/normalize.js';

describe('numberToWords', () => {
  it.each([
    [0, 'zero'], [1, 'um'], [15, 'quinze'], [21, 'vinte e um'], [100, 'cem'], [101, 'cento e um'],
    [999, 'novecentos e noventa e nove'], [1000, 'mil'], [1100, 'mil e cem'], [1234, 'mil duzentos e trinta e quatro'],
    [2024, 'dois mil e vinte e quatro'], [2500, 'dois mil e quinhentos'], [1_000_000, 'um milhão'],
    [2_300_000, 'dois milhões e trezentos mil'], [1_000_000_000, 'um bilhão'],
  ])('%i -> %s', (n, words) => expect(numberToWords(n)).toBe(words));
});

describe('prepareForSpeech', () => {
  it('expande inteiros, milhar e decimais', () => {
    expect(prepareForSpeech('Tenho 3 gatos')).toBe('Tenho três gatos');
    expect(prepareForSpeech('Custa 1.234 unidades')).toBe('Custa mil duzentos e trinta e quatro unidades');
    expect(prepareForSpeech('Pi vale 3,14')).toBe('Pi vale três vírgula um quatro');
  });
  it('trata moeda, percentual e ordinais', () => {
    expect(prepareForSpeech('R$ 12,50')).toBe('doze reais e cinquenta centavos');
    expect(prepareForSpeech('R$ 1')).toBe('um real');
    expect(prepareForSpeech('50%')).toBe('cinquenta por cento');
    expect(prepareForSpeech('o 1º lugar e a 2ª vez')).toBe('o primeiro lugar e a segunda vez');
  });
  it('expande abreviações e troca links', () => {
    expect(prepareForSpeech('O Sr. Silva e a Dra. Ana')).toBe('O senhor Silva e a doutora Ana');
    expect(prepareForSpeech('Veja https://exemplo.com/x agora')).toBe('Veja link agora');
  });
  it('não mexe em texto sem números', () => {
    expect(prepareForSpeech('Olá, mundo!')).toBe('Olá, mundo!');
  });
});

describe('cleanText', () => {
  it('une linhas do mesmo parágrafo e preserva parágrafos', () => {
    expect(cleanText('linha um\nlinha dois\n\n\n\nnovo parágrafo')).toBe('linha um linha dois\n\nnovo parágrafo');
  });
  it('junta palavras hifenizadas na quebra de linha', () => {
    expect(cleanText('cons-\ntrução')).toBe('construção');
  });
  it('remove caracteres invisíveis', () => {
    expect(cleanText('a­b​c d')).toBe('abc d');
  });
});
