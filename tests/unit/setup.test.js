// はじめの準備・月末のまとめ入力・いつもの動き
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from './helpers.js';
import * as A from '../../app/js/core/actions.js';
import { effectiveClose, monthReport } from '../../app/js/core/closes.js';
import { monthEndStatus } from '../../app/js/core/assets.js';
import { validateDataset } from '../../app/js/core/validate.js';
import { buildExport, parseBackup } from '../../app/js/core/backup.js';

const PRESET = [
  { role: 'salary', name: '給与の口座', type: 'bank' },
  { role: 'savings', name: '貯金の口座', type: 'bank' },
  { role: 'nisa', name: 'NISA', type: 'investment' },
  { role: 'loan', name: '奨学金', type: 'loan', initialPrincipalYen: null },
];

test('はじめの準備：4口座をまとめて登録し、いつもの動き（振替・積立・返済・給与）を用意する', () => {
  const w = new World('2026-10-08');
  const r = w.run(A.setupAccounts(w.state, { managedFrom: '2026-09-30', accounts: PRESET, quickMoves: true }, w.ctx()));
  assert.equal(w.state.accounts.length, 4);
  assert.ok(w.state.accounts.every((a) => a.managedFrom === '2026-09-30' && a.startKind === 'existing'));
  const [salary, savings, nisa, loan] = r.records;
  const moves = w.state.settings.quickMoves;
  assert.deepEqual(
    moves.map((m) => [m.label, m.kind, m.fromAccountId, m.toAccountId, m.amountYen]),
    [
      ['貯金の口座へ', 'transfer', salary.id, savings.id, null],
      ['NISAの積立', 'transfer', salary.id, nisa.id, null],
      ['奨学金の返済（引き落とし）', 'repayment', savings.id, loan.id, null],
      ['給与', 'income', null, salary.id, null],
    ],
  );
  assert.deepEqual(validateDataset(w.state), []);
  // 9月末から管理 → 9月末がチェック対象
  assert.equal(monthEndStatus(w.state, '2026-09', w.today).items.length, 4);
});

test('はじめの準備：口座を選ばなければ何も作らない', () => {
  const w = new World('2026-10-08');
  assert.equal(A.setupAccounts(w.state, { managedFrom: '2026-10-08', accounts: [] }, w.ctx()).ok, false);
});

test('月末のまとめ入力：4口座の月末残高を記録して、そのまま確定（1つの保存で）', () => {
  const w = new World('2026-10-08');
  const [salary, savings, nisa, loan] = w.run(A.setupAccounts(w.state, { managedFrom: '2026-08-31', accounts: PRESET }, w.ctx())).records;
  const entries = [
    { accountId: salary.id, amountYen: 120_000 },
    { accountId: savings.id, amountYen: 500_000 },
    { accountId: nisa.id, amountYen: 300_000 },
    { accountId: loan.id, amountYen: 1_200_000 },
  ];
  w.run(A.recordMonthEndBatch(w.state, '2026-08', entries, { confirm: true }, w.ctx()));
  const res = A.recordMonthEndBatch(
    w.state,
    '2026-09',
    entries.map((e) => ({ ...e, amountYen: e.amountYen + (e.accountId === loan.id ? -15_000 : 10_000) })),
    { confirm: true },
    w.ctx(),
  );
  assert.equal(res.ok, true);
  assert.equal(res.changes.put.snapshots.length, 4);
  assert.equal(res.changes.add.closes.length, 1, '確定も同じ変更に含む');
  w.run(res);
  assert.ok(w.state.snapshots.every((s) => s.kind === 'actual' && s.monthEndVerified));
  assert.equal(effectiveClose(w.state, '2026-09', w.today).status, 'confirmed');
  assert.equal(monthReport(w.state, '2026-09', w.today).prevMonthComparison.delta.net, 45_000);
});

test('月末のまとめ入力：1件でも失敗したら何も保存しない／まだ来ていない月末は不可', () => {
  const w = new World('2026-10-08');
  const [salary, savings] = w.run(A.setupAccounts(w.state, { managedFrom: '2026-09-30', accounts: PRESET.slice(0, 2) }, w.ctx())).records;
  w.balance(salary, '2026-09-30', 1000);
  const r = A.recordMonthEndBatch(
    w.state,
    '2026-09',
    [
      { accountId: savings.id, amountYen: 5000 },
      { accountId: salary.id, amountYen: 2000 },
    ],
    { confirm: true },
    w.ctx(),
  );
  assert.equal(r.ok, false);
  assert.match(r.message, /給与の口座：この月末の残高はすでに記録されています/);
  assert.equal(A.recordMonthEndBatch(w.state, '2026-10', [{ accountId: savings.id, amountYen: 1 }], {}, w.ctx()).code, 'not_ended');
  // 残りがそろえば、記録なしで確定だけもできる
  w.run(A.recordMonthEndBatch(w.state, '2026-09', [{ accountId: savings.id, amountYen: 5000 }], { confirm: true }, w.ctx()));
  assert.equal(effectiveClose(w.state, '2026-09', w.today).close.totals.net, 6000);
});

test('いつもの動き：追加・削除・検証、口座を消すと参照を外す、バックアップに含まれる', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空の給与口座', 'bank');
  const spare = w.account('使わない口座', 'bank');
  const m = w.run(
    A.addQuickMove(w.state, { label: '貯金へ', kind: 'transfer', amountYen: 25_000, fromAccountId: bank.id, toAccountId: spare.id }, w.ctx()),
  ).record;
  assert.equal(w.state.settings.quickMoves[0].amountYen, 25_000);
  assert.equal(A.addQuickMove(w.state, { label: '', kind: 'transfer' }, w.ctx()).ok, false);
  assert.equal(A.addQuickMove(w.state, { label: 'x', kind: 'expense' }, w.ctx()).ok, false);
  assert.equal(A.addQuickMove(w.state, { label: 'x', kind: 'income', amountYen: 1.5 }, w.ctx()).ok, false);
  w.run(A.deleteAccount(w.state, spare.id));
  assert.equal(w.state.settings.quickMoves[0].toAccountId, null);
  assert.deepEqual(validateDataset(w.state), []);
  const parsed = parseBackup(JSON.stringify(buildExport(w.state, '2026-10-08T12:00:00.000+09:00')));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.settings.quickMoves, w.state.settings.quickMoves);
  w.run(A.removeQuickMove(w.state, m.id));
  assert.equal(w.state.settings.quickMoves.length, 0);
  // 存在しない口座を指す動きは復元で拒否
  const bad = buildExport(w.state, '2026-10-08T12:00:00.000+09:00');
  bad.data.settings.quickMoves = [{ id: 'move_x', label: 'x', kind: 'transfer', amountYen: null, fromAccountId: 'acc_none', toAccountId: null }];
  delete bad.summary;
  assert.equal(parseBackup(JSON.stringify(bad)).code, 'invalid');
});
