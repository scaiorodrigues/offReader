import { describe, it, expect } from 'vitest';
import { Player } from '../src/lib/player.js';
import { FakeAudio, fakeEngine, until, tick } from './helpers.js';

const chunks = (n) => Array.from({ length: n }, (_, i) => ({ text: `Trecho número ${i + 1}.`, endsParagraph: i === n - 1, paragraph: 0 }));

// Cada unidade do motor falso dura 0,1 s (800 amostras a 8 kHz) + pausa (0,35 s entre frases, 0,8 s no fim do parágrafo).
function setup(engineOpts = {}, n = 4, playerOpts = {}) {
  const engine = fakeEngine(engineOpts);
  const audio = new FakeAudio();
  const urls = new Set();
  const wavs = [];
  let seq = 0;
  const player = new Player({
    audio, resolveEngine: () => engine,
    createUrl: (wav) => { const u = `blob:${++seq}`; urls.add(u); wavs.push(wav); return u; },
    revokeUrl: (u) => urls.delete(u),
    ...playerOpts,
  });
  player.configure({ voiceId: 'fake:f' });
  player.setChunks(chunks(n));
  return { engine, audio, player, urls, wavs };
}

/** Termina cada segmento em sequência até a leitura acabar. */
async function drain(audio, player, max = 30) {
  for (let i = 0; i < max && player.state !== 'ended' && player.state !== 'error'; i++) {
    await until(() => audio.played.length > i);
    audio.end();
    await tick(8);
  }
}

describe('Player com motor falso', () => {
  it('carrega a voz uma vez, toca tudo em ordem e termina', async () => {
    const { engine, audio, player } = setup();
    const states = [];
    player.on('state', (s) => states.push(s));
    await player.play();
    await until(() => audio.played.length === 1);
    await drain(audio, player);
    expect(player.state).toBe('ended');
    expect(engine.calls.load).toEqual(['fake:f']);
    expect(engine.calls.synth.map((c) => c.text)).toEqual(['Trecho número um.', 'Trecho número dois.', 'Trecho número três.', 'Trecho número quatro.']);
    expect(states).toContain('playing');
    expect(player.metrics.segments).toBeLessThan(4); // o buffer permite emendar unidades em poucos segmentos
  });

  it('emenda as unidades prontas num único áudio contínuo (menos trocas de src)', async () => {
    const { audio, player, wavs } = setup({}, 4);
    await player.play();
    await until(() => audio.played.length === 1);
    await until(() => player.ready.size === 3); // as 3 seguintes ficam prontas enquanto a 1ª toca
    audio.end();
    await until(() => audio.played.length === 2);
    // 2º segmento = unidades 2..4: 3 × 800 amostras de fala + 2 pausas de frase (0,35 s) + pausa de parágrafo (0,8 s) a 8 kHz
    const samples = 3 * 800 + 2 * 2800 + 6400;
    expect(wavs[1].length).toBe(44 + samples * 2);
    expect(player.seg.offsets.map((o) => o.unit)).toEqual([1, 2, 3]);
    await drain(audio, player);
    expect(player.state).toBe('ended');
  });

  it('prepara à frente por TEMPO (bufferSec), não por quantidade de trechos', async () => {
    const { engine, audio, player } = setup({}, 20);
    player.configure({ bufferSec: 1 });
    await player.play();
    await until(() => audio.played.length === 1);
    await tick(40);
    expect(engine.calls.synth.length).toBe(3); // 0,45 s tocando + 2 × 0,45 s prontos ≥ 1 s
    expect(player.bufferedSec).toBeGreaterThanOrEqual(1);
    player.configure({ bufferSec: 5 });
    await until(() => engine.calls.synth.length >= 12);
    await tick(40);
    expect(engine.calls.synth.length).toBeLessThan(20);
    expect(player.bufferedSec).toBeGreaterThanOrEqual(5);
    expect(player.bufferedSec).toBeLessThan(5 + 0.9);
  });

  it('com o buffer padrão (3 min) prepara um texto curto inteiro enquanto o primeiro trecho toca', async () => {
    const { engine, audio, player } = setup({}, 10);
    await player.play();
    await until(() => audio.played.length === 1);
    await until(() => engine.calls.synth.length === 10);
    expect(player.ready.size).toBe(9);
  });

  it('o que foi consumido cai do buffer; stop libera as URLs', async () => {
    const { audio, player, urls } = setup({}, 10);
    await player.play();
    await until(() => audio.played.length === 1);
    player.stop();
    expect(urls.size).toBe(0);
    expect(audio.paused).toBe(true);
    expect(player.ready.size).toBe(0);
  });

  it('pausa e retoma sem ressintetizar', async () => {
    const { engine, audio, player } = setup();
    await player.play();
    await until(() => audio.played.length === 1);
    player.pause();
    expect(player.state).toBe('paused');
    expect(audio.paused).toBe(true);
    await player.play();
    expect(player.state).toBe('playing');
    expect(audio.paused).toBe(false);
    expect(audio.src).toBeTruthy();
    expect(engine.calls.synth.filter((c) => c.text.includes('um.')).length).toBe(1);
  });

  it('próximo trecho dentro do buffer reaproveita o que já está pronto (não ressintetiza)', async () => {
    const { engine, audio, player } = setup({}, 6);
    await player.play();
    await until(() => engine.calls.synth.length === 6);
    const before = engine.calls.synth.length;
    player.next();
    await until(() => audio.played.length === 2);
    expect(player.index).toBe(1);
    expect(engine.calls.synth.length).toBe(before);
    expect(player.seg.offsets[0].unit).toBe(1);
  });

  it('seek para trás ou para fora do buffer ressintetiza a partir do trecho pedido', async () => {
    const { engine, audio, player } = setup({}, 6);
    await player.play();
    await until(() => engine.calls.synth.length === 6);
    player.next(); // consome o buffer inteiro num segmento
    await until(() => audio.played.length === 2);
    const before = engine.calls.synth.length;
    player.seek(3);
    await until(() => audio.played.length === 3);
    expect(player.index).toBe(3);
    expect(engine.calls.synth.length).toBeGreaterThan(before);
  });

  it('trocar a velocidade com o segmento longo em curso corta no fim da unidade atual e usa a velocidade nova', async () => {
    const { engine, audio, player } = setup({}, 6);
    await player.play();
    await until(() => audio.played.length === 1);
    await until(() => player.ready.size === 5);
    audio.end(); // 2º segmento: unidades 2..6
    await until(() => audio.played.length === 2);
    player.configure({ speed: 1.5 });
    await until(() => audio.played.length === 3, 3000); // o corte acontece no fim da unidade 2 (~0,45 s)
    const last = engine.calls.synth[engine.calls.synth.length - 1];
    expect(last.speed).toBe(1.5);
    expect(player.index).toBe(2); // continua do trecho seguinte (a 3ª frase)
    expect(player.seg.offsets[0].unit).toBe(2);
  });

  it('trocar velocidade antes do próximo segmento descarta o que estava pronto', async () => {
    const { engine, audio, player } = setup({}, 6);
    await player.play();
    await until(() => engine.calls.synth.length === 6);
    player.configure({ speed: 1.25 });
    expect(player.ready.size).toBe(0);
    await until(() => engine.calls.synth.filter((c) => c.speed === 1.25).length >= 1);
    audio.end();
    await until(() => audio.played.length === 2);
  });

  it('trocar de voz recarrega o motor', async () => {
    const { engine, audio, player } = setup();
    await player.play();
    await until(() => audio.played.length === 1);
    player.configure({ voiceId: 'fake:m' });
    audio.end();
    await until(() => audio.played.length === 2);
    expect(engine.calls.load).toEqual(['fake:f', 'fake:m']);
    expect(engine.calls.synth.at(-1).voiceId).toBe('fake:m');
  });

  it('passa passos e normaliza números para a fala', async () => {
    const { engine, audio, player } = setup();
    player.setChunks([{ text: 'Tenho 3 gatos.', endsParagraph: true, paragraph: 0 }]);
    player.configure({ steps: 7 });
    await player.play();
    await until(() => audio.played.length === 1);
    expect(engine.calls.synth[0]).toMatchObject({ text: 'Tenho três gatos.', steps: 7 });
  });

  it('erro ao preparar à frente não derruba o que está tocando; aparece quando o próximo seria necessário', async () => {
    const { player, audio } = setup({ failOn: 'dois' });
    const errors = [];
    player.on('error', (e) => errors.push(e.message));
    await player.play();
    await until(() => audio.played.length === 1);
    await tick(30);
    expect(errors).toEqual([]);
    expect(player.state).toBe('playing');
    audio.end();
    await until(() => errors.length === 1);
    expect(errors[0]).toBe('falha simulada');
    expect(player.state).toBe('error');
  });

  it('erro na primeira síntese vai direto ao estado de erro', async () => {
    const { player } = setup({ failOn: 'um.' });
    const errors = [];
    player.on('error', (e) => errors.push(e.message));
    await player.play();
    await until(() => errors.length === 1);
    expect(player.state).toBe('error');
  });

  it('pré-carga e ▶ simultâneos carregam a voz uma só vez', async () => {
    const { engine, audio, player } = setup({ loadDelay: 40 });
    const pre = player.preload();
    await player.play();
    await pre;
    await until(() => audio.played.length === 1);
    expect(engine.calls.load).toEqual(['fake:f']);
    expect(player.metrics.load.ms).toBeGreaterThanOrEqual(0);
    await drain(audio, player);
    expect(engine.calls.load.length).toBe(1);
  });

  it('com a voz já pré-carregada, o ▶ só espera a síntese', async () => {
    const { engine, audio, player } = setup({ loadDelay: 60 }, 2);
    await player.preload();
    const t0 = Date.now();
    await player.play();
    await until(() => audio.played.length === 1);
    expect(Date.now() - t0).toBeLessThan(40);
    expect(engine.calls.load.length).toBe(1);
  });

  it('trechos sem nada falável não chamam o motor e viram um silêncio audível (nunca um WAV vazio)', async () => {
    const { engine, audio, player, wavs } = setup({}, 1);
    player.configure({ sentencePause: 0 });
    player.setChunks([{ text: '* * *', endsParagraph: false, paragraph: 0 }, { text: '😀', endsParagraph: false, paragraph: 0 }, { text: 'Fim.', endsParagraph: true, paragraph: 0 }]);
    await player.play();
    await until(() => audio.played.length === 1);
    await drain(audio, player);
    expect(engine.calls.synth.map((c) => c.text)).toEqual(['Fim.']);
    // o 1º áudio é só a unidade muda: ≥ 0,25 s a 22,05 kHz, 16 bits
    expect(wavs[0].length).toBeGreaterThanOrEqual(44 + Math.round(0.25 * 22050) * 2);
    expect(player.state).toBe('ended');
  });

  it('emite "slow" uma vez quando a síntese é mais lenta que a fala', () => {
    const { player } = setup();
    const events = [];
    player.on('slow', (e) => events.push(e));
    player._recordSynth(4000, 3, 'fake:f'); // rtf 1,33
    expect(events.length).toBe(0); // precisa de 2 amostras
    player._recordSynth(4200, 3, 'fake:f');
    player._recordSynth(4200, 3, 'fake:f');
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ voiceId: 'fake:f', steps: 5 });
    expect(events[0].rtf).toBeGreaterThan(1.3);
  });

  it('não emite "slow" para voz rápida', () => {
    const { player } = setup();
    const events = [];
    player.on('slow', (e) => events.push(e));
    for (let i = 0; i < 4; i++) player._recordSynth(1000, 3, 'fake:f');
    expect(events.length).toBe(0);
  });
});

describe('Player: tela bloqueada (silêncio de manutenção) e posição', () => {
  it('quando o próximo áudio ainda não ficou pronto, toca um silêncio em loop e o desliga ao voltar a falar', async () => {
    const { audio, player } = setup({ delay: 80 }, 3, { keepAlive: true });
    await player.play();
    await until(() => audio.played.length >= 1 && player.state === 'playing');
    audio.end(); // acabou o 1º segmento, mas a unidade 2 ainda está sendo gerada
    expect(player.state).toBe('buffering');
    expect(audio.loop).toBe(true);
    expect(audio.src).toBe(player.silenceUrl);
    await until(() => player.state === 'playing', 3000);
    expect(audio.loop).toBe(false);
    expect(audio.src).not.toBe(player.silenceUrl);
  });

  it('sem keepAlive não toca o silêncio (padrão dos testes)', async () => {
    const { audio, player } = setup({ delay: 60 }, 3);
    await player.play();
    await until(() => player.state === 'playing');
    audio.end();
    expect(player.state).toBe('buffering');
    expect(audio.loop).toBe(false);
  });

  it('o destaque acompanha a posição do áudio dentro do segmento', async () => {
    const { audio, player } = setup({}, 4);
    const seen = [];
    player.on('index', (i) => seen.push(i));
    await player.play();
    await until(() => audio.played.length === 1);
    await until(() => player.ready.size === 3);
    audio.end();
    await until(() => audio.played.length === 2);
    expect(player.index).toBe(1);
    const offs = player.seg.offsets;
    audio.at(offs[1].start + 0.05);
    expect(player.index).toBe(2);
    audio.at(offs[2].start + 0.05);
    expect(player.index).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('com o buffer baixo, reabastece enquanto toca (timeupdate)', async () => {
    const { engine, audio, player } = setup({}, 30);
    player.configure({ bufferSec: 1 });
    await player.play();
    await until(() => audio.played.length === 1);
    await tick(40);
    const before = engine.calls.synth.length;
    audio.end();
    await until(() => audio.played.length === 2);
    audio.at(0.2); // passou tempo: o buffer ficou abaixo do alvo
    await until(() => engine.calls.synth.length > before);
    expect(engine.calls.synth.length).toBeGreaterThan(before);
  });
});

describe('Player: início rápido (trecho inicial dividido em duas unidades)', () => {
  const long = 'Uma noite destas, vindo da cidade para o Engenho Novo, encontrei num trem da Central um rapaz aqui do bairro.';
  function setupLong(opts = {}) {
    const engine = fakeEngine({});
    const audio = new FakeAudio();
    const player = new Player({ audio, resolveEngine: () => engine, createUrl: () => `blob:${Math.random()}`, revokeUrl: () => {}, ...opts });
    player.configure({ voiceId: 'fake:f' });
    player.setChunks([
      { text: long, endsParagraph: false, paragraph: 0 },
      { text: 'Segundo trecho curto.', endsParagraph: true, paragraph: 0 },
    ]);
    return { engine, audio, player };
  }

  it('sintetiza primeiro só o início; o trecho continua sendo o mesmo para a interface', async () => {
    const { engine, audio, player } = setupLong();
    const indexes = [];
    player.on('index', (i) => indexes.push(i));
    await player.play();
    await until(() => audio.played.length === 1);
    expect(engine.calls.synth[0].text).toBe('Uma noite destas, vindo da cidade para o Engenho Novo,');
    expect(player.index).toBe(0);
    await until(() => player.ready.size === 2);
    audio.end(); // 2º segmento: o resto do trecho 0 + o trecho 1
    await until(() => audio.played.length === 2);
    expect(player.index).toBe(0); // ainda o trecho 0 (segunda metade)
    audio.at(player.seg.offsets[1].start + 0.05);
    expect(player.index).toBe(1);
    audio.end();
    expect(player.state).toBe('ended');
    expect(engine.calls.synth.map((c) => c.text)).toEqual([
      'Uma noite destas, vindo da cidade para o Engenho Novo,',
      'encontrei num trem da Central um rapaz aqui do bairro.',
      'Segundo trecho curto.',
    ]);
    expect(indexes).toEqual([1]); // o 0 já foi anunciado em setChunks; as duas metades do trecho 0 não geram evento repetido
  });

  it('prev em trecho dividido toca desde o início do trecho', async () => {
    const { engine, audio, player } = setupLong();
    await player.play(1);
    await until(() => audio.played.length === 1);
    player.prev();
    await until(() => audio.played.length === 2);
    expect(player.index).toBe(0);
    expect(engine.calls.synth.map((c) => c.text)).toContain('Uma noite destas, vindo da cidade para o Engenho Novo,');
  });

  it('fastStart desligado mantém uma unidade por trecho', async () => {
    const { engine, audio, player } = setupLong({ fastStart: false });
    await player.play();
    await until(() => audio.played.length === 1);
    expect(engine.calls.synth[0].text).toBe(long);
  });
});
