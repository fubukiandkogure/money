// 受け入れ条件 13.4 のうち、書き出し・検証の計算部分（D03, D04）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from './helpers.js';
import * as A from '../../app/js/core/actions.js';
import { buildExport, parseBackup, summarize, backupFileName } from '../../app/js/core/backup.js';
import { validateDataset } from '../../app/js/core/validate.js';
import { COLLECTIONS } from '../../app/js/core/constants.js';

function fullWorld() {
  const w = new World('2026-10-20');
  const bank = w.account('架空銀行', 'bank');
  const nisa = w.account('架空NISA', 'investment');
  const loan = w.account('架空奨学金', 'loan', { initialPrincipalYen: 2_400_000 });
  const s = w.balance(bank, '2026-08-31', 200_000);
  w.balance(nisa, '2026-08-31', 100_000);
  w.balance(loan, '2026-08-31', 300_000);
  w.confirm('2026-08');
  w.run(
    A.addSnapshot(
      w.state,
      { accountId: bank.id, asOfDate: '2026-08-31', amountYen: 210_000, kind: 'actual', monthEndVerified: true, revisionOf: s.id },
      w.ctx(),
    ),
  );
  w.balance(bank, '2026-09-30', 250_000);
  w.balance(nisa, '2026-09-30', 104_000);
  w.balance(loan, '2026-09-30', 280_000);
  w.confirm('2026-09');
  w.run(A.addSnapshot(w.state, { accountId: nisa.id, asOfDate: '2026-10-25', amountYen: 110_000, kind: 'estimate' }, w.ctx()));
  w.expense(6800, 'food', { isLuxury: true });
  w.expense(3200, 'play', { memo: 'ボウリング' });
  const del = w.expense(999, 'other');
  w.run(A.deleteEvent(w.state, del.id, w.ctx()));
  w.event({ kind: 'transfer', amountYen: 40_000, fromAccountId: bank.id, toAccountId: nisa.id });
  w.event({ kind: 'repayment', amountYen: 20_000, toAccountId: loan.id, breakdownUnknown: true });
  w.expense(500, 'subscription', { datePrecision: 'month', yearMonth: '2026-09' });
  const c = w.run(
    A.createContract(
      w.state,
      { displayName: '架空動画', status: 'active', priceYen: 980, frequency: 'monthly', nextDueOn: '2026-10-15', startOn: '2026-01-01' },
      w.ctx(),
    ),
  ).record;
  w.run(A.changeTerms(w.state, c.id, { effectiveOn: '2026-12-01', priceYen: 1200 }, w.ctx()));
  w.run(A.confirmPayment(w.state, { contractId: c.id, ym: '2026-10', amountYen: 980, occurredOn: '2026-10-15' }, w.ctx()));
  w.run(A.createContract(w.state, { displayName: '架空体験', status: 'trial', priceYen: null, frequency: 'monthly', trialEndsOn: '2026-11-01' }, w.ctx()));
  w.run(A.updateSettings(w.state, { theme: 'dark' }));
  return w;
}

test('D03: 書き出し → 検証 → 復元データで ID・履歴・確定・支出・ごほうび・契約・設定と集計が一致', () => {
  const w = fullWorld();
  const now = '2026-10-20T21:05:00.000+09:00';
  const backup = buildExport(w.state, now);
  assert.equal(backup.appId, 'futokoro-machi');
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.exportedAt, now);
  const text = JSON.stringify(backup);
  const parsed = parseBackup(text);
  assert.equal(parsed.ok, true, parsed.errors?.join('\n'));
  for (const c of COLLECTIONS) assert.deepEqual(parsed.data[c], w.state[c], c);
  assert.deepEqual(parsed.data.settings, w.state.settings);
  assert.deepEqual(parsed.summary, summarize(w.state, '2026-10-20'));
  assert.equal(parsed.summary.closes['2026-08'].status, 'needs_review');
  assert.equal(parsed.summary.closes['2026-09'].status, 'confirmed');
  assert.equal(parsed.summary.luxuryCount, 1);
  assert.equal(parsed.summary.expenseTotal, 6800 + 3200 + 500 + 980);
  assert.equal(backupFileName(now), 'futokoro-machi-backup-20261020-2105.json');
});

test('D04: 壊れたJSON・別アプリ・未対応の新しい版は拒否', () => {
  const w = fullWorld();
  const good = buildExport(w.state, '2026-10-20T21:05:00.000+09:00');
  const text = JSON.stringify(good);
  assert.equal(parseBackup(text.slice(0, text.length / 2)).code, 'json');
  assert.equal(parseBackup('').code, 'empty');
  assert.equal(parseBackup(JSON.stringify({ ...good, appId: 'subseat' })).code, 'other_app');
  assert.equal(parseBackup(JSON.stringify({ version: 1, subs: [] })).code, 'other_app');
  assert.equal(parseBackup(JSON.stringify({ ...good, schemaVersion: 99 })).code, 'too_new');
  assert.equal(parseBackup('[]').code, 'format');
});

test('D04: 中身の改ざん・不整合（金額・参照・ID重複・確定値）は拒否', () => {
  const w = fullWorld();
  const good = buildExport(w.state, '2026-10-20T21:05:00.000+09:00');
  const clone = () => structuredClone(good);

  const b1 = clone();
  b1.data.events[0].amountYen = 1.5;
  assert.equal(parseBackup(JSON.stringify(b1)).code, 'invalid');

  const b2 = clone();
  b2.data.snapshots[0].accountId = 'acc_missing';
  assert.equal(parseBackup(JSON.stringify(b2)).code, 'invalid');

  const b3 = clone();
  b3.data.events.push(structuredClone(b3.data.events[0]));
  assert.equal(parseBackup(JSON.stringify(b3)).code, 'invalid');

  const b4 = clone();
  b4.data.closes[0].totals.net += 1;
  assert.equal(parseBackup(JSON.stringify(b4)).code, 'invalid');

  const b5 = clone();
  b5.data.events[0].amountYen += 100; // 形式は正しいが集計が合わない
  assert.equal(parseBackup(JSON.stringify(b5)).code, 'summary_mismatch');

  const b6 = clone();
  b6.data.paymentLinks[0].moneyEventId = 'evt_missing';
  assert.equal(parseBackup(JSON.stringify(b6)).code, 'invalid');

  const b7 = clone();
  b7.data.events[0].occurredOn = '2026-02-30';
  assert.equal(parseBackup(JSON.stringify(b7)).code, 'invalid');

  const b8 = clone();
  delete b8.data.closes;
  assert.equal(parseBackup(JSON.stringify(b8)).code, 'invalid');
});

test('意図的な未入力（口座未指定・料金不明・推計・未確定・月だけの日付）は破損扱いしない', () => {
  const w = fullWorld();
  assert.deepEqual(validateDataset(w.state), []);
});

test('空のデータも書き出し・復元できる', () => {
  const w = new World('2026-10-08');
  const parsed = parseBackup(JSON.stringify(buildExport(w.state, '2026-10-08T09:00:00.000+09:00')));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.summary.counts.accounts, 0);
});
