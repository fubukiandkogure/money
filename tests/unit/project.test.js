// 配信物の点検：デモデータの妥当性、Service Worker の対象一覧、公開物に個人データを入れないこと
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDemo } from '../../app/js/demo.js';
import { validateDataset } from '../../app/js/core/validate.js';
import { effectiveClose } from '../../app/js/core/closes.js';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

test('デモの架空データは検証に通り、本人データの初期値ではない', () => {
  for (const today of ['2026-10-08', '2026-11-01', '2026-03-31', '2027-01-15']) {
    const state = seedDemo(today);
    assert.deepEqual(validateDataset(state), [], today);
    assert.ok(state.accounts.every((a) => a.name.startsWith('架空')));
    assert.ok(state.contracts.every((c) => c.displayName.startsWith('架空')));
    assert.ok(state.closes.length >= 2);
    assert.ok(state.closes.every((c) => effectiveClose(state, c.yearMonth, today).status === 'confirmed'));
  }
});

test('Service Worker が配信物をすべて事前キャッシュの対象にしている', async () => {
  const sw = await readFile(join(APP, 'sw.js'), 'utf8');
  const files = (await walk(APP)).map((p) => `./${relative(APP, p).split('\\').join('/')}`).filter((p) => p !== './sw.js' && !p.endsWith('icon-maskable.svg'));
  for (const f of files) assert.ok(sw.includes(`'${f}'`), `${f} が sw.js の SHELL にありません`);
  const listed = [...sw.matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]).filter((p) => p !== './');
  for (const f of listed) assert.ok(files.includes(f), `${f} は存在しません`);
});

test('Service Worker は自分のキャッシュだけを消す（同じドメインの別アプリに触れない）', async () => {
  const sw = await readFile(join(APP, 'sw.js'), 'utf8');
  assert.match(sw, /k\.startsWith\(CACHE_PREFIX\) && k !== CACHE/);
  assert.match(sw, /const CACHE_PREFIX = 'futokoro-machi-shell-'/);
  assert.match(sw, /if \(!req\.url\.startsWith\(SCOPE\)\) return;/);
});

test('D12: 公開する配信物に実データ・バックアップ・資格情報らしきものが含まれない', async () => {
  const files = await walk(APP);
  assert.ok(!files.some((p) => p.endsWith('.json')), '配信物に JSON（バックアップ）ファイルがない');
  for (const p of files.filter((f) => /\.(js|html|css|webmanifest|svg)$/.test(f))) {
    const text = await readFile(p, 'utf8');
    assert.doesNotMatch(text, /password\s*[:=]|api[_-]?key|secret\s*[:=]|token\s*[:=]/i, p);
    assert.doesNotMatch(text, /subseat:v1'?\s*[,)]/, `${p} が旧サブスク荘の保存キーを使っていない`);
  }
});
