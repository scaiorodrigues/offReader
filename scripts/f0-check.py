"""Mede o F0 (altura da voz) com Praat para conferir se o gênero declarado é coerente com o áudio gerado.
Faixas típicas de referência: voz masculina ~85–155 Hz; feminina ~165–255 Hz. É só um indicador, não mede qualidade.
Uso: python3 scripts/f0-check.py arquivo1.wav arquivo2.wav ...   (requer: pip install praat-parselmouth)"""
import sys
import numpy as np
import parselmouth

for path in sys.argv[1:]:
    f0 = parselmouth.Sound(path).to_pitch(pitch_floor=70, pitch_ceiling=400).selected_array['frequency']
    voiced = f0[f0 > 0]
    if len(voiced) < 10:
        print(f"{path.split('/')[-1]}: pouco trecho sonoro"); continue
    print(f"{path.split('/')[-1]}: mediana {np.median(voiced):.0f} Hz (P10 {np.percentile(voiced, 10):.0f} – P90 {np.percentile(voiced, 90):.0f}), {len(voiced)} quadros sonoros")
