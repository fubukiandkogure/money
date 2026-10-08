// サブスク荘：1契約＝1部屋。無料体験＝内見、有料利用＝入居、解約＝退去。
// 契約の予定・見込みと、実際に支払った記録（支出）は別に扱う。
// 見込みは「現在の契約条件の年換算」。年払いを12件の実績に展開しない。期日が来ても自動で実績にしない。

import { sumYen, monthlyFromAnnual } from './money.js';
import { dateInMonth, firstDayOfMonth, lastDayOfMonth, addMonths, monthOf, dayDiff } from './dates.js';

export const ROOMS_PER_FLOOR = 4;

export function termsOf(state, contractId) {
  return state.contractTerms
    .filter((t) => t.contractId === contractId)
    .sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn) || a.recordedAt.localeCompare(b.recordedAt));
}

/** date 時点で有効な条件（effectiveOn が date 以前で最も新しいもの） */
export function termAt(terms, date) {
  let found = null;
  for (const t of terms) if (t.effectiveOn <= date) found = t;
  return found;
}

/** 条件1つの年換算（整数円）。有料利用中でなければ0。料金不明は null */
export function annualOf(term) {
  if (!term || term.status !== 'active') return 0;
  if (term.priceYen === null || term.priceYen === undefined) return null;
  return term.frequency === 'yearly' ? term.priceYen : term.priceYen * 12;
}

/** 内見（無料体験）終了後に予定される年換算（不明なら null） */
export function afterTrialAnnual(term) {
  if (!term || term.status !== 'trial') return 0;
  if (term.priceYen === null || term.priceYen === undefined) return null;
  return term.frequency === 'yearly' ? term.priceYen : term.priceYen * 12;
}

/** 表示用：条件1つの月額相当（年払いは÷12。丸めは表示時） */
export function monthlyEquivalentOf(term) {
  const a = annualOf(term);
  return a === null ? null : monthlyFromAnnual(a);
}

export function contractView(state, contract, today) {
  const terms = termsOf(state, contract.id);
  const current = termAt(terms, today);
  const upcoming = terms.filter((t) => t.effectiveOn > today);
  const status = current?.status ?? 'scheduled';
  const annual = annualOf(current);
  const nextEnd = upcoming.find((t) => t.status === 'ended') ?? null;
  const trialOverdue = current?.status === 'trial' && current.trialEndsOn && current.trialEndsOn < today && upcoming.length === 0;
  return {
    contract,
    terms,
    current,
    upcoming,
    status,
    annual,
    priceUnknown: current?.status === 'active' && annual === null,
    nextEnd,
    trialOverdue,
    nextDue: current ? nextDueOn(current, today) : null,
  };
}

/** 次回の支払予定日（分かる場合のみ。予定であって実績ではない） */
export function nextDueOn(term, today) {
  if (!term || term.status !== 'active' || !term.dueDay) return null;
  const ym = monthOf(today);
  if (term.frequency === 'monthly') {
    const d = dateInMonth(ym, term.dueDay);
    return d >= today ? d : dateInMonth(addMonths(ym, 1), term.dueDay);
  }
  if (!term.dueMonth) return null;
  for (let i = 0; i <= 12; i++) {
    const m = addMonths(ym, i);
    if (Number(m.slice(5, 7)) === term.dueMonth) {
      const d = dateInMonth(m, term.dueDay);
      if (d >= today) return d;
    }
  }
  return null;
}

/**
 * 契約全体の見込み。合計は丸め前の年額（整数）で計算し、月額相当は最後に1回だけ丸める。
 * 料金不明の契約は合計に入れず件数で示す。
 */
export function projection(state, today) {
  const views = state.contracts.filter((c) => !c.archivedAt).map((c) => contractView(state, c, today));
  const active = views.filter((v) => v.status === 'active');
  const known = active.filter((v) => v.annual !== null);
  const annualTotal = sumYen(known.map((v) => v.annual));
  const trials = views.filter((v) => v.status === 'trial');
  const trialAfterKnown = trials.filter((v) => afterTrialAnnual(v.current) !== null);
  // 退去予定：将来日に終了する条件があるもの。減るのは「見込み」であり、実現した節約額ではない
  const ending = active
    .filter((v) => v.nextEnd)
    .map((v) => ({ contract: v.contract, on: v.nextEnd.effectiveOn, annual: v.annual }));
  return {
    views,
    annualTotal,
    monthlyTotal: monthlyFromAnnual(annualTotal),
    activeCount: active.length,
    unknownCount: active.length - known.length,
    trialCount: trials.length,
    trialAfterAnnual: sumYen(trialAfterKnown.map((v) => afterTrialAnnual(v.current))),
    trialAfterUnknown: trials.length - trialAfterKnown.length,
    ending,
  };
}

// ---------------------------------------------------------------------------
// 支払確認（候補 → 本人が確認して1件の支出として保存）

/** 支払の確認単位のID。契約ID＋請求月で決まり、金額や日付を直しても変わらない */
export function occurrenceKey(contractId, ym) {
  return `${contractId}|${ym}`;
}

export function extraOccurrenceKey(contractId, ym, suffix) {
  return `${contractId}|${ym}|x-${suffix}`;
}

function activeTermInMonth(terms, ym) {
  const end = termAt(terms, lastDayOfMonth(ym));
  if (end?.status === 'active') return end;
  const inMonth = terms.filter((t) => t.effectiveOn >= firstDayOfMonth(ym) && t.effectiveOn <= lastDayOfMonth(ym) && t.status === 'active');
  if (inMonth.length) return inMonth[inMonth.length - 1];
  const start = termAt(terms, firstDayOfMonth(ym));
  return start?.status === 'active' ? start : null;
}

/**
 * ym 月の支払候補（予定）。予定は実績ではない。
 * 月払い：その月に有料利用中なら1件。支払日が分かれば、その日に有効な条件の金額を候補にする。
 * 年払い：支払月が分かっていて、その月に有料利用中なら1件。
 */
export function candidateFor(state, contract, ym) {
  const terms = termsOf(state, contract.id);
  const ref = activeTermInMonth(terms, ym);
  if (!ref) return null;
  const month = Number(ym.slice(5, 7));
  if (ref.frequency === 'yearly' && ref.dueMonth !== month) return null;
  const dueOn = ref.dueDay ? dateInMonth(ym, ref.dueDay) : null;
  let term = ref;
  if (dueOn) {
    const atDue = termAt(terms, dueOn);
    if (!atDue || atDue.status !== 'active' || atDue.frequency !== ref.frequency) return null;
    term = atDue;
  }
  if (term.frequency === 'yearly' && term.dueMonth !== month) return null;
  return {
    key: occurrenceKey(contract.id, ym),
    contractId: contract.id,
    ym,
    dueOn,
    expectedYen: term.priceYen ?? null,
    frequency: term.frequency,
  };
}

/**
 * ym 月の支払確認一覧。予定の候補と、確認済み・支払なしの記録を合わせて並べる。
 * 実支出は「確認済みで、リンク先の支出が有効なもの」だけを数える（候補と実績を二重に足さない）。
 */
export function paymentChecklist(state, ym, today) {
  const eventsById = new Map(state.events.map((e) => [e.id, e]));
  const contractsById = new Map(state.contracts.map((c) => [c.id, c]));
  const links = state.paymentLinks.filter((l) => l.yearMonth === ym);
  const linkById = new Map(links.map((l) => [l.id, l]));
  const rows = [];
  const seen = new Set();
  for (const contract of [...state.contracts].sort((a, b) => a.roomNo - b.roomNo)) {
    const cand = candidateFor(state, contract, ym);
    if (!cand) continue;
    const link = linkById.get(cand.key) ?? null;
    rows.push(makeRow(cand, contract, link, eventsById, today));
    seen.add(cand.key);
  }
  for (const link of links) {
    if (seen.has(link.id)) continue;
    const contract = contractsById.get(link.contractId);
    const cand = { key: link.id, contractId: link.contractId, ym, dueOn: null, expectedYen: null, frequency: null, extra: link.kind === 'extra' };
    rows.push(makeRow(cand, contract, link, eventsById, today));
  }
  const confirmed = rows.filter((r) => r.state === 'confirmed' && r.event);
  const pending = rows.filter((r) => r.state === 'pending');
  return {
    ym,
    rows,
    confirmedTotal: sumYen(confirmed.map((r) => r.event.amountYen)),
    confirmedCount: confirmed.length,
    pendingCount: pending.length,
    skippedCount: rows.filter((r) => r.state === 'skipped').length,
  };
}

function makeRow(cand, contract, link, eventsById, today) {
  const event = link?.moneyEventId ? eventsById.get(link.moneyEventId) ?? null : null;
  let state = 'pending';
  if (link?.status === 'confirmed' && event && !event.deletedAt) state = 'confirmed';
  else if (link?.status === 'skipped') state = 'skipped';
  return {
    ...cand,
    contract,
    link,
    event: state === 'confirmed' ? event : null,
    state,
    overdue: state === 'pending' && !!cand.dueOn && cand.dueOn < today,
  };
}

/** その支出がどの支払確認に結び付いているか */
export function linkForEvent(state, eventId) {
  return state.paymentLinks.find((l) => l.moneyEventId === eventId) ?? null;
}

/** 空いている部屋番号（101〜104, 201〜…） */
export function nextRoomNo(contracts) {
  const used = new Set(contracts.map((c) => c.roomNo));
  for (let floor = 1; floor < 100; floor++) {
    for (let r = 1; r <= ROOMS_PER_FLOOR; r++) {
      const no = floor * 100 + r;
      if (!used.has(no)) return no;
    }
  }
  return 9999;
}

/** 内見期間の残り日数 */
export function trialDaysLeft(term, today) {
  if (!term?.trialEndsOn) return null;
  return dayDiff(today, term.trialEndsOn);
}

/** 契約に結び付いた支払の履歴（新しい順） */
export function paymentsOfContract(state, contractId) {
  const eventsById = new Map(state.events.map((e) => [e.id, e]));
  return state.paymentLinks
    .filter((l) => l.contractId === contractId)
    .map((l) => ({ link: l, event: l.moneyEventId ? eventsById.get(l.moneyEventId) ?? null : null }))
    .sort((a, b) => b.link.yearMonth.localeCompare(a.link.yearMonth) || (b.link.confirmedAt ?? '').localeCompare(a.link.confirmedAt ?? ''));
}
