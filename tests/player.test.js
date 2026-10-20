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
});
