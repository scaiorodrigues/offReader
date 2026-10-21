// Player: transforma trechos de texto em áudio, um à frente do outro, usando QUALQUER motor da interface comum.
// Usa um <audio> (não Web Audio) por ser mais confiável em celulares com a tela bloqueada.
//
// "Trecho" (chunk) é o que a interface mostra e destaca. Internamente o player toca "unidades": normalmente 1 por trecho,
// mas o trecho em que a leitura COMEÇA é dividido em duas (início curto + resto) para o primeiro som sair mais cedo.
import { prepareForSpeech, isPronounceable } from './normalize.js';
import { splitHead } from './split.js';
import { pcmToWav } from './wav.js';

export const LOOKAHEAD = 2;
const MIN_UNIT_SEC = 0.25; // unidades mudas/vazias nunca viram um WAV de 0 s (alguns navegadores dão erro)
const HEAD_PAUSE = 0.1; // pausa curta entre o início e o resto de um trecho dividido
const SLOW_RTF = 1.15; // síntese mais lenta que a fala (tempo de síntese / duração do áudio)

export class Player {
  /**
   * @param {object} deps
   * @param {HTMLAudioElement} deps.audio
   * @param {(voiceId:string)=>object} deps.resolveEngine  devolve o motor da voz (interface comum)
   * @param {(wav:Uint8Array)=>string} [deps.createUrl]
   * @param {(url:string)=>void} [deps.revokeUrl]
   * @param {boolean} [deps.fastStart]  dividir o trecho inicial em duas unidades (padrão: sim)
   */
  constructor({ audio, resolveEngine, createUrl, revokeUrl, unlockAudio = false, fastStart = true }) {
    this.unlockAudio = unlockAudio;
    this.fastStart = fastStart;
    this.audio = audio;
    this.resolveEngine = resolveEngine;
    this.createUrl = createUrl ?? ((wav) => URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
    this.revokeUrl = revokeUrl ?? ((u) => URL.revokeObjectURL(u));
    this.chunks = [];
    this.units = [];
    this.ui = 0; // índice da unidade atual
    this.state = 'idle'; // idle | loading | buffering | playing | paused | ended | error
    this.settings = { voiceId: null, speed: 1, steps: 5, sentencePause: 0.35, paragraphPause: 0.8 };
    this.listeners = { state: [], index: [], progress: [], error: [], slow: [] };
    this.ready = new Map(); // unidade -> url
    this.gen = 0;
    this.pumping = false;
    this.loadedKey = null;
    this.loading = null;
    this.metrics = { load: null, synth: [] };
    this.waitingFor = null; // unidade que estamos esperando ficar pronta para tocar
    this.lastEmitted = -1;
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('error', () => { if (this.audio.src) this._fail(new Error('Falha ao tocar o áudio.')); });
  }

  /** Índice do TRECHO atual (o que a interface destaca). */
  get index() { return this.units[this.ui]?.chunk ?? 0; }

  on(event, fn) { this.listeners[event].push(fn); return () => { this.listeners[event] = this.listeners[event].filter((f) => f !== fn); }; }
  _emit(event, ...args) { for (const fn of this.listeners[event]) fn(...args); }
  _setState(s) { if (this.state !== s) { this.state = s; this._emit('state', s); } }
  _fail(err) { this._setState('error'); this._emit('error', err); }
  _emitIndex() { if (this.index !== this.lastEmitted) { this.lastEmitted = this.index; this._emit('index', this.index); } }

  /** Monta as unidades; `splitAt` (índice de trecho) ganha início curto + resto quando houver um corte natural. */
  _buildUnits(splitAt = -1) {
    const units = [];
    this.chunks.forEach((c, i) => {
      const head = this.fastStart && i === splitAt ? splitHead(c.text) : null;
      if (head) {
        units.push({ chunk: i, text: head[0], pause: HEAD_PAUSE });
        units.push({ chunk: i, text: head[1], endsParagraph: c.endsParagraph });
      } else units.push({ chunk: i, text: c.text, endsParagraph: c.endsParagraph });
    });
    this.units = units;
  }
  _firstUnitOf(chunk) { return Math.max(0, this.units.findIndex((u) => u.chunk === chunk)); }

  setChunks(chunks, index = 0) {
    this.stop();
    this.chunks = chunks;
    this._buildUnits();
    this.ui = this._firstUnitOf(Math.min(Math.max(0, index), Math.max(0, chunks.length - 1)));
    this.lastEmitted = -1;
    this._emitIndex();
  }

  /** Muda voz/velocidade/passos/pausas. O que já está pronto é descartado; a unidade em curso termina normalmente. */
  configure(patch) {
    const voiceChanged = patch.voiceId !== undefined && patch.voiceId !== this.settings.voiceId;
    Object.assign(this.settings, patch);
    if (voiceChanged || ['speed', 'steps', 'sentencePause', 'paragraphPause'].some((k) => k in patch)) this._invalidateAhead();
  }

  _invalidateAhead() {
    this.gen++;
    for (const url of this.ready.values()) this.revokeUrl(url);
    this.ready.clear();
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
  invalidateLoaded() { this.loadedKey = null; this.loading = null; }

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

  _restart(chunk) {
    this._clear();
    this._buildUnits(chunk);
    this.ui = this._firstUnitOf(chunk);
    this._emitIndex();
    this._setState('loading');
    this.waitingFor = this.ui;
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
  seek(chunk) {
    if (!this.chunks.length) return;
    const target = Math.min(Math.max(0, chunk), this.chunks.length - 1);
    if (this._active() || this.state === 'ended') this._restart(target);
    else { this.ui = this._firstUnitOf(target); this._emitIndex(); }
  }

  /** Carrega a voz uma única vez, mesmo que preload() e play() peçam ao mesmo tempo. */
  _ensureLoaded() {
    const { voiceId } = this.settings;
    if (!voiceId) return Promise.reject(new Error('Nenhuma voz selecionada.'));
    if (this.loadedKey === voiceId) return Promise.resolve();
    if (this.loading?.voiceId === voiceId) return this.loading.promise;
    const engine = this.resolveEngine(voiceId);
    this._emit('progress', { phase: 'carregando', fraction: 0 });
    const t0 = performance.now();
    const promise = engine.load(voiceId, (p) => this._emit('progress', p)).then((info) => {
      this.metrics.load = { ms: Math.round(performance.now() - t0), ...(info?.timings ?? {}) };
      this.loadedKey = voiceId;
      this._emit('progress', null);
    }).finally(() => { if (this.loading?.promise === promise) this.loading = null; });
    this.loading = { voiceId, promise };
    return promise;
  }

  /** Aquece a voz em segundo plano (ex.: ao abrir um texto), para o ▶ começar sem esperar o carregamento. */
  async preload() {
    try { await this._ensureLoaded(); return true; } catch { return false; }
  }

  async _pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const gen = this.gen;
        const wanted = this._nextWanted();
        if (wanted === null) break;
        await this._ensureLoaded();
        if (gen !== this.gen) continue;
        const unit = this.units[wanted];
        const { voiceId, speed, steps, sentencePause, paragraphPause } = this.settings;
        const engine = this.resolveEngine(voiceId);
        const spoken = prepareForSpeech(unit.text);
        let pcm = new Float32Array(0);
        let sampleRate = 22050;
        if (isPronounceable(spoken)) {
          const ts = performance.now();
          ({ pcm, sampleRate } = await engine.synth(spoken, { speed, voiceId, steps }));
          this._recordSynth(performance.now() - ts, pcm.length / sampleRate, voiceId);
        }
        if (gen !== this.gen) continue; // configuração mudou enquanto sintetizava
        const pause = unit.pause ?? (unit.endsParagraph ? paragraphPause : sentencePause);
        const silence = pcm.length ? pause : Math.max(pause, MIN_UNIT_SEC);
        const url = this.createUrl(pcmToWav(pcm, sampleRate, silence));
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

  _recordSynth(ms, audioSec, voiceId) {
    const rtf = ms / 1000 / Math.max(0.01, audioSec);
    this.metrics.synth.push({ ms: Math.round(ms), audioSec: +audioSec.toFixed(2), rtf: +rtf.toFixed(2) });
    if (this.metrics.synth.length > 20) this.metrics.synth.shift();
    const recent = this.metrics.synth.slice(-3);
    const key = `${voiceId}|${this.settings.steps}`;
    if (recent.length >= 2 && audioSec >= 2 && recent.every((m) => m.rtf > SLOW_RTF) && this.slowWarned !== key) {
      this.slowWarned = key;
      this._emit('slow', { rtf: +(recent.reduce((a, m) => a + m.rtf, 0) / recent.length).toFixed(2), voiceId, steps: this.settings.steps });
    }
  }

  _nextWanted() {
    if (!this._active() && this.state !== 'loading') return null;
    // (LOOKAHEAD = quantas unidades preparar além da que está tocando ou sendo esperada)
    const playing = !!this.currentUrl;
    const start = playing ? this.ui + 1 : (this.waitingFor ?? this.ui);
    const end = Math.min(this.units.length, start + (playing ? LOOKAHEAD : 1 + LOOKAHEAD));
    for (let i = start; i < end; i++) if (!this.ready.has(i)) return i;
    return null;
  }

  _startPlayback(u) {
    const url = this.ready.get(u);
    this.ready.delete(u);
    if (this.currentUrl) this.revokeUrl(this.currentUrl);
    this.currentUrl = url;
    this.waitingFor = null;
    this.ui = u;
    this.audio.src = url;
    this._emitIndex();
    this._setState('playing');
    const started = this.audio.play();
    started?.catch?.((e) => this._fail(e));
    this._pump();
  }

  _onEnded() {
    if (this.state !== 'playing') return;
    const next = this.ui + 1;
    if (next >= this.units.length) { this._setState('ended'); return; }
    if (this.ready.has(next)) this._startPlayback(next);
    else if (this.deferredError) {
      const err = this.deferredError;
      this.deferredError = null;
      this._fail(err);
    } else {
      if (this.currentUrl) { this.revokeUrl(this.currentUrl); this.currentUrl = null; }
      this.ui = next;
      this._emitIndex();
      this.waitingFor = next;
      this._setState('buffering');
      this._pump();
    }
  }
}
