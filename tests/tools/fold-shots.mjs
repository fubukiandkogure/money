// 開発用：Galaxy Z Fold 相当の画面サイズで各画面を撮る（デモの架空データ）
//   node tests/tools/fold-shots.mjs [outDir] [--dark] [--only=home,subs]
import { mkdir } from 'node:fs/promises';
import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'test-results/fold';
const dark = process.argv.includes('--dark');
const only = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
await mkdir(out, { recursive: true });
const server = await startServer(8092);
const browser = await chromium.launch();

// 閉じた画面（カバー）・開いた画面（縦・横）
const SIZES = [
  ['cover', { width: 412, height: 915 }],
  ['inner', { width: 760, height: 860 }],
  ['inner-land', { width: 860, height: 760 }],
];
const ROUTES = ['home', 'assets', 'assets/month/2026-09', 'records', 'report/assets', 'report/spending', 'subs', 'settings'];
const errors = [];
for (const [name, viewport] of SIZES) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    colorScheme: dark ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  await page.clock.setFixedTime(new Date('2026-10-08T19:30:00+09:00'));
  await page.goto('http://localhost:8092/money/?demo=1#/home');
  await page.waitForSelector('html[data-ready="1"]');
  await page.waitForFunction(() => document.querySelector('.hero-num'));
  await page.evaluate(() => document.fonts.ready);
  for (const r of ROUTES) {
    if (only && !only.some((o) => r.startsWith(o))) continue;
    await page.evaluate((h) => (location.hash = h), `#/${r}`);
    await page.waitForTimeout(350);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) errors.push(`${name} ${r}: horizontal overflow ${overflow}px`);
    await page.screenshot({ path: `${out}/${name}-${r.replaceAll('/', '-')}${dark ? '-dark' : ''}.png`, fullPage: true });
  }
  await ctx.close();
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
server.close();
