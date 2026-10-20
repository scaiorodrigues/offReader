// Lista de vozes (Femininas / Masculinas) com motor, estado do download, prévia, baixar/remover.
import { allVoices, engineForVoice, cachedMapAll } from '../lib/engines/registry.js';
import { GENDER_LABEL, ENGINE_LABEL, PREVIEW_TEXT, voiceBytes } from '../lib/engines/voices.js';
import { pcmToWav } from '../lib/wav.js';

const fmtSize = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${Math.round(bytes / 1e6)} MB`);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
};

export function initVoicesUI({ container, getSettings, onSelect, onEngineTouched, onPause, toast }) {
  let cached = {};
  const busy = new Map(); // voiceId -> { fraction, label }
  const previewAudio = new Audio();
  let previewUrl = null;

  const stopPreview = () => {
    previewAudio.pause();
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  };

  async function refresh() {
    try { cached = await cachedMapAll(); } catch { cached = {}; }
    render();
  }

  const setBusy = (id, patch) => { if (patch) busy.set(id, { ...busy.get(id), ...patch }); else busy.delete(id); render(); };

  async function download(voice) {
    const engine = engineForVoice(voice.id);
    setBusy(voice.id, { fraction: 0, label: 'Baixando…' });
    try {
      await (engine.download ?? engine.load).call(engine, voice.id, (p) => {
        if (p?.phase === 'preparando') setBusy(voice.id, { fraction: 1, label: 'Preparando…' });
        else if (p) setBusy(voice.id, { fraction: p.fraction ?? 0, label: `Baixando… ${Math.round((p.fraction ?? 0) * 100)}%` });
      });
      return true;
    } catch (e) {
      toast(`Não foi possível baixar a voz ${voice.name}: ${e.message}`);
      return false;
    } finally {
      setBusy(voice.id, null);
      await refresh();
    }
  }

  // Voz Supertonic com o modelo compartilhado já baixado: falta só o arquivo de estilo (~0,3 MB).
  const remainingBytes = (voice) => {
    const sharedReady = voice.sharedFiles.length > 0 && allVoices().some((v) => v.engine === voice.engine && v.id !== voice.id && cached[v.id]);
    return sharedReady ? voice.files.reduce((a, f) => a + f.bytes, 0) : voiceBytes(voice);
  };

  const confirmDownload = (voice) => window.confirm(
    `A voz "${voice.name}" (${ENGINE_LABEL[voice.engine]}) precisa baixar ${fmtSize(remainingBytes(voice))} uma única vez.`
    + ' Depois ela fica guardada e funciona sem internet. Se estiver em dados móveis, prefira o Wi-Fi. Continuar?');

  async function ensureDownloaded(voice) {
    if (cached[voice.id]) return true;
    if (!confirmDownload(voice)) return false;
    return download(voice);
  }

  async function use(voice) {
    if (!(await ensureDownloaded(voice))) return;
    onSelect(voice.id);
    render();
  }

  async function preview(voice) {
    onPause?.();
    stopPreview();
    if (!(await ensureDownloaded(voice))) return;
    const engine = engineForVoice(voice.id);
    const s = getSettings();
    setBusy(voice.id, { fraction: 0, label: 'Preparando a prévia…' });
    try {
      await engine.load(voice.id, (p) => { if (p?.phase === 'baixando') setBusy(voice.id, { fraction: p.fraction, label: 'Preparando a prévia…' }); });
      onEngineTouched?.();
      const { pcm, sampleRate } = await engine.synth(PREVIEW_TEXT, { speed: s.speed, voiceId: voice.id, steps: s.steps });
      previewUrl = URL.createObjectURL(new Blob([pcmToWav(pcm, sampleRate, 0.2)], { type: 'audio/wav' }));
      previewAudio.src = previewUrl;
      await previewAudio.play();
    } catch (e) {
      toast(`Falha na prévia da voz ${voice.name}: ${e.message}`);
    } finally {
      setBusy(voice.id, null);
    }
  }

  async function remove(voice) {
    if (!window.confirm(`Remover a voz "${voice.name}" do aparelho? Para usá-la de novo será preciso baixar outra vez.`)) return;
    await engineForVoice(voice.id).remove(voice.id);
    await refresh();
  }

  function row(voice) {
    const selected = getSettings().voiceId === voice.id;
    const b = busy.get(voice.id);
    const isCached = !!cached[voice.id];
    const need = remainingBytes(voice);
    const sharedNote = voice.sharedFiles.length && need === voiceBytes(voice) ? ' (o modelo é compartilhado: as outras vozes Supertonic custam quase nada depois)' : '';
    const actions = el('div', { className: 'actions' },
      el('button', { type: 'button', className: selected ? '' : 'primary', disabled: selected || !!b, textContent: selected ? 'Em uso' : 'Usar esta voz', onclick: () => use(voice) }),
      el('button', { type: 'button', disabled: !!b, textContent: '▶ Ouvir prévia', onclick: () => preview(voice) }),
      isCached
        ? el('button', { type: 'button', className: 'ghost', disabled: !!b || selected, title: selected ? 'Troque de voz antes de remover' : '', textContent: 'Remover', onclick: () => remove(voice) })
        : el('button', { type: 'button', className: 'ghost', disabled: !!b, textContent: `Baixar (${fmtSize(need)})`, onclick: async () => { if (confirmDownload(voice)) await download(voice); } }));
    return el('div', { className: `voice${selected ? ' selected' : ''}` },
      el('div', { className: 'meta' },
        el('strong', { textContent: voice.name }),
        el('span', { className: 'badge', textContent: ENGINE_LABEL[voice.engine] }),
        el('span', { className: isCached ? 'st-ok' : 'st-no', textContent: isCached ? '✓ Baixada' : `Não baixada · ${fmtSize(need)}${sharedNote}` })),
      actions,
      b ? el('div', { className: 'bar-dl' }, el('i', { style: `width:${Math.round((b.fraction ?? 0) * 100)}%` })) : null,
      b ? el('div', { className: 'msg', textContent: b.label }) : null);
  }

  function render() {
    container.replaceChildren();
    const voices = allVoices();
    for (const gender of ['feminina', 'masculina']) {
      const list = voices.filter((v) => v.gender === gender);
      if (!list.length) continue;
      container.append(el('section', { className: 'group' }, el('h4', { textContent: GENDER_LABEL[gender] }), list.map(row)));
    }
  }

  return { refresh, render, stopPreview };
}
