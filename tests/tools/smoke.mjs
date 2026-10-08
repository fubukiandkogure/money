// 開発用：各画面を開いてエラーがないか確かめ、スクリーンショットを撮る
//   node tests/tools/smoke.mjs [outDir] [--demo]
import { mkdir } from 'node:fs/promises';
import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';

const out = process.argv[2] ?? 'test-results/smoke';
const demo = process.argv.includes('--demo');
const dark = process.argv.includes('--dark');
await mkdir(out, { recursive: true });
const server = await startServer(8091);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
const base = `http://localhost:8091/money/${demo ? '?demo=1' : ''}`;
await page.goto(`${base}#/home`);
await page.waitForSelector('html[data-ready="1"]', { timeout: 10000 });
await page.waitForTimeout(demo ? 1500 : 300);
const routes = ['home', 'assets', 'records', 'report/assets', 'report/spending', 'subs', 'settings'];
for (const r of routes) {
  await page.evaluate((h) => (location.hash = h), `#/${r}`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${r.replace('/', '-')}${dark ? '-dark' : ''}.png`, fullPage: true });
}
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
server.close();
