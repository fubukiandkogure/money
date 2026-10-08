// テスト用の小さな道具。金額・口座名はすべて架空。
import { emptyState, applyChanges } from '../../app/js/core/apply.js';
import * as A from '../../app/js/core/actions.js';

let seq = 0;

export function ctxAt(today, time = '12:00:00') {
  return { today, now: `${today}T${time}.000+09:00`, newId: (p) => `${p}_${++seq}` };
}

export function must(res) {
  if (!res.ok) throw new Error(`action failed: ${res.code} ${res.message}`);
  return res;
}

/** state と操作の小さなラッパー */
export class World {
  constructor(today = '2026-10-08') {
    this.state = emptyState();
    this.today = today;
  }
  ctx(today = this.today, time) {
    return ctxAt(today, time);
  }
  run(res) {
    must(res);
    this.state = applyChanges(this.state, res.changes);
    return res;
  }
  account(name, type, opts = {}) {
    return this.run(A.createAccount(this.state, { name, type, managedFrom: '2026-01-01', ...opts }, this.ctx(opts.createdOn ?? this.today))).record;
  }
  /** 実残高（月末日なら月末終了時点として確認済み） */
  balance(account, asOfDate, amountYen, opts = {}) {
    const recordedOn = opts.recordedOn ?? this.today;
    return this.run(
      A.addSnapshot(
        this.state,
        { accountId: account.id, asOfDate, amountYen, kind: 'actual', monthEndVerified: opts.monthEnd ?? true, ...opts },
        this.ctx(recordedOn, opts.time),
      ),
    ).record;
  }
  confirm(ym, today = this.today) {
    return this.run(A.confirmMonth(this.state, ym, '', this.ctx(today))).record;
  }
  expense(amountYen, categoryId, opts = {}) {
    return this.run(A.createEvent(this.state, { kind: 'expense', amountYen, categoryId, ...opts }, this.ctx(opts.today ?? this.today))).record;
  }
  event(input, today = this.today) {
    return this.run(A.createEvent(this.state, input, this.ctx(today))).record;
  }
}
