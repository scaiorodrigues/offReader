/** PCM float [-1,1] -> WAV 16 bits mono, com silêncio opcional no final (pausa entre trechos). */
export function pcmToWav(pcm, sampleRate, trailingSilenceSec = 0) {
  const silence = Math.max(0, Math.round(trailingSilenceSec * sampleRate));
  const total = pcm.length + silence;
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, total * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/** Estatísticas simples do áudio, úteis para testes automáticos (não medem qualidade). */
export function pcmStats(pcm) {
  let peak = 0; let sum = 0; let bad = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    if (!Number.isFinite(v)) { bad++; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { samples: pcm.length, peak, rms: Math.sqrt(sum / Math.max(1, pcm.length)), nonFinite: bad };
}

/** Float32 [-1,1] -> Int16 (metade da memória: o buffer à frente guarda minutos de áudio). */
export function floatToInt16(pcm) {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Emenda várias unidades (Int16 + silêncio final em amostras) num único WAV 16 bits mono.
 * Um áudio só, longo, evita trocar o `src` do <audio> a cada frase — o ponto frágil com a tela bloqueada.
 * @param {{pcm: Int16Array, silence: number}[]} parts
 */
export function partsToWav(parts, sampleRate) {
  const total = parts.reduce((a, p) => a + p.pcm.length + p.silence, 0);
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, total * 2, true);
  const samples = new Int16Array(buffer, 44, total);
  let off = 0;
  for (const p of parts) { samples.set(p.pcm, off); off += p.pcm.length + p.silence; }
  return new Uint8Array(buffer);
}
