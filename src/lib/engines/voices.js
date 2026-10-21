// Catálogo de vozes. Dados puros (sem I/O), usados pela interface, pelos motores e pelos testes.
// Gêneros: Supertonic segue a documentação oficial (M1–M5 masculinas, F1–F5 femininas);
// Piper pt_BR: o gênero foi informado pelo usuário (os cards do Piper não dizem) e conferido por medição de F0.

const HF = 'https://huggingface.co';

export const PIPER_REV = '5041a7a49ae5b3a0f30e6837769eb03fdbb231bd';
export const SUPERTONIC_REV = 'aafc6e32416a594460b32413efc49d7fe4ce6d46';

const piperUrl = (speaker, quality) =>
  `${HF}/rhasspy/piper-voices/resolve/${PIPER_REV}/pt/pt_BR/${speaker}/${quality}/pt_BR-${speaker}-${quality}.onnx`;

// bytes: tamanhos reais (Hugging Face), usados só para a barra de progresso e para exibir o tamanho.
const PIPER = [
  ['cadu', 'medium', 'Cadu', 62950044, 1],
  ['faber', 'medium', 'Faber', 63201294, 1],
  ['jeff', 'medium', 'Jeff', 62950044, 1],
  // ganho fixo: a Edresson sai com o pico em ~0,19 (medido), bem mais baixa que as demais.
  ['edresson', 'low', 'Edresson (qualidade menor)', 63104526, 3],
].map(([speaker, quality, name, bytes, gain]) => ({
  id: `piper:pt_BR-${speaker}-${quality}`,
  name,
  gender: 'masculina',
  engine: 'piper',
  sizeMB: Math.round(bytes / 1e6),
  gain,
  sampleRate: quality === 'low' ? 16000 : 22050,
  files: [{ url: piperUrl(speaker, quality), bytes }, { url: `${piperUrl(speaker, quality)}.json`, bytes: 6000 }],
  sharedFiles: [],
}));

const ST_BASE = `${HF}/supertone-oss-archive/supertonic-3/resolve/${SUPERTONIC_REV}`;
export const SUPERTONIC_MODEL_FILES = [
  ['duration_predictor.onnx', 3700147], ['text_encoder.onnx', 36416150],
  ['vector_estimator.onnx', 256534781], ['vocoder.onnx', 101424195],
  ['tts.json', 8253], ['unicode_indexer.json', 277676],
].map(([f, bytes]) => ({ url: `${ST_BASE}/onnx/${f}`, bytes }));
export const SUPERTONIC_MODEL_MB = Math.round(SUPERTONIC_MODEL_FILES.reduce((a, f) => a + f.bytes, 0) / 1e6);

const SUPERTONIC = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map((s) => ({
  id: `supertonic:${s}`,
  name: `${s[0] === 'F' ? 'Feminina' : 'Masculina'} ${s[1]}`,
  gender: s[0] === 'F' ? 'feminina' : 'masculina',
  engine: 'supertonic',
  gain: 1,
  style: s,
  sizeMB: SUPERTONIC_MODEL_MB,
  sampleRate: 44100,
  files: [{ url: `${ST_BASE}/voice_styles/${s}.json`, bytes: 292000 }],
  sharedFiles: SUPERTONIC_MODEL_FILES,
}));

export const VOICES = [...SUPERTONIC, ...PIPER];
export const DEFAULT_VOICE_ID = 'piper:pt_BR-cadu-medium';
export const GENDER_LABEL = { feminina: 'Femininas', masculina: 'Masculinas' };
export const ENGINE_LABEL = { piper: 'Piper', supertonic: 'Supertonic' };

export const voiceById = (id) => VOICES.find((v) => v.id === id) ?? null;
export const voiceFiles = (voice) => [...voice.sharedFiles, ...voice.files];
export const voiceUrls = (voice) => voiceFiles(voice).map((f) => f.url);
export const voiceBytes = (voice) => voiceFiles(voice).reduce((a, f) => a + f.bytes, 0);
export const PREVIEW_TEXT = 'Olá! Esta é uma prévia da minha voz em português do Brasil. Boa leitura!';
