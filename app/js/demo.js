// デモ用の架空データ（デモ専用の保存場所にだけ入れる。本人のデータとは混ざらない）
import { emptyState, applyChanges } from './core/apply.js';
import * as A from './core/actions.js';
import { newId } from './core/ids.js';
import { addMonths, lastDayOfMonth, monthOf, addDays, prevMonth } from './core/dates.js';

export function seedDemo(today) {
  let state = emptyState();
  const ctx = (d, t = '20:00:00') => ({ today: d < today ? d : today, now: `${d < today ? d : today}T${t}.000+09:00`, newId });
  const run = (res) => {
    if (!res.ok) throw new Error(`demo: ${res.message}`);
    state = applyChanges(state, res.changes);
    return res;
  };
  const thisMonth = monthOf(today);
  const m = (n) => addMonths(thisMonth, n);
  const start = `${m(-5)}-01`;

  const bank = run(A.createAccount(state, { name: '架空のみなと銀行', type: 'bank', managedFrom: start }, ctx(start))).record;
  const nisa = run(A.createAccount(state, { name: '架空つみたてNISA', type: 'investment', managedFrom: start }, ctx(start))).record;
  const loan = run(A.createAccount(state, { name: '架空の奨学金', type: 'loan', managedFrom: start, initialPrincipalYen: 2_400_000 }, ctx(start))).record;

  // 月末の実残高（架空）
  const plan = [
    [-5, 312_000, 180_000, 1_520_000],
    [-4, 298_000, 214_000, 1_505_000],
    [-3, 335_000, 236_000, 1_490_000],
    [-2, 341_000, 262_000, 1_475_000],
    [-1, 362_000, 281_000, 1_460_000],
  ];
  for (const [n, b, i, l] of plan) {
    const end = lastDayOfMonth(m(n));
    const rec = addDays(end, 3);
    run(A.addSnapshot(state, { accountId: bank.id, asOfDate: end, amountYen: b, kind: 'actual', monthEndVerified: true }, ctx(rec)));
    run(A.addSnapshot(state, { accountId: nisa.id, asOfDate: end, amountYen: i, kind: 'actual', monthEndVerified: true }, ctx(rec)));
    if (n !== -3) run(A.addSnapshot(state, { accountId: loan.id, asOfDate: end, amountYen: l, kind: 'actual', monthEndVerified: true }, ctx(rec)));
    // 3か月前の奨学金だけ未入力（未確定の月の例）
    if (n !== -3 && n !== -1) run(A.confirmMonth(state, m(n), '', ctx(addDays(end, 4))));
  }
  // 今月の途中の確認
  const mid = addDays(`${thisMonth}-01`, Math.min(4, Number(today.slice(8, 10)) - 1));
  run(A.addSnapshot(state, { accountId: bank.id, asOfDate: mid, amountYen: 351_000, kind: 'actual' }, ctx(mid)));

  // 支出（架空）
  const cats = ['food', 'food', 'daily', 'shopping', 'play', 'transport', 'food', 'other'];
  const memos = { food: ['', 'ランチ', 'スーパー', ''], play: ['友だちとカラオケ', ''], shopping: ['本', '服'], daily: [''], transport: [''], other: [''] };
  let seed = 7;
  const rnd = (n) => {
    seed = (seed * 9301 + 49297) % 233280;
    return Math.floor((seed / 233280) * n);
  };
  for (let k = -3; k <= 0; k++) {
    const ym = m(k);
    if (k === -3) continue; // 記録なしの月の例
    const days = k === 0 ? Number(today.slice(8, 10)) : 28;
    for (let d = 1; d <= days; d += 1 + rnd(3)) {
      const c = cats[rnd(cats.length)];
      const amount = { food: 400 + rnd(18) * 100, daily: 300 + rnd(10) * 100, shopping: 1500 + rnd(40) * 100, play: 2000 + rnd(30) * 100, transport: 200 + rnd(8) * 100, other: 500 + rnd(20) * 100 }[c];
      const date = `${ym}-${String(d).padStart(2, '0')}`;
      run(A.createEvent(state, { kind: 'expense', amountYen: amount, categoryId: c, occurredOn: date, memo: memos[c][rnd(memos[c].length)], isLuxury: rnd(9) === 0 }, ctx(date)));
    }
  }
  const prev = prevMonth(thisMonth);
  run(A.createEvent(state, { kind: 'expense', amountYen: 3000, categoryId: 'food', occurredOn: `${prev}-12`, memo: 'ちょっといいケーキ', isLuxury: true }, ctx(`${prev}-12`)));
  run(A.createEvent(state, { kind: 'expense', amountYen: 48_000, categoryId: 'travel', occurredOn: `${prev}-20`, memo: '温泉旅行' }, ctx(`${prev}-20`)));
  run(A.createEvent(state, { kind: 'transfer', amountYen: 30_000, fromAccountId: bank.id, toAccountId: nisa.id, occurredOn: `${prev}-27`, memo: 'つみたて' }, ctx(`${prev}-27`)));
  run(A.createEvent(state, { kind: 'repayment', amountYen: 15_000, toAccountId: loan.id, fromAccountId: bank.id, occurredOn: `${prev}-27` }, ctx(`${prev}-27`)));
  run(A.createEvent(state, { kind: 'income', amountYen: 210_000, incomeType: 'salary', toAccountId: bank.id, occurredOn: `${prev}-25` }, ctx(`${prev}-25`)));

  // サブスク荘（架空のサービス名）
  const video = run(A.createContract(state, { displayName: '架空どうが', status: 'active', priceYen: 990, frequency: 'monthly', startOn: start, nextDueOn: `${thisMonth}-15` }, ctx(start))).record;
  const music = run(A.createContract(state, { displayName: '架空ミュージック', status: 'active', priceYen: 1080, frequency: 'monthly', startOn: start, nextDueOn: `${thisMonth}-05` }, ctx(start))).record;
  const cloud = run(A.createContract(state, { displayName: '架空クラウド', status: 'active', priceYen: 3900, frequency: 'yearly', startOn: start, nextDueOn: `${m(-2)}-10` }, ctx(start))).record;
  run(A.createContract(state, { displayName: '架空マンガ', status: 'trial', priceYen: 600, frequency: 'monthly', startOn: addDays(today, -5), trialEndsOn: addDays(today, 9) }, ctx(addDays(today, -5))));
  run(A.changeTerms(state, music.id, { effectiveOn: `${m(1)}-01`, priceYen: 1180 }, ctx(today)));
  for (const k of [-2, -1]) {
    run(A.confirmPayment(state, { contractId: video.id, ym: m(k), amountYen: 990, occurredOn: `${m(k)}-15` }, ctx(`${m(k)}-16`)));
    run(A.confirmPayment(state, { contractId: music.id, ym: m(k), amountYen: 1080, occurredOn: `${m(k)}-05` }, ctx(`${m(k)}-06`)));
  }
  run(A.confirmPayment(state, { contractId: cloud.id, ym: m(-2), amountYen: 3900, occurredOn: `${m(-2)}-10` }, ctx(`${m(-2)}-11`)));
  return state;
}
