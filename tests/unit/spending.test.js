// 受け入れ条件 13.2（E01〜E11）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from './helpers.js';
import * as A from '../../app/js/core/actions.js';
import { currentOverview } from '../../app/js/core/assets.js';
import { summarizeExpenses, monthPeriod, weekPeriod, yearPeriod, monthlyExpenseSeries, placeInPeriod } from '../../app/js/core/spending.js';
import { todayJST, nowStampJST } from '../../app/js/core/dates.js';
import { formatPercent } from '../../app/js/core/money.js';

test('E01: 金額とカテゴリーだけで保存できる（当日が初期値。メモ・口座・店名は不要）', () => {
  const w = new World('2026-10-08');
  const e = w.expense(6800, 'food');
  assert.equal(e.occurredOn, '2026-10-08');
  assert.equal(e.yearMonth, '2026-10');
  assert.equal(e.memo, '');
  assert.equal(e.accountId, null);
  assert.equal(e.isLuxury, false);
  assert.equal(A.createEvent(w.state, { kind: 'expense', amountYen: 6800 }, w.ctx()).ok, false, 'カテゴリーは必須');
  assert.equal(A.createEvent(w.state, { kind: 'expense', categoryId: 'food' }, w.ctx()).ok, false, '金額は必須');
});

test('E02: 消費支出だけを合計・割合の分母にする（積立・カード精算を足さない）', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  const nisa = w.account('架空NISA', 'investment');
  w.expense(6800, 'food');
  w.expense(3200, 'play');
  w.event({ kind: 'transfer', amountYen: 40_000, fromAccountId: bank.id, toAccountId: nisa.id });
  w.event({ kind: 'card_payment', amountYen: 30_000, fromAccountId: bank.id });
  w.event({ kind: 'income', amountYen: 200_000, incomeType: 'salary', toAccountId: bank.id });
  const s = summarizeExpenses(w.state.events, monthPeriod('2026-10'));
  assert.equal(s.total, 10_000);
  const food = s.byCategory.find((c) => c.category.id === 'food');
  const play = s.byCategory.find((c) => c.category.id === 'play');
  assert.equal(formatPercent(food.percent), '68%');
  assert.equal(formatPercent(play.percent), '32%');
});

test('E03: 口座を指定してもしなくても、確認済み実残高は変わらない', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  w.balance(bank, '2026-10-01', 100_000, { monthEnd: false });
  const before = currentOverview(w.state, w.today);
  w.expense(5000, 'food');
  w.expense(5000, 'food', { accountId: bank.id, paymentMethod: 'bank' });
  const after = currentOverview(w.state, w.today);
  assert.equal(after.assets.total, before.assets.total);
  assert.equal(after.net, 100_000);
});

test('E04: カードの買い物と後日の引き落とし → 消費支出は1回だけ', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  w.balance(bank, '2026-10-01', 100_000, { monthEnd: false });
  w.expense(6800, 'shopping', { paymentMethod: 'card', occurredOn: '2026-10-02' });
  w.event({ kind: 'card_payment', amountYen: 6800, fromAccountId: bank.id, occurredOn: '2026-10-07' });
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-10')).total, 6800);
  assert.equal(currentOverview(w.state, w.today).assets.total, 100_000);
});

test('E05: 奨学金の元金返済は消費支出0、純資産は両時点とも −200,000', () => {
  const w = new World('2026-11-05');
  const bank = w.account('架空銀行', 'bank');
  const loan = w.account('架空奨学金', 'loan');
  w.balance(bank, '2026-09-30', 100_000);
  w.balance(loan, '2026-09-30', 300_000);
  w.confirm('2026-09');
  const before = currentOverview(w.state, '2026-10-01').net;
  w.event({ kind: 'repayment', amountYen: 20_000, toAccountId: loan.id, fromAccountId: bank.id, occurredOn: '2026-10-27' });
  assert.equal(currentOverview(w.state, '2026-10-28').net, before, '返済の記録だけでは残高を変えない');
  w.balance(bank, '2026-10-31', 80_000);
  w.balance(loan, '2026-10-31', 280_000);
  w.confirm('2026-10');
  assert.equal(before, -200_000);
  assert.equal(currentOverview(w.state, w.today).net, -200_000);
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-10')).total, 0);
});

test('E05b: 利息が分かる返済は、利息だけを費用（その他）として1件記録する', () => {
  const w = new World('2026-10-08');
  const loan = w.account('架空奨学金', 'loan');
  const r = w.run(A.createEvent(w.state, { kind: 'repayment', amountYen: 20_000, interestYen: 150, toAccountId: loan.id }, w.ctx()));
  assert.equal(r.records.length, 2);
  const s = summarizeExpenses(w.state.events, monthPeriod('2026-10'));
  assert.equal(s.total, 150);
  assert.equal(s.byCategory.find((c) => c.category.id === 'other').total, 150);
});

test('E06: ごほうびの付け外しで変わるのは振り返り一覧だけ', () => {
  const w = new World('2026-10-08');
  const e = w.expense(3000, 'food');
  w.expense(2000, 'play');
  const p = monthPeriod('2026-10');
  const s0 = summarizeExpenses(w.state.events, p);
  w.run(A.setLuxury(w.state, e.id, true, w.ctx()));
  const s1 = summarizeExpenses(w.state.events, p);
  assert.equal(s1.luxury.count, 1);
  assert.equal(s1.total, s0.total);
  assert.deepEqual(
    s1.byCategory.map((c) => c.total),
    s0.byCategory.map((c) => c.total),
  );
  w.run(A.setLuxury(w.state, e.id, false, w.ctx()));
  const s2 = summarizeExpenses(w.state.events, p);
  assert.equal(s2.luxury.count, 0);
  assert.equal(s2.total, s0.total);
});

test('E07: 少額のごほうびは振り返れる。高額でも自動で贅沢扱いしない', () => {
  const w = new World('2026-10-08');
  w.expense(3000, 'food', { isLuxury: true });
  const big = w.expense(50_000, 'daily');
  const s = summarizeExpenses(w.state.events, monthPeriod('2026-10'));
  assert.deepEqual(
    s.luxury.items.map((e) => e.amountYen),
    [3000],
  );
  assert.equal(s.big[0].id, big.id);
  assert.equal(s.big[0].isLuxury, false);
});

test('E08: 別月・別カテゴリーへの訂正、削除で二重計上しない（IDは維持）', () => {
  const w = new World('2026-10-08');
  const e = w.expense(5000, 'food');
  const r = w.run(A.updateEvent(w.state, e.id, { occurredOn: '2026-09-20', categoryId: 'travel' }, w.ctx()));
  assert.equal(r.record.id, e.id);
  assert.equal(r.record.revision, 2);
  assert.equal(w.state.events.length, 1);
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-10')).total, 0);
  const sep = summarizeExpenses(w.state.events, monthPeriod('2026-09'));
  assert.equal(sep.total, 5000);
  assert.equal(sep.byCategory.find((c) => c.category.id === 'travel').total, 5000);
  assert.equal(sep.byCategory.find((c) => c.category.id === 'food').total, 0);
  w.run(A.deleteEvent(w.state, e.id, w.ctx()));
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-09')).total, 0);
  assert.equal(summarizeExpenses(w.state.events, yearPeriod(2026)).count, 0);
});

test('E09: 記録のない月は「記録なし」（0円・節約成功と判定しない）', () => {
  const w = new World('2026-10-08');
  w.expense(1000, 'food', { occurredOn: '2026-08-05' });
  w.expense(1000, 'food', { occurredOn: '2026-10-05' });
  const series = monthlyExpenseSeries(w.state.events, '2026-08', '2026-10');
  assert.equal(series[1].hasRecords, false);
  assert.equal(series[1].total, null);
  const s = summarizeExpenses(w.state.events, monthPeriod('2026-09'));
  assert.equal(s.hasRecords, false);
  assert.equal(s.byCategory[0].percent, null, '割合は未算出（ゼロ除算しない）');
});

test('E10: 日本時間の月初0時台の記録は日本時間の月へ集計', () => {
  const now = new Date('2026-10-31T15:30:00Z'); // = 2026-11-01 00:30 JST
  assert.equal(todayJST(now), '2026-11-01');
  assert.equal(nowStampJST(now), '2026-11-01T00:30:00.000+09:00');
  const w = new World(todayJST(now));
  const e = w.expense(500, 'food');
  assert.equal(e.yearMonth, '2026-11');
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-11')).total, 500);
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-10')).total, 0);
  // 逆方向：JST 23:59 はまだ同じ日
  assert.equal(todayJST(new Date('2026-10-31T14:59:59Z')), '2026-10-31');
});

test('E11: 月だけ分かる支払は月合計に含め、週には配分しない（別表示）', () => {
  const w = new World('2026-10-08');
  const undated = w.expense(980, 'subscription', { datePrecision: 'month', yearMonth: '2026-10' });
  w.expense(1000, 'food', { occurredOn: '2026-10-06' });
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-10')).total, 1980);
  const wk = summarizeExpenses(w.state.events, weekPeriod('2026-10-06'));
  assert.equal(wk.total, 1000);
  assert.equal(wk.undated.total, 980);
  assert.equal(placeInPeriod(undated, weekPeriod('2026-10-06')), 'undated');
  assert.equal(placeInPeriod(undated, weekPeriod('2026-11-16')), 'out');
  assert.equal(summarizeExpenses(w.state.events, yearPeriod(2026)).total, 1980);
});

test('週の境界は月曜始まり', () => {
  const w = new World('2026-10-08');
  w.expense(100, 'food', { occurredOn: '2026-10-04' }); // 日
  w.expense(200, 'food', { occurredOn: '2026-10-05' }); // 月
  w.expense(300, 'food', { occurredOn: '2026-10-11' }); // 日
  assert.equal(summarizeExpenses(w.state.events, weekPeriod('2026-10-08')).total, 500);
});

test('振替は2つの別口座が必要／返済先は奨学金', () => {
  const w = new World('2026-10-08');
  const bank = w.account('架空銀行', 'bank');
  assert.equal(A.createEvent(w.state, { kind: 'transfer', amountYen: 1, fromAccountId: bank.id, toAccountId: bank.id }, w.ctx()).ok, false);
  assert.equal(A.createEvent(w.state, { kind: 'transfer', amountYen: 1, fromAccountId: bank.id }, w.ctx()).ok, false);
  assert.equal(A.createEvent(w.state, { kind: 'repayment', amountYen: 1, toAccountId: bank.id }, w.ctx()).ok, false);
});
