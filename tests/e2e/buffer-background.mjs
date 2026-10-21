// Chromium real + Piper real: o buffer enche à frente, o áudio é emendado em poucos segmentos longos e
// continua tocando quando a página é CONGELADA (imita o sistema suspendendo o JS com a tela apagada).
// Limite: é uma emulação no Chromium; NÃO substitui testar o bloqueio de tela num celular de verdade.
// Uso: npm run build && node tests/e2e/buffer-background.mjs
import { startPreview, launch, waitState } from './helpers.mjs';

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name} ${extra}`); };
const server = await startPreview();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 780 } });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);

const sentence = 'Esta é uma frase de exemplo para encher o buffer, com bastante conteúdo e vírgulas, só para durar alguns segundos. ';
try {
  await page.goto(server.url);
  await page.waitForFunction(() => !!window.__leitor);
  await page.evaluate((t) => { window.__leitor.settings.voiceId = 'piper:pt_BR-cadu-medium'; return window.__leitor.openText('Buffer', t); }, Array.from({ length: 80 }, (_, i) => `${sentence}Número ${i + 1}.`).join('\n\n'));
  await page.click('#btn-play');
  await waitState(page, ['playing', 'error'], 180000);

  // 1) o buffer enche muito à frente do que toca
  await page.waitForFunction(() => window.__leitor.player.bufferedSec > 40, null, { timeout: 120000 });
  const m1 = await page.evaluate(() => ({ buf: Math.round(window.__leitor.player.bufferedSec), seg: window.__leitor.player.metrics.segments, idx: window.__leitor.player.index, ct: window.__leitor.player.audio.currentTime }));
  check('buffer à frente passa de 40 s enquanto toca', m1.buf > 40, JSON.stringify(m1));
  check('poucas trocas de áudio no começo (segmentos emendados)', m1.seg <= 6, `segmentos=${m1.seg}`);

  // 2) espera o segmento longo começar e congela a página (JS parado), como o sistema faz com a tela apagada
  await page.waitForFunction(() => window.__leitor.player.seg && window.__leitor.player.seg.totalSec > 30, null, { timeout: 120000 });
  const before = await page.evaluate(() => ({ t: performance.now(), ct: window.__leitor.player.audio.currentTime, total: window.__leitor.player.seg.totalSec, idx: window.__leitor.player.index }));
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 12000));
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  const frozenFor = (Date.now() - t0) / 1000;
  await page.waitForFunction(() => !!window.__leitor);
  const after = await page.evaluate(() => ({ ct: window.__leitor.player.audio.currentTime, paused: window.__leitor.player.audio.paused, state: window.__leitor.player.state, idx: window.__leitor.player.index }));
  const advanced = after.ct - before.ct;
  console.log(`   congelada por ${frozenFor.toFixed(1)} s; áudio avançou ${advanced.toFixed(1)} s (segmento de ${before.total.toFixed(0)} s)`);
  check('o áudio continuou tocando com o JS congelado', advanced > 8 && !after.paused, JSON.stringify(after));
  // 3) depois de descongelar, o destaque volta a acompanhar
  await page.waitForTimeout(2500);
  const idxLater = await page.evaluate(() => window.__leitor.player.index);
  check('o trecho destacado alcança a posição real depois de voltar', idxLater >= before.idx, `${before.idx} → ${idxLater}`);
  check('sem erros de página', errors.length === 0, errors.join(' | '));
} catch (e) { check(`exceção: ${e.message}`, false); }
await browser.close(); server.stop();
console.log(results.every(Boolean) ? '\ntudo certo' : '\nhá falhas');
process.exit(results.every(Boolean) ? 0 : 1);
