// アイコンPNGを SVG から作る： node tests/tools/make-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '../pw.mjs';

const dir = new URL('../../app/icons/', import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
]) {
  const svg = await readFile(new URL(src, dir), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const buf = await page.locator('svg').screenshot({ omitBackground: true });
  await writeFile(new URL(out, dir), buf);
  console.log('wrote', out, buf.length);
}
await browser.close();
