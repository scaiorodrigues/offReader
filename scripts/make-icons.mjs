// Gera os ícones PNG do PWA a partir de public/icon.svg (usa o Chromium do Playwright).
import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('public/icon.svg', 'utf8');
const exe = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
async function render(size, file, { maskable = false } = {}) {
  const inner = maskable ? svg.replace('<rect width="512" height="512" rx="112" fill="#1f6feb"/>', '<rect width="512" height="512" fill="#1f6feb"/>').replace(/<svg([^>]*)>/, '<svg$1><g transform="translate(76.8 76.8) scale(.7)">').replace('</svg>', '</g></svg>') : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${inner.replace('<svg', `<svg width="${size}" height="${size}"`)}</body>`);
  await page.screenshot({ path: file, omitBackground: true });
}
await render(192, 'public/icon-192.png');
await render(512, 'public/icon-512.png');
await render(512, 'public/icon-maskable-512.png', { maskable: true });
await browser.close();
