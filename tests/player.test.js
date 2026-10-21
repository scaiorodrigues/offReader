import { describe, it, expect } from 'vitest';
import { Player } from '../src/lib/player.js';
import { FakeAudio, fakeEngine, until } from './helpers.js';

const chunks = (n) => Array.from({ length: n }, (_, i) => ({ text: `Trecho número ${i + 1}.`, endsParagraph: i === n - 1, paragraph: 0 }));

function setup(engineOpts = {}, n = 4) {
  const engine = fakeEngine(engineOpts);
  const audio = new FakeAudio();
  const urls = new Set();
  let seq = 0;
  const player = new Player({
    audio, resolveEngine: () => engine,
    createUrl: () => { const u = `blob:${++seq}`; urls.add(u); return u; },
    revokeUrl: (u) => urls.delete(u),
  });
  player.configure({ voiceId: 'fake:f' });
  player.setChunks(chunks(n));
  return { engine, audio, player, urls };
}

describe('Player com motor falso', () => {
  it('carrega a voz uma vez, toca em sequência e termina', async () => {
    const { engine, audio, player } = setup();
    const states = [];
    player.on('state', (s) => states.push(s));
    await player.play();
    await until(() => audio.played.length === 1);
    for (let i = 1; i < 4; i++) { audio.end(); await until(() => audio.played.length === i + 1); }
    audio.end();
    expect(player.state).toBe('ended');
    expect(engine.calls.load).toEqual(['fake:f']);
    expect(engine.calls.synth.map((c) => c.text)).toEqual(['Trecho número um.', 'Trecho número dois.', 'Trecho número três.', 'Trecho número quatro.']);
    expect(states).toContain('playing');
  });

  it('prepara no máximo 2 trechos à frente e libera as URLs', async () => {
    const { engine, audio, player, urls } = setup({}, 10);
    await player.play();
    await until(() => engine.calls.synth.length === 3);
    await new Promise((r) => setTimeout(r, 30));
    expect(engine.calls.synth.length).toBe(3); // atual + 2 à frente
    player.stop();
    expect(urls.size).toBe(0);
    expect(audio.paused).toBe(true);
  });

  it('pausa e retoma sem sintetizar de novo', async () => {
    const { engine, audio, player } = setup();
    await player.play();
    await until(() => audio.played.length === 1);
    player.pause();
    expect(player.state).toBe('paused');
    expect(audio.paused).toBe(true);
    const synthCount = engine.calls.synth.length;
    await player.play();
    expect(player.state).toBe('playing');
    expect(audio.paused).toBe(false);
    expect(engine.calls.synth.length).toBeGreaterThanOrEqual(synthCount);
    expect(audio.src).toBeTruthy(); // continua no mesmo áudio, sem ressintetizar o trecho atual
    expect(engine.calls.synth.filter((c) => c.text.includes('um.')).length).toBe(1);
  });

  it('seek/next/prev reiniciam a partir do trecho pedido', async () => {
    const { engine, audio, player } = setup();
    await player.play();
    await until(() => audio.played.length === 1);
    player.next();
    await until(() => audio.played.length === 2);
    expect(player.index).toBe(1);
    player.seek(3);
    await until(() => audio.played.length === 3);
    expect(player.index).toBe(3);
    expect(engine.calls.synth.some((c) => c.text.includes('quatro'))).toBe(true);
  });

  it('trocar velocidade descarta o que estava pronto e usa a nova velocidade', async () => {
    const { engine, audio, player } = setup({}, 6);
    await player.play();
    await until(() => engine.calls.synth.length === 3);
    player.configure({ speed: 1.5 });
    audio.end();
    await until(() => audio.played.length === 2);
    const last = engine.calls.synth[engine.calls.synth.length - 1];
    expect(last.speed).toBe(1.5);
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

  it('erro ao preparar à frente não derruba o trecho atual; aparece quando o próximo seria necessário', async () => {
    const { player, audio } = setup({ failOn: 'dois' });
    const errors = [];
    player.on('error', (e) => errors.push(e.message));
    await player.play();
    await until(() => audio.played.length === 1);
    await new Promise((r) => setTimeout(r, 30));
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

  it('pré-carga e ▶ simultâneos carregam a voz uma só vez e o play começa sem novo carregamento', async () => {
    const { engine, audio, player } = setup({ loadDelay: 40 });
    const pre = player.preload();
    await player.play();
    await pre;
    await until(() => audio.played.length === 1);
    expect(engine.calls.load).toEqual(['fake:f']);
    expect(player.metrics.load.ms).toBeGreaterThanOrEqual(0);
    audio.end();
    await until(() => audio.played.length === 2);
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
    const wavs = [];
    const engine = fakeEngine({});
    const audio = new FakeAudio();
    const player = new Player({ audio, resolveEngine: () => engine, createUrl: (w) => { wavs.push(w.length); return `blob:${wavs.length}`; }, revokeUrl: () => {} });
    player.configure({ voiceId: 'fake:f', sentencePause: 0 });
    player.setChunks([{ text: '* * *', endsParagraph: false, paragraph: 0 }, { text: '😀', endsParagraph: false, paragraph: 0 }, { text: 'Fim.', endsParagraph: true, paragraph: 0 }]);
    await player.play();
    await until(() => audio.played.length === 1);
    audio.end(); await until(() => audio.played.length === 2);
    audio.end(); await until(() => audio.played.length === 3);
    expect(engine.calls.synth.map((c) => c.text)).toEqual(['Fim.']);
    expect(wavs[0]).toBeGreaterThan(44 + 2000 * 2 * 0.25 * 0.9); // ≥ 0,25 s a 22,05 kHz, 16 bits
    expect(wavs[1]).toBe(wavs[0]);
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

describe('Player: início rápido (trecho inicial dividido em duas unidades)', () => {
  const long = 'Uma noite destas, vindo da cidade para o Engenho Novo, encontrei num trem da Central um rapaz aqui do bairro.';
  function setupLong() {
    const engine = fakeEngine({});
    const audio = new FakeAudio();
    const player = new Player({ audio, resolveEngine: () => engine, createUrl: () => `blob:${Math.random()}`, revokeUrl: () => {} });
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
    audio.end(); await until(() => audio.played.length === 2);
    expect(player.index).toBe(0); // ainda o trecho 0 (segunda metade)
    audio.end(); await until(() => audio.played.length === 3);
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

  it('seek/next em trecho dividido toca desde o início do trecho', async () => {
    const { engine, audio, player } = setupLong();
    await player.play(1);
    await until(() => audio.played.length === 1);
    player.prev();
    await until(() => audio.played.length === 2);
    expect(player.index).toBe(0);
    expect(engine.calls.synth.map((c) => c.text)).toContain('Uma noite destas, vindo da cidade para o Engenho Novo,');
  });

  it('fastStart desligado mantém uma unidade por trecho', async () => {
    const engine = fakeEngine({});
    const audio = new FakeAudio();
    const player = new Player({ audio, resolveEngine: () => engine, createUrl: () => 'blob:x', revokeUrl: () => {}, fastStart: false });
    player.configure({ voiceId: 'fake:f' });
    player.setChunks([{ text: long, endsParagraph: true, paragraph: 0 }]);
    await player.play();
    await until(() => audio.played.length === 1);
    expect(engine.calls.synth[0].text).toBe(long);
  });
});
