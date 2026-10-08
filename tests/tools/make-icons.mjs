// アイコン（SVG と PNG）をドット絵の定義（app/js/ui/pixel.js）から作る： node tests/tools/make-icons.mjs
import { writeFile } from 'node:fs/promises';
import { chromium } from '../pw.mjs';
import { appIconSvg } from '../../app/js/ui/pixel.js';

const dir = new URL('../../app/icons/', import.meta.url);
await writeFile(new URL('icon.svg', dir), appIconSvg({ size: 512 }) + '\n');
await writeFile(new URL('icon-maskable.svg', dir), appIconSvg({ size: 512, maskable: true }) + '\n');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [out, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${appIconSvg({ size, maskable })}</body></html>`);
  const buf = await page.locator('svg').screenshot({ omitBackground: true });
  await writeFile(new URL(out, dir), buf);
  console.log('wrote', out, buf.length);
}
await browser.close();
