import { describe, it, expect } from 'vitest';
import { numberToWords, ordinalToWords, romanToInt, prepareForSpeech, cleanText, isPronounceable } from '../src/lib/normalize.js';

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

describe('prepareForSpeech: casos reais de texto colado', () => {
  const say = (t) => prepareForSpeech(t);
  it('horas (antes saía "dezhtrinta" e "oitoh")', () => {
    expect(say('às 10h30')).toBe('às dez horas e trinta minutos');
    expect(say('às 8h.')).toBe('às oito horas.');
    expect(say('à 1h')).toBe('à uma hora');
    expect(say('2h e 30min de espera')).toBe('duas horas e trinta minutos de espera');
    expect(say('Faltam 15 min.')).toBe('Faltam quinze minutos.');
  });
  it('datas', () => {
    expect(say('21/10/2026')).toBe('vinte e um de outubro de dois mil e vinte e seis');
    expect(say('1/5/2024')).toBe('primeiro de maio de dois mil e vinte e quatro');
    expect(say('2026-10-21')).toBe('vinte e um de outubro de dois mil e vinte e seis');
    expect(say('até dia 5/11')).toBe('até dia cinco de novembro');
    expect(say('31/13/2026')).toContain('trinta e um'); // mês inválido: não vira data
  });
  it('telefone, CPF e sequências longas são lidos dígito a dígito', () => {
    expect(say('91234-5678')).toBe('nove um dois três quatro, cinco seis sete oito');
    expect(say('0800 123 4567')).toBe('zero oito zero zero, um dois três, quatro cinco seis sete');
    expect(say('123.456.789-00')).toBe('um dois três, quatro cinco seis, sete oito nove, zero zero');
    expect(say('1234567890')).toBe('um dois três quatro cinco seis sete oito nove zero');
  });
  it('moeda com escala e outras moedas', () => {
    expect(say('R$ 1,5 milhão')).toBe('um vírgula cinco milhões de reais');
    expect(say('R$ 2 milhões')).toBe('dois milhões de reais');
    expect(say('R$ 1 milhão')).toBe('um milhão de reais');
    expect(say('R$ 5 mil')).toBe('cinco mil reais');
    expect(say('US$ 5,00')).toBe('cinco dólares');
    expect(say('€ 1,50')).toBe('um euro e cinquenta centavos');
  });
  it('ordinais, graus e sinais', () => {
    expect(say('21º século')).toBe('vigésimo primeiro século');
    expect(say('a 3ª vez')).toBe('a terceira vez');
    expect(say('3°C')).toBe('três graus Celsius');
    expect(say('(−2 °C)')).toBe('(menos dois graus Celsius)');
    expect(say('de 10-20')).toBe('de dez-vinte');
  });
  it('algarismos romanos depois de palavras-chave', () => {
    expect(say('Capítulo XII')).toBe('Capítulo doze');
    expect(say('no século XXI')).toBe('no século vinte e um');
    expect(say('Luís XIV')).toBe('Luís quatorze');
    expect(say('Eu vi o X')).toBe('Eu vi o X');
  });
  it('unidades, e-mail, símbolos e abreviações', () => {
    expect(say('80 km/h e 1 kg e 2,5 kg')).toBe('oitenta quilômetros por hora e um quilo e dois vírgula cinco quilos');
    expect(say('contato@site.com.br')).toBe('contato arroba site ponto com ponto br');
    expect(say('#tag @alguem')).toBe('tag alguem');
    expect(say('a & b, e/ou c')).toBe('a e b, e ou c');
    expect(say('Veja ex. isto')).toBe('Veja por exemplo isto');
    expect(say('pág. 12')).toBe('página doze');
  });
  it('remove emojis e repetições de pontuação', () => {
    expect(say('Oi!!! 😀😀 Tudo bem??? 🙏❤️')).toBe('Oi! Tudo bem?');
    expect(say('Espere.....')).toBe('Espere...');
    expect(say('🙂')).toBe('');
  });
  it('trecho em maiúsculas vira minúsculas (evita soletrar); siglas curtas ficam', () => {
    expect(say('ATENÇÃO: PROIBIDO ESTACIONAR NESTE LOCAL')).toBe('atenção: proibido estacionar neste local');
    expect(say('A NASA lançou um foguete hoje')).toBe('A NASA lançou um foguete hoje');
  });
  it('feminino em horas/páginas e ordinais', () => {
    expect(numberToWords(2, true)).toBe('duas');
    expect(numberToWords(200, true)).toBe('duzentas');
    expect(numberToWords(1002, true)).toBe('mil e duas');
    expect(numberToWords(21_000, true)).toBe('vinte e uma mil');
    expect(ordinalToWords(10)).toBe('décimo');
    expect(ordinalToWords(33, true)).toBe('trigésima terceira');
    expect(ordinalToWords(101)).toBeNull();
    expect(romanToInt('XIV')).toBe(14);
    expect(romanToInt('MCMXC')).toBe(1990);
  });
  it('isPronounceable', () => {
    expect(isPronounceable('...')).toBe(false);
    expect(isPronounceable('— * —')).toBe(false);
    expect(isPronounceable('a')).toBe(true);
    expect(isPronounceable('3')).toBe(true);
  });
});

describe('cleanText: quebras de linha', () => {
  it('mantém títulos e itens curtos em linhas separadas', () => {
    expect(cleanText('Capítulo 1\nEra uma vez um rei')).toBe('Capítulo 1\nEra uma vez um rei');
    expect(cleanText('Lista de compras\nPão\nLeite\nCafé')).toBe('Lista de compras\nPão\nLeite\nCafé');
  });
  it('junta linhas de um parágrafo quebrado (PDF)', () => {
    const wrapped = 'Este é um texto longo que foi quebrado na largura da página\npelo programa que gerou o arquivo e continua aqui.';
    expect(cleanText(wrapped)).toBe(wrapped.replace('\n', ' '));
  });
  it('mensagens que terminam em pontuação viram frases seguidas', () => {
    expect(cleanText('Oi, tudo bem?\nEstou bem.\nE você?')).toBe('Oi, tudo bem? Estou bem. E você?');
  });
  it('CRLF e parágrafos', () => {
    expect(cleanText('Um.\r\n\r\n\r\nDois.')).toBe('Um.\n\nDois.');
  });
});
