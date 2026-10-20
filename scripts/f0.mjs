// Estimativa grosseira de F0 (autocorrelação) para conferir se uma voz soa na faixa grave/aguda esperada.
// Não mede qualidade nem naturalidade: serve só como checagem de sanidade do gênero.
export function medianF0(pcm, sampleRate, { min = 70, max = 400 } = {}) {
  const frame = Math.floor(0.04 * sampleRate);
  const hop = Math.floor(0.02 * sampleRate);
  const lagMin = Math.floor(sampleRate / max);
  const lagMax = Math.floor(sampleRate / min);
  const vals = [];
  let globalPeak = 0;
  for (let i = 0; i < pcm.length; i++) globalPeak = Math.max(globalPeak, Math.abs(pcm[i]));
  for (let s = 0; s + frame + lagMax < pcm.length; s += hop) {
    let e = 0;
    for (let i = 0; i < frame; i++) e += pcm[s + i] * pcm[s + i];
    if (Math.sqrt(e / frame) < globalPeak * 0.05) continue;
    let best = 0; let bestLag = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let c = 0; let e2 = 0;
      for (let i = 0; i < frame; i++) { c += pcm[s + i] * pcm[s + i + lag]; e2 += pcm[s + i + lag] ** 2; }
      const norm = c / Math.sqrt(e * e2 + 1e-12);
      if (norm > best) { best = norm; bestLag = lag; }
    }
    if (best > 0.6 && bestLag) vals.push(sampleRate / bestLag);
  }
  if (vals.length < 5) return null;
  vals.sort((a, b) => a - b);
  return { median: vals[Math.floor(vals.length / 2)], voicedFrames: vals.length };
}
