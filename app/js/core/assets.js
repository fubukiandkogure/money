// 資産・奨学金の計算。実残高（手動で確認した値）だけを真実として扱う。
// 支出・入金・返済の記録から残高を自動で加減することはしない。

import { ACCOUNT_TYPES } from './constants.js';
import { sumYen } from './money.js';
import { lastDayOfMonth, monthOf, isLastDayOfMonth } from './dates.js';

// ---------------------------------------------------------------------------
// 口座と管理対象期間

export const isAssetAccount = (a) => ACCOUNT_TYPES[a.type]?.group === 'asset';
export const isLoanAccount = (a) => a.type === 'loan';

/**
 * date の終了時点で、その口座が管理対象か。
 * 管理開始日（含む）〜 管理終了日（その日に解約・完済・管理終了。含まない）。
 * アーカイブ（一覧の整理）は対象期間に影響しない。
 */
export function inScope(account, date) {
  if (account.managedFrom > date) return false;
  if (account.managedUntil && account.managedUntil <= date) return false;
  return true;
}

export function scopeAt(accounts, date) {
  return accounts.filter((a) => inScope(a, date));
}

export function sortAccounts(accounts) {
  const order = { bank: 0, investment: 1, loan: 2 };
  return [...accounts].sort(
    (a, b) => order[a.type] - order[b.type] || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt),
  );
}

// ---------------------------------------------------------------------------
// 残高履歴（訂正系列）

const indexCache = new WeakMap();

/**
 * 訂正系列を解決する。
 * - revisionOf を持つ記録は、参照先を「訂正済み」にする（1件の記録を訂正できるのは1回＝系列は一本道）
 * - 無効化（取り消し）された記録は採用しない
 * - 有効 = 取り消されておらず、まだ訂正されていない記録
 */
export function snapshotIndex(snapshots) {
  let idx = indexCache.get(snapshots);
  if (idx) return idx;
  const byId = new Map(snapshots.map((s) => [s.id, s]));
  const supersededBy = new Map();
  for (const s of snapshots) {
    if (s.revisionOf) supersededBy.set(s.revisionOf, s.id);
  }
  const effectiveByAccount = new Map();
  for (const s of snapshots) {
    if (s.invalidatedAt || supersededBy.has(s.id)) continue;
    if (!effectiveByAccount.has(s.accountId)) effectiveByAccount.set(s.accountId, []);
    effectiveByAccount.get(s.accountId).push(s);
  }
  idx = { byId, supersededBy, effectiveByAccount };
  indexCache.set(snapshots, idx);
  return idx;
}

export function isEffectiveSnapshot(snapshots, snap) {
  const idx = snapshotIndex(snapshots);
  return !snap.invalidatedAt && !idx.supersededBy.has(snap.id);
}

/** 訂正系列（古い順）。snap が属する系列全体を返す */
export function revisionChain(snapshots, snap) {
  const idx = snapshotIndex(snapshots);
  let head = snap;
  while (idx.supersededBy.has(head.id)) head = idx.byId.get(idx.supersededBy.get(head.id));
  const chain = [head];
  let cur = head;
  while (cur.revisionOf && idx.byId.has(cur.revisionOf)) {
    cur = idx.byId.get(cur.revisionOf);
    chain.unshift(cur);
  }
  return chain;
}

export function effectiveSnapshotsOf(snapshots, accountId) {
  return snapshotIndex(snapshots).effectiveByAccount.get(accountId) ?? [];
}

/**
 * 今日までの最新の実残高。
 * 基準日が最も新しいものを選ぶ（入力が新しいだけで基準日が古い記録を最新扱いしない）。
 * 同じ基準日では「月末終了時点」と確認した記録を優先する。それでも複数あれば conflict を返す。
 */
export function latestActual(snapshots, accountId, today) {
  const list = effectiveSnapshotsOf(snapshots, accountId).filter((s) => s.kind === 'actual' && s.asOfDate <= today);
  if (list.length === 0) return { snapshot: null, conflict: null };
  const maxDate = list.reduce((m, s) => (s.asOfDate > m ? s.asOfDate : m), '');
  let sameDay = list.filter((s) => s.asOfDate === maxDate);
  const endOfDay = sameDay.filter((s) => s.monthEndVerified);
  if (endOfDay.length > 0) sameDay = endOfDay;
  if (sameDay.length === 1) return { snapshot: sameDay[0], conflict: null };
  const sorted = [...sameDay].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return { snapshot: sorted[0], conflict: sorted };
}

/** 最新の実残高より新しい推計（将来日の予定も含む）。合計には使わない */
export function newerEstimate(snapshots, accountId, latestActualDate) {
  const list = effectiveSnapshotsOf(snapshots, accountId).filter(
    (s) => s.kind === 'estimate' && (!latestActualDate || s.asOfDate > latestActualDate),
  );
  if (list.length === 0) return null;
  return list.reduce((m, s) => (s.asOfDate > m.asOfDate || (s.asOfDate === m.asOfDate && s.recordedAt > m.recordedAt) ? s : m));
}

// ---------------------------------------------------------------------------
// 現在の概要（確認済み残高の合計）

/**
 * 管理中の口座それぞれの最新実残高を集めた概要。
 * - 未確認の口座は 0 円扱いしない（missing に入れ、合計は「部分合計」と明示する）
 * - 基準日が混在する場合は mixedDates = true
 */
export function currentOverview(state, today) {
  const accounts = scopeAt(state.accounts, today);
  const rows = sortAccounts(accounts).map((account) => {
    const { snapshot, conflict } = latestActual(state.snapshots, account.id, today);
    const estimate = newerEstimate(state.snapshots, account.id, snapshot?.asOfDate);
    return { account, latest: snapshot, conflict, estimate };
  });
  const group = (pred) => {
    const rs = rows.filter((r) => pred(r.account));
    const known = rs.filter((r) => r.latest);
    return {
      rows: rs,
      total: sumYen(known.map((r) => r.latest.amountYen)),
      knownCount: known.length,
      missing: rs.filter((r) => !r.latest).map((r) => r.account),
    };
  };
  const assets = group(isAssetAccount);
  const loans = group(isLoanAccount);
  const dates = rows.filter((r) => r.latest).map((r) => r.latest.asOfDate).sort();
  const missing = [...assets.missing, ...loans.missing];
  return {
    rows,
    assets,
    loans,
    net: assets.total - loans.total,
    accountCount: rows.length,
    complete: rows.length > 0 && missing.length === 0,
    partial: missing.length > 0 && dates.length > 0,
    missing,
    oldestDate: dates[0] ?? null,
    newestDate: dates[dates.length - 1] ?? null,
    mixedDates: dates.length > 0 && dates[0] !== dates[dates.length - 1],
    conflicts: rows.filter((r) => r.conflict).map((r) => r.account),
  };
}

// ---------------------------------------------------------------------------
// 月末の実残高

/**
 * ym 月末（終了時点）の対象口座と採用候補を調べる。
 * 採用できるのは、基準日＝月末・実残高・「月末終了時点」と確認済み・有効な記録だけ。
 * 今日の値・別日の値・前月の値・推計で補わない。
 */
export function monthEndStatus(state, ym, today) {
  const end = lastDayOfMonth(ym);
  const scope = sortAccounts(scopeAt(state.accounts, end));
  const items = scope.map((account) => {
    const onEnd = effectiveSnapshotsOf(state.snapshots, account.id).filter((s) => s.asOfDate === end);
    const candidates = onEnd.filter((s) => s.kind === 'actual' && s.monthEndVerified);
    if (candidates.length === 1) return { account, adopted: candidates[0], problem: null };
    if (candidates.length > 1) return { account, adopted: null, problem: 'conflict', related: candidates };
    const unverified = onEnd.filter((s) => s.kind === 'actual');
    if (unverified.length > 0) return { account, adopted: null, problem: 'time_unknown', related: unverified };
    const est = onEnd.filter((s) => s.kind === 'estimate');
    if (est.length > 0) return { account, adopted: null, problem: 'estimate_only', related: est };
    return { account, adopted: null, problem: 'missing', related: [] };
  });
  const ended = end <= today;
  const complete = items.length > 0 && items.every((i) => i.adopted);
  const totals = complete ? totalsFrom(items.map((i) => [i.account, i.adopted.amountYen])) : null;
  const blockers = [];
  if (!ended) blockers.push('not_ended');
  if (items.length === 0) blockers.push('no_accounts');
  if (items.some((i) => !i.adopted)) blockers.push('missing');
  return { ym, end, items, complete, ended, canConfirm: blockers.length === 0, blockers, totals };
}

export const PROBLEM_LABELS = {
  missing: '月末の実残高が未登録',
  time_unknown: '月末日の実残高はあるが、終了時点の値か未確認',
  estimate_only: '推計のみ（実残高ではない）',
  conflict: '月末の記録が複数あり、どれを使うか決まっていない',
};

/** [[account, amount], ...] → { assets, loans, net } */
export function totalsFrom(pairs) {
  const assets = sumYen(pairs.filter(([a]) => isAssetAccount(a)).map(([, v]) => v));
  const loans = sumYen(pairs.filter(([a]) => isLoanAccount(a)).map(([, v]) => v));
  return { assets, loans, net: assets - loans };
}

// ---------------------------------------------------------------------------
// 奨学金の進み具合

/**
 * 奨学金の進み具合。当初元金がわかる場合だけ返済額・返済率を出す。
 * わからない場合は、記録を始めた日（最初の実残高）からの減少額だけを示す（当初元金とは呼ばない）。
 */
export function loanProgress(state, account, today) {
  const { snapshot: latest } = latestActual(state.snapshots, account.id, today);
  const actuals = effectiveSnapshotsOf(state.snapshots, account.id)
    .filter((s) => s.kind === 'actual' && s.asOfDate <= today)
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate) || a.recordedAt.localeCompare(b.recordedAt));
  const first = actuals[0] ?? null;
  const initial = account.initialPrincipalYen ?? null;
  const res = { account, latest, first, initial, repaid: null, ratio: null, sinceFirst: null };
  if (!latest) return res;
  if (initial !== null && initial > 0) {
    res.repaid = initial - latest.amountYen;
    res.ratio = Math.min(1, Math.max(0, res.repaid / initial));
  }
  if (first && first.id !== latest.id && first.asOfDate < latest.asOfDate) {
    res.sinceFirst = { from: first, to: latest, decrease: first.amountYen - latest.amountYen };
  }
  return res;
}

/** 複数の奨学金の合算（当初元金が分かる分だけ） */
export function loansSummary(state, today) {
  const loans = sortAccounts(scopeAt(state.accounts, today).filter(isLoanAccount));
  const items = loans.map((a) => loanProgress(state, a, today));
  const known = items.filter((i) => i.initial !== null && i.latest);
  const initialTotal = sumYen(known.map((i) => i.initial));
  const remainingKnown = sumYen(known.map((i) => i.latest.amountYen));
  return {
    items,
    knownCount: known.length,
    unknownCount: items.length - known.length,
    initialTotal: known.length ? initialTotal : null,
    repaidTotal: known.length ? initialTotal - remainingKnown : null,
    ratio: known.length && initialTotal > 0 ? Math.min(1, Math.max(0, (initialTotal - remainingKnown) / initialTotal)) : null,
  };
}

/** 残高記録の入力が月末用として扱えるか（UI補助） */
export function canBeMonthEnd(date, kind) {
  return kind === 'actual' && isLastDayOfMonth(date);
}

/** 管理期間の最初の月（月末チェックの一覧に使う） */
export function earliestManagedMonth(accounts) {
  if (accounts.length === 0) return null;
  return monthOf(accounts.reduce((m, a) => (a.managedFrom < m ? a.managedFrom : m), accounts[0].managedFrom));
}
