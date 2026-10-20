# Leitor

Leitor de textos e documentos com narração neural em português do Brasil (pt-BR).
Funciona como PWA e roda 100% no navegador: o texto não sai do seu dispositivo.

## Recursos

- Formatos de entrada: TXT, MD, PDF, DOCX e EPUB.
- Narração neural em pt-BR com [Piper](https://github.com/rhasspy/piper), executado no navegador.
- Funciona offline depois do primeiro download dos arquivos de voz.
- Interface em português do Brasil.

## Stack

- [Vite](https://vitejs.dev/) + JavaScript puro
- [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) 1.18.0
- Piper TTS em um Web Worker (`public/tts-worker.js`)

## Desenvolvimento

```sh
npm ci          # instala as dependências
npm test        # roda os testes
npm run build   # gera dist/
npm run preview # serve o build localmente
```

O service worker só existe no build; em `npm run dev` ele não está ativo.

## Publicação

O app usa `base: './'` e pode ser publicado em qualquer subcaminho,
como `https://<usuario>.github.io/offReader/`.

## Roadmap

- Vozes femininas e masculinas, com escolha na tela de Configurações.
- Segundo motor de voz (Supertonic), mantendo o Piper como reserva.
- Publicação automática no GitHub Pages.

## Status

Este repositório foi inicializado apenas com este README. O código-fonte do app
ainda precisa ser adicionado.
