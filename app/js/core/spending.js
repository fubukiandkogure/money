// 支出の集計。合計は「記録済み支出」であり、実生活の総支出とは限らない。
// 分母は同じ期間の記録済み消費支出だけ（入金・振替/積立・元金返済・カード精算・サブスク見込みを混ぜない）。
// ごほうび（贅沢）マークは振り返り用の印で、合計・カテゴリー別の金額を変えない。

import { CATEGORIES } from './constants.js';
import { sumYen, ratioPercent } from './money.js';
import { addDays, monthOf, yearOf, monthRange, lastDayOfMonth, firstDayOfMonth, addMonths, weekStart, formatMonth, formatDateShort } from './dates.js';

export const isActive = (e) => !e.deletedAt;
export const isExpense = (e) => e.kind === 'expense' && !e.deletedAt;

export function activeExpenses(events) {
  return events.filter(isExpense);
}

/** 事象の並び順用の日付（月だけ分かる記録はその月の初日扱い。表示では「日付不明」と出す） */
export function sortKey(e) {
  return e.datePrecision === 'month' ? `${e.yearMonth}-00` : e.occurredOn;
}

// ---------------------------------------------------------------------------
// 期間

export function monthPeriod(ym) {
  return { type: 'month', ym };
}
export function weekPeriod(date) {
  return { type: 'week', start: weekStart(date) };
}
export function yearPeriod(year) {
  return { type: 'year', year: String(year) };
}

export function periodBounds(p) {
  if (p.type === 'month') return { from: firstDayOfMonth(p.ym), to: lastDayOfMonth(p.ym) };
  if (p.type === 'week') return { from: p.start, to: addDays(p.start, 6) };
  if (p.type === 'year') return { from: `${p.year}-01-01`, to: `${p.year}-12-31` };
  throw new Error(`unknown period ${p.type}`);
}

export function shiftPeriod(p, n) {
  if (p.type === 'month') return monthPeriod(addMonths(p.ym, n));
  if (p.type === 'week') return { type: 'week', start: addDays(p.start, 7 * n) };
  if (p.type === 'year') return yearPeriod(Number(p.year) + n);
  throw new Error(`unknown period ${p.type}`);
}

export function periodLabel(p) {
  if (p.type === 'month') return formatMonth(p.ym);
  if (p.type === 'year') return `${p.year}年`;
  const { from, to } = periodBounds(p);
  return `${formatDateShort(from)}〜${formatDateShort(to)}`;
}

/**
 * 'in'：期間の合計に含める / 'undated'：週など日単位の期間で、月だけ分かる記録（合計に配分しない）/ 'out'
 */
export function placeInPeriod(e, p) {
  const { from, to } = periodBounds(p);
  if (e.datePrecision === 'month') {
    if (p.type === 'month') return e.yearMonth === p.ym ? 'in' : 'out';
    if (p.type === 'year') return yearOf(e.yearMonth) === p.year ? 'in' : 'out';
    const mFrom = firstDayOfMonth(e.yearMonth);
    const mTo = lastDayOfMonth(e.yearMonth);
    return mFrom <= to && mTo >= from ? 'undated' : 'out';
  }
  return e.occurredOn >= from && e.occurredOn <= to ? 'in' : 'out';
}

// ---------------------------------------------------------------------------
// 集計

const byAmountDesc = (a, b) => b.amountYen - a.amountYen || sortKey(b).localeCompare(sortKey(a)) || a.id.localeCompare(b.id);

export function summarizeExpenses(events, p, { bigCount = 5 } = {}) {
  const inItems = [];
  const undatedItems = [];
  for (const e of events) {
    if (!isExpense(e)) continue;
    const place = placeInPeriod(e, p);
    if (place === 'in') inItems.push(e);
    else if (place === 'undated') undatedItems.push(e);
  }
  const total = sumYen(inItems.map((e) => e.amountYen));
  const byCategory = CATEGORIES.map((category) => {
    const items = inItems.filter((e) => e.categoryId === category.id);
    const t = sumYen(items.map((e) => e.amountYen));
    return { category, total: t, count: items.length, percent: ratioPercent(t, total) };
  });
  const luxuryItems = inItems.filter((e) => e.isLuxury).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  return {
    period: p,
    hasRecords: inItems.length > 0,
    total,
    count: inItems.length,
    byCategory,
    big: [...inItems].sort(byAmountDesc).slice(0, bigCount),
    luxury: { total: sumYen(luxuryItems.map((e) => e.amountYen)), count: luxuryItems.length, items: luxuryItems },
    undated: {
      total: sumYen(undatedItems.map((e) => e.amountYen)),
      count: undatedItems.length,
      items: undatedItems,
    },
    items: inItems,
  };
}

/** 月ごとの記録済み支出。記録のない月は total = null（0円・節約成功とは扱わない） */
export function monthlyExpenseSeries(events, fromYm, toYm) {
  const map = new Map();
  for (const e of events) {
    if (!isExpense(e)) continue;
    const ym = e.yearMonth;
    if (!map.has(ym)) map.set(ym, { total: 0, count: 0, luxury: 0 });
    const m = map.get(ym);
    m.total += e.amountYen;
    m.count += 1;
    if (e.isLuxury) m.luxury += e.amountYen;
  }
  return monthRange(fromYm, toYm).map((ym) => {
    const m = map.get(ym);
    return m ? { ym, hasRecords: true, ...m } : { ym, hasRecords: false, total: null, count: 0, luxury: null };
  });
}

/** 記録一覧用：日付ごとのグループ（月だけ分かる記録は別グループ） */
export function groupByDay(events) {
  const undated = [];
  const days = new Map();
  for (const e of events) {
    if (e.datePrecision === 'month') {
      undated.push(e);
      continue;
    }
    if (!days.has(e.occurredOn)) days.set(e.occurredOn, []);
    days.get(e.occurredOn).push(e);
  }
  const sortedDays = [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      expenseTotal: sumYen(items.filter(isExpense).map((e) => e.amountYen)),
    }));
  return { undated, days: sortedDays };
}

/** 記録一覧の対象月に入るか */
export function inMonth(e, ym) {
  return e.datePrecision === 'month' ? e.yearMonth === ym : monthOf(e.occurredOn) === ym;
}
