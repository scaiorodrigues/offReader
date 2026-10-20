// Normalização de texto para leitura em pt-BR.
// `cleanText` limpa a extração (PDF/EPUB...), preservando parágrafos.
// `prepareForSpeech` expande números e abreviações apenas para a fala.

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];

function below1000(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    parts.push(rest < 20 ? UNITS[rest] : TENS[Math.floor(rest / 10)] + (rest % 10 ? ' e ' + UNITS[rest % 10] : ''));
  }
  return parts.join(' e ');
}

// Conector "e" depois de mil/milhão: quando o resto é < 100 ou múltiplo de 100.
const joinsWithE = (rest) => rest > 0 && (rest < 100 || rest % 100 === 0);

export function numberToWords(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999_999) return String(n);
  if (n < 20) return UNITS[n];
  const scales = [
    [1_000_000_000, 'bilhão', 'bilhões'],
    [1_000_000, 'milhão', 'milhões'],
    [1_000, 'mil', 'mil'],
  ];
  for (const [value, singular, plural] of scales) {
    if (n >= value) {
      const q = Math.floor(n / value);
      const rest = n % value;
      const head = value === 1_000 && q === 1 ? 'mil' : `${numberToWords(q)} ${q === 1 ? singular : plural}`;
      if (!rest) return head;
      return `${head}${joinsWithE(rest) ? ' e ' : ' '}${numberToWords(rest)}`;
    }
  }
  return below1000(n);
}

const digitsToWords = (s) => s.split('').map((d) => UNITS[Number(d)]).join(' ');

const ORDINALS_M = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono', 'décimo'];
const ORDINALS_F = ['', 'primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava', 'nona', 'décima'];

const ABBREVIATIONS = [
  [/\bSra\.(?=\s)/g, 'senhora'], [/\bSr\.(?=\s)/g, 'senhor'],
  [/\bDra\.(?=\s)/g, 'doutora'], [/\bDr\.(?=\s)/g, 'doutor'],
  [/\bProfa\.(?=\s)/g, 'professora'], [/\bProf\.(?=\s)/g, 'professor'],
  [/\bAv\.(?=\s)/g, 'avenida'], [/\bpágs\./gi, 'páginas'], [/\bpág\./gi, 'página'],
  [/\betc\./gi, 'etcétera'], [/\bnº\s*/gi, 'número '], [/\bn\.º\s*/gi, 'número '],
];

/** Limpa o texto extraído mantendo apenas quebras de parágrafo. */
export function cleanText(raw) {
  let t = String(raw ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[­​‌‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ');
  // palavra hifenizada na quebra de linha: "pala-\nvra" -> "palavra"
  t = t.replace(/([a-záéíóúâêôãõç])-\n([a-záéíóúâêôãõç])/g, '$1$2');
  t = t.replace(/ *\n */g, '\n');
  // quebra simples dentro do parágrafo vira espaço (PDFs); linha em branco separa parágrafos
  t = t.replace(/([^\n])\n(?!\n)([^\n])/g, '$1 $2');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** Converte o texto de um trecho em algo que o motor consiga pronunciar bem. */
export function prepareForSpeech(text) {
  let t = String(text ?? '');
  t = t.replace(/https?:\/\/\S+/gi, ' link ').replace(/\bwww\.\S+/gi, ' link ');
  for (const [re, out] of ABBREVIATIONS) t = t.replace(re, out);

  // moeda: R$ 1.234,56
  t = t.replace(/R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/g, (_, int, cents) => {
    const n = Number(int.replace(/\./g, ''));
    let out = `${numberToWords(n)} ${n === 1 ? 'real' : 'reais'}`;
    if (cents) {
      const c = Number(cents.padEnd(2, '0'));
      if (c) out += ` e ${numberToWords(c)} ${c === 1 ? 'centavo' : 'centavos'}`;
    }
    return out;
  });

  // ordinais: 1º, 2ª
  t = t.replace(/\b(\d{1,2})\s?([ºª°])/g, (m, d, s) => {
    const n = Number(d);
    const list = s === 'ª' ? ORDINALS_F : ORDINALS_M;
    return n >= 1 && n <= 10 ? list[n] : m;
  });

  // percentual e decimais: 12,5% / 3,14
  t = t.replace(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s?%/g, (_, int, dec) => {
    const base = numberToWords(Number(int.replace(/\./g, '')));
    return `${dec ? `${base} vírgula ${digitsToWords(dec)}` : base} por cento`;
  });
  t = t.replace(/(\d{1,3}(?:\.\d{3})+|\d+),(\d+)/g, (_, int, dec) =>
    `${numberToWords(Number(int.replace(/\./g, '')))} vírgula ${digitsToWords(dec)}`);

  // inteiros (com ponto de milhar)
  t = t.replace(/\d{1,3}(?:\.\d{3})+|\d+/g, (m) => {
    const digits = m.replace(/\./g, '');
    if (digits.length > 12) return digitsToWords(digits);
    return numberToWords(Number(digits));
  });

  return t.replace(/\s+/g, ' ').trim();
}
