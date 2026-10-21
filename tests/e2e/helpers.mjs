import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import fs from 'node:fs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.data': 'application/octet-stream' };

/** Serve dist/ como o Netlify faria (sem COOP/COEP). `prefix` simula publicação em subcaminho, ex.: /offreader/. */
export async function startPreview(port = 0, { dir = 'dist', prefix = '/' } = {}) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith(prefix)) { res.writeHead(404); res.end('fora do prefixo'); return; }
    p = p.slice(prefix.length - 1);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('não encontrado'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://localhost:${server.address().port}${prefix}`, stop: () => server.close() };
}

export async function launch() {
  const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
  // proxy por argumento (a opção `proxy` do Playwright também força o proxy para localhost)
  const proxyArgs = process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : [];
  return chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required', ...proxyArgs] });
}

/** Lê o WAV atualmente no <audio> e devolve estatísticas objetivas (duração, pico, RMS). */
export const audioStats = (page) => page.evaluate(async () => {
  const a = document.getElementById('audio');
  const buf = await (await fetch(a.src)).arrayBuffer();
  const v = new DataView(buf);
  const rate = v.getUint32(24, true);
  const n = (buf.byteLength - 44) / 2;
  let peak = 0; let sum = 0;
  for (let i = 0; i < n; i++) { const s = v.getInt16(44 + i * 2, true) / 32768; peak = Math.max(peak, Math.abs(s)); sum += s * s; }
  return { rate, seconds: +(n / rate).toFixed(2), peak: +peak.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4) };
});

export const waitState = (page, states, timeout = 120000) =>
  page.waitForFunction((s) => s.includes(window.__leitor.player.state), states, { timeout });
