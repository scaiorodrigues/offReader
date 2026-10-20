# CLAUDE.md — Leitor

PWA que lê TXT, MD, PDF, DOCX e EPUB em voz alta, em pt-BR, com vozes neurais **100% no navegador**.
Interface em português do Brasil. Hospedagem: Netlify (repositório conectado; cada PR gera um deploy de prévia).

## Comandos

```sh
npm ci                 # instala (inclui devDependencies: o build precisa delas)
npm test               # vitest: lógica pura, parsers, player (motor falso), cache, núcleo do Piper (~10 s, sem rede)
npm run build          # prepare-vendor + vite build -> dist/ (gera também dist/sw.js)
npm run preview        # serve dist/ (única forma de ver o service worker)
npm run dev            # Vite em modo dev (SEM service worker)
npm run e2e:files      # Chromium: abre TXT/MD/DOCX/EPUB/PDF pela interface (sem rede). Exige `npm run build` antes
npm run e2e:voices     # Chromium + modelo Piper REAL (baixa ~63 MB): toca, prévia, cache e OFFLINE
npm run e2e:voices:all # idem + Supertonic F1 (baixa ~400 MB, leva alguns minutos)
npm run verify:engines # Node + modelos reais: sintetiza com os motores e grava WAVs + estatísticas
```
Verificações de áudio fora do navegador: `scripts/f0-check.py` (altura da voz/gênero, Praat) e `scripts/asr-check.py` (Whisper → WER).
Eles medem coisas objetivas; **não avaliam qualidade/naturalidade**. Nunca afirme qualidade de áudio: você não ouve.

## Arquitetura

```
src/main.js                 controlador da UI (DOM puro). Expõe window.__leitor só para testes E2E
src/ui/voices-ui.js         lista de vozes (Femininas/Masculinas), prévia, baixar/remover
src/lib/normalize.js        cleanText (extração) e prepareForSpeech (números/abreviações -> palavras pt-BR)
src/lib/split.js            texto -> trechos (frases agrupadas até maxLen; marca fim de parágrafo)
src/lib/player.js           fila de síntese com pré-busca (2 à frente) sobre um <audio>; independe do motor
src/lib/wav.js              PCM -> WAV 16 bits (+ silêncio final = pausa) e estatísticas
src/lib/storage.js          configurações (localStorage) e documentos recentes (IndexedDB)
src/lib/parsers/            txt, md, docx (fflate), epub (fflate), pdf (pdf.js injetado); sem DOM => testável no Node
src/lib/engines/
  voices.js                 CATÁLOGO: id, nome, gênero, motor, tamanho, arquivos (URLs fixadas por revisão)
  registry.js               registro de motores (a UI só fala com isto)
  worker-engine.js          motor genérico que conversa com um worker (interface comum, ver abaixo)
  cache.js                  download com progresso + Cache Storage ("leitor-models-v1")
  rpc.js                    RPC sobre postMessage
  default.js                registra Piper e Supertonic
  piper/core.js             fonemização (espeak-ng/WASM) + VITS
  supertonic/core.js        pipeline do Supertonic 3 (duração -> texto -> N passos -> vocoder)
src/workers/*.worker.js     workers ES-module (um por motor), empacotados pelo Vite
scripts/prepare-vendor.mjs  copia ort-wasm e o fonemizador para public/vendor (gitignored, gerado em dev/build)
scripts/sw-plugin.mjs + sw-template.js   gera dist/sw.js
```

**Interface comum do motor** (`worker-engine.js`): `listVoices()`, `load(voiceId, onProgress)`, `synth(text, {speed, voiceId, steps}) -> {pcm: Float32Array, sampleRate}`,
`cachedMap() -> {voiceId: bool}`, `remove(voiceId)`; extra: `download(voiceId, onProgress)` baixa para o cache sem carregar na memória.
Adicionar um motor = criar worker + core, entrar no catálogo `voices.js` e registrar em `default.js`.

## Armadilhas (leia antes de mexer)

- **Service worker só existe no build** (plugin `sw-plugin.mjs`). `npm run dev` não o tem; teste offline só com build + preview/E2E.
  O SW cuida do app (HTML/JS/CSS/wasm do `/vendor`); os **modelos de voz ficam no Cache Storage**, gravados pelos workers, não pelo SW.
- **Workers são ES-module** (`new Worker(new URL(...), {type:'module'})`), não scripts clássicos. O fonemizador (`piper_phonemize.mjs`)
  é gerado por `prepare-vendor.mjs` a partir do pacote `@diffusionstudio/piper-wasm` (ganha `export default`) e importado por URL em tempo de execução.
- **Netlify não força COOP/COEP** (não configurado) → sem `SharedArrayBuffer` → ONNX roda com **1 thread** (`numThreads = 1`). Não suba esse número sem configurar os cabeçalhos e testar.
- **onnxruntime-web fixado em 1.18.0** (sem `^`). Funciona com Piper e Supertonic 3 (testado). Se um dia precisar de outra versão para um motor, isole por worker/entrada.
- Os binários `.wasm` do ORT são servidos de `/vendor/ort/` (`ort.env.wasm.wasmPaths`), nunca de CDN: o app precisa funcionar offline e sob subcaminho (`base: './'`).
- **Piper:** use o `phoneme_id_map` **do modelo** (`phonemesToIds`), não o `phoneme_ids` do CLI do fonemizador: o CLI usa um mapa padrão e a voz Edresson quebra (índice fora do embedding).
- **Supertonic:** ~396 MB (vector_estimator 256 MB, vocoder 101 MB). Pico de memória alto ao criar sessões: em celulares pode falhar. Custo de síntese ≈ proporcional ao nº de passos (3→0,9×, 5→1,2×, 8→1,9× o tempo do áudio, medido em CPU de servidor, 1 thread). Por isso o player pré-busca à frente e o padrão é 5 passos.
- URLs do Hugging Face estão **fixadas por revisão** em `voices.js` (o repositório do Supertonic foi arquivado; o namespace atual é `supertone-oss-archive`). Nunca troque por `main`.
- `<audio>` + blob WAV (não Web Audio): melhor com tela bloqueada. iOS exige "destravar" o elemento dentro do toque (`Player._unlock`).
- Ao rodar o E2E aqui (proxy do ambiente), o Chromium recebe o proxy por `--proxy-server` com bypass de localhost (a opção `proxy` do Playwright força proxy até para localhost).
- Não use `pkill -f <padrão>` em comandos do shell: casa com o próprio comando.

## Convenções

- JavaScript puro; sem dependências novas sem justificativa (hoje: `onnxruntime-web`, `pdfjs-dist`, `fflate`).
- Textos de interface e comentários em português do Brasil.
- `normalize.js` e `split.js` têm testes; ajuste os testes junto.
- Commits pequenos; PR como rascunho.
