"""Inteligibilidade objetiva: transcreve os WAVs com Whisper e calcula a taxa de erro de palavras (WER) contra o texto lido.
É um INDICADOR (um reconhecedor automático não é um ouvinte humano): não mede naturalidade, sotaque nem agrado.
Dica: use texto sem numerais (o Whisper escreve "2024" em dígitos e o texto falado tem as palavras, o que infla o WER).
Uso: python3 scripts/asr-check.py base refs.json 'out/*.wav'
  refs.json: {"trecho_do_nome_do_arquivo": "texto de referência", ...}
Requer: pip install faster-whisper numpy"""
import glob, json, re, sys, unicodedata, wave
import numpy as np
from faster_whisper import WhisperModel


def load(path):
    w = wave.open(path)
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    n = int(len(x) * 16000 / sr)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def words(t):
    t = unicodedata.normalize('NFD', t.lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9 ]', ' ', t).split()


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = [[0] * (len(h) + 1) for _ in range(len(r) + 1)]
    for i in range(len(r) + 1): d[i][0] = i
    for j in range(len(h) + 1): d[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] != h[j - 1]))
    return d[-1][-1] / max(1, len(r))


model = WhisperModel(sys.argv[1], device='cpu', compute_type='int8')
refs = json.load(open(sys.argv[2]))
for f in sorted(sum([glob.glob(g) for g in sys.argv[3:]], [])):
    ref = next(v for k, v in refs.items() if k in f)
    segs, _ = model.transcribe(load(f), language='pt', beam_size=5)
    hyp = ' '.join(s.text for s in segs)
    print(f"{f.split('/')[-1]} | WER={wer(ref, hyp):.2f} | {hyp.strip()[:140]}")
