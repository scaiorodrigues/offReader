// Normalização de texto para leitura em pt-BR.
// `cleanText` limpa a extração (PDF/EPUB...), preservando parágrafos.
// `prepareForSpeech` expande números e abreviações apenas para a fala.

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// fem: "uma/duas" e "duzentas…" (horas, páginas…)
function below1000(n, fem) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(fem && h >= 2 ? HUNDREDS[h].replace(/os$/, 'as') : HUNDREDS[h]);
  if (rest) {
    const unit = (u) => (fem && u === 1 ? 'uma' : fem && u === 2 ? 'duas' : UNITS[u]);
    parts.push(rest < 20 ? unit(rest) : TENS[Math.floor(rest / 10)] + (rest % 10 ? ' e ' + unit(rest % 10) : ''));
  }
  return parts.join(' e ');
}

// Conector "e" depois de mil/milhão: quando o resto é < 100 ou múltiplo de 100.
const joinsWithE = (rest) => rest > 0 && (rest < 100 || rest % 100 === 0);

export function numberToWords(n, fem = false) {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999_999) return String(n);
  if (n < 20) return fem && n === 1 ? 'uma' : fem && n === 2 ? 'duas' : UNITS[n];
  const scales = [
    [1_000_000_000, 'bilhão', 'bilhões'],
    [1_000_000, 'milhão', 'milhões'],
    [1_000, 'mil', 'mil'],
  ];
  for (const [value, singular, plural] of scales) {
    if (n >= value) {
      const q = Math.floor(n / value);
      const rest = n % value;
      const head = value === 1_000 && q === 1 ? 'mil' : `${numberToWords(q, fem && value === 1_000)} ${q === 1 ? singular : plural}`;
      if (!rest) return head;
      return `${head}${joinsWithE(rest) ? ' e ' : ' '}${numberToWords(rest, fem)}`;
    }
  }
  return below1000(n, fem);
}

const digitsToWords = (s) => s.replace(/\D/g, '').split('').map((d) => UNITS[Number(d)]).join(' ');
const num = (s) => Number(s.replace(/\./g, ''));

const ORD_UNITS = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono'];
const ORD_TENS = ['', 'décimo', 'vigésimo', 'trigésimo', 'quadragésimo', 'quinquagésimo', 'sexagésimo', 'septuagésimo', 'octogésimo', 'nonagésimo'];

/** 1..100 -> "primeiro", "vigésimo primeiro"... (fem: "primeira"). Fora disso devolve null. */
export function ordinalToWords(n, fem = false) {
  if (!Number.isInteger(n) || n < 1 || n > 100) return null;
  const w = n === 100 ? 'centésimo' : [ORD_TENS[Math.floor(n / 10)], ORD_UNITS[n % 10]].filter(Boolean).join(' ');
  return fem ? w.replace(/o\b/g, 'a') : w;
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
export function romanToInt(r) {
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const v = ROMAN[r[i]];
    total += v < (ROMAN[r[i + 1]] ?? 0) ? -v : v;
  }
  return total;
}

const ABBREVIATIONS = [
  [/\bSra\.(?=\s)/g, 'senhora'], [/\bSr\.(?=\s)/g, 'senhor'], [/\bSrta\.(?=\s)/g, 'senhorita'],
  [/\bDra\.(?=\s)/g, 'doutora'], [/\bDr\.(?=\s)/g, 'doutor'],
  [/\bProfa\.(?=\s)/g, 'professora'], [/\bProf\.(?=\s)/g, 'professor'],
  [/\bAv\.(?=\s)/g, 'avenida'], [/\bpágs\./gi, 'páginas'], [/\bpág\./gi, 'página'],
  [/\bpp\.\s?(?=\d)/g, 'páginas '], [/\bp\.\s?(?=\d)/g, 'página '], [/\bcap\.\s?(?=\d)/gi, 'capítulo '],
  [/\betc\./gi, 'etcétera'], [/\bvs\.?(?=\s)/gi, 'versus'], [/\baprox\./gi, 'aproximadamente'],
  [/\bLtda\./g, 'limitada'], [/\btel\.(?=\s|:)/gi, 'telefone'], [/\bobs\.:?/gi, 'observação:'],
  [/(?<![\w-])ex\.(?=\s)/gi, 'por exemplo'], [/\bn[º°]\.?\s*(?=\d)/gi, 'número '], [/\bn\.º\s*/gi, 'número '],
  [/\be\/ou\b/gi, 'e ou'],
];

// Unidades depois de números: [regex da unidade, singular, plural]
const UNIT_WORDS = [
  [/km\/h\b/i, 'quilômetro por hora', 'quilômetros por hora'], [/km\b/i, 'quilômetro', 'quilômetros'],
  [/kg\b/i, 'quilo', 'quilos'], [/cm\b/i, 'centímetro', 'centímetros'], [/mm\b/i, 'milímetro', 'milímetros'],
  [/ml\b/i, 'mililitro', 'mililitros'], [/gb\b/i, 'gigabyte', 'gigabytes'], [/mb\b/i, 'megabyte', 'megabytes'], [/kb\b/i, 'quilobyte', 'quilobytes'],
  [/min\b/i, 'minuto', 'minutos'],
];

const CURRENCY = {
  'R$': ['real', 'reais'], 'US$': ['dólar', 'dólares'], '€': ['euro', 'euros'],
};

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu;

/** Limpa o texto extraído mantendo parágrafos e quebras de linha que parecem intencionais (títulos, itens, versos). */
export function cleanText(raw) {
  let t = String(raw ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[­​‌‍﻿]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ');
  // palavra hifenizada na quebra de linha: "pala-\nvra" -> "palavra"
  t = t.replace(/([a-záéíóúâêôãõç])-\n([a-záéíóúâêôãõç])/g, '$1$2');

  // Quebra simples: é continuação do parágrafo (texto "quebrado" de PDF) ou fim de um item curto (título, verso, lista)?
  const out = [];
  let prev = null; // última linha não vazia do parágrafo atual
  for (const raw of t.split('\n')) {
    const line = raw.trim();
    if (!line) { if (prev !== null) { out.push('\n\n'); prev = null; } continue; }
    if (prev !== null) {
      const endsSentence = /[.!?…:;]["'”’)»\]]*$/.test(prev);
      const startsLower = /^[a-záéíóúâêôãõç(«"“'‘]/.test(line) && !/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(line);
      const wrapped = startsLower || endsSentence || prev.length >= 45;
      out.push(wrapped ? ' ' : '\n');
    }
    out.push(line);
    prev = line;
  }
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** Há algo que possa ser falado (letra ou número)? */
export const isPronounceable = (text) => /[\p{L}\p{N}]/u.test(text);

/** Converte o texto de um trecho em algo que o motor consiga pronunciar bem. */
export function prepareForSpeech(text) {
  let t = String(text ?? '').replace(EMOJI, ' ');

  // trecho gritado (maiúsculas) vira minúsculas: evita soletrar
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters >= 12 && (t.match(/\p{Lu}/gu) ?? []).length / letters >= 0.7) t = t.toLowerCase();

  t = t.replace(/^[\s•·▪●◦‣*\-–—]+(?=\S)/, '');
  t = t.replace(/https?:\/\/\S+/gi, ' link ').replace(/\bwww\.\S+/gi, ' link ');
  t = t.replace(/\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)\b/g, (_, user, domain) => `${user.replace(/[._+-]/g, ' ')} arroba ${domain.replace(/\./g, ' ponto ')}`);
  for (const [re, out] of ABBREVIATIONS) t = t.replace(re, out);

  // números de telefone, CPF, CNPJ e sequências longas: dígito a dígito
  t = t.replace(/\b0800[\s-]?(\d{3})[\s-]?(\d{4})\b/g, (_, a, b) => `zero oito zero zero, ${digitsToWords(a)}, ${digitsToWords(b)}`);
  t = t.replace(/\b(\d{4,5})-(\d{4})\b/g, (_, a, b) => `${digitsToWords(a)}, ${digitsToWords(b)}`);
  t = t.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, (m) => m.split(/[.\-/]/).map(digitsToWords).join(', '));
  t = t.replace(/\b\d{10,}\b/g, (m) => digitsToWords(m));

  // datas: 21/10/2026, 2026-10-21, "dia 21/10"
  const day = (d) => (d === 1 ? 'primeiro' : numberToWords(d));
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, d, mo, y) => (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12
    ? `${day(+d)} de ${MONTHS[mo - 1]} de ${numberToWords(+y)}` : m));
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12
    ? `${day(+d)} de ${MONTHS[mo - 1]} de ${numberToWords(+y)}` : m));
  t = t.replace(/\b(dia|desde|até)\s+(\d{1,2})\/(\d{1,2})\b/gi, (m, w, d, mo) => (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12
    ? `${w} ${day(+d)} de ${MONTHS[mo - 1]}` : m));

  // horas: 10h30, 8h, 2h e 30min
  t = t.replace(/\b(\d{1,2})\s?h(?:\s?([0-5]\d))?(?![\p{L}\d])/gu, (m, h, min) => {
    if (+h > 24) return m;
    const hours = `${numberToWords(+h, true)} ${+h === 1 ? 'hora' : 'horas'}`;
    return min && +min > 0 ? `${hours} e ${numberToWords(+min)} ${+min === 1 ? 'minuto' : 'minutos'}` : hours;
  });

  // moeda: R$ 1.234,56 · US$ 5 · € 3 · R$ 1,5 milhão
  t = t.replace(/(R\$|US\$|€)\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?:\s+(mil|milhões|milhão|bilhões|bilhão)\b)?/gi, (_, cur, int, dec, scale) => {
    const [one, many] = CURRENCY[cur.toUpperCase()] ?? CURRENCY['R$'];
    const n = num(int);
    if (scale) {
      const head = dec ? `${numberToWords(n)} vírgula ${digitsToWords(dec)}` : numberToWords(n);
      const plural = n === 1 && !dec && !/^mil$/i.test(scale) ? scale.toLowerCase() : scale.toLowerCase().replace(/ão$/, 'ões');
      return `${head} ${plural}${/^mil$/i.test(scale) ? '' : ' de'} ${many}`;
    }
    let out = `${numberToWords(n)} ${n === 1 ? one : many}`;
    if (dec) {
      const c = Number(dec.padEnd(2, '0').slice(0, 2));
      if (c) out += ` e ${numberToWords(c)} ${c === 1 ? 'centavo' : 'centavos'}`;
    }
    return out;
  });

  // temperatura e sinais
  t = t.replace(/\s?°\s?C\b/g, ' graus Celsius').replace(/\s?°\s?F\b/g, ' graus Fahrenheit').replace(/(\d)\s?°/g, '$1 graus');
  t = t.replace(/(^|[\s(])[−–-](?=\d)/g, '$1menos ');

  // ordinais: 1º, 2ª, 21º
  t = t.replace(/\b(\d{1,3})\s?([ºª])/g, (m, d, s) => ordinalToWords(+d, s === 'ª') ?? numberToWords(+d, s === 'ª'));

  // algarismos romanos depois de palavras que os pedem: Capítulo XII, século XXI, Luís XIV
  t = t.replace(/\b(cap[ií]tulo|s[eé]culo|parte|livro|tomo|volume|ato|se[cç][aã]o|t[ií]tulo|pap[ae]\s+\p{Lu}\p{L}+|lu[ií]s|jo[aã]o|pedro|pio|le[aã]o|bento|henrique|lu[ií]za)\s+([IVXLCDM]{1,7})\b/giu,
    (m, w, r) => (/^[IVXLCDM]+$/.test(r) ? `${w} ${numberToWords(romanToInt(r))}` : m));

  // unidades de medida
  t = t.replace(/(\d[\d.,]*)\s?(km\/h|km|kg|cm|mm|ml|gb|mb|kb|min)(?![\p{L}\d])/giu, (m, n, unit) => {
    const entry = UNIT_WORDS.find(([re]) => re.test(unit));
    return entry ? `${n} ${n === '1' ? entry[1] : entry[2]}` : m;
  });

  // percentual e decimais: 12,5% / 3,14
  t = t.replace(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s?%/g, (_, int, dec) => {
    const base = numberToWords(num(int));
    return `${dec ? `${base} vírgula ${digitsToWords(dec)}` : base} por cento`;
  });
  t = t.replace(/(\d{1,3}(?:\.\d{3})+|\d+),(\d+)/g, (_, int, dec) => `${numberToWords(num(int))} vírgula ${digitsToWords(dec)}`);

  // inteiros (com ponto de milhar)
  t = t.replace(/\d{1,3}(?:\.\d{3})+|\d+/g, (m) => {
    const digits = m.replace(/\./g, '');
    return digits.length > 12 ? digitsToWords(digits) : numberToWords(Number(digits));
  });

  // símbolos
  t = t.replace(/&/g, ' e ').replace(/\s=\s/g, ' igual a ').replace(/\s\+\s/g, ' mais ');
  t = t.replace(/(?<=\S)\/(?=\S)/g, ' barra ').replace(/[@#*_~^|\\<>{}]/g, ' ');
  t = t.replace(/([!?])\1{2,}/g, '$1').replace(/\.{4,}/g, '...');

  return t.replace(/\s+/g, ' ').trim();
}
