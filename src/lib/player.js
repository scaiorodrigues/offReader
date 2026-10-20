// Player: transforma trechos de texto em áudio, um à frente do outro, usando QUALQUER motor da interface comum.
// Usa um <audio> (não Web Audio) por ser mais confiável em celulares com a tela bloqueada.
import { prepareForSpeech } from './normalize.js';
import { pcmToWav } from './wav.js';

export const LOOKAHEAD = 2;

export class Player {
  /**
   * @param {object} deps
   * @param {HTMLAudioElement} deps.audio
   * @param {(voiceId:string)=>object} deps.resolveEngine  devolve o motor da voz (interface comum)
   * @param {(wav:Uint8Array)=>string} [deps.createUrl]
   * @param {(url:string)=>void} [deps.revokeUrl]
   */
  constructor({ audio, resolveEngine, createUrl, revokeUrl, unlockAudio = false }) {
    this.unlockAudio = unlockAudio;
    this.audio = audio;
    this.resolveEngine = resolveEngine;
    this.createUrl = createUrl ?? ((wav) => URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
    this.revokeUrl = revokeUrl ?? ((u) => URL.revokeObjectURL(u));
    this.chunks = [];
    this.index = 0;
    this.state = 'idle'; // idle | loading | buffering | playing | paused | ended | error
    this.settings = { voiceId: null, speed: 1, steps: 5, sentencePause: 0.35, paragraphPause: 0.8 };
    this.listeners = { state: [], index: [], progress: [], error: [] };
    this.ready = new Map();
    this.gen = 0;
    this.pumping = false;
    this.loadedKey = null;
    this.waitingFor = null;
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('error', () => { if (this.audio.src) this._fail(new Error('Falha ao tocar o áudio.')); });
  }

  on(event, fn) { this.listeners[event].push(fn); return () => { this.listeners[event] = this.listeners[event].filter((f) => f !== fn); }; }
  _emit(event, ...args) { for (const fn of this.listeners[event]) fn(...args); }
  _setState(s) { if (this.state !== s) { this.state = s; this._emit('state', s); } }
  _fail(err) { this._setState('error'); this._emit('error', err); }

  setChunks(chunks, index = 0) {
    this.stop();
    this.chunks = chunks;
    this.index = Math.min(Math.max(0, index), Math.max(0, chunks.length - 1));
    this._emit('index', this.index);
  }

  /** Muda voz/velocidade/passos/pausas. O que já está pronto é descartado; o trecho em curso termina normalmente. */
  configure(patch) {
    const voiceChanged = patch.voiceId !== undefined && patch.voiceId !== this.settings.voiceId;
    Object.assign(this.settings, patch);
    if (voiceChanged || ['speed', 'steps', 'sentencePause', 'paragraphPause'].some((k) => k in patch)) this._invalidateAhead();
  }

  _invalidateAhead() {
    this.gen++;
    const playing = this.state === 'playing' || this.state === 'paused' ? this.index : -1;
    for (const [i, url] of this.ready) if (i !== playing) { this.revokeUrl(url); this.ready.delete(i); }
    if (this._active()) this._pump();
  }

  _active() { return ['loading', 'buffering', 'playing', 'paused'].includes(this.state); }

  /** iOS/Safari só deixam tocar de forma assíncrona se o <audio> foi "destravado" dentro de um toque do usuário. */
  _unlock() {
    if (!this.unlockAudio || this._unlocked) return;
    this._unlocked = true;
    this.audio.src = this.createUrl(pcmToWav(new Float32Array(800), 8000));
    this.audio.play?.().catch?.(() => {});
  }

  /** Chame depois que outro código trocou a voz carregada no motor (p.ex. a prévia). */
  invalidateLoaded() { this.loadedKey = null; }

  async play(from = this.index) {
    if (!this.chunks.length) return;
    this._unlock();
    if (this.state === 'paused' && from === this.index && this.audio.src) {
      await this.audio.play();
      this._setState('playing');
      return;
    }
    if (this.state === 'ended' && from >= this.chunks.length - 1 && from === this.index) from = 0;
    this._restart(Math.min(Math.max(0, from), this.chunks.length - 1));
  }

  _restart(index) {
    this._clear();
    this.index = index;
    this._emit('index', index);
    this._setState('loading');
    this.waitingFor = index;
    this._pump();
  }

  pause() {
    if (this.state === 'playing') { this.audio.pause(); this._setState('paused'); }
    else if (this.state === 'buffering' || this.state === 'loading') { this._setState('paused'); this.waitingFor = null; }
  }

  stop() {
    this._clear();
    this._setState('idle');
  }

  _clear() {
    this.gen++;
    this.deferredError = null;
    this.waitingFor = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    for (const url of this.ready.values()) this.revokeUrl(url);
    this.ready.clear();
    if (this.currentUrl) { this.revokeUrl(this.currentUrl); this.currentUrl = null; }
  }

  next() { this.seek(this.index + 1); }
  prev() { this.seek(this.index - 1); }
  seek(i) {
    if (!this.chunks.length) return;
    const target = Math.min(Math.max(0, i), this.chunks.length - 1);
    if (this._active() || this.state === 'ended') this._restart(target);
    else { this.index = target; this._emit('index', target); }
  }

  async _ensureLoaded(gen) {
    const { voiceId } = this.settings;
    if (!voiceId) throw new Error('Nenhuma voz selecionada.');
    if (this.loadedKey === voiceId) return;
    const engine = this.resolveEngine(voiceId);
    this._emit('progress', { phase: 'carregando', fraction: 0 });
    await engine.load(voiceId, (p) => { if (gen === this.gen) this._emit('progress', p); });
    this.loadedKey = voiceId;
    this._emit('progress', null);
  }

  async _pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const gen = this.gen;
        const wanted = this._nextWanted();
        if (wanted === null) break;
        await this._ensureLoaded(gen);
        if (gen !== this.gen) continue;
        const chunk = this.chunks[wanted];
        const { voiceId, speed, steps, sentencePause, paragraphPause } = this.settings;
        const engine = this.resolveEngine(voiceId);
        const { pcm, sampleRate } = await engine.synth(prepareForSpeech(chunk.text), { speed, voiceId, steps });
        if (gen !== this.gen) continue; // configuração mudou enquanto sintetizava
        const url = this.createUrl(pcmToWav(pcm, sampleRate, chunk.endsParagraph ? paragraphPause : sentencePause));
        this.ready.set(wanted, url);
        if (this.waitingFor === wanted) this._startPlayback(wanted);
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
      // erro ao preparar à frente: deixa o trecho atual terminar e avisa quando o próximo seria necessário
      if (this.currentUrl && this.state === 'playing') this.deferredError = e;
      else this._fail(e);
    } finally {
      this.pumping = false;
    }
  }

  _nextWanted() {
    if (!this._active() && this.state !== 'loading') return null;
    // com áudio em curso, o próximo a preparar é o seguinte; sem áudio ainda, é o trecho esperado
    // (LOOKAHEAD = quantos trechos preparar além do que está tocando ou sendo esperado)
    const playing = !!this.currentUrl;
    const start = playing ? this.index + 1 : (this.waitingFor ?? this.index);
    const end = Math.min(this.chunks.length, start + (playing ? LOOKAHEAD : 1 + LOOKAHEAD));
    for (let i = start; i < end; i++) if (!this.ready.has(i)) return i;
    return null;
  }

  _startPlayback(i) {
    const url = this.ready.get(i);
    this.ready.delete(i);
    if (this.currentUrl) this.revokeUrl(this.currentUrl);
    this.currentUrl = url;
    this.waitingFor = null;
    this.index = i;
    this.audio.src = url;
    this._emit('index', i);
    this._setState('playing');
    const started = this.audio.play();
    started?.catch?.((e) => this._fail(e));
    this._pump();
  }

  _onEnded() {
    if (this.state !== 'playing') return;
    const next = this.index + 1;
    if (next >= this.chunks.length) { this._setState('ended'); return; }
    if (this.ready.has(next)) this._startPlayback(next);
    else if (this.deferredError) {
      const err = this.deferredError;
      this.deferredError = null;
      this._fail(err);
    } else {
      if (this.currentUrl) { this.revokeUrl(this.currentUrl); this.currentUrl = null; }
      this.index = next; this._emit('index', next); this.waitingFor = next; this._setState('buffering'); this._pump();
    }
  }
}
