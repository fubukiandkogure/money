// 受け入れ条件 13.1（A01〜A10）と残高履歴の規則
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, must } from './helpers.js';
import * as A from '../../app/js/core/actions.js';
import { currentOverview, monthEndStatus, latestActual, loanProgress, loansSummary } from '../../app/js/core/assets.js';
import { effectiveClose, monthReport, monthlySeries, checklistMonths } from '../../app/js/core/closes.js';
import { summarizeExpenses, monthPeriod } from '../../app/js/core/spending.js';

function threeAccounts(w) {
  return {
    bank: w.account('架空銀行', 'bank'),
    inv: w.account('架空NISA', 'investment'),
    loan: w.account('架空奨学金', 'loan'),
  };
}

test('A01: 2か月とも確定・同じ範囲なら前月比を出す', () => {
  const w = new World('2026-10-08');
  const { bank, inv, loan } = threeAccounts(w);
  w.balance(bank, '2026-08-31', 200_000);
  w.balance(inv, '2026-08-31', 100_000);
  w.balance(loan, '2026-08-31', 300_000);
  w.balance(bank, '2026-09-30', 250_000);
  w.balance(inv, '2026-09-30', 100_000);
  w.balance(loan, '2026-09-30', 280_000);
  w.confirm('2026-08');
  w.confirm('2026-09');
  const aug = effectiveClose(w.state, '2026-08', w.today);
  const sep = effectiveClose(w.state, '2026-09', w.today);
  assert.equal(aug.status, 'confirmed');
  assert.equal(aug.close.totals.net, 0);
  assert.equal(sep.close.totals.net, 70_000);
  const r = monthReport(w.state, '2026-09', w.today);
  assert.equal(r.prevMonthComparison.available, true);
  assert.equal(r.prevMonthComparison.delta.net, 70_000);
  assert.equal(r.prevMonthComparison.delta.loans, -20_000);
});

test('A02: 確認日が混在する最新値は混在と分かる／9月末は未確定', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  const inv = w.account('架空NISA', 'investment');
  w.balance(bank, '2026-10-03', 210_000, { monthEnd: false });
  w.balance(inv, '2026-09-30', 100_000);
  const ov = currentOverview(w.state, w.today);
  assert.equal(ov.mixedDates, true);
  assert.equal(ov.oldestDate, '2026-09-30');
  assert.equal(ov.newestDate, '2026-10-03');
  assert.equal(ov.assets.total, 310_000);
  const ms = monthEndStatus(w.state, '2026-09', w.today);
  assert.equal(ms.canConfirm, false);
  assert.equal(ms.items.find((i) => i.account.id === bank.id).problem, 'missing');
  const res = A.confirmMonth(w.state, '2026-09', '', w.ctx());
  assert.equal(res.ok, false);
  assert.equal(effectiveClose(w.state, '2026-09', w.today).status, 'unconfirmed');
});

test('A03: 10/5 に 9/30 の実残高を入力 → 基準日9/30・記録日時10/5、そろえば確定できる', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  const s = w.balance(bank, '2026-09-30', 123_456, { recordedOn: '2026-10-05' });
  assert.equal(s.asOfDate, '2026-09-30');
  assert.ok(s.recordedAt.startsWith('2026-10-05T'));
  assert.equal(monthEndStatus(w.state, '2026-09', w.today).canConfirm, true);
  w.confirm('2026-09');
  assert.equal(effectiveClose(w.state, '2026-09', w.today).status, 'confirmed');
});

test('A04: 今月末だけ確定・前月末不明 → 前月比は出さない', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  w.balance(bank, '2026-09-30', 100_000);
  w.confirm('2026-09');
  const r = monthReport(w.state, '2026-09', w.today);
  assert.equal(r.close.status, 'confirmed');
  assert.equal(r.prevMonthComparison.available, false);
  assert.equal(r.prevMonthComparison.delta, null);
  assert.equal(r.periodComparison, null);
});

test('A05: 8月末・10月末が確定、9月末は未確定 → 期間比較（8→10月）。10月の前月比にしない', () => {
  const w = new World('2026-11-05');
  const bank = w.account('架空銀行', 'bank');
  w.balance(bank, '2026-08-31', 100_000);
  w.balance(bank, '2026-10-31', 150_000);
  w.confirm('2026-08');
  w.confirm('2026-10');
  const r = monthReport(w.state, '2026-10', w.today);
  assert.equal(r.prevMonthComparison.available, false);
  assert.equal(r.periodComparison.available, true);
  assert.equal(r.periodComparison.from, '2026-08');
  assert.equal(r.periodComparison.to, '2026-10');
  assert.equal(r.periodComparison.months, 2);
  assert.equal(r.periodComparison.delta.net, 50_000);
  // 月次推移の欠測は null（0や補間で埋めない）
  const series = monthlySeries(w.state, '2026-08', '2026-10', w.today);
  assert.deepEqual(
    series.map((s) => s.totals?.net ?? null),
    [100_000, null, 150_000],
  );
});

test('A06: 実残高がそろえば支出入力が不完全でも確定できる／支出は「記録なし」のまま', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  w.balance(bank, '2026-09-30', 100_000);
  w.confirm('2026-09');
  assert.equal(effectiveClose(w.state, '2026-09', w.today).status, 'confirmed');
  const sum = summarizeExpenses(w.state.events, monthPeriod('2026-09'));
  assert.equal(sum.hasRecords, false);
});

test('A07: 未入力は欠測、実際の0円は有効な実残高', () => {
  const w = new World('2026-10-08');
  const a = w.account('架空銀行A', 'bank');
  const b = w.account('架空銀行B', 'bank');
  w.balance(b, '2026-09-30', 0);
  const ov = currentOverview(w.state, w.today);
  assert.deepEqual(ov.missing.map((x) => x.id), [a.id]);
  assert.equal(ov.complete, false);
  assert.equal(ov.partial, true);
  assert.equal(ov.rows.find((r) => r.account.id === b.id).latest.amountYen, 0);
  const ms = monthEndStatus(w.state, '2026-09', w.today);
  assert.equal(ms.items.find((i) => i.account.id === b.id).adopted.amountYen, 0);
  assert.equal(ms.items.find((i) => i.account.id === a.id).problem, 'missing');
  assert.equal(ms.canConfirm, false);
});

test('A08: 確定に使った残高を訂正・無効化 → 履歴が残り、要再確認。再確定で新しい版', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  const loan = w.account('架空奨学金', 'loan');
  w.balance(bank, '2026-08-31', 200_000);
  w.balance(loan, '2026-08-31', 300_000);
  const s9 = w.balance(bank, '2026-09-30', 250_000);
  w.balance(loan, '2026-09-30', 280_000);
  w.confirm('2026-08');
  const c1 = w.confirm('2026-09');
  assert.equal(monthReport(w.state, '2026-09', w.today).prevMonthComparison.delta.net, 70_000);

  // 訂正
  const fixed = w.run(A.addSnapshot(w.state, { accountId: bank.id, asOfDate: '2026-09-30', amountYen: 240_000, kind: 'actual', monthEndVerified: true, revisionOf: s9.id }, w.ctx())).record;
  const e = effectiveClose(w.state, '2026-09', w.today);
  assert.equal(e.status, 'needs_review');
  assert.equal(e.reasons[0].type, 'snapshot_changed');
  assert.ok(w.state.snapshots.some((s) => s.id === s9.id), '旧記録は残る');
  // 要再確認の月とは比較しない（古い確定値を有効な実績として使い続けない）
  assert.equal(monthReport(w.state, '2026-09', w.today).prevMonthComparison.available, false);

  // 再確定
  const c2 = w.confirm('2026-09');
  assert.equal(c2.revision, 2);
  assert.equal(c2.previousId, c1.id);
  assert.equal(c2.selectedSnapshotIds[bank.id], fixed.id);
  assert.equal(monthReport(w.state, '2026-09', w.today).prevMonthComparison.delta.net, 60_000);

  // 無効化
  w.run(A.invalidateSnapshot(w.state, fixed.id, '桁違い', w.ctx()));
  const e2 = effectiveClose(w.state, '2026-09', w.today);
  assert.equal(e2.status, 'needs_review');
  assert.equal(monthEndStatus(w.state, '2026-09', w.today).canConfirm, false);
  assert.equal(w.state.snapshots.length, 5, '物理削除しない');
});

test('A09: 以前からある口座を途中から管理 → 比較を保留。新規開設なら開設前0円で比較できる', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  w.balance(bank, '2026-08-31', 100_000);
  w.balance(bank, '2026-09-30', 100_000);
  w.confirm('2026-08');
  const old = w.account('昔からの架空口座', 'bank', { managedFrom: '2026-09-15', startKind: 'existing' });
  w.balance(old, '2026-09-30', 500_000);
  w.confirm('2026-09');
  const r = monthReport(w.state, '2026-09', w.today);
  assert.equal(r.close.status, 'confirmed');
  assert.equal(r.prevMonthComparison.available, false);
  assert.equal(r.prevMonthComparison.reasons[0].type, 'added_existing');

  // 同じ状況で「新しく開設した口座」なら比較できる
  w.run(A.updateAccount(w.state, old.id, { startKind: 'new' }, w.ctx()));
  const r2 = monthReport(w.state, '2026-09', w.today);
  assert.equal(r2.prevMonthComparison.available, true);
  assert.equal(r2.prevMonthComparison.notes[0].type, 'opened');
  assert.equal(r2.prevMonthComparison.delta.net, 500_000);

  // 管理開始日を過去へ広げると、その月の確定は要再確認（対象範囲の変更）
  w.run(A.updateAccount(w.state, old.id, { managedFrom: '2026-08-01', startKind: 'existing' }, w.ctx()));
  assert.equal(effectiveClose(w.state, '2026-08', w.today).status, 'needs_review');
  assert.equal(effectiveClose(w.state, '2026-08', w.today).reasons[0].type, 'scope_added');
});

test('A09b: 解約して0円で管理を終えた口座は比較を妨げない', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  const closing = w.account('解約する架空口座', 'bank');
  w.balance(bank, '2026-08-31', 100_000);
  w.balance(closing, '2026-08-31', 50_000);
  w.confirm('2026-08');
  w.run(A.updateAccount(w.state, closing.id, { managedUntil: '2026-09-10', endKind: 'zero' }, w.ctx()));
  assert.equal(effectiveClose(w.state, '2026-08', w.today).status, 'confirmed', '8月末の対象は変わらない');
  w.balance(bank, '2026-09-30', 150_000);
  w.confirm('2026-09');
  const r = monthReport(w.state, '2026-09', w.today);
  assert.equal(r.prevMonthComparison.available, true);
  assert.equal(r.prevMonthComparison.notes[0].type, 'closed_zero');
  assert.equal(r.prevMonthComparison.delta.net, 0);
});

test('A10: 当初元金が不明なら返済額・返済率を作らない。分かる場合だけ出す', () => {
  const w = new World('2026-10-08');
  const loan = w.account('架空奨学金', 'loan');
  w.balance(loan, '2026-08-31', 300_000);
  w.balance(loan, '2026-09-30', 280_000);
  const p = loanProgress(w.state, loan, w.today);
  assert.equal(p.initial, null);
  assert.equal(p.repaid, null);
  assert.equal(p.ratio, null);
  assert.equal(p.sinceFirst.decrease, 20_000);
  assert.equal(p.sinceFirst.from.asOfDate, '2026-08-31');

  w.run(A.updateAccount(w.state, loan.id, { initialPrincipalYen: 400_000 }, w.ctx()));
  const p2 = loanProgress(w.state, w.state.accounts.find((a) => a.id === loan.id), w.today);
  assert.equal(p2.repaid, 120_000);
  assert.equal(p2.ratio, 0.3);

  const loan2 = w.account('架空奨学金2', 'loan');
  w.balance(loan2, '2026-09-30', 100_000);
  const sum = loansSummary(w.state, w.today);
  assert.equal(sum.knownCount, 1);
  assert.equal(sum.unknownCount, 1);
  assert.equal(sum.repaidTotal, 120_000);
});

test('最新値：入力が新しいだけで基準日が古い記録を最新にしない', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  w.balance(bank, '2026-10-03', 300_000, { monthEnd: false, recordedOn: '2026-10-03' });
  w.balance(bank, '2026-09-30', 250_000, { recordedOn: '2026-10-07' });
  assert.equal(latestActual(w.state.snapshots, bank.id, w.today).snapshot.amountYen, 300_000);
});

test('推計は実残高を上書きしない／未来日の実残高は保存できない', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  w.balance(bank, '2026-09-30', 100_000);
  w.run(A.addSnapshot(w.state, { accountId: bank.id, asOfDate: '2026-09-30', amountYen: 999, kind: 'estimate' }, w.ctx()));
  const ms = monthEndStatus(w.state, '2026-09', w.today);
  assert.equal(ms.items[0].adopted.amountYen, 100_000);
  assert.equal(currentOverview(w.state, w.today).assets.total, 100_000);
  const fut = A.addSnapshot(w.state, { accountId: bank.id, asOfDate: '2026-10-20', amountYen: 1, kind: 'actual' }, w.ctx());
  assert.equal(fut.ok, false);
  assert.equal(fut.code, 'future_actual');
  const futEst = A.addSnapshot(w.state, { accountId: bank.id, asOfDate: '2026-10-20', amountYen: 1, kind: 'estimate' }, w.ctx());
  assert.equal(futEst.ok, true);
});

test('月末の朝の値（終了時点か未確認）や推計だけでは月末を確定できない', () => {
  const w = new World('2026-10-08');
  const a = w.account('架空銀行', 'bank');
  const b = w.account('架空NISA', 'investment');
  w.balance(a, '2026-09-30', 100_000, { monthEnd: false });
  w.run(A.addSnapshot(w.state, { accountId: b.id, asOfDate: '2026-09-30', amountYen: 5, kind: 'estimate' }, w.ctx()));
  const ms = monthEndStatus(w.state, '2026-09', w.today);
  assert.equal(ms.items.find((i) => i.account.id === a.id).problem, 'time_unknown');
  assert.equal(ms.items.find((i) => i.account.id === b.id).problem, 'estimate_only');
  // 前日・翌日の値でも補わない
  w.balance(b, '2026-09-29', 100, { monthEnd: false });
  w.balance(b, '2026-10-01', 100, { monthEnd: false });
  assert.equal(monthEndStatus(w.state, '2026-09', w.today).canConfirm, false);
});

test('同じ日・同じ区分の記録は黙って追加せず、訂正を求める（合算しない）', () => {
  const w = new World('2026-10-08');
  const a = w.account('架空銀行', 'bank');
  const s1 = w.balance(a, '2026-10-05', 100_000, { monthEnd: false });
  const dup = A.addSnapshot(w.state, { accountId: a.id, asOfDate: '2026-10-05', amountYen: 120_000, kind: 'actual' }, w.ctx());
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'same_day_exists');
  assert.equal(dup.existing[0].id, s1.id);
  // 訂正済みの記録をもう一度訂正することはできない（系列は一本道）
  w.run(A.addSnapshot(w.state, { accountId: a.id, asOfDate: '2026-10-05', amountYen: 120_000, kind: 'actual', revisionOf: s1.id }, w.ctx()));
  const again = A.addSnapshot(w.state, { accountId: a.id, asOfDate: '2026-10-05', amountYen: 130_000, kind: 'actual', revisionOf: s1.id }, w.ctx());
  assert.equal(again.ok, false);
  assert.equal(currentOverview(w.state, w.today).assets.total, 120_000);
});

test('管理開始日より前の残高は確認してから開始日を広げる', () => {
  const w = new World('2026-10-08');
  const a = w.account('架空銀行', 'bank', { managedFrom: '2026-10-01' });
  const r = A.addSnapshot(w.state, { accountId: a.id, asOfDate: '2026-09-30', amountYen: 1000, kind: 'actual', monthEndVerified: true }, w.ctx());
  assert.equal(r.code, 'before_managed_from');
  const r2 = w.run(A.addSnapshot(w.state, { accountId: a.id, asOfDate: '2026-09-30', amountYen: 1000, kind: 'actual', monthEndVerified: true, extendManagedFrom: true }, w.ctx()));
  assert.equal(r2.accountChanged.managedFrom, '2026-09-30');
  assert.equal(monthEndStatus(w.state, '2026-09', w.today).canConfirm, true);
});

test('負の純資産も扱える（奨学金が資産より多い）', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  const loan = w.account('架空奨学金', 'loan');
  w.balance(bank, '2026-09-30', 100_000);
  w.balance(loan, '2026-09-30', 300_000);
  w.confirm('2026-09');
  assert.equal(effectiveClose(w.state, '2026-09', w.today).close.totals.net, -200_000);
  assert.equal(currentOverview(w.state, w.today).net, -200_000);
});

test('月末チェックの対象月：管理開始月〜先月（今日が月末なら今月も）', () => {
  const w = new World('2026-10-08');
  w.account('架空銀行', 'bank', { managedFrom: '2026-08-10' });
  assert.deepEqual(checklistMonths(w.state, '2026-10-08'), ['2026-09', '2026-08']);
  assert.deepEqual(checklistMonths(w.state, '2026-10-31'), ['2026-10', '2026-09', '2026-08']);
});

test('確定の取り消しは履歴に残り、未確定に戻る', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  w.balance(bank, '2026-09-30', 1);
  w.confirm('2026-09');
  w.run(A.cancelClose(w.state, '2026-09', 'やり直し', w.ctx()));
  const e = effectiveClose(w.state, '2026-09', w.today);
  assert.equal(e.status, 'unconfirmed');
  assert.equal(e.cancelled, true);
  assert.equal(e.history.length, 2);
  const c3 = w.confirm('2026-09');
  assert.equal(c3.revision, 3);
});

test('月末日でない日付に月末確認を付けても保存されない', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  const s = must(A.addSnapshot(w.state, { accountId: bank.id, asOfDate: '2026-09-29', amountYen: 1, kind: 'actual', monthEndVerified: true }, w.ctx())).record;
  assert.equal(s.monthEndVerified, false);
});
