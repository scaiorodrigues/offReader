// E2E com Chromium REAL e modelos REAIS (precisa de internet na primeira execução).
// Uso: npm run build && node tests/e2e/real-voice.mjs [--supertonic]
// Verifica: lista de vozes, download + síntese + reprodução, cache e uso OFFLINE via service worker.
// Não avalia a qualidade do áudio, só que ele existe, não é silêncio e avança entre trechos.
import { startPreview, launch, audioStats, waitState } from './helpers.mjs';

const withSupertonic = process.argv.includes('--supertonic');
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name} ${extra}`); };

const server = await startPreview();
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 420, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

const TEXT = 'Esta é a primeira frase do teste. Aqui vai a segunda frase, com o número 3 e uma vírgula.\n\nE este é um novo parágrafo para conferir a pausa.';

try {
  await page.goto(server.url);
  await page.waitForFunction(() => !!window.__leitor);
  check('página carrega sem erros', errors.length === 0, errors.join(' | '));

  await page.click('#btn-settings');
  const groups = await page.$$eval('.group h4', (h) => h.map((x) => x.textContent));
  check('grupos Femininas e Masculinas', groups.join() === 'Femininas,Masculinas', groups.join());
  const rows = await page.$$eval('.voice', (v) => v.length);
  check('14 vozes listadas (5 F + 9 M)', rows === 14, String(rows));
  await page.keyboard.press('Escape');

  // service worker precisa estar ativo para o teste offline
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!window.__leitor && !!navigator.serviceWorker.controller);
  check('service worker controla a página', true);

  async function playAndCheck(label, voiceId, timeout) {
    await page.evaluate(([id, t]) => { window.__leitor.settings.voiceId = id; return window.__leitor.openText('Teste', t); }, [voiceId, TEXT]);
    const t0 = Date.now();
    await page.click('#btn-play');
    await waitState(page, ['playing', 'error'], timeout);
    const state = await page.evaluate(() => window.__leitor.player.state);
    check(`${label}: começou a tocar`, state === 'playing', `(${Math.round((Date.now() - t0) / 1000)} s até o 1º áudio)`);
    if (state !== 'playing') return false;
    const st = await audioStats(page);
    check(`${label}: áudio não é silêncio`, st.rms > 0.005 && st.peak > 0.05, JSON.stringify(st));
    // avança para o 2º trecho
    await page.click('#btn-next');
    await page.waitForFunction(() => window.__leitor.player.index === 1 && window.__leitor.player.state === 'playing', null, { timeout });
    check(`${label}: avança para o trecho seguinte`, true);
    await page.click('#btn-play'); // pausa
    check(`${label}: pausa`, (await page.evaluate(() => window.__leitor.player.state)) === 'paused');
    return true;
  }

  await playAndCheck('Piper Cadu (online)', 'piper:pt_BR-cadu-medium', 180000);
  const cached = await page.evaluate(async () => (await caches.keys()).includes('leitor-models-v1') && (await (await caches.open('leitor-models-v1')).keys()).length);
  check('modelo ficou no Cache Storage', cached >= 2, String(cached));

  // ---- offline ----
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!window.__leitor, null, { timeout: 15000 });
  check('app abre offline (service worker)', true);
  await playAndCheck('Piper Cadu (OFFLINE)', 'piper:pt_BR-cadu-medium', 120000);
  await context.setOffline(false);

  if (withSupertonic) {
    await playAndCheck('Supertonic F1 (online)', 'supertonic:F1', 900000);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => !!window.__leitor, null, { timeout: 15000 });
    await playAndCheck('Supertonic F1 (OFFLINE)', 'supertonic:F1', 600000);
    await context.setOffline(false);
  }
  check('sem erros de console/página durante o teste', errors.filter((e) => !/Failed to load resource.*(offline|ERR_INTERNET)/i.test(e)).length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check(`exceção: ${e.message}`, false);
} finally {
  await browser.close();
  server.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
process.exit(failed ? 1 : 0);
