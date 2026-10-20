# Verificação

O que foi medido de fato, como reproduzir e o que **não** foi (e não pode ser) verificado por quem escreveu o código.

## 0. Limite principal

**Ninguém aqui ouviu o áudio.** Tudo abaixo é objetivo (duração, nível, altura da voz, transcrição automática, comportamento da interface).
Naturalidade, sotaque, "agrado" e se a voz feminina soa feminina para você só se confirmam ouvindo (veja o checklist no PR).

## 1. Testes automáticos (`npm test`, sem rede)

60 testes: normalização de números/abreviações, divisão em trechos, leitores de TXT/MD/DOCX/EPUB/PDF, player com **motor falso**
(pré-busca, pausa, busca, troca de voz/velocidade, erros), cache offline (com `CacheStorage` simulado), catálogo de vozes
e o mapeamento de fonemas do Piper contra o **fonemizador real** (reproduz os ids do CLI para o Faber e evita o estouro da Edresson).

## 2. Motores com modelos reais (Node, `npm run verify:engines`)

Ambiente: servidor de nuvem, WASM de 1 thread, onnxruntime-web 1.18.0. Frase de teste com números, moeda e abreviação.

| Voz | Resultado |
|---|---|
| Piper Cadu, Faber, Jeff, Edresson | sintetizam; sem NaN; ~0,4× do tempo do áudio (mais rápido que tempo real) |
| Supertonic F1–F5, M1–M5 | sintetizam; sem NaN; ~1,8× do tempo do áudio com 8 passos |

Supertonic — tempo de síntese ÷ duração do áudio, mesma frase: **3 passos 0,9× · 5 passos 1,2× · 8 passos 1,9×** (por isso o padrão é 5 e o player pré-busca à frente).

**Bug encontrado e corrigido:** o CLI do fonemizador usa um mapa de fonemas padrão; a voz Edresson tem mapa próprio e falhava (`indices element out of data bounds`). Agora o app mapeia com o `phoneme_id_map` de cada modelo.

## 3. Gênero das vozes (altura da voz, Praat — `scripts/f0-check.py`)

Mediana de F0 em ~12 s de fala. Referência aproximada: masculina 85–155 Hz, feminina 165–255 Hz.

| Voz | F0 mediano | Leitura |
|---|---|---|
| Supertonic F1 · F2 · F3 · F4 · F5 | 190 · 218 · 170 · 194 · 163 Hz | faixa feminina |
| Supertonic M1 · M2 · M3 · M4 · M5 | 131 · 89 · 107 · 119 · 88 Hz | faixa masculina |
| Piper Cadu | 136 Hz | faixa masculina |
| Piper Jeff · Edresson | 152 · 156 Hz | masculina, parte alta da faixa |
| Piper Faber | 173 Hz | **ambíguo** (entre as faixas) |

As 5 femininas do Supertonic ficam acima das 5 masculinas, o que corrobora os rótulos oficiais F/M. Para o Piper, o gênero "masculino" vem do que o autor informou
(os cards das vozes não dizem); a medição é coerente para Cadu, Jeff e Edresson e **inconclusiva para Faber** — ouça e, se for o caso, reclassifique em `src/lib/engines/voices.js`.

## 4. Inteligibilidade (Whisper-base, `scripts/asr-check.py`)

Parágrafo de 3 frases sem numerais, 14 vozes, WER = erro de palavras da transcrição automática contra o texto lido.
É um **indicador de que as palavras são reconhecíveis**, não de qualidade; o próprio reconhecedor erra (p.ex. "em voz alta" → "envosa" apareceu em vozes distintas).

| Motor | WER |
|---|---|
| Supertonic (8 passos), 10 vozes | 0 a 6% |
| Piper, 4 vozes | 6 a 12% |

Com 3 passos o Supertonic já errava palavras numa frase de teste (WER 11%), com 5 passos 6%, com 8 passos 0% — uma única frase, indicativo apenas.

## 5. Navegador real (Chromium via Playwright)

`npm run e2e:voices:all` — 25 verificações passaram, incluindo:

- lista de vozes em Femininas (5) e Masculinas (9), 14 no total;
- **Piper Cadu e Supertonic F1**: baixam do Hugging Face, sintetizam, tocam (áudio não silencioso), avançam de trecho e pausam;
- botão "Ouvir prévia";
- **modo offline** (`setOffline(true)` + recarregar): o app abre pelo service worker e as duas vozes tocam a partir do Cache Storage;
- sem erros de console/página;
- o mesmo fluxo sob subcaminho `/offreader/` (Piper) passou.

Tempos medidos no Chromium headless: Piper ≈ 7 s até o 1º áudio (inclui baixar 63 MB), 3 s offline; Supertonic ≈ 24 s (inclui baixar ~400 MB), 8 s offline.

`npm run e2e:files` — abre TXT, MD, DOCX, EPUB e PDF pelo seletor de arquivos, confere o texto exibido e o aviso para formato inválido.

## 6. O que NÃO foi verificado

- **Qualidade/naturalidade do áudio** e a percepção de gênero (precisa de ouvidos).
- **Celulares reais** (iOS/Android): memória do Supertonic (~400 MB de modelo), velocidade em CPU móvel, reprodução com tela bloqueada, instalação como PWA.
- **Deploy real no Netlify** (só o build local e o `netlify.toml`); cabeçalhos de cache.
- PDFs reais grandes/complexos (só PDF sintético simples); EPUB/DOCX reais com estruturas exóticas.
- Supertonic com WebGPU (não implementado; só WASM).
