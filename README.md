# Leitor

Leitor de textos e documentos com **narração neural em português do Brasil**, que roda **100% no navegador**
(nada do que você lê sai do seu aparelho) e funciona **offline** depois do primeiro download de cada voz.

- **Formatos:** TXT, MD, PDF, DOCX e EPUB — ou cole um texto.
- **Vozes femininas e masculinas**, em dois motores: **Piper** (leve) e **Supertonic 3** (femininas + masculinas).
- Velocidade, pausas entre frases e parágrafos, tema claro/escuro/sépia, tamanho do texto.
- Retoma de onde você parou; instalável como app (PWA); controles na tela de bloqueio (Media Session).

> Sobre "tonalidades": o app oferece o que os modelos realmente fazem — **várias vozes** (cada uma com timbre próprio),
> **velocidade**, **pausas** e, no Supertonic, o número de **passos de refinamento** (precisão × velocidade).
> Não há controle de emoção nem mudança de tom: nenhum dos dois motores suporta isso.

## Vozes

| Motor | Vozes | Tamanho | Observações |
|---|---|---|---|
| Supertonic 3 | Feminina 1–5, Masculina 1–5 | ~399 MB, **uma vez**, compartilhado pelas 10 vozes | 44,1 kHz; exige mais memória/CPU; mais lento para gerar |
| Piper | Cadu, Faber, Jeff, Edresson (menor qualidade) | ~63 MB cada | leve e rápido; **só vozes masculinas** em pt-BR |

Os nomes "Feminina/Masculina N" seguem a documentação oficial do Supertonic (estilos F1–F5 e M1–M5) e foram conferidos medindo a altura da voz
(ver [docs/VERIFICACAO.md](docs/VERIFICACAO.md)). Cada voz é baixada do Hugging Face na primeira vez que você a usa (com confirmação) e guardada no aparelho.

## Publicar no Netlify

1. No Netlify: **Add new site → Import an existing project →** escolha este repositório.
2. As configurações vêm de [`netlify.toml`](netlify.toml) (build `npm run build`, pasta `dist`, Node 22) — não precisa preencher nada.
3. Publique a branch `main`. Cada Pull Request ganha um **Deploy Preview** com link próprio para testar antes de mesclar.
4. No celular, abra o link e use "Adicionar à tela inicial" para instalar.

O app usa `base: './'`, então também funciona em subcaminhos (por exemplo `https://usuario.github.io/offReader/`).

## Desenvolvimento

```sh
npm ci
npm test            # testes unitários (sem rede)
npm run build       # gera dist/ (e dist/sw.js)
npm run preview     # serve o build (o service worker só existe no build)
npm run dev         # modo dev (sem service worker)
```

Testes de ponta a ponta no Chromium e verificações com modelos reais: veja [CLAUDE.md](CLAUDE.md) e [docs/VERIFICACAO.md](docs/VERIFICACAO.md).

## Como funciona

`texto → limpeza (normalize) → trechos (split) → motor de voz (worker) → WAV → <audio>`. Enquanto toca, o app já deixa vários minutos de áudio prontos à frente (ajustável em "Preparar com antecedência") e emenda tudo em blocos contínuos.
Os motores seguem uma interface comum (`listVoices`, `load`, `synth`, `cachedMap`, `remove`), então adicionar outro motor não mexe no player nem na interface.
Detalhes e armadilhas em [CLAUDE.md](CLAUDE.md).

## Limites conhecidos

- PDFs digitalizados (imagens) não têm texto extraível; o app avisa, mas não faz OCR.
- Supertonic em celulares antigos pode ficar lento ou faltar memória; use Piper como reserva.
- A leitura com a **tela apagada** depende do navegador e do sistema (iOS é o mais restritivo). O app prepara minutos de áudio à frente e toca em blocos longos para ajudar, mas isso ainda não foi confirmado em celular real. Se parar, deixe o app instalado ("Adicionar à tela inicial") e aumente "Preparar com antecedência".
- ONNX roda com 1 thread (sem COOP/COEP).

## Licenças e créditos

- Piper: vozes Cadu, Faber e Jeff com dados CC0; Edresson com dados CC BY 4.0 ([TTS-Portuguese-Corpus](https://github.com/Edresson/TTS-Portuguese-Corpus), Edresson Casanova). Fonemizador espeak-ng (GPL-3.0) via [`@diffusionstudio/piper-wasm`](https://www.npmjs.com/package/@diffusionstudio/piper-wasm) (MIT).
- Supertonic 3 © Supertone Inc.: código de exemplo MIT; **modelo sob [OpenRAIL-M](https://huggingface.co/supertone-oss-archive/supertonic-3/blob/aafc6e32416a594460b32413efc49d7fe4ce6d46/LICENSE)** (restrições de uso). O projeto original foi arquivado; os arquivos são baixados de uma revisão fixa em `supertone-oss-archive/supertonic-3`.
- onnxruntime-web (MIT), pdf.js (Apache-2.0), fflate (MIT).
- Licença do código deste repositório: **a definir pelo autor**.
