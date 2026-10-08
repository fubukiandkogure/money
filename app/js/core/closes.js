// 月末確定と期間比較。
// 確定は「採用した残高記録ID・対象口座・計算版」を固定したリビジョンとして残す。
// 採用残高の訂正・無効化、対象範囲の変更、計算版の変更があれば「要再確認」と判定する（保存値ではなく毎回原データから判定）。

import { CALC_VERSION } from './constants.js';
import { monthEndStatus, totalsFrom, earliestManagedMonth } from './assets.js';
import { lastDayOfMonth, prevMonth, monthDiff, monthRange, monthOf, isLastDayOfMonth } from './dates.js';

export function closeRevisions(closes, ym) {
  return closes.filter((c) => c.yearMonth === ym).sort((a, b) => a.revision - b.revision);
}

/**
 * ym 月末の確定状態。
 * @returns {{ym, status: 'unconfirmed'|'confirmed'|'needs_review', close, cancelled, reasons, history}}
 */
export function effectiveClose(state, ym, today) {
  const history = closeRevisions(state.closes, ym);
  const latest = history[history.length - 1] ?? null;
  if (!latest) return { ym, status: 'unconfirmed', close: null, cancelled: false, reasons: [], history };
  if (latest.status === 'cancelled') return { ym, status: 'unconfirmed', close: null, cancelled: true, cancelRecord: latest, reasons: [], history };

  const reasons = [];
  if (latest.calculationVersion !== CALC_VERSION) reasons.push({ type: 'calc_version' });
  const ms = monthEndStatus(state, ym, today);
  const currentScope = new Set(ms.items.map((i) => i.account.id));
  const closedScope = new Set(latest.accountScope);
  for (const id of currentScope) if (!closedScope.has(id)) reasons.push({ type: 'scope_added', accountId: id });
  for (const id of closedScope) if (!currentScope.has(id)) reasons.push({ type: 'scope_removed', accountId: id });
  for (const item of ms.items) {
    if (!closedScope.has(item.account.id)) continue;
    const selected = latest.selectedSnapshotIds[item.account.id];
    if (!item.adopted || item.adopted.id !== selected) {
      reasons.push({ type: 'snapshot_changed', accountId: item.account.id, nowAdopted: item.adopted?.id ?? null, problem: item.problem });
    }
  }
  return { ym, status: reasons.length ? 'needs_review' : 'confirmed', close: latest, cancelled: false, reasons, history };
}

export const REVIEW_REASON_LABELS = {
  calc_version: '計算方法の版が変わった',
  scope_added: '対象口座が増えた',
  scope_removed: '対象口座から外れた',
  snapshot_changed: '確定に使った残高が訂正・取り消しされた',
};

/** 確定レコードを作る（保存はしない） */
export function buildCloseRecord(state, ym, today, { id, now, reason = '' }) {
  const ms = monthEndStatus(state, ym, today);
  if (!ms.canConfirm) return { ok: false, status: ms };
  const history = closeRevisions(state.closes, ym);
  const latest = history[history.length - 1] ?? null;
  const selectedSnapshotIds = {};
  const values = {};
  for (const item of ms.items) {
    selectedSnapshotIds[item.account.id] = item.adopted.id;
    values[item.account.id] = item.adopted.amountYen;
  }
  const record = {
    id,
    yearMonth: ym,
    revision: (latest?.revision ?? 0) + 1,
    status: 'confirmed',
    createdAt: now,
    accountScope: ms.items.map((i) => i.account.id).sort(),
    selectedSnapshotIds,
    values,
    totals: ms.totals,
    calculationVersion: CALC_VERSION,
    previousId: latest?.id ?? null,
    reason,
  };
  return { ok: true, record, status: ms };
}

/** 確定の取り消しレコード（履歴として残す） */
export function buildCancelRecord(state, ym, { id, now, reason = '' }) {
  const history = closeRevisions(state.closes, ym);
  const latest = history[history.length - 1] ?? null;
  if (!latest || latest.status === 'cancelled') return { ok: false };
  return {
    ok: true,
    record: {
      id,
      yearMonth: ym,
      revision: latest.revision + 1,
      status: 'cancelled',
      createdAt: now,
      accountScope: [],
      selectedSnapshotIds: {},
      values: {},
      totals: null,
      calculationVersion: CALC_VERSION,
      previousId: latest.id,
      reason,
    },
  };
}

/** 確定レコードの保存値が、参照する残高記録から再計算した値と一致するか（復元時の検証用） */
export function verifyCloseRecord(state, close) {
  const errors = [];
  if (close.status !== 'confirmed') return errors;
  const byId = new Map(state.snapshots.map((s) => [s.id, s]));
  const accById = new Map(state.accounts.map((a) => [a.id, a]));
  const end = lastDayOfMonth(close.yearMonth);
  const pairs = [];
  for (const accId of close.accountScope) {
    const acc = accById.get(accId);
    const snapId = close.selectedSnapshotIds[accId];
    const snap = byId.get(snapId);
    if (!acc) {
      errors.push(`月末確定 ${close.yearMonth}: 口座 ${accId} が見つかりません`);
      continue;
    }
    if (!snap) {
      errors.push(`月末確定 ${close.yearMonth}: 残高記録 ${snapId} が見つかりません`);
      continue;
    }
    if (snap.accountId !== accId || snap.asOfDate !== end || snap.kind !== 'actual' || !snap.monthEndVerified) {
      errors.push(`月末確定 ${close.yearMonth}: 残高記録 ${snapId} が月末の実残高ではありません`);
    }
    if (close.values[accId] !== snap.amountYen) errors.push(`月末確定 ${close.yearMonth}: 保存値と残高記録が一致しません`);
    pairs.push([acc, snap.amountYen]);
  }
  if (Object.keys(close.selectedSnapshotIds).length !== close.accountScope.length) {
    errors.push(`月末確定 ${close.yearMonth}: 対象口座と採用記録の数が一致しません`);
  }
  if (errors.length === 0) {
    const t = totalsFrom(pairs);
    if (!close.totals || t.assets !== close.totals.assets || t.loans !== close.totals.loans || t.net !== close.totals.net) {
      errors.push(`月末確定 ${close.yearMonth}: 合計が再計算と一致しません`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 比較

/**
 * 2つの確定（a が古い）の純資産を比べられるか。
 * 対象口座がそろっている場合だけ比較する。違いがある場合は、
 *  - b だけにある口座：その日に「新しく開設」した口座（開設前は0円）なら比較できる
 *  - a だけにある口座：「解約・完済で0円」になって管理を終えた口座なら比較できる
 *  - それ以外（以前からあった口座を途中から管理し始めた等）は比較を保留する
 */
export function compareCloses(state, a, b) {
  const reasons = [];
  const notes = [];
  if (a.status !== 'confirmed') reasons.push({ type: a.status === 'needs_review' ? 'from_needs_review' : 'from_unconfirmed', ym: a.ym });
  if (b.status !== 'confirmed') reasons.push({ type: b.status === 'needs_review' ? 'to_needs_review' : 'to_unconfirmed', ym: b.ym });
  if (reasons.length) return { comparable: false, reasons, notes, delta: null, from: a.ym, to: b.ym };

  const accById = new Map(state.accounts.map((x) => [x.id, x]));
  const endA = lastDayOfMonth(a.ym);
  const endB = lastDayOfMonth(b.ym);
  const scopeA = new Set(a.close.accountScope);
  const scopeB = new Set(b.close.accountScope);
  for (const id of scopeB) {
    if (scopeA.has(id)) continue;
    const acc = accById.get(id);
    if (acc && acc.startKind === 'new' && acc.managedFrom > endA) notes.push({ type: 'opened', account: acc });
    else reasons.push({ type: 'added_existing', account: acc ?? { id, name: '（削除された口座）' } });
  }
  for (const id of scopeA) {
    if (scopeB.has(id)) continue;
    const acc = accById.get(id);
    if (acc && acc.endKind === 'zero' && acc.managedUntil && acc.managedUntil <= endB) notes.push({ type: 'closed_zero', account: acc });
    else reasons.push({ type: 'removed_unknown', account: acc ?? { id, name: '（削除された口座）' } });
  }
  if (reasons.length) return { comparable: false, reasons, notes, delta: null, from: a.ym, to: b.ym };
  const ta = a.close.totals;
  const tb = b.close.totals;
  return {
    comparable: true,
    reasons,
    notes,
    from: a.ym,
    to: b.ym,
    months: monthDiff(a.ym, b.ym),
    delta: { assets: tb.assets - ta.assets, loans: tb.loans - ta.loans, net: tb.net - ta.net },
  };
}

export const COMPARE_REASON_LABELS = {
  from_unconfirmed: '比較元の月末が未確定',
  from_needs_review: '比較元の月末が要再確認',
  to_unconfirmed: 'この月末が未確定',
  to_needs_review: 'この月末が要再確認',
  added_existing: '途中から管理を始めた口座がある（以前の残高が不明）',
  removed_unknown: '管理を終えた口座がある（その後の残高が不明）',
};

/**
 * ある月の月次レポート。
 * - 前月比：対象月と直前月の月末がともに確定し、比較可能な場合だけ
 * - 期間比較：直前月が確定していないとき、それより前の直近の確定月から（「前月比」とは呼ばない）
 */
export function monthReport(state, ym, today) {
  const cur = effectiveClose(state, ym, today);
  const prevYm = prevMonth(ym);
  const prev = effectiveClose(state, prevYm, today);
  let prevMonthComparison;
  let periodComparison = null;
  if (cur.status !== 'confirmed') {
    prevMonthComparison = { available: false, reasons: [{ type: cur.status === 'needs_review' ? 'to_needs_review' : 'to_unconfirmed', ym }] };
  } else {
    const c = compareCloses(state, prev, cur);
    prevMonthComparison = { available: c.comparable, ...c };
    if (prev.status !== 'confirmed') {
      const earlier = latestConfirmedBefore(state, prevYm, today);
      if (earlier) {
        const pc = compareCloses(state, earlier, cur);
        periodComparison = { available: pc.comparable, ...pc };
      }
    }
  }
  return { ym, close: cur, prevMonthComparison, periodComparison };
}

/** ym より前（ym を含まない）で最も新しい、有効に確定している月 */
export function latestConfirmedBefore(state, ym, today) {
  const months = [...new Set(state.closes.map((c) => c.yearMonth))]
    .filter((m) => m < ym)
    .sort()
    .reverse();
  for (const m of months) {
    const e = effectiveClose(state, m, today);
    if (e.status === 'confirmed') return e;
  }
  return null;
}

/** 最も新しい、有効に確定している月 */
export function latestConfirmed(state, today) {
  return latestConfirmedBefore(state, '9999-12', today);
}

/** 月末チェックに並べる月（管理開始月〜月末を迎えた最新月。確定記録のある月も含める） */
export function checklistMonths(state, today) {
  const start = earliestManagedMonth(state.accounts);
  const lastEnded = isLastDayOfMonth(today) ? monthOf(today) : prevMonth(monthOf(today));
  const set = new Set(state.closes.map((c) => c.yearMonth));
  if (start && start <= lastEnded) for (const m of monthRange(start, lastEnded)) set.add(m);
  return [...set].sort().reverse();
}

/** 月次推移（確定月以外は null。欠測を0や補間で埋めない） */
export function monthlySeries(state, fromYm, toYm, today) {
  return monthRange(fromYm, toYm).map((ym) => {
    const e = effectiveClose(state, ym, today);
    return { ym, status: e.status, totals: e.status === 'confirmed' ? e.close.totals : null, close: e };
  });
}
