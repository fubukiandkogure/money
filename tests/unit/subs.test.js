// 受け入れ条件 13.3（S01〜S08）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from './helpers.js';
import * as A from '../../app/js/core/actions.js';
import { applyChanges } from '../../app/js/core/apply.js';
import { projection, paymentChecklist, contractView, candidateFor, nextDueOn, termAt, termsOf } from '../../app/js/core/subs.js';
import { summarizeExpenses, monthPeriod, yearPeriod } from '../../app/js/core/spending.js';

function contract(w, input) {
  return w.run(A.createContract(w.state, { startOn: '2026-01-01', ...input }, w.ctx())).record;
}

test('S01: 月980円を登録 → 見込み 980/月・11,760/年。実支出0件', () => {
  const w = new World('2026-10-08');
  contract(w, { displayName: '架空動画', status: 'active', priceYen: 980, frequency: 'monthly', nextDueOn: '2026-10-15' });
  const p = projection(w.state, w.today);
  assert.equal(p.monthlyTotal, 980);
  assert.equal(p.annualTotal, 11_760);
  assert.equal(w.state.events.length, 0);
  const cl = paymentChecklist(w.state, '2026-10', w.today);
  assert.equal(cl.rows.length, 1);
  assert.equal(cl.rows[0].state, 'pending');
  assert.equal(cl.rows[0].expectedYen, 980);
  assert.equal(cl.rows[0].dueOn, '2026-10-15');
  assert.equal(cl.confirmedTotal, 0);
});

test('S02: 同じ請求の確認を連打・再試行しても実支出は1件', () => {
  const w = new World('2026-10-20');
  const c = contract(w, { displayName: '架空動画', status: 'active', priceYen: 980, frequency: 'monthly', nextDueOn: '2026-10-15' });
  const input = { contractId: c.id, ym: '2026-10', amountYen: 980, occurredOn: '2026-10-15' };
  const first = A.confirmPayment(w.state, input, w.ctx());
  const second = A.confirmPayment(w.state, input, w.ctx()); // 保存前の古い状態からの再試行
  w.run(first);
  assert.throws(() => applyChanges(w.state, second.changes), /すでにあります/, 'DB と同じ一意制約で弾く');
  const third = A.confirmPayment(w.state, input, w.ctx());
  assert.equal(third.ok, false);
  assert.equal(third.code, 'already');
  assert.equal(w.state.events.length, 1);
  assert.equal(paymentChecklist(w.state, '2026-10', w.today).confirmedTotal, 980);
});

test('S03: 別々の2契約で同日980円 → 各1件、合計1,960', () => {
  const w = new World('2026-10-20');
  const a = contract(w, { displayName: '架空A', status: 'active', priceYen: 980, frequency: 'monthly', nextDueOn: '2026-10-15' });
  const b = contract(w, { displayName: '架空B', status: 'active', priceYen: 980, frequency: 'monthly', nextDueOn: '2026-10-15' });
  w.run(A.confirmPayment(w.state, { contractId: a.id, ym: '2026-10', amountYen: 980, occurredOn: '2026-10-15' }, w.ctx()));
  w.run(A.confirmPayment(w.state, { contractId: b.id, ym: '2026-10', amountYen: 980, occurredOn: '2026-10-15' }, w.ctx()));
  assert.equal(w.state.events.length, 2);
  assert.equal(paymentChecklist(w.state, '2026-10', w.today).confirmedTotal, 1960);
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-10')).total, 1960);
});

test('S04: 年払い12,000円 → 実支出は12,000を1回。見込み1,000/月。他の月に実支出を作らない', () => {
  const w = new World('2026-10-20');
  const c = contract(w, { displayName: '架空クラウド', status: 'active', priceYen: 12_000, frequency: 'yearly', nextDueOn: '2026-10-10' });
  assert.equal(projection(w.state, w.today).monthlyTotal, 1000);
  assert.equal(projection(w.state, w.today).annualTotal, 12_000);
  w.run(A.confirmPayment(w.state, { contractId: c.id, ym: '2026-10', amountYen: 12_000, occurredOn: '2026-10-10' }, w.ctx()));
  assert.equal(summarizeExpenses(w.state.events, yearPeriod(2026)).total, 12_000);
  assert.equal(w.state.events.length, 1);
  assert.equal(paymentChecklist(w.state, '2026-11', w.today).rows.length, 0, '支払月以外は候補も出さない');
  assert.equal(paymentChecklist(w.state, '2027-10', w.today).rows.length, 1, '翌年の同じ月に候補');
});

test('S05: 予定日が過ぎても未確認なら実支出を作らない', () => {
  const w = new World('2026-10-30');
  contract(w, { displayName: '架空音楽', status: 'active', priceYen: 1080, frequency: 'monthly', nextDueOn: '2026-10-05' });
  const cl = paymentChecklist(w.state, '2026-10', w.today);
  assert.equal(cl.rows[0].state, 'pending');
  assert.equal(cl.rows[0].overdue, true);
  assert.equal(w.state.events.length, 0);
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-10')).total, 0);
});

test('S06: 普通の支出に登録済みの支払を契約へ結び付け → 重複計上なし', () => {
  const w = new World('2026-10-20');
  const c = contract(w, { displayName: '架空動画', status: 'active', priceYen: 980, frequency: 'monthly', nextDueOn: '2026-10-15' });
  const e = w.expense(980, 'other', { occurredOn: '2026-10-15' });
  w.run(A.linkExistingPayment(w.state, { contractId: c.id, ym: '2026-10', eventId: e.id }, w.ctx()));
  assert.equal(w.state.events.length, 1);
  assert.equal(w.state.events[0].categoryId, 'subscription');
  const cl = paymentChecklist(w.state, '2026-10', w.today);
  assert.equal(cl.rows[0].state, 'confirmed');
  assert.equal(cl.confirmedTotal, 980);
  assert.equal(summarizeExpenses(w.state.events, monthPeriod('2026-10')).total, 980);
  // 同じ支出をもう一度別の支払に結ぶことはできない
  const again = A.linkExistingPayment(w.state, { contractId: c.id, ym: '2026-11', eventId: e.id }, w.ctx());
  assert.equal(again.code, 'already_linked');
  // 支出を削除すると結び付きも外れ、候補に戻る
  w.run(A.deleteEvent(w.state, e.id, w.ctx()));
  assert.equal(w.state.paymentLinks.length, 0);
  assert.equal(paymentChecklist(w.state, '2026-10', w.today).rows[0].state, 'pending');
});

test('S07: 料金変更は適用日以降の見込みだけに反映。過去の実支出は変えない', () => {
  const w = new World('2026-10-20');
  const c = contract(w, { displayName: '架空動画', status: 'active', priceYen: 980, frequency: 'monthly', nextDueOn: '2026-10-15' });
  w.run(A.confirmPayment(w.state, { contractId: c.id, ym: '2026-10', amountYen: 980, occurredOn: '2026-10-15' }, w.ctx()));
  w.run(A.changeTerms(w.state, c.id, { effectiveOn: '2026-11-01', priceYen: 1490 }, w.ctx()));
  assert.equal(projection(w.state, '2026-10-20').monthlyTotal, 980);
  assert.equal(projection(w.state, '2026-11-02').monthlyTotal, 1490);
  assert.equal(w.state.events[0].amountYen, 980);
  assert.equal(paymentChecklist(w.state, '2026-11', w.today).rows[0].expectedYen, 1490);
  assert.equal(paymentChecklist(w.state, '2026-10', w.today).rows[0].event.amountYen, 980);
});

test('S08: 解約（退去）は将来の見込み減として扱い、実現した節約額にしない', () => {
  const w = new World('2026-10-20');
  const c = contract(w, { displayName: '架空動画', status: 'active', priceYen: 980, frequency: 'monthly', nextDueOn: '2026-10-15' });
  w.run(A.changeTerms(w.state, c.id, { effectiveOn: '2026-11-15', status: 'ended', cancelledOn: '2026-10-20' }, w.ctx()));
  const p = projection(w.state, w.today);
  assert.equal(p.monthlyTotal, 980, '退去日までは現在の見込みのまま');
  assert.equal(p.ending.length, 1);
  assert.equal(p.ending[0].on, '2026-11-15');
  assert.equal(p.ending[0].annual, 11_760);
  assert.equal(projection(w.state, '2026-11-15').monthlyTotal, 0);
  assert.equal(w.state.events.length, 0, '節約額などの実績は作らない');
  // 11月の支払日（15日）にはすでに終了 → 候補なし
  assert.equal(paymentChecklist(w.state, '2026-11', w.today).rows.length, 0);
  const v = contractView(w.state, c, w.today);
  assert.equal(v.status, 'active');
  assert.equal(v.nextEnd.cancelledOn, '2026-10-20');
  // 終了後でも、遅れて引き落とされた支払は本人が追加できる
  w.run(A.confirmPayment(w.state, { contractId: c.id, ym: '2026-12', extra: true, amountYen: 980, occurredOn: '2026-12-01' }, w.ctx('2026-12-02')));
  assert.equal(paymentChecklist(w.state, '2026-12', '2026-12-02').confirmedTotal, 980);
});

test('内見（無料体験）：現在は0円、終了後の見込みは別。自動で有料・実績にしない', () => {
  const w = new World('2026-10-08');
  const c = contract(w, { displayName: '架空マンガ', status: 'trial', priceYen: 600, frequency: 'monthly', trialEndsOn: '2026-10-20', startOn: '2026-10-01' });
  const p = projection(w.state, w.today);
  assert.equal(p.monthlyTotal, 0);
  assert.equal(p.trialCount, 1);
  assert.equal(p.trialAfterAnnual, 7200);
  const later = contractView(w.state, c, '2026-10-25');
  assert.equal(later.status, 'trial', '終了日を過ぎても自動で有料にしない');
  assert.equal(later.trialOverdue, true);
  assert.equal(paymentChecklist(w.state, '2026-10', w.today).rows.length, 0);
});

test('料金不明は0円と区別し、合計に入れず件数で示す', () => {
  const w = new World('2026-10-08');
  contract(w, { displayName: '架空A', status: 'active', priceYen: null, frequency: 'monthly' });
  contract(w, { displayName: '架空B', status: 'active', priceYen: 0, frequency: 'monthly' });
  contract(w, { displayName: '架空C', status: 'active', priceYen: 500, frequency: 'monthly' });
  const p = projection(w.state, w.today);
  assert.equal(p.unknownCount, 1);
  assert.equal(p.activeCount, 3);
  assert.equal(p.annualTotal, 6000);
});

test('見込みの合計は丸め前の年額で計算する', () => {
  const w = new World('2026-10-08');
  // 1,000/年 ×3 = 3,000/年 → 月250。契約ごとに 83 に丸めて足すと 249 になってしまう
  for (const n of ['A', 'B', 'C']) contract(w, { displayName: `架空${n}`, status: 'active', priceYen: 1000, frequency: 'yearly' });
  assert.equal(projection(w.state, w.today).monthlyTotal, 250);
});

test('支払日が月末を超える場合は月末に寄せる／次回支払日', () => {
  const w = new World('2026-02-10');
  const c = contract(w, { displayName: '架空', status: 'active', priceYen: 100, frequency: 'monthly', nextDueOn: '2026-01-31' });
  assert.equal(candidateFor(w.state, c, '2026-02').dueOn, '2026-02-28');
  const t = termAt(termsOf(w.state, c.id), w.today);
  assert.equal(nextDueOn(t, '2026-02-10'), '2026-02-28');
  assert.equal(nextDueOn(t, '2026-03-31'), '2026-03-31');
});

test('支払なし（スキップ）は支出を作らず、候補を片付ける', () => {
  const w = new World('2026-10-20');
  const c = contract(w, { displayName: '架空', status: 'active', priceYen: 100, frequency: 'monthly', nextDueOn: '2026-10-15' });
  w.run(A.skipPayment(w.state, { contractId: c.id, ym: '2026-10' }, w.ctx()));
  const cl = paymentChecklist(w.state, '2026-10', w.today);
  assert.equal(cl.rows[0].state, 'skipped');
  assert.equal(w.state.events.length, 0);
  w.run(A.unlinkPayment(w.state, cl.rows[0].key));
  assert.equal(paymentChecklist(w.state, '2026-10', w.today).rows[0].state, 'pending');
});

test('月だけ分かる支払確認（日付不明）', () => {
  const w = new World('2026-10-20');
  const c = contract(w, { displayName: '架空', status: 'active', priceYen: 100, frequency: 'monthly' });
  const r = w.run(A.confirmPayment(w.state, { contractId: c.id, ym: '2026-10', amountYen: 100, datePrecision: 'month' }, w.ctx()));
  assert.equal(r.record.datePrecision, 'month');
  assert.equal(r.record.occurredOn, null);
  assert.equal(r.record.yearMonth, '2026-10');
});
