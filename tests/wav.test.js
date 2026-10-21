import { describe, it, expect } from 'vitest';
import { pcmToWav, partsToWav, floatToInt16, pcmStats } from '../src/lib/wav.js';

const parse = (wav) => {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const str = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  return { riff: str(0), wave: str(8), rate: v.getUint32(24, true), dataBytes: v.getUint32(40, true), samples: new Int16Array(wav.buffer.slice(wav.byteOffset + 44)) };
};

describe('wav', () => {
  it('pcmToWav: cabeçalho, taxa, saturação e silêncio final', () => {
    const w = parse(pcmToWav(Float32Array.from([0, 0.5, -0.5, 2, -2]), 22050, 0.001));
    expect([w.riff, w.wave, w.rate]).toEqual(['RIFF', 'WAVE', 22050]);
    expect([...w.samples.slice(0, 5)]).toEqual([0, 16383, -16384, 32767, -32768]);
    expect(w.samples.length).toBe(5 + Math.round(0.001 * 22050));
    expect(w.dataBytes).toBe(w.samples.length * 2);
  });
  it('floatToInt16 equivale ao WAV direto', () => {
    expect([...floatToInt16(Float32Array.from([0.25, -1, 1]))]).toEqual([8191, -32768, 32767]);
  });
  it('partsToWav emenda partes com silêncio entre elas', () => {
    const w = parse(partsToWav([{ pcm: Int16Array.from([1, 2]), silence: 3 }, { pcm: Int16Array.from([9]), silence: 1 }], 8000));
    expect(w.rate).toBe(8000);
    expect([...w.samples]).toEqual([1, 2, 0, 0, 0, 9, 0]);
    expect(w.dataBytes).toBe(14);
  });
  it('pcmStats detecta silêncio, pico e valores inválidos', () => {
    expect(pcmStats(Float32Array.from([0, 0, 0])).rms).toBe(0);
    expect(pcmStats(Float32Array.from([0.5, -1, NaN])).nonFinite).toBe(1);
    expect(pcmStats(Float32Array.from([0.5, -1])).peak).toBe(1);
  });
});
