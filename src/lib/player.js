// Player: transforma trechos de texto em áudio, bem à frente do que está tocando, usando QUALQUER motor da interface comum.
//
// Vocabulário:
//  - trecho (chunk):  o que a interface mostra e destaca;
//  - unidade (unit):  o que é sintetizado — normalmente 1 por trecho; o trecho em que a leitura COMEÇA vira 2 (início curto + resto)
//                     para o primeiro som sair mais cedo;
//  - segmento:        várias unidades já prontas emendadas num único WAV (~90 s) que o <audio> toca de uma vez.
//
// Por que segmentos e um buffer por tempo (minutos à frente): com a tela bloqueada o navegador suspende a página nos instantes
// de silêncio e é fraco em trocar o `src` do <audio> no meio. Quanto mais áudio pronto e menos trocas, mais seguro.
import { prepareForSpeech, isPronounceable } from './normalize.js';
import { splitHead } from './split.js';
import { pcmToWav, floatToInt16, partsToWav } from './wav.js';

const MIN_UNIT_SEC = 0.25; // unidades mudas/vazias nunca viram um WAV de 0 s (alguns navegadores dão erro)
const HEAD_PAUSE = 0.1; // pausa curta entre o início e o resto de um trecho dividido
const SLOW_RTF = 1.15; // síntese mais lenta que a fala (tempo de síntese / duração do áudio)
export const SEGMENT_MAX_SEC = 90;
export const DEFAULT_BUFFER_SEC = 180;

export class Player {
  /**
   * @param {object} deps
   * @param {HTMLAudioElement} deps.audio
   * @param {(voiceId:string)=>object} deps.resolveEngine  devolve o motor da voz (interface comum)
   * @param {(wav:Uint8Array)=>string} [deps.createUrl]
   * @param {(url:string)=>void} [deps.revokeUrl]
   * @param {boolean} [deps.unlockAudio]  "destrava" o <audio> no 1º toque (iOS/Safari)
   * @param {boolean} [deps.keepAlive]    toca um silêncio em loop quando precisa esperar a síntese, para a sessão de áudio não ser encerrada
   * @param {boolean} [deps.fastStart]    dividir o trecho inicial em duas unidades (padrão: sim)
   */
  constructor({ audio, resolveEngine, createUrl, revokeUrl, unlockAudio = false, keepAlive = false, fastStart = true }) {
    this.unlockAudio = unlockAudio;
    this.keepAlive = keepAlive;
    this.fastStart = fastStart;
    this.audio = audio;
    this.resolveEngine = resolveEngine;
    this.createUrl = createUrl ?? ((wav) => URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
    this.revokeUrl = revokeUrl ?? ((u) => URL.revokeObjectURL(u));
    this.chunks = [];
    this.units = [];
    this.ui = 0; // índice da unidade atual
    this.state = 'idle'; // idle | loading | buffering | playing | paused | ended | error
    this.settings = { voiceId: null, speed: 1, steps: 5, sentencePause: 0.35, paragraphPause: 0.8, bufferSec: DEFAULT_BUFFER_SEC };
    this.listeners = { state: [], index: [], progress: [], error: [], slow: [], buffer: [] };
    this.ready = new Map(); // unidade -> { pcm: Int16Array, rate, silence (amostras) }, ainda não tocadas
    this.seg = null; // segmento em reprodução: { start, end, url, offsets: [{unit, start, end}], totalSec }
    this.cut = null; // corte pedido quando uma configuração muda no meio de um segmento: { unit, end }
    this.cutTimer = null;
    this.gen = 0;
    this.pumping = false;
    this.loadedKey = null;
    this.loading = null;
    this.metrics = { load: null, synth: [], segments: 0 };
    this.waitingFor = null; // unidade que estamos esperando ficar pronta para tocar
    this.lastEmitted = -1;
    this.silenceUrl = null;
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('timeupdate', () => this._onTime());
    this.audio.addEventListener('error', () => { if (this.audio.src) this._fail(new Error('Falha ao tocar o áudio.')); });
  }

  /** Índice do TRECHO atual (o que a interface destaca). */
  get index() { return this.units[this.ui]?.chunk ?? 0; }

  /** Segundos de áudio já prontos à frente do ponto de reprodução (inclui o que resta do segmento atual). */
  get bufferedSec() {
    let sec = this._playingRemaining();
    for (const e of this.ready.values()) sec += this._entrySec(e);
    return sec;
  }

  on(event, fn) { this.listeners[event].push(fn); return () => { this.listeners[event] = this.listeners[event].filter((f) => f !== fn); }; }
  _emit(event, ...args) { for (const fn of this.listeners[event]) fn(...args); }
  _setState(s) { if (this.state !== s) { this.state = s; this._emit('state', s); } }
  _fail(err) { this._stopKeepAlive(); this._setState('error'); this._emit('error', err); }
  _emitIndex() { if (this.index !== this.lastEmitted) { this.lastEmitted = this.index; this._emit('index', this.index); } }
  _entrySec(e) { return (e.pcm.length + e.silence) / e.rate; }
  _playingRemaining() {
    if (!this.seg) return 0;
    const end = this.cut ? this.cut.end : this.seg.totalSec;
    return Math.max(0, end - (this.audio.currentTime || 0));
  }

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

  /**
   * Muda voz/velocidade/passos/pausas/buffer. O que já está pronto é descartado; a unidade em curso termina normalmente
   * (o segmento é cortado no fim dela) e o resto é gerado de novo com a configuração nova.
   */
  configure(patch) {
    const voiceChanged = patch.voiceId !== undefined && patch.voiceId !== this.settings.voiceId;
    Object.assign(this.settings, patch);
    if (voiceChanged || ['speed', 'steps', 'sentencePause', 'paragraphPause'].some((k) => k in patch)) this._invalidateAhead();
    else if ('bufferSec' in patch && this._active()) this._pump();
  }

  _invalidateAhead() {
    this.gen++;
    this.ready.clear();
    this._scheduleCut();
    if (this._active()) this._pump();
  }

  _active() { return ['loading', 'buffering', 'playing', 'paused'].includes(this.state); }

  /** Cortar o segmento em reprodução no fim da unidade atual (as demais, já emendadas, usam a configuração antiga). */
  _scheduleCut() {
    if (!this.seg) return;
    const ct = this.audio.currentTime || 0;
    const cur = this.seg.offsets.find((o) => ct < o.end) ?? this.seg.offsets[this.seg.offsets.length - 1];
    if (cur.unit === this.seg.end) { this.cut = null; return; } // já é a última: nada a cortar
    this.cut = { unit: cur.unit, end: cur.end };
    clearTimeout(this.cutTimer);
    if (this.state === 'playing') this.cutTimer = setTimeout(() => this._doCut(), Math.max(0, (cur.end - ct) * 1000 - 20));
  }

  _doCut() {
    clearTimeout(this.cutTimer);
    if (!this.cut || !this.seg || this.state !== 'playing') return;
    const { unit } = this.cut;
    this.cut = null;
    this.audio.pause();
    this._finishSegment(unit + 1);
  }

  /** iOS/Safari só deixam tocar de forma assíncrona se o <audio> foi "destravado" dentro de um toque do usuário. */
  _unlock() {
    if (!this.unlockAudio || this._unlocked) return;
    this._unlocked = true;
    this.audio.src = this._silence();
    this.audio.play?.().catch?.(() => {});
  }

  _silence() { return (this.silenceUrl ??= this.createUrl(pcmToWav(new Float32Array(800), 8000, 1))); }

  /** Enquanto espera a síntese, mantém um silêncio em loop: a sessão de áudio (e a página) continuam vivas com a tela bloqueada. */
  _startKeepAlive() {
    if (!this.keepAlive) return;
    this.audio.loop = true;
    this.audio.src = this._silence();
    this.audio.play?.().catch?.(() => {});
  }
  _stopKeepAlive() { this.audio.loop = false; }

  /** Chame depois que outro código trocou a voz carregada no motor (p.ex. a prévia). */
  invalidateLoaded() { this.loadedKey = null; this.loading = null; }

  async play(from = this.index) {
    if (!this.chunks.length) return;
    this._unlock();
    if (this.state === 'paused' && from === this.index && this.seg) {
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
    else if (this.state === 'buffering' || this.state === 'loading') { this.audio.pause(); this._setState('paused'); this.waitingFor = null; }
  }

  stop() {
    this._clear();
    this._setState('idle');
  }

  _clear() {
    this.gen++;
    this.deferredError = null;
    this.waitingFor = null;
    this.cut = null;
    clearTimeout(this.cutTimer);
    this._stopKeepAlive();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.ready.clear();
    if (this.seg) { this.revokeUrl(this.seg.url); this.seg = null; }
  }

  next() { this.seek(this.index + 1); }
  prev() { this.seek(this.index - 1); }
  seek(chunk) {
    if (!this.chunks.length) return;
    const target = Math.min(Math.max(0, chunk), this.chunks.length - 1);
    if (!this._active() && this.state !== 'ended') { this.ui = this._firstUnitOf(target); this._emitIndex(); return; }
    // pular para frente dentro do que já está pronto aproveita o buffer em vez de gerar tudo de novo
    const u = this._firstUnitOf(target);
    if (this.seg && this.ready.has(u) && u > this.seg.end) {
      for (const k of [...this.ready.keys()]) if (k < u) this.ready.delete(k);
      this.cut = null;
      clearTimeout(this.cutTimer);
      this._startPlayback(u);
      return;
    }
    this._restart(target);
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
        let rate = 22050;
        if (isPronounceable(spoken)) {
          const ts = performance.now();
          const out = await engine.synth(spoken, { speed, voiceId, steps });
          pcm = out.pcm;
          rate = out.sampleRate;
          this._recordSynth(performance.now() - ts, pcm.length / rate, voiceId);
        }
        if (gen !== this.gen) continue; // configuração mudou enquanto sintetizava
        const pause = unit.pause ?? (unit.endsParagraph ? paragraphPause : sentencePause);
        const silenceSec = pcm.length ? pause : Math.max(pause, MIN_UNIT_SEC);
        this.ready.set(wanted, { pcm: floatToInt16(pcm), rate, silence: Math.round(silenceSec * rate) });
        this._emit('buffer', this.bufferedSec);
        if (this.waitingFor === wanted) this._startPlayback(wanted);
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
      // erro ao preparar à frente: deixa o que está tocando terminar e avisa quando o próximo seria necessário
      if (this.seg && this.state === 'playing') this.deferredError = e;
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

  /** Próxima unidade a sintetizar: a primeira que falta, enquanto o áudio pronto à frente for menor que o alvo. */
  _nextWanted() {
    if (!this._active()) return null;
    const target = this.settings.bufferSec;
    const start = this.seg ? (this.cut ? this.cut.unit : this.seg.end) + 1 : (this.waitingFor ?? this.ui);
    let sec = this._playingRemaining();
    for (let i = start; i < this.units.length; i++) {
      const e = this.ready.get(i);
      if (!e) return sec < target || !this.seg ? i : null;
      sec += this._entrySec(e);
    }
    return null;
  }

  /** Emenda a unidade `u` e as seguintes que já estão prontas (até SEGMENT_MAX_SEC) e começa a tocar. */
  _startPlayback(u) {
    const parts = [];
    const offsets = [];
    let t = 0;
    let rate = null;
    let i = u;
    while (i < this.units.length && this.ready.has(i) && (parts.length === 0 || t < SEGMENT_MAX_SEC)) {
      const e = this.ready.get(i);
      if (rate !== null && e.rate !== rate) break;
      rate = e.rate;
      const dur = this._entrySec(e);
      offsets.push({ unit: i, start: t, end: t + dur });
      parts.push(e);
      this.ready.delete(i);
      t += dur;
      i++;
    }
    const url = this.createUrl(partsToWav(parts, rate));
    if (this.seg) this.revokeUrl(this.seg.url);
    this.seg = { start: u, end: i - 1, url, offsets, totalSec: t };
    this.metrics.segments++;
    this.cut = null;
    clearTimeout(this.cutTimer);
    this.waitingFor = null;
    this.ui = u;
    this._stopKeepAlive();
    this.audio.src = url;
    this._emitIndex();
    this._setState('playing');
    const started = this.audio.play();
    started?.catch?.((e) => this._fail(e));
    this._pump();
  }

  /** O <audio> avisa a posição ~4×/s: atualiza o trecho destacado e repõe o buffer que foi sendo consumido. */
  _onTime() {
    if (!this.seg || this.state !== 'playing') return;
    const ct = this.audio.currentTime || 0;
    if (this.cut && ct >= this.cut.end - 0.03) { this._doCut(); return; }
    const cur = this.seg.offsets.find((o) => ct < o.end) ?? this.seg.offsets[this.seg.offsets.length - 1];
    if (cur.unit !== this.ui) { this.ui = cur.unit; this._emitIndex(); }
    if (!this.pumping) this._pump();
  }

  _onEnded() {
    if (this.state !== 'playing' || !this.seg) return;
    this._finishSegment(this.seg.end + 1);
  }

  _finishSegment(next) {
    if (next >= this.units.length) {
      this.ui = this.units.length - 1;
      this._emitIndex();
      this._setState('ended');
      return;
    }
    if (this.ready.has(next)) { this._startPlayback(next); return; }
    if (this.deferredError) {
      const err = this.deferredError;
      this.deferredError = null;
      this._fail(err);
      return;
    }
    if (this.seg) { this.revokeUrl(this.seg.url); this.seg = null; }
    this.ui = next;
    this._emitIndex();
    this.waitingFor = next;
    this._setState('buffering');
    this._startKeepAlive();
    this._pump();
  }
}
