// ブラウザでの受け入れ確認（Chromium、Android 相当の画面サイズ、GitHub Pages と同じ /money/ 配下）
//   node tests/e2e/run.mjs            すべて
//   node tests/e2e/run.mjs D05 D06    名前に含む項目だけ
// 金額・名前はすべて架空。スクリーンショットは test-results/e2e/ に保存する。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';

const PORT = 8093;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `${ORIGIN}/money/`;
const OUT = 'test-results/e2e';
const NOW = new Date('2026-10-08T12:00:00+09:00');
// Galaxy Z Fold の閉じた画面（カバー）相当。数字の数え上げなどの動きは止めて、表示を確定させる
const PHONE = {
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
  reducedMotion: 'reduce',
};
const INNER = { viewport: { width: 760, height: 860 } };

await mkdir(OUT, { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch();
const filters = process.argv.slice(2);
const results = [];

// ---------------------------------------------------------------------------
// 道具

async function newPage(ctx, { clock = true } = {}) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(`console: ${m.text()}`);
  });
  if (clock) await page.clock.setFixedTime(NOW);
  return page;
}

async function open(page, hash = '#/home', { query = '' } = {}) {
  await page.goto(`${BASE}${query}${hash}`);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 10000 });
}

async function go(page, hash) {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForTimeout(120);
}

const dialog = (page) => page.getByRole('dialog').last();

async function waitClosed(page) {
  await page.waitForFunction(() => document.querySelectorAll('.sheet-root:not(.closing)').length === 0, null, { timeout: 5000 });
  await page.waitForTimeout(250);
}

async function toastText(page) {
  await page.waitForSelector('.toast', { timeout: 5000 });
  return (await page.locator('.toast .toast-msg').allTextContents()).join(' / ');
}

async function dismissToasts(page) {
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
}

/** この端末の保存データを直接読む（検証用） */
async function dumpDb(page, name = 'futokoro-machi') {
  return page.evaluate(
    (dbName) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names, 'readonly');
          const out = {};
          let left = names.length;
          for (const n of names) {
            const r = tx.objectStore(n).getAll();
            r.onsuccess = () => {
              out[n] = r.result;
              left -= 1;
              if (left === 0) {
                db.close();
                resolve(out);
              }
            };
          }
        };
      }),
    name,
  );
}

async function addAccount(page, { name, type = '銀行', managedFrom, principal }) {
  await go(page, '#/assets');
  await page.getByRole('button', { name: '口座を追加' }).first().click();
  const d = dialog(page);
  await d.getByRole('radio', { name: new RegExp(type) }).click();
  await d.getByRole('textbox', { name: '名前' }).fill(name);
  if (managedFrom) await d.locator('input[type=date]').first().fill(managedFrom);
  if (principal) await d.getByRole('textbox', { name: '金額' }).fill(String(principal));
  await d.getByRole('button', { name: '追加する' }).click();
  // 続けて残高のシートが開く
  await page.waitForFunction(() => document.querySelector('.sheet-title')?.textContent.includes('の残高'));
}

async function fillSnapshot(page, { amount, date, monthEnd = true, label = '残高' }) {
  const d = dialog(page);
  await d.getByRole('textbox', { name: label }).fill(String(amount));
  await d.locator('input[type=date]').fill(date);
  await d.locator('input[type=date]').dispatchEvent('change');
  if (monthEnd) await d.getByLabel('月末の終了時点の残高として確認した').check();
  await d.getByRole('button', { name: /記録する|訂正を保存/ }).click();
}

async function addExpense(page, { amount, category, luxury = false, date }) {
  await page.locator('.fab').click();
  const d = dialog(page);
  await d.getByRole('textbox', { name: '金額' }).fill(String(amount));
  await d.getByRole('radio', { name: category }).click();
  if (date) await d.locator('input[type=date]').first().fill(date);
  if (luxury) await d.getByRole('button', { name: 'ごほうび' }).click();
  await d.getByRole('button', { name: '記録する' }).click();
  await waitClosed(page);
}

/** 3口座＋9月末の実残高＋確定＋支出2件 */
async function seedBasic(page) {
  await open(page);
  await addAccount(page, { name: 'テスト銀行', managedFrom: '2026-09-01' });
  await fillSnapshot(page, { amount: 250000, date: '2026-09-30', label: '残高' });
  await waitClosed(page);
  await addAccount(page, { name: 'テストNISA', type: '投資', managedFrom: '2026-09-01' });
  await fillSnapshot(page, { amount: 100000, date: '2026-09-30', label: '残高' });
  await waitClosed(page);
  await addAccount(page, { name: 'テスト奨学金', type: '奨学金', managedFrom: '2026-09-01', principal: 400000 });
  await fillSnapshot(page, { amount: 280000, date: '2026-09-30', label: '元金の残高' });
  await waitClosed(page);
  await go(page, '#/assets/month/2026-09');
  await page.getByRole('button', { name: '2026年9月末を確定する' }).click();
  await dialog(page).getByRole('button', { name: '確定する', exact: true }).click();
  await waitClosed(page);
  await go(page, '#/home');
  await addExpense(page, { amount: 6800, category: '食費' });
  await addExpense(page, { amount: 3000, category: '遊び', luxury: true });
  await dismissToasts(page);
}

async function test(name, fn) {
  if (filters.length && !filters.some((f) => name.includes(f))) return;
  const ctxs = [];
  const mkCtx = async (opts = {}) => {
    const c = await browser.newContext({ ...PHONE, ...opts });
    ctxs.push(c);
    return c;
  };
  const t0 = Date.now();
  try {
    await fn(mkCtx);
    results.push([name, 'PASS', Date.now() - t0]);
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push([name, 'FAIL', Date.now() - t0, e]);
    console.log(
      `FAIL  ${name}\n      ${String(e.stack ?? e)
        .split('\n')
        .slice(0, 6)
        .join('\n      ')}`,
    );
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
  }
}

function noErrors(page) {
  assert.deepEqual(page.errors, [], `ページでエラー: ${page.errors.join(' | ')}`);
}

// ---------------------------------------------------------------------------
// 受け入れ確認

await test('D01 主要な入力（口座・月末残高・確定・支出）が再読込後も残る', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await seedBasic(page);
  await page.screenshot({ path: `${OUT}/D01-home-before.png`, fullPage: true });
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]');
  const net = await page.locator('.hero-num').first().textContent();
  assert.equal(net.trim(), '¥70,000');
  assert.match(await page.locator('main').textContent(), /¥6,800/);
  await go(page, '#/assets/month/2026-09');
  assert.match(await page.locator('main').textContent(), /確定/);
  assert.match(await page.locator('.status-line').textContent(), /確定.*第1版/);
  const db = await dumpDb(page);
  assert.equal(db.accounts.length, 3);
  assert.equal(db.snapshots.length, 3);
  assert.equal(db.closes.length, 1);
  assert.equal(db.events.filter((e) => e.kind === 'expense').length, 2);
  assert.equal(db.events.find((e) => e.amountYen === 3000).isLuxury, true);
  // 9/30 の値を 10/8 に入力 → 基準日と記録日時は別
  const s = db.snapshots[0];
  assert.equal(s.asOfDate, '2026-09-30');
  assert.ok(s.recordedAt.startsWith('2026-10-08T12:00:00'));
  // 管理開始日より前の日付ではなかったので、開始日は入力どおり
  assert.equal(db.accounts[0].managedFrom, '2026-09-01');
  noErrors(page);
});

await test('E01 入力は金額とカテゴリーだけ・当日が初期値、Android の戻るでシートが閉じる', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await open(page);
  const t0 = Date.now();
  await page.locator('.fab').click();
  const d = dialog(page);
  // 金額欄に自動でフォーカス（数字キーボード）
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('inputmode')), 'numeric');
  await page.keyboard.type('6800');
  await d.getByRole('radio', { name: '食費' }).click();
  await d.getByRole('button', { name: '記録する' }).click();
  await waitClosed(page);
  const ms = Date.now() - t0;
  assert.match(await toastText(page), /¥6,800（食費）を記録しました/);
  const db = await dumpDb(page);
  assert.equal(db.events[0].occurredOn, '2026-10-08');
  assert.equal(db.events[0].memo, '');
  assert.equal(db.events[0].accountId, null);
  // 戻る操作でシートを閉じ、画面はそのまま
  await page.locator('.fab').click();
  await dialog(page).waitFor();
  await page.goBack();
  await waitClosed(page);
  assert.equal(new URL(page.url()).hash, '#/home');
  console.log(`      入力〜保存（操作の自動化）${ms}ms`);
  noErrors(page);
});

await test('A08 月末確定に使った残高を訂正 → 要再確認、確定し直すと第2版', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await seedBasic(page);
  await go(page, '#/assets');
  await page.getByRole('link', { name: /テスト銀行/ }).click();
  await page.getByRole('button', { name: '訂正' }).first().click();
  const d = dialog(page);
  await d.getByRole('textbox', { name: '残高' }).fill('240000');
  await d.getByRole('button', { name: '訂正を保存' }).click();
  await waitClosed(page);
  assert.match(await page.locator('main').textContent(), /訂正済み/);
  await go(page, '#/assets/month/2026-09');
  assert.match(await page.locator('.status-line').textContent(), /要再確認/);
  assert.match(await page.locator('main').textContent(), /確定に使った残高が訂正・取り消しされた/);
  await page.screenshot({ path: `${OUT}/A08-needs-review.png`, fullPage: true });
  await page.getByRole('button', { name: 'いまの残高で確定し直す' }).click();
  await dialog(page).getByRole('button', { name: '確定する', exact: true }).click();
  await waitClosed(page);
  assert.match(await page.locator('.status-line').textContent(), /確定.*第2版/);
  const db = await dumpDb(page);
  assert.equal(db.closes.length, 2);
  assert.equal(db.snapshots.length, 4, '訂正前の記録も残る');
  noErrors(page);
});

await test('A07/A02 同じ日の記録は訂正として扱い、合算しない', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await open(page);
  await addAccount(page, { name: 'テスト銀行', managedFrom: '2026-10-01' });
  await fillSnapshot(page, { amount: 0, date: '2026-10-05', monthEnd: false });
  await waitClosed(page);
  await go(page, '#/assets');
  await page.getByRole('button', { name: 'テスト銀行の残高を記録' }).click();
  await fillSnapshot(page, { amount: 1000, date: '2026-10-05', monthEnd: false });
  await page.getByText('同じ日の記録があります').waitFor();
  await dialog(page).getByRole('button', { name: '訂正として保存' }).click();
  await waitClosed(page);
  const db = await dumpDb(page);
  assert.equal(db.snapshots.length, 2);
  assert.equal(db.snapshots.find((s) => s.amountYen === 1000).revisionOf, db.snapshots.find((s) => s.amountYen === 0).id);
  await go(page, '#/home');
  assert.equal((await page.locator('.hero-num').first().textContent()).trim(), '¥1,000');
  noErrors(page);
});

await test('S02 サブスクの支払確認を連打しても実支出は1件', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await open(page, '#/subs');
  await page.getByRole('button', { name: '入居' }).first().click();
  const d = dialog(page);
  await d.getByRole('textbox', { name: 'サービス名' }).fill('テスト動画');
  await d.getByRole('textbox', { name: '金額' }).fill('980');
  await d.locator('input[type=date]').nth(1).fill('2026-10-05');
  await d.getByRole('button', { name: '入居する' }).click();
  await waitClosed(page);
  assert.match(await page.locator('main').textContent(), /¥980/);
  assert.match(await page.locator('main').textContent(), /¥11,760/);
  await page.getByRole('button', { name: '支払った' }).click();
  const p = dialog(page);
  const save = p.getByRole('button', { name: '支払を記録' });
  await Promise.all([save.click(), save.click({ force: true }).catch(() => {}), save.dispatchEvent('click').catch(() => {})]);
  await waitClosed(page);
  const db = await dumpDb(page);
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].categoryId, 'subscription');
  assert.equal(db.paymentLinks.length, 1);
  assert.match(await page.locator('main').textContent(), /支払済み/);
  await page.screenshot({ path: `${OUT}/S02-subs.png`, fullPage: true });
  noErrors(page);
});

await test('D02 保存に失敗したら未保存と分かり、入力が残って再試行できる', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await open(page);
  // 容量不足を1回だけ起こす
  await page.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    window.__restorePut = () => (IDBObjectStore.prototype.put = orig);
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'events') throw new DOMException('quota', 'QuotaExceededError');
      return orig.apply(this, args);
    };
  });
  await page.locator('.fab').click();
  const d = dialog(page);
  await d.getByRole('textbox', { name: '金額' }).fill('1234');
  await d.getByRole('radio', { name: '日用品' }).click();
  await d.getByRole('button', { name: '記録する' }).click();
  await d.locator('.form-error').waitFor();
  assert.match(await d.locator('.form-error').textContent(), /保存容量が足りない.*入力はそのまま残っています/);
  assert.equal(await d.getByRole('textbox', { name: '金額' }).inputValue(), '1,234');
  assert.equal(await d.getByRole('radio', { name: '日用品' }).getAttribute('aria-checked'), 'true');
  assert.equal((await dumpDb(page)).events.length, 0);
  await page.screenshot({ path: `${OUT}/D02-save-failed.png` });
  await page.evaluate(() => window.__restorePut());
  await d.getByRole('button', { name: '記録する' }).click();
  await waitClosed(page);
  assert.equal((await dumpDb(page)).events.length, 1);
  assert.match(await page.locator('main').textContent(), /¥1,234/);
});

await test('D03/D07 書き出し → 別の空の環境へ復元 → ID・履歴・確定・支出・ごほうび・契約・設定が一致', async (mk) => {
  const ctxA = await mk();
  const a = await newPage(ctxA);
  await seedBasic(a);
  // サブスクと設定も
  await go(a, '#/subs');
  await a.getByRole('button', { name: '入居' }).first().click();
  await dialog(a).getByRole('textbox', { name: 'サービス名' }).fill('テスト音楽');
  await dialog(a).getByRole('textbox', { name: '金額' }).fill('1080');
  await dialog(a).getByRole('button', { name: '入居する' }).click();
  await waitClosed(a);
  await go(a, '#/settings');
  await a.getByRole('radio', { name: 'よる' }).click();
  await a.waitForTimeout(200);
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'JSONを書き出す（ダウンロード）' }).click()]);
  const fileName = download.suggestedFilename();
  assert.match(fileName, /^chiritsumo-backup-20261008-1200\.json$/);
  const text = await readFile(await download.path(), 'utf8');
  await writeFile(`${OUT}/sample-backup-fictional.json`, text);
  const backup = JSON.parse(text);
  assert.equal(backup.appId, 'futokoro-machi');
  assert.equal(backup.schemaVersion, 1);
  // D07: 書き出しの記録はあるが、クラウド保管完了とは表示しない
  await a.waitForTimeout(200);
  const settingsText = await a.locator('main').textContent();
  assert.match(settingsText, /最後に書き出した日時/);
  assert.match(settingsText, /保存が完了したかは、アプリでは確認できません/);
  assert.doesNotMatch(settingsText, /バックアップ完了|保存完了|クラウドに保存しました/);
  await a.screenshot({ path: `${OUT}/D07-settings-after-export.png`, fullPage: true });
  const dbA = await dumpDb(a);

  const ctxB = await mk();
  const b = await newPage(ctxB);
  await open(b, '#/settings');
  await b.setInputFiles('input[type=file]', { name: fileName, mimeType: 'application/json', buffer: Buffer.from(text) });
  await b.getByText('読み込めるファイルです。').waitFor();
  await b.screenshot({ path: `${OUT}/D03-restore-preview.png`, fullPage: true });
  await b.getByLabel('今のデータがすべてファイルの内容に置き換わることを理解しました').check();
  await b.getByRole('button', { name: '置き換えて復元する' }).click();
  await dialog(b).getByRole('button', { name: '置き換えて復元' }).click();
  await b.getByText('復元しました。').waitFor();
  assert.match(await b.locator('main').textContent(), /一致することを確かめました/);
  const dbB = await dumpDb(b);
  for (const c of ['accounts', 'snapshots', 'events', 'contracts', 'contractTerms', 'paymentLinks', 'closes']) {
    const sort = (arr) => [...arr].sort((x, y) => x.id.localeCompare(y.id));
    assert.deepEqual(sort(dbB[c]), sort(dbA[c]), c);
  }
  assert.deepEqual(
    dbB.meta.find((m) => m.key === 'settings'),
    dbA.meta.find((m) => m.key === 'settings'),
  );
  assert.equal(await b.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await go(b, '#/home');
  assert.equal((await b.locator('.hero-num').first().textContent()).trim(), '¥70,000');
  await go(b, '#/assets/month/2026-09');
  assert.match(await b.locator('.status-line').textContent(), /確定.*第1版/);
  noErrors(a);
  noErrors(b);
});

await test('D04 壊れたJSON・別アプリ・新しすぎる版は拒否し、今のデータは変えない', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await seedBasic(page);
  const before = await dumpDb(page);
  await go(page, '#/settings');
  const cases = [
    ['broken.json', '{"appId":"futokoro-machi","schemaVersion":1,"data":{"accounts":[', /JSONとして読み込めません/],
    ['subseat.json', JSON.stringify({ version: '0.7.1', subs: [{ name: 'x' }] }), /チリツモのバックアップではありません/],
    ['future.json', JSON.stringify({ appId: 'futokoro-machi', schemaVersion: 99, exportedAt: '2030-01-01T00:00:00.000+09:00', data: {} }), /新しい版/],
    [
      'invalid.json',
      JSON.stringify({ appId: 'futokoro-machi', schemaVersion: 1, exportedAt: '2026-10-08T12:00:00.000+09:00', data: { accounts: [{ id: 'x' }] } }),
      /復元できないファイル/,
    ],
  ];
  for (const [name, body, re] of cases) {
    await page.setInputFiles('input[type=file]', { name, mimeType: 'application/json', buffer: Buffer.from(body) });
    await page.locator('.error-box').waitFor();
    assert.match(await page.locator('.error-box').textContent(), re, name);
    assert.match(await page.locator('.error-box').textContent(), /今のデータには何も変更していません/);
  }
  await page.screenshot({ path: `${OUT}/D04-rejected.png`, fullPage: true });
  const after = await dumpDb(page);
  assert.deepEqual(after, before);
  noErrors(page);
});

await test('D05 復元の途中で保存に失敗しても、既存データはそのまま（混ざらない）', async (mk) => {
  const ctxA = await mk();
  const a = await newPage(ctxA);
  await open(a, '#/home', { query: '?demo=1' });
  await a.waitForFunction(() => document.querySelector('.hero-num'));
  await go(a, '#/settings');
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'JSONを書き出す（ダウンロード）' }).click()]);
  const text = await readFile(await download.path(), 'utf8');

  const ctxB = await mk();
  const b = await newPage(ctxB);
  await seedBasic(b);
  const before = await dumpDb(b);
  await go(b, '#/settings');
  await b.setInputFiles('input[type=file]', { name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await b.getByText('読み込めるファイルです。').waitFor();
  // 20件目の書き込みで失敗させる
  await b.evaluate(() => {
    const orig = IDBObjectStore.prototype.add;
    let n = 0;
    window.__restoreAdd = () => (IDBObjectStore.prototype.add = orig);
    IDBObjectStore.prototype.add = function (...args) {
      n += 1;
      if (n === 20) throw new DOMException('disk full', 'QuotaExceededError');
      return orig.apply(this, args);
    };
  });
  await b.getByLabel('今のデータがすべてファイルの内容に置き換わることを理解しました').check();
  await b.getByRole('button', { name: '置き換えて復元する' }).click();
  await dialog(b).getByRole('button', { name: '置き換えて復元' }).click();
  await b.getByText('復元できませんでした').waitFor();
  assert.match(await dialog(b).textContent(), /今のデータはそのまま残っています/);
  await b.screenshot({ path: `${OUT}/D05-restore-failed.png` });
  await b.evaluate(() => window.__restoreAdd());
  const after = await dumpDb(b);
  assert.deepEqual(after, before);
  await b.reload();
  await b.waitForSelector('html[data-ready="1"]');
  await go(b, '#/home');
  assert.equal((await b.locator('.hero-num').first().textContent()).trim(), '¥70,000');
});

await test('D06 端末内データが壊れていたらエラーを表示し、初期化もサンプル投入もしない（バックアップで復旧できる）', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await seedBasic(page);
  await go(page, '#/settings');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONを書き出す（ダウンロード）' }).click()]);
  const backupText = await readFile(await bk.path(), 'utf8');
  await go(page, '#/home');
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('futokoro-machi');
        req.onsuccess = () => {
          const tx = req.result.transaction('events', 'readwrite');
          tx.objectStore('events').put({ id: 'evt_broken', kind: 'expense', amountYen: 'abc' });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page.getByText('保存データを読み込めませんでした').waitFor();
  const t = await page.locator('#app').textContent();
  assert.match(t, /初期化したり、見本のデータで置き換えたりはしていません/);
  await page.screenshot({ path: `${OUT}/D06-load-error.png`, fullPage: true });
  const db = await dumpDb(page);
  assert.equal(db.events.length, 3, '壊れた記録も含め、そのまま残る');
  assert.equal(db.accounts.length, 3);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '中身をそのまま書き出す（調査用）' }).click()]);
  const dump = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(dump.rescue, true);
  assert.equal(dump.data.events.length, 3);
  // 調査用の書き出しは、そのままでは復元に使えない（壊れた中身を持ち込まない）
  await page.setInputFiles('input[type=file]', { name: 'rescue.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(dump)) });
  await page.locator('.error-box .error-box').waitFor();
  // 端末の外に保管したバックアップで置き換えて復旧
  await page.setInputFiles('input[type=file]', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
  await dialog(page).getByRole('button', { name: '置き換えて復元' }).click();
  await page.waitForSelector('html[data-ready="1"]', { timeout: 10000 });
  await go(page, '#/home');
  assert.equal((await page.locator('.hero-num').first().textContent()).trim(), '¥70,000');
  const fixed = await dumpDb(page);
  assert.equal(fixed.events.length, 2);
  assert.ok(!fixed.events.some((e) => e.id === 'evt_broken'));
});

await test('他タブ：古い画面の保存で新しい内容を上書きしない', async (mk) => {
  const ctx = await mk();
  const p1 = await newPage(ctx);
  await open(p1);
  // 2つめのタブは他タブ通知を受け取れない状況を作る（通知がなくても上書きしないことの確認）
  const p2 = await newPage(ctx);
  await p2.addInitScript(() => {
    delete window.BroadcastChannel;
  });
  await open(p2);
  await addExpense(p1, { amount: 111, category: '食費' });
  // p2 は古い状態のまま保存しようとする
  await p2.locator('.fab').click();
  const d = dialog(p2);
  await d.getByRole('textbox', { name: '金額' }).fill('222');
  await d.getByRole('radio', { name: '交通' }).click();
  await d.getByRole('button', { name: '記録する' }).click();
  await d.locator('.form-error').waitFor();
  assert.match(await d.locator('.form-error').textContent(), /別のタブ.*保存しませんでした/);
  assert.equal(await d.getByRole('textbox', { name: '金額' }).inputValue(), '222');
  // 最新を読み込んだので、もう一度押せば保存できる
  await d.getByRole('button', { name: '記録する' }).click();
  await waitClosed(p2);
  const db = await dumpDb(p2);
  assert.deepEqual(
    db.events.map((e) => e.amountYen).sort((x, y) => x - y),
    [111, 222],
  );
  // 通知を受け取れなかったタブも、画面に戻ったときに読み直す
  await p1.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p1.waitForFunction(() => document.querySelector('main').textContent.includes('¥222'), null, { timeout: 5000 });
  // 通知を受け取れるタブどうしは、保存と同時に読み直す
  const p3 = await newPage(ctx);
  await open(p3);
  await addExpense(p3, { amount: 333, category: '旅行' });
  await p1.waitForFunction(() => document.querySelector('main').textContent.includes('¥333'), null, { timeout: 5000 });
  assert.match(await toastText(p1), /別のタブで保存された変更を読み込みました/);
  noErrors(p1);
  noErrors(p3);
});

await test('D08 別のブラウザ（別の保存領域）には自動同期されない', async (mk) => {
  const a = await newPage(await mk());
  await seedBasic(a);
  const b = await newPage(await mk());
  await open(b);
  assert.match(await b.locator('main').textContent(), /チリツモへようこそ/);
  await go(b, '#/settings');
  assert.match(await b.locator('main').textContent(), /別のスマホや別のブラウザでは別のデータです（自動同期はありません）/);
});

await test('D09 新しい版のデータベースを見つけても削除せず、エラーで止まる', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await seedBasic(page);
  // 将来の版（2）へ上げたDBを作る（中身はそのまま）
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('futokoro-machi', 2);
        req.onupgradeneeded = () => {};
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => {};
      }),
  );
  await page.reload();
  await page.getByText('保存データを読み込めませんでした').waitFor();
  assert.match(await page.locator('#app').textContent(), /新しい版/);
  const db = await dumpDb(page);
  assert.equal(db.accounts.length, 3);
  assert.equal(db.closes.length, 1);
});

await test('D10 同じドメインの旧サブスク荘の保存キーと別アプリのキャッシュを壊さない', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx, { clock: false });
  await page.goto(`${ORIGIN}/subseat/`);
  await page.evaluate(async () => {
    localStorage.setItem('subseat:v1', JSON.stringify({ subs: [{ name: 'テスト' }], v: '0.7.1' }));
    const c = await caches.open('subseat-v0.7.1');
    await c.put('/subseat/index.html', new Response('old app'));
    await caches.open('futokoro-machi-shell-0.9.0'); // 自分の古いキャッシュ（消してよい）
    await caches.open('futokoro-machi-fonts-1'); // 以前の版の書体キャッシュ（自分のもの。消してよい）
  });
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await caches.keys()).includes('futokoro-machi-shell-1.2.0'), null, { timeout: 10000 });
  await addExpense(page, { amount: 500, category: '食費' });
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]');
  await page.waitForTimeout(300);
  const info = await page.evaluate(async () => ({
    ls: localStorage.getItem('subseat:v1'),
    keys: await caches.keys(),
    scope: (await navigator.serviceWorker.getRegistration())?.scope,
    old: await (await (await caches.open('subseat-v0.7.1')).match('/subseat/index.html'))?.text(),
  }));
  assert.equal(info.ls, JSON.stringify({ subs: [{ name: 'テスト' }], v: '0.7.1' }));
  assert.ok(info.keys.includes('subseat-v0.7.1'), '別アプリのキャッシュが残る');
  assert.equal(info.old, 'old app');
  assert.ok(!info.keys.includes('futokoro-machi-shell-0.9.0'), '自分の古いキャッシュは整理する');
  assert.ok(!info.keys.includes('futokoro-machi-fonts-1'), '使わなくなった自分の書体キャッシュも整理する');
  assert.equal(info.scope, `${BASE}`);
  // オフラインでも開ける（データは端末内）
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]');
  assert.match(await page.locator('main').textContent(), /¥500/);
  await ctx.setOffline(false);
  noErrors(page);
});

await test('D11 狭い Android 画面（360px）：主導線が操作でき、負の純資産・日付・エラーが見切れない', async (mk) => {
  const ctx = await mk({ viewport: { width: 360, height: 740 } });
  const page = await newPage(ctx);
  await open(page, '#/home', { query: '?demo=1' });
  await page.waitForFunction(() => document.querySelector('.hero-num'));
  await dismissToasts(page);
  for (const r of ['home', 'assets', 'assets/month/2026-09', 'records', 'report/assets', 'report/spending', 'subs', 'settings']) {
    await go(page, `#/${r}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${r} が横にはみ出している (${overflow}px)`);
    await page.screenshot({ path: `${OUT}/D11-${r.replaceAll('/', '-')}.png`, fullPage: true });
  }
  await go(page, '#/home');
  const net = page.locator('.hero-num').first();
  assert.match(await net.textContent(), /^−¥/);
  const box = await net.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 360, '負の純資産が見切れない');
  // 入力シートも狭い画面で操作できる
  await page.locator('.fab').click();
  await page.screenshot({ path: `${OUT}/D11-entry-sheet.png` });
  const d = dialog(page);
  await d.getByRole('button', { name: '記録する' }).click();
  assert.match(await d.textContent(), /金額を入力してください/);
  assert.match(await d.textContent(), /カテゴリーを選んでください/);
  await page.screenshot({ path: `${OUT}/D11-entry-errors.png` });
  noErrors(page);
});

await test('操作の一巡（振替・返済・編集・削除と元に戻す・週/年の振り返り・入居→退去・管理終了・深いURL）', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await seedBasic(page);
  // 振替（NISA積立）：支出に入らない
  await go(page, '#/records');
  await page.getByRole('button', { name: '入金・振替・返済など' }).click();
  let d = dialog(page);
  await d.getByRole('radio', { name: '振替・積立' }).click();
  await d.getByRole('textbox', { name: '金額' }).fill('40000');
  await d.getByRole('combobox', { name: '移動元' }).selectOption({ label: 'テスト銀行' });
  await d.getByRole('combobox', { name: '移動先' }).selectOption({ label: 'テストNISA' });
  await d.getByRole('button', { name: '記録する' }).click();
  await waitClosed(page);
  // 奨学金の返済（利息150円が分かる）
  await page.getByRole('button', { name: '入金・振替・返済など' }).click();
  d = dialog(page);
  await d.getByRole('radio', { name: '返済' }).click();
  await d.getByRole('textbox', { name: '金額' }).fill('20000');
  await d.getByRole('textbox', { name: '利息' }).fill('150');
  await d.getByRole('button', { name: '記録する' }).click();
  await waitClosed(page);
  await go(page, '#/report/spending');
  assert.match(await page.locator('main').textContent(), /¥9,950/);
  // 編集：カテゴリーを変える（IDは同じ）
  await go(page, '#/records');
  await page.getByRole('button', { name: /食費.*¥6,800/ }).click();
  d = dialog(page);
  await d.getByRole('radio', { name: '旅行' }).click();
  await d.getByRole('button', { name: '保存する' }).click();
  await waitClosed(page);
  let db = await dumpDb(page);
  const edited = db.events.find((e) => e.amountYen === 6800);
  assert.equal(edited.categoryId, 'travel');
  assert.equal(edited.revision, 2);
  // 削除して元に戻す
  await page.getByRole('button', { name: /遊び.*¥3,000/ }).click();
  await dialog(page).getByRole('button', { name: '削除' }).click();
  await dialog(page).getByRole('button', { name: '削除する' }).click();
  await waitClosed(page);
  await page.locator('.toast-action', { hasText: '取り消す' }).click();
  await page.waitForTimeout(300);
  db = await dumpDb(page);
  assert.equal(db.events.find((e) => e.amountYen === 3000).deletedAt, null);
  // 週・年の振り返り
  await go(page, '#/report/spending');
  await page.getByRole('radio', { name: '週' }).click();
  assert.match(await page.locator('main').textContent(), /10\/5〜10\/11/);
  await page.getByRole('radio', { name: '年' }).click();
  assert.match(await page.locator('main').textContent(), /2026年の記録済み支出/);
  await page.screenshot({ path: `${OUT}/flow-report-year.png`, fullPage: true });
  // サブスク：内見 → 入居 → 退去予定
  await go(page, '#/subs');
  await page.getByRole('button', { name: '入居' }).first().click();
  d = dialog(page);
  await d.getByRole('textbox', { name: 'サービス名' }).fill('テスト漫画');
  await d.getByRole('radio', { name: '内見中（無料体験）' }).click();
  await d.getByRole('textbox', { name: '金額' }).fill('600');
  await d.getByRole('button', { name: '入居する' }).click();
  await waitClosed(page);
  await page.getByRole('link', { name: /テスト漫画/ }).click();
  await page.getByRole('button', { name: '入居（有料にする）' }).click();
  await dialog(page).getByRole('button', { name: '保存する' }).click();
  await waitClosed(page);
  await page.getByRole('button', { name: '退去（解約）' }).click();
  d = dialog(page);
  await d.locator('input[type=date]').nth(1).fill('2026-11-15');
  await d.getByRole('button', { name: '退去を記録' }).click();
  await waitClosed(page);
  assert.match(await page.locator('main').textContent(), /退去予定/);
  await page.screenshot({ path: `${OUT}/flow-contract.png`, fullPage: true });
  await go(page, '#/subs');
  assert.match(await page.locator('main').textContent(), /節約できた実績ではありません/);
  // 口座の管理終了（解約して0円）
  await go(page, '#/assets');
  await page.getByRole('link', { name: /テストNISA/ }).click();
  await page.getByRole('button', { name: '編集' }).click();
  d = dialog(page);
  await d.getByText('解約・完済・管理終了').click();
  await d.getByLabel('この口座の管理を終える').check();
  await d.getByRole('button', { name: '保存する' }).click();
  await dialog(page).getByRole('button', { name: '変更する' }).click();
  await waitClosed(page);
  assert.match(await page.locator('main').textContent(), /解約・完済/);
  // 深いURLを直接開く・再読み込み
  await page.goto(`${BASE}#/assets/month/2026-09`);
  await page.waitForSelector('html[data-ready="1"]');
  assert.match(await page.locator('h1').textContent(), /2026年9月末/);
  await page.goto(`${ORIGIN}/money#/report/spending`);
  await page.waitForSelector('html[data-ready="1"]');
  assert.match(await page.locator('main').textContent(), /支出の振り返り/);
  noErrors(page);
});

await test('はじめの準備 → 先月末の残高をまとめて記録 → そのまま確定（金色のブロック）', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await open(page);
  await page.getByRole('button', { name: 'はじめの準備をする' }).click();
  let d = dialog(page);
  const names = await d.getByRole('textbox', { name: '名前' }).evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(names, ['給与の口座', '貯金の口座', 'NISA', '奨学金']);
  await d.getByRole('textbox', { name: '名前' }).nth(1).fill('貯金の口座（テスト）');
  await d.getByRole('textbox', { name: '当初の元金' }).fill('2400000');
  await page.screenshot({ path: `${OUT}/setup-wizard.png`, fullPage: true });
  await d.getByRole('button', { name: 'この内容で始める' }).click();
  // 続けて 9月末のまとめ入力が開く
  await page.waitForFunction(() => document.querySelector('.sheet-title')?.textContent.includes('2026年9月末の残高'));
  d = dialog(page);
  for (const [label, v] of [
    ['給与の口座の残高', '85000'],
    ['貯金の口座（テスト）の残高', '420000'],
    ['NISAの評価額', '310000'],
    ['奨学金の元金の残高', '1460000'],
  ]) {
    await d.getByRole('textbox', { name: label }).fill(v);
  }
  await page.screenshot({ path: `${OUT}/bulk-month-end.png`, fullPage: true });
  await d.getByRole('button', { name: '9/30 の終了時点の残高として記録' }).click();
  await waitClosed(page);
  assert.match(await toastText(page), /2026年9月末を確定しました/);
  const db = await dumpDb(page);
  assert.equal(db.accounts.length, 4);
  assert.ok(db.accounts.every((a) => a.managedFrom === '2026-09-30'));
  assert.equal(db.accounts.find((a) => a.type === 'loan').initialPrincipalYen, 2_400_000);
  assert.equal(db.snapshots.length, 4);
  assert.ok(db.snapshots.every((x) => x.asOfDate === '2026-09-30' && x.kind === 'actual' && x.monthEndVerified));
  assert.equal(db.closes.length, 1);
  assert.equal(db.closes[0].totals.net, 85000 + 420000 + 310000 - 1460000);
  assert.equal(db.meta.find((m) => m.key === 'settings').value.quickMoves.length, 4);
  // ホーム：確定のブロック・チリツモ山・返済のメーター
  await go(page, '#/home');
  assert.equal((await page.locator('.hero-num').first().textContent()).trim(), '−¥645,000');
  assert.equal(await page.locator('.block.st-confirmed').count(), 1);
  assert.match(await page.locator('.hero-caption').textContent(), /確定 1か月/);
  assert.equal(await page.locator('.meter span.on').count(), 8, '当初240万円・残り146万円 → 20マスのうち8');
  await page.screenshot({ path: `${OUT}/setup-home.png`, fullPage: true });
  noErrors(page);
});

await test('いつもの動き：1タップで呼び出して記録、新しく登録もできる', async (mk) => {
  const ctx = await mk();
  const page = await newPage(ctx);
  await open(page);
  await page.getByRole('button', { name: 'はじめの準備をする' }).click();
  await dialog(page).getByRole('radio', { name: '今日から' }).click();
  await dialog(page).getByRole('button', { name: 'この内容で始める' }).click();
  await waitClosed(page);
  await go(page, '#/records');
  await page.getByRole('button', { name: /貯金の口座へ/ }).click();
  let d = dialog(page);
  assert.equal(await d.getByRole('radio', { name: '振替・積立' }).getAttribute('aria-checked'), 'true');
  assert.equal(await d.getByRole('combobox', { name: '移動元' }).locator('option:checked').textContent(), '給与の口座');
  assert.equal(await d.getByRole('combobox', { name: '移動先' }).locator('option:checked').textContent(), '貯金の口座');
  await d.getByRole('textbox', { name: '金額' }).fill('35000');
  await d.getByRole('button', { name: '記録する' }).click();
  await waitClosed(page);
  let db = await dumpDb(page);
  const ev = db.events[0];
  assert.equal(ev.kind, 'transfer');
  assert.equal(ev.amountYen, 35000);
  assert.equal(ev.memo, '貯金の口座へ');
  // 新しい動きを「いつもの動き」に登録（金額も覚える）
  await page.getByRole('button', { name: '入金・振替・返済など' }).click();
  d = dialog(page);
  await d.getByRole('radio', { name: 'カード精算' }).click();
  await d.getByRole('textbox', { name: '金額' }).fill('12000');
  await d.getByLabel('この内容を「いつもの動き」に登録する').check();
  await d.getByRole('textbox', { name: 'いつもの動きの名前' }).fill('カードの引き落とし');
  await d.getByRole('button', { name: '記録する' }).click();
  await waitClosed(page);
  db = await dumpDb(page);
  const moves = db.meta.find((m) => m.key === 'settings').value.quickMoves;
  assert.equal(moves.length, 5);
  assert.deepEqual([moves[4].label, moves[4].kind, moves[4].amountYen], ['カードの引き落とし', 'card_payment', 12000]);
  assert.equal(db.events.length, 2);
  // 設定から消せる
  await go(page, '#/settings');
  await page.getByRole('button', { name: 'カードの引き落としを消す' }).click();
  await dialog(page).getByRole('button', { name: '消す' }).click();
  await waitClosed(page);
  db = await dumpDb(page);
  assert.equal(db.meta.find((m) => m.key === 'settings').value.quickMoves.length, 4);
  assert.equal(db.events.length, 2, '記録済みの動きは残る');
  noErrors(page);
});

await test('Fold：開いた画面は左のメニュー＋2段組み、閉じた画面は下のメニュー＋1段', async (mk) => {
  const inner = await newPage(await mk(INNER));
  await open(inner, '#/home', { query: '?demo=1' });
  await inner.waitForFunction(() => document.querySelector('.hero-num'));
  const rail = await inner.locator('.tabbar').boundingBox();
  assert.ok(rail.x === 0 && rail.width < 120 && rail.height > 800, `左のメニュー ${JSON.stringify(rail)}`);
  const cols = await inner.locator('.cols > .col').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  assert.ok(cols.length === 2 && cols[1] > cols[0] + 200, `2段組み ${cols}`);
  const fab = await inner.locator('.fab').boundingBox();
  assert.ok(fab.x < 100 && fab.y < 220, `支出ボタンは左のメニューの中 ${JSON.stringify(fab)}`);
  assert.equal(await inner.locator('.topbar').isVisible(), false);
  await inner.locator('.fab').click();
  const sheet = await inner.locator('.sheet').boundingBox();
  assert.ok(sheet.width <= 560 && sheet.x > 120, `入力は中央のダイアログ ${JSON.stringify(sheet)}`);
  await inner.screenshot({ path: `${OUT}/fold-inner-entry.png` });
  // 横向き
  await inner.setViewportSize({ width: 860, height: 760 });
  await inner.keyboard.press('Escape');
  await waitClosed(inner);
  for (const r of ['assets', 'subs', 'report/spending', 'settings']) {
    await go(inner, `#/${r}`);
    const overflow = await inner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${r} が横にはみ出している`);
  }

  const cover = await newPage(await mk());
  await open(cover, '#/home', { query: '?demo=1' });
  await cover.waitForFunction(() => document.querySelector('.hero-num'));
  const bar = await cover.locator('.tabbar').boundingBox();
  assert.ok(bar.y > 800 && bar.width === 412, '下のメニュー');
  assert.equal(await cover.locator('.tabbar .tab-link:visible').count(), 5, '閉じた画面のメニューは5つ');
  const cols2 = await cover.locator('.cols > .col').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  assert.equal(cols2[0], cols2[1], '1段に積む');
  noErrors(inner);
  noErrors(cover);
});

await test('Fold：半分折ったフレックスモードでは、入力シートが下半分（本の形なら右半分）に入る', async (mk) => {
  const ctx = await mk(INNER);
  const page = await newPage(ctx);
  await open(page, '#/home', { query: '?demo=1' });
  await page.waitForFunction(() => document.querySelector('.hero-num'));
  const cdp = await ctx.newCDPSession(page);
  const fold = (o) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width: o === 'horizontal' ? 760 : 860,
      height: o === 'horizontal' ? 860 : 760,
      deviceScaleFactor: 2,
      mobile: true,
      displayFeature: { orientation: o, offset: 430, maskLength: 0 },
    });
  // Playwright の操作は画面のエミュレーションを上書きするので、ここでは DevTools プロトコルとページ内の操作だけを使う
  for (const [o, expect] of [
    ['horizontal', { x: 0, y: 430, w: 760, h: 430 }],
    ['vertical', { x: 430, y: 0, w: 430, h: 760 }],
  ]) {
    await fold(o);
    await new Promise((r) => setTimeout(r, 300));
    const box = await page.evaluate(
      () =>
        new Promise((res) => {
          document.querySelector('.fab').click();
          setTimeout(() => {
            const b = document.querySelector('.sheet').getBoundingClientRect();
            res({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) });
          }, 500);
        }),
    );
    assert.deepEqual(box, expect, o);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${OUT}/fold-flex-${o}.png`, Buffer.from(shot.data, 'base64'));
    await page.evaluate(() => document.querySelector('.sheet-head .icon-btn').click());
    await new Promise((r) => setTimeout(r, 400));
  }
  noErrors(page);
});

await test('ダークテーマ・デモ（架空データ）の全画面表示', async (mk) => {
  const ctx = await mk({ colorScheme: 'dark' });
  const page = await newPage(ctx);
  await open(page, '#/home', { query: '?demo=1' });
  await page.waitForFunction(() => document.querySelector('.hero-num'));
  await dismissToasts(page);
  for (const r of ['home', 'subs', 'report/spending']) {
    await go(page, `#/${r}`);
    await page.screenshot({ path: `${OUT}/dark-${r.replaceAll('/', '-')}.png`, fullPage: true });
  }
  // デモは本人用の保存場所を使わない
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  assert.ok(dbs.includes('futokoro-machi-demo'));
  assert.ok(!dbs.includes('futokoro-machi'));
  noErrors(page);
});

// ---------------------------------------------------------------------------

await browser.close();
server.close();
const failed = results.filter((r) => r[1] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await writeFile(
  `${OUT}/results.json`,
  JSON.stringify(
    results.map(([n, s, ms, e]) => ({ name: n, status: s, ms, error: e ? String(e.message ?? e) : undefined })),
    null,
    1,
  ),
);
process.exit(failed.length ? 1 : 0);
