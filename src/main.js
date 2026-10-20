import './style.css';
import { registerDefaultEngines } from './lib/engines/default.js';
import { engineForVoice, voiceMeta, cachedMapAll } from './lib/engines/registry.js';
import { DEFAULT_VOICE_ID, voiceBytes } from './lib/engines/voices.js';
import { Player } from './lib/player.js';
import { cleanText } from './lib/normalize.js';
import { splitIntoChunks } from './lib/split.js';
import { extractDocument } from './lib/parsers/index.js';
import { loadSettings, saveSettings, saveDoc, getDoc, listDocs, deleteDoc, docId } from './lib/storage.js';
import { initVoicesUI } from './ui/voices-ui.js';

registerDefaultEngines();

const $ = (id) => document.getElementById(id);
const MAX_CHUNK = 220;
let settings = loadSettings();
if (!voiceMeta(settings.voiceId)) settings.voiceId = DEFAULT_VOICE_ID;
let doc = null; // { id, title, text, chunks, pos }

const audio = $('audio');
const player = new Player({ audio, resolveEngine: (id) => engineForVoice(id), unlockAudio: true });

// ---------- utilidades ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 8000);
}
const persist = () => saveSettings(settings);

function applyAppearance() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty('--font-size', `${settings.fontSize}px`);
}

function syncPlayerSettings() {
  player.configure({
    voiceId: settings.voiceId, speed: settings.speed, steps: settings.steps,
    sentencePause: settings.sentencePause, paragraphPause: settings.paragraphPause,
  });
  $('speed').value = String(settings.speed);
  const v = voiceMeta(settings.voiceId);
  $('btn-voice').textContent = v ? `🔊 ${v.name}` : 'Escolher voz';
}

// ---------- documento ----------
function renderReader() {
  const box = $('text');
  box.replaceChildren();
  let current = -1;
  let p = null;
  doc.chunks.forEach((c, i) => {
    if (c.paragraph !== current) { current = c.paragraph; p = document.createElement('p'); box.append(p); }
    const span = document.createElement('span');
    span.className = 'chunk';
    span.dataset.i = String(i);
    span.textContent = `${c.text} `;
    p.append(span);
  });
  $('doc-title').textContent = doc.title;
}

function showReader(show) {
  $('home').hidden = show;
  $('reader').hidden = !show;
  $('bar').hidden = !show;
}

async function openText(title, text, pos = 0) {
  player.stop();
  const id = docId(title, text);
  const saved = await getDoc(id).catch(() => null);
  const chunks = splitIntoChunks(text, { maxLen: MAX_CHUNK });
  if (!chunks.length) { toast('Não há texto para ler.'); return; }
  doc = { id, title, text, chunks, pos: saved?.pos ?? pos };
  renderReader();
  showReader(true);
  player.setChunks(chunks, doc.pos);
  await saveDoc({ id, title, text, pos: doc.pos, total: chunks.length, updated: Date.now() }).catch(() => {});
  highlight(doc.pos, false);
  setStatus('Pronto. Toque em ▶ ou em qualquer trecho para começar.');
  window.scrollTo(0, 0);
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  return pdfjs;
}

async function openFile(file) {
  try {
    setStatus(`Lendo ${file.name}…`);
    $('bar').hidden = false;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const deps = /\.pdf$/i.test(file.name)
      ? { pdfjs: await loadPdfjs(), onProgress: (i, n) => setStatus(`Lendo o PDF… página ${i} de ${n}`) }
      : {};
    const { title, text } = await extractDocument({ name: file.name, bytes }, deps);
    await openText(title, text);
  } catch (e) {
    console.error(e);
    toast(`Não consegui abrir "${file.name}": ${e.message}`);
    if (!doc) $('bar').hidden = true;
  }
}

// ---------- destaque e estado ----------
function highlight(i, scroll = true) {
  $('text').querySelector('.chunk.active')?.classList.remove('active');
  const span = $('text').querySelector(`.chunk[data-i="${i}"]`);
  span?.classList.add('active');
  if (span && scroll) span.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const total = doc?.chunks.length ?? 1;
  $('progress-fill').style.width = `${((i + 1) / total) * 100}%`;
}

function setStatus(msg, error = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('error', error);
}

let lastProgress = null;
function updateStatus() {
  const n = doc?.chunks.length ?? 0;
  const pos = `Trecho ${player.index + 1} de ${n}`;
  if (player.state === 'error') return;
  if (lastProgress?.phase === 'baixando') setStatus(`Baixando a voz… ${Math.round((lastProgress.fraction ?? 0) * 100)}%`);
  else if (lastProgress?.phase === 'preparando') setStatus('Preparando a voz (pode levar alguns segundos)…');
  else if (player.state === 'loading') setStatus('Carregando a voz…');
  else if (player.state === 'buffering') setStatus(`Gerando o áudio… (${pos})`);
  else if (player.state === 'playing') setStatus(pos);
  else if (player.state === 'paused') setStatus(`Pausado · ${pos}`);
  else if (player.state === 'ended') setStatus('Fim da leitura.');
}

player.on('index', (i) => {
  highlight(i, player.state !== 'idle');
  if (doc) {
    doc.pos = i;
    clearTimeout(persist.t);
    persist.t = setTimeout(() => saveDoc({ id: doc.id, title: doc.title, text: doc.text, pos: i, total: doc.chunks.length, updated: Date.now() }).catch(() => {}), 800);
  }
  updateStatus();
});
player.on('progress', (p) => { lastProgress = p; updateStatus(); });
player.on('state', (s) => {
  if (s !== 'loading') lastProgress = s === 'buffering' || s === 'playing' ? null : lastProgress;
  const playing = s === 'playing';
  const btn = $('btn-play');
  btn.textContent = playing || s === 'buffering' || s === 'loading' ? '⏸' : '▶';
  btn.setAttribute('aria-label', playing || s === 'buffering' || s === 'loading' ? 'Pausar' : 'Ler');
  updateStatus();
  updateMediaSession();
});
player.on('error', (e) => {
  console.error(e);
  setStatus(`Erro: ${e.message}`, true);
  toast(`Erro na leitura: ${e.message}`);
});

// ---------- ações ----------
async function ensureVoiceReady() {
  const voice = voiceMeta(settings.voiceId);
  if (!voice) return false;
  const cached = await cachedMapAll().catch(() => ({}));
  if (cached[voice.id]) return true;
  const mb = Math.round(voiceBytes(voice) / 1e6);
  return window.confirm(`A voz "${voice.name}" precisa baixar ${mb} MB uma única vez. Depois funciona sem internet. Continuar?`);
}

async function togglePlay() {
  if (!doc) return;
  if (['playing', 'buffering', 'loading'].includes(player.state)) { player.pause(); return; }
  player.unlockAudio && player._unlock(); // dentro do toque do usuário, antes de qualquer espera
  if (!(await ensureVoiceReady())) return;
  syncPlayerSettings();
  await player.play();
}

$('btn-play').addEventListener('click', togglePlay);
$('btn-prev').addEventListener('click', () => player.prev());
$('btn-next').addEventListener('click', () => player.next());
$('speed').addEventListener('change', (e) => { settings.speed = Number(e.target.value); persist(); syncPlayerSettings(); syncSettingsForm(); });
$('text').addEventListener('click', async (e) => {
  const span = e.target.closest?.('.chunk');
  if (!span) return;
  player._unlock();
  if (!(await ensureVoiceReady())) return;
  syncPlayerSettings();
  await player.play(Number(span.dataset.i));
});
$('btn-close').addEventListener('click', () => { player.stop(); doc = null; showReader(false); renderRecent(); });

document.addEventListener('keydown', (e) => {
  if (!doc || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector('dialog[open]')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowRight') player.next();
  else if (e.code === 'ArrowLeft') player.prev();
});

// ---------- abrir arquivo / colar ----------
const fileInput = $('file');
$('btn-open').addEventListener('click', () => fileInput.click());
$('drop').addEventListener('click', () => fileInput.click());
$('drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) openFile(f); });
for (const ev of ['dragenter', 'dragover']) window.addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('over'); });
for (const ev of ['dragleave', 'drop']) window.addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.remove('over'); });
window.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) openFile(f); });

$('btn-paste').addEventListener('click', () => $('dlg-paste').showModal());
$('paste-go').addEventListener('click', async () => {
  const text = $('paste-text').value.trim();
  if (!text) return;
  $('dlg-paste').close();
  
  await openText('Texto colado', cleanText(text));
});

// ---------- recentes ----------
async function renderRecent() {
  const docs = await listDocs().catch(() => []);
  $('recent-title').hidden = !docs.length;
  const ul = $('recent');
  ul.replaceChildren();
  for (const d of docs.slice(0, 20)) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'open';
    const pct = d.total ? Math.round(((d.pos + 1) / d.total) * 100) : 0;
    open.innerHTML = '<b></b><small></small>';
    open.firstChild.textContent = d.title;
    open.lastChild.textContent = `${pct}% lido · ${new Date(d.updated).toLocaleDateString('pt-BR')}`;
    open.addEventListener('click', () => openText(d.title, d.text, d.pos));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost';
    del.textContent = 'Excluir';
    del.setAttribute('aria-label', `Excluir ${d.title}`);
    del.addEventListener('click', async () => { await deleteDoc(d.id); renderRecent(); });
    li.append(open, del);
    ul.append(li);
  }
}

// ---------- configurações / vozes ----------
const voicesUI = initVoicesUI({
  container: $('voices'),
  getSettings: () => settings,
  onSelect: (id) => { settings.voiceId = id; persist(); syncPlayerSettings(); },
  onEngineTouched: () => player.invalidateLoaded(),
  onPause: () => player.pause(),
  toast,
});

const bindings = [
  ['set-speed', 'out-speed', 'speed', (v) => `${v.toFixed(2).replace('.', ',')}×`],
  ['set-sp', 'out-sp', 'sentencePause', (v) => `${v.toFixed(2).replace('.', ',')} s`],
  ['set-pp', 'out-pp', 'paragraphPause', (v) => `${v.toFixed(1).replace('.', ',')} s`],
  ['set-steps', 'out-steps', 'steps', (v) => `${v} passos`],
  ['set-font', 'out-font', 'fontSize', (v) => `${v} px`],
];
function syncSettingsForm() {
  for (const [inputId, outId, key, fmt] of bindings) { $(inputId).value = settings[key]; $(outId).textContent = fmt(Number(settings[key])); }
  $('set-theme').value = settings.theme;
}
for (const [inputId, , key] of bindings) {
  $(inputId).addEventListener('input', (e) => { settings[key] = Number(e.target.value); persist(); applyAppearance(); syncPlayerSettings(); syncSettingsForm(); });
}
$('set-theme').addEventListener('change', (e) => { settings.theme = e.target.value; persist(); applyAppearance(); });

const dlg = $('dlg-settings');
async function openSettings() { syncSettingsForm(); voicesUI.render(); dlg.showModal(); await voicesUI.refresh(); }
$('btn-settings').addEventListener('click', openSettings);
$('btn-voice').addEventListener('click', openSettings);
dlg.addEventListener('close', () => voicesUI.stopPreview());

// ---------- Media Session (controles na tela de bloqueio) ----------
function updateMediaSession() {
  if (!('mediaSession' in navigator) || !doc) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: doc.title, artist: 'Leitor' });
  navigator.mediaSession.playbackState = player.state === 'playing' ? 'playing' : 'paused';
}
if ('mediaSession' in navigator) {
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* ação não suportada */ } };
  set('play', () => togglePlay());
  set('pause', () => player.pause());
  set('previoustrack', () => player.prev());
  set('nexttrack', () => player.next());
}

// ---------- início ----------
applyAppearance();
syncPlayerSettings();
renderRecent();
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker não registrado:', e));
}
// gancho para testes de ponta a ponta
if (typeof window !== 'undefined') window.__leitor = { player, get settings() { return settings; }, openText };
