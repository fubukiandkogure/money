// データの検証。保存前のレコード検証と、復元・起動時のデータ全体の検証に使う。
// 意図的な未入力（口座未指定・料金不明・未確定・推計など）は破損扱いしない。

import { ACCOUNT_TYPES, CATEGORY_IDS, COLLECTIONS, CONTRACT_STATUSES, EVENT_KINDS, FREQUENCIES, INCOME_TYPES, PAYMENT_METHODS } from './constants.js';
import { isYen } from './money.js';
import { isValidDate, isValidMonth, isValidStamp, isLastDayOfMonth, monthOf } from './dates.js';
import { verifyCloseRecord } from './closes.js';

const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const isNullOr = (pred) => (v) => v === null || pred(v);
const isId = (v) => isStr(v) && v.length > 0 && v.length <= 200;
const isText = (max) => (v) => isStr(v) && v.length <= max;

function check(errors, cond, msg) {
  if (!cond) errors.push(msg);
}

export function validateAccount(a) {
  const e = [];
  const p = `口座 ${a?.id ?? '?'}`;
  if (!a || typeof a !== 'object') return [`${p}: 形式が不正です`];
  check(e, isId(a.id), `${p}: id が不正です`);
  check(e, isText(60)(a.name) && a.name.trim().length > 0, `${p}: 名前が不正です`);
  check(e, Object.hasOwn(ACCOUNT_TYPES, a.type), `${p}: 種類が不正です`);
  check(e, a.currency === 'JPY', `${p}: 通貨が不正です`);
  check(e, isValidDate(a.managedFrom), `${p}: 管理開始日が不正です`);
  check(e, a.startKind === 'existing' || a.startKind === 'new', `${p}: 開始の種類が不正です`);
  check(e, isNullOr(isValidDate)(a.managedUntil), `${p}: 管理終了日が不正です`);
  if (a.managedUntil && isValidDate(a.managedFrom)) check(e, a.managedUntil > a.managedFrom, `${p}: 管理終了日は開始日より後にしてください`);
  check(e, a.managedUntil ? a.endKind === 'zero' || a.endKind === 'untracked' : a.endKind === null, `${p}: 終了の種類が不正です`);
  check(e, isNullOr((v) => isYen(v) && v >= 0)(a.initialPrincipalYen), `${p}: 当初元金が不正です`);
  if (a.type !== 'loan') check(e, a.initialPrincipalYen === null, `${p}: 当初元金は奨学金だけに設定できます`);
  check(e, Number.isSafeInteger(a.sortOrder), `${p}: 並び順が不正です`);
  check(e, isNullOr(isValidStamp)(a.archivedAt), `${p}: アーカイブ日時が不正です`);
  check(e, isText(500)(a.note), `${p}: メモが不正です`);
  check(e, isValidStamp(a.createdAt) && isValidStamp(a.updatedAt), `${p}: 記録日時が不正です`);
  return e;
}

export function validateSnapshot(s, account = null) {
  const e = [];
  const p = `残高記録 ${s?.id ?? '?'}`;
  if (!s || typeof s !== 'object') return [`${p}: 形式が不正です`];
  check(e, isId(s.id), `${p}: id が不正です`);
  check(e, isId(s.accountId), `${p}: 口座が不正です`);
  check(e, isYen(s.amountYen), `${p}: 金額が不正です`);
  if (account && account.type !== 'bank') check(e, s.amountYen >= 0, `${p}: 金額がマイナスです`);
  check(e, isValidDate(s.asOfDate), `${p}: 基準日が不正です`);
  check(e, isValidStamp(s.recordedAt), `${p}: 記録日時が不正です`);
  check(e, s.kind === 'actual' || s.kind === 'estimate', `${p}: 実測/推計の区分が不正です`);
  check(e, isBool(s.monthEndVerified), `${p}: 月末確認の値が不正です`);
  if (s.monthEndVerified) check(e, s.kind === 'actual' && isLastDayOfMonth(s.asOfDate), `${p}: 月末確認は月末日の実残高だけに付けられます`);
  check(e, isNullOr(isId)(s.revisionOf), `${p}: 訂正元が不正です`);
  check(e, s.revisionOf !== s.id, `${p}: 訂正元が自分自身です`);
  check(e, isNullOr(isValidStamp)(s.invalidatedAt), `${p}: 取り消し日時が不正です`);
  check(e, isText(200)(s.invalidReason), `${p}: 取り消し理由が不正です`);
  check(e, isText(500)(s.note), `${p}: メモが不正です`);
  return e;
}

export function validateEvent(ev) {
  const e = [];
  const p = `記録 ${ev?.id ?? '?'}`;
  if (!ev || typeof ev !== 'object') return [`${p}: 形式が不正です`];
  check(e, isId(ev.id), `${p}: id が不正です`);
  check(e, Object.hasOwn(EVENT_KINDS, ev.kind), `${p}: 種類が不正です`);
  check(e, isYen(ev.amountYen) && ev.amountYen > 0, `${p}: 金額は1円以上の整数にしてください`);
  check(e, ev.datePrecision === 'day' || ev.datePrecision === 'month', `${p}: 日付の精度が不正です`);
  if (ev.datePrecision === 'day') {
    check(e, isValidDate(ev.occurredOn), `${p}: 日付が不正です`);
    check(e, isValidDate(ev.occurredOn) && ev.yearMonth === monthOf(ev.occurredOn), `${p}: 年月と日付が一致しません`);
  } else {
    check(e, ev.occurredOn === null, `${p}: 月だけの記録に日付があります`);
    check(e, isValidMonth(ev.yearMonth), `${p}: 年月が不正です`);
  }
  check(e, isText(200)(ev.memo), `${p}: メモが不正です`);
  check(e, ev.paymentMethod === null || Object.hasOwn(PAYMENT_METHODS, ev.paymentMethod), `${p}: 支払方法が不正です`);
  for (const k of ['accountId', 'fromAccountId', 'toAccountId']) check(e, isNullOr(isId)(ev[k]), `${p}: ${k} が不正です`);
  check(e, isBool(ev.isLuxury), `${p}: ごほうびの値が不正です`);
  if (ev.kind === 'expense') {
    check(e, CATEGORY_IDS.has(ev.categoryId), `${p}: カテゴリーが不正です`);
  } else {
    check(e, ev.categoryId === null, `${p}: 支出以外にカテゴリーがあります`);
    check(e, ev.isLuxury === false, `${p}: 支出以外にごほうびの印があります`);
  }
  if (ev.kind === 'transfer') {
    check(e, ev.fromAccountId && ev.toAccountId && ev.fromAccountId !== ev.toAccountId, `${p}: 振替には別々の2口座が必要です`);
  }
  if (ev.kind === 'repayment') check(e, !!ev.toAccountId, `${p}: 返済先の奨学金が必要です`);
  check(e, isBool(ev.breakdownUnknown), `${p}: 内訳不明の値が不正です`);
  check(e, ev.incomeType === null || Object.hasOwn(INCOME_TYPES, ev.incomeType), `${p}: 入金の種類が不正です`);
  check(e, isValidStamp(ev.createdAt) && isValidStamp(ev.updatedAt), `${p}: 記録日時が不正です`);
  check(e, Number.isSafeInteger(ev.revision) && ev.revision >= 1, `${p}: 版が不正です`);
  check(e, isNullOr(isValidStamp)(ev.deletedAt), `${p}: 削除日時が不正です`);
  return e;
}

export function validateContract(c) {
  const e = [];
  const p = `契約 ${c?.id ?? '?'}`;
  if (!c || typeof c !== 'object') return [`${p}: 形式が不正です`];
  check(e, isId(c.id), `${p}: id が不正です`);
  check(e, isText(60)(c.displayName) && c.displayName.trim().length > 0, `${p}: 名前が不正です`);
  check(e, Number.isSafeInteger(c.roomNo) && c.roomNo > 0, `${p}: 部屋番号が不正です`);
  check(e, isNullOr(isValidStamp)(c.archivedAt), `${p}: アーカイブ日時が不正です`);
  check(e, isText(500)(c.note), `${p}: メモが不正です`);
  check(e, isValidStamp(c.createdAt) && isValidStamp(c.updatedAt), `${p}: 記録日時が不正です`);
  return e;
}

export function validateTerm(t) {
  const e = [];
  const p = `契約条件 ${t?.id ?? '?'}`;
  if (!t || typeof t !== 'object') return [`${p}: 形式が不正です`];
  check(e, isId(t.id) && isId(t.contractId), `${p}: id が不正です`);
  check(e, isValidDate(t.effectiveOn), `${p}: 適用日が不正です`);
  check(e, Object.hasOwn(CONTRACT_STATUSES, t.status), `${p}: 状態が不正です`);
  check(e, isNullOr((v) => isYen(v) && v >= 0)(t.priceYen), `${p}: 料金が不正です`);
  check(e, Object.hasOwn(FREQUENCIES, t.frequency), `${p}: 周期が不正です`);
  check(e, isNullOr((v) => Number.isInteger(v) && v >= 1 && v <= 31)(t.dueDay), `${p}: 支払日が不正です`);
  check(e, isNullOr((v) => Number.isInteger(v) && v >= 1 && v <= 12)(t.dueMonth), `${p}: 支払月が不正です`);
  check(e, isNullOr(isValidDate)(t.trialEndsOn), `${p}: 無料期間の終了日が不正です`);
  check(e, isNullOr(isValidDate)(t.cancelledOn), `${p}: 解約手続き日が不正です`);
  check(e, isValidStamp(t.recordedAt), `${p}: 記録日時が不正です`);
  check(e, isText(500)(t.note), `${p}: メモが不正です`);
  return e;
}

export function validateLink(l) {
  const e = [];
  const p = `支払確認 ${l?.id ?? '?'}`;
  if (!l || typeof l !== 'object') return [`${p}: 形式が不正です`];
  check(e, isId(l.id) && isId(l.contractId), `${p}: id が不正です`);
  check(e, isValidMonth(l.yearMonth), `${p}: 請求月が不正です`);
  check(e, l.kind === 'regular' || l.kind === 'extra', `${p}: 種類が不正です`);
  if (l.kind === 'regular') check(e, l.id === `${l.contractId}|${l.yearMonth}`, `${p}: 確認単位のIDが不正です`);
  else check(e, isStr(l.id) && l.id.startsWith(`${l.contractId}|${l.yearMonth}|x-`), `${p}: 確認単位のIDが不正です`);
  check(e, l.status === 'confirmed' || l.status === 'skipped', `${p}: 状態が不正です`);
  if (l.status === 'confirmed') check(e, isId(l.moneyEventId), `${p}: 支払記録がありません`);
  else check(e, l.moneyEventId === null, `${p}: 支払なしに支払記録があります`);
  check(e, isValidStamp(l.confirmedAt), `${p}: 確認日時が不正です`);
  return e;
}

export function validateClose(c) {
  const e = [];
  const p = `月末確定 ${c?.yearMonth ?? '?'}`;
  if (!c || typeof c !== 'object') return [`${p}: 形式が不正です`];
  check(e, isId(c.id), `${p}: id が不正です`);
  check(e, isValidMonth(c.yearMonth), `${p}: 年月が不正です`);
  check(e, Number.isSafeInteger(c.revision) && c.revision >= 1, `${p}: 版が不正です`);
  check(e, c.status === 'confirmed' || c.status === 'cancelled', `${p}: 状態が不正です`);
  check(e, isValidStamp(c.createdAt), `${p}: 記録日時が不正です`);
  check(e, Array.isArray(c.accountScope) && c.accountScope.every(isId), `${p}: 対象口座が不正です`);
  check(e, c.selectedSnapshotIds && typeof c.selectedSnapshotIds === 'object', `${p}: 採用記録が不正です`);
  check(e, c.values && typeof c.values === 'object' && Object.values(c.values).every(isYen), `${p}: 保存値が不正です`);
  if (c.status === 'confirmed') {
    check(e, c.accountScope?.length > 0, `${p}: 対象口座がありません`);
    check(e, c.totals && isYen(c.totals.assets) && isYen(c.totals.loans) && Number.isSafeInteger(c.totals.net), `${p}: 合計が不正です`);
  }
  check(e, Number.isSafeInteger(c.calculationVersion), `${p}: 計算版が不正です`);
  check(e, isNullOr(isId)(c.previousId), `${p}: 前の版が不正です`);
  check(e, isText(500)(c.reason), `${p}: 理由が不正です`);
  return e;
}

export function validateSettings(s) {
  const e = [];
  if (!s || typeof s !== 'object') return ['設定: 形式が不正です'];
  check(e, s.timeZone === 'Asia/Tokyo', '設定: タイムゾーンが不正です');
  check(e, s.currency === 'JPY', '設定: 通貨が不正です');
  check(e, ['auto', 'light', 'dark'].includes(s.theme), '設定: 表示テーマが不正です');
  return e;
}

const RECORD_VALIDATORS = {
  accounts: validateAccount,
  snapshots: validateSnapshot,
  events: validateEvent,
  contracts: validateContract,
  contractTerms: validateTerm,
  paymentLinks: validateLink,
  closes: validateClose,
};

/**
 * データ全体の検証（構造・金額・日付・ID一意性・関連付け・確定条件）。
 * @returns {string[]} エラーの一覧（空なら正常）
 */
export function validateDataset(data, { maxErrors = 50 } = {}) {
  const errors = [];
  const push = (m) => {
    if (errors.length < maxErrors) errors.push(m);
  };
  if (!data || typeof data !== 'object') return ['データの形式が不正です'];
  for (const c of COLLECTIONS) {
    if (!Array.isArray(data[c])) push(`${c} がありません`);
  }
  if (errors.length) return errors;
  validateSettings(data.settings).forEach(push);

  const accById = new Map();
  for (const c of COLLECTIONS) {
    const ids = new Set();
    for (const rec of data[c]) {
      if (c !== 'snapshots') RECORD_VALIDATORS[c](rec).forEach(push);
      if (rec && ids.has(rec.id)) push(`${c}: id が重複しています (${rec.id})`);
      if (rec) ids.add(rec.id);
      if (c === 'accounts' && rec) accById.set(rec.id, rec);
    }
  }
  for (const s of data.snapshots) validateSnapshot(s, accById.get(s?.accountId)).forEach(push);
  if (errors.length) return errors;

  // 残高記録の関連
  const snapById = new Map(data.snapshots.map((s) => [s.id, s]));
  const revisedOnce = new Set();
  for (const s of data.snapshots) {
    if (!accById.has(s.accountId)) push(`残高記録 ${s.id}: 口座が見つかりません`);
    if (s.revisionOf) {
      const prev = snapById.get(s.revisionOf);
      if (!prev) push(`残高記録 ${s.id}: 訂正元が見つかりません`);
      else if (prev.accountId !== s.accountId) push(`残高記録 ${s.id}: 訂正元の口座が異なります`);
      if (revisedOnce.has(s.revisionOf)) push(`残高記録 ${s.revisionOf}: 訂正が二重にあります`);
      revisedOnce.add(s.revisionOf);
    }
  }
  // 訂正の循環
  for (const s of data.snapshots) {
    let cur = s;
    let steps = 0;
    while (cur?.revisionOf && steps <= data.snapshots.length) {
      cur = snapById.get(cur.revisionOf);
      steps++;
    }
    if (steps > data.snapshots.length) {
      push(`残高記録 ${s.id}: 訂正の参照が循環しています`);
      break;
    }
  }

  // 記録（支出など）の関連
  const eventById = new Map(data.events.map((e) => [e.id, e]));
  for (const ev of data.events) {
    for (const k of ['accountId', 'fromAccountId', 'toAccountId']) {
      if (ev[k] && !accById.has(ev[k])) push(`記録 ${ev.id}: 口座 ${ev[k]} が見つかりません`);
    }
    if (ev.kind === 'repayment' && accById.get(ev.toAccountId) && accById.get(ev.toAccountId).type !== 'loan') {
      push(`記録 ${ev.id}: 返済先が奨学金ではありません`);
    }
  }

  // サブスク
  const contractIds = new Set(data.contracts.map((c) => c.id));
  const rooms = new Set();
  for (const c of data.contracts) {
    if (rooms.has(c.roomNo)) push(`契約 ${c.id}: 部屋番号が重複しています`);
    rooms.add(c.roomNo);
    if (!data.contractTerms.some((t) => t.contractId === c.id)) push(`契約 ${c.id}: 契約条件がありません`);
  }
  for (const t of data.contractTerms) if (!contractIds.has(t.contractId)) push(`契約条件 ${t.id}: 契約が見つかりません`);
  const linkedEvents = new Set();
  for (const l of data.paymentLinks) {
    if (!contractIds.has(l.contractId)) push(`支払確認 ${l.id}: 契約が見つかりません`);
    if (l.moneyEventId) {
      const ev = eventById.get(l.moneyEventId);
      if (!ev) push(`支払確認 ${l.id}: 支払記録が見つかりません`);
      else if (ev.kind !== 'expense' || ev.deletedAt) push(`支払確認 ${l.id}: 支払記録が有効な支出ではありません`);
      if (linkedEvents.has(l.moneyEventId)) push(`支払確認 ${l.id}: 同じ支出が二重に結び付いています`);
      linkedEvents.add(l.moneyEventId);
    }
  }

  // 月末確定
  const byMonth = new Map();
  for (const c of data.closes) {
    if (!byMonth.has(c.yearMonth)) byMonth.set(c.yearMonth, []);
    byMonth.get(c.yearMonth).push(c);
  }
  for (const [ym, list] of byMonth) {
    list.sort((a, b) => a.revision - b.revision);
    list.forEach((c, i) => {
      if (c.revision !== i + 1) push(`月末確定 ${ym}: 版の番号が連続していません`);
      if (c.previousId !== (i === 0 ? null : list[i - 1].id)) push(`月末確定 ${ym}: 前の版の参照が不正です`);
    });
  }
  const state = { accounts: data.accounts, snapshots: data.snapshots };
  for (const c of data.closes) verifyCloseRecord(state, c).forEach(push);

  return errors;
}
