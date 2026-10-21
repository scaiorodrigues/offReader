// Estresse do fluxo "Colar texto" e do tempo até o 1º som, com CPU limitada (imita celular) e modelo já em cache.
// Uso: npm run build && SIZE=300000 THROTTLE=4 WAIT=0 VOICE=piper:pt_BR-cadu-medium node tests/e2e/paste-stress.mjs
//   SIZE: caracteres colados · THROTTLE: fator de lentidão da CPU · WAIT: ms entre abrir o texto e tocar ▶ (voz pré-carregada) · VOICE: id da voz
// Baixa a voz na 1ª fase (sem limitar CPU), recarrega a página e mede. Imprime tempos e as métricas do player.
import { startPreview, launch, audioStats } from './helpers.mjs';
const SIZE = Number(process.env.SIZE || 300000);
const THROTTLE = Number(process.env.THROTTLE || 4);
const VOICE = process.env.VOICE || 'piper:pt_BR-cadu-medium';
const server = await startPreview();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 780 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 200)); });
page.on('dialog', (d) => d.accept());
const cdp = await ctx.newCDPSession(page);
await page.goto(server.url);
await page.waitForFunction(() => !!window.__leitor);
// 1) aquece: baixa o modelo para o cache (sem limitar CPU) e recarrega, como um uso "no dia seguinte"
await page.evaluate(async (v) => { window.__leitor.settings.voiceId = v; await window.__leitor.openText('aquecer', 'Texto curto para aquecer.'); }, VOICE);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.click('#btn-play');
await page.waitForFunction(() => window.__leitor.player.state === 'playing', null, { timeout: 900000 });
await page.reload();
await page.waitForFunction(() => !!window.__leitor && !!navigator.serviceWorker.controller);
await page.evaluate((v) => { window.__leitor.settings.voiceId = v; }, VOICE);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

const para = 'Esta é uma frase de exemplo, com vírgulas e números como 1.234,56 e o Sr. Silva. Outra frase vem logo depois! Será que funciona? 😀 Sim, funciona.';
const text = Array.from({ length: Math.ceil(SIZE / 140) }, (_, i) => (i % 6 === 5 ? '\r\n\r\n' : '') + para).join(' ');
const t = {};
let t0 = Date.now();
await page.click('#btn-paste');
await page.evaluate((v) => { document.getElementById('paste-text').value = v; }, text);
t.fill = Date.now() - t0; t0 = Date.now();
await page.click('#paste-go');
await page.waitForFunction(() => !document.getElementById('reader').hidden && document.querySelectorAll('.chunk').length > 0, null, { timeout: 120000 });
t.abrirTexto = Date.now() - t0;
const info = await page.evaluate(() => ({ renderizados: document.querySelectorAll('.chunk').length, total: window.__leitor.player.chunks.length, state: window.__leitor.player.state }));
await page.waitForTimeout(3000);
const long = await page.evaluate(() => new Promise((r) => { const t0 = performance.now(); let worst = 0, last = t0; const id = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 50); last = n; if (n - t0 > 1500) { clearInterval(id); r(Math.round(worst)); } }, 50); }));
console.log('maior travamento da tela durante a renderização do resto (ms):', long, '| renderizados depois de 3 s:', await page.evaluate(() => document.querySelectorAll('.chunk').length));
console.log('texto', text.length, 'chars | preencher', t.fill, 'ms | abrir', t.abrirTexto, 'ms |', JSON.stringify(info));

if (process.env.WAIT) await page.waitForTimeout(Number(process.env.WAIT));
t0 = Date.now();
await page.click('#btn-play');
const marks = [];
const poll = setInterval(async () => { try { marks.push([Date.now() - t0, await page.evaluate(() => window.__leitor.player.state + ' ' + (document.getElementById('status').textContent))]); } catch {} }, 1500);
await page.waitForFunction(() => ['playing', 'error'].includes(window.__leitor.player.state), null, { timeout: 300000 });
clearInterval(poll);
t.primeiroAudio = Date.now() - t0;
console.log('primeiro áudio após clicar ▶:', t.primeiroAudio, 'ms');
console.log('linha do tempo:', JSON.stringify(marks.filter((m, i) => i === 0 || m[1] !== marks[i - 1][1])));
console.log('estado final:', await page.evaluate(() => window.__leitor.player.state), JSON.stringify(await audioStats(page).catch(() => null)));
console.log('métricas:', JSON.stringify(await page.evaluate(() => window.__leitor.player.metrics)));
console.log('erros:', errors.slice(0, 6));
await browser.close(); server.stop();
