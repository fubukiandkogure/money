// 変更の組み立て（純粋関数）。state と入力から「1回のトランザクションで永続化する変更」を作る。
// 保存そのものは data/store.js が行い、成功した後で画面に反映する。
//
// 変更の形： { add: {coll: [rec]}, put: {coll: [rec]}, del: {coll: [id]} }
//  - add は同じIDがあると失敗する（サブスク支払確認の二重保存を DB でも防ぐ）
//  - 戻り値は { ok: true, changes, ... } か { ok: false, code, message, ... }

import { ACCOUNT_TYPES, CATEGORY_IDS, EVENT_KINDS } from './constants.js';
import { isYen } from './money.js';
import { isValidDate, isValidMonth, isLastDayOfMonth, monthOf, lastDayOfMonth } from './dates.js';
import { effectiveSnapshotsOf, isEffectiveSnapshot } from './assets.js';
import { buildCloseRecord, buildCancelRecord } from './closes.js';
import { termsOf, termAt, nextRoomNo, occurrenceKey, extraOccurrenceKey, linkForEvent } from './subs.js';
import { validateAccount, validateSnapshot, validateEvent, validateContract, validateTerm, validateLink, validateClose, validateSettings } from './validate.js';
import { ID_PREFIX, shortId } from './ids.js';
import { applyChanges } from './apply.js';

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

function changes() {
  return { add: {}, put: {}, del: {} };
}

/** 2つの変更を1つにまとめる（同じトランザクションで保存するため）。後の put・settings が優先 */
export function mergeChanges(a, b) {
  const out = changes();
  for (const op of ['add', 'put', 'del']) {
    for (const src of [a, b]) for (const [coll, list] of Object.entries(src[op] ?? {})) (out[op][coll] ??= []).push(...list);
  }
  if (a.settings) out.settings = a.settings;
  if (b.settings) out.settings = b.settings;
  return out;
}

/** 複数の操作を順に組み立て、1つの変更にまとめる。steps は (state) => 結果 の関数 */
function chain(state, steps) {
  let working = state;
  let all = changes();
  const results = [];
  for (const step of steps) {
    const res = step(working);
    if (!res.ok) return { ...res, results };
    all = mergeChanges(all, res.changes);
    working = applyChanges(working, res.changes);
    results.push(res);
  }
  return { ok: true, changes: all, results, state: working };
}
function addTo(ch, op, coll, rec) {
  (ch[op][coll] ??= []).push(rec);
  return ch;
}

function guard(errors) {
  return errors.length ? fail('invalid', errors[0], { errors }) : null;
}

const trimText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------------------------------------------------------------------------
// 口座

export function createAccount(state, input, ctx) {
  const type = input.type;
  if (!ACCOUNT_TYPES[type]) return fail('invalid', '種類を選んでください');
  const name = trimText(input.name, 60);
  if (!name) return fail('invalid', '名前を入力してください');
  const managedFrom = input.managedFrom || ctx.today;
  if (!isValidDate(managedFrom)) return fail('invalid', '管理開始日が正しくありません');
  const sameType = state.accounts.filter((a) => a.type === type);
  const rec = {
    id: ctx.newId(ID_PREFIX.accounts),
    name,
    type,
    currency: 'JPY',
    managedFrom,
    startKind: input.startKind === 'new' ? 'new' : 'existing',
    managedUntil: null,
    endKind: null,
    initialPrincipalYen: type === 'loan' ? (input.initialPrincipalYen ?? null) : null,
    sortOrder: sameType.reduce((m, a) => Math.max(m, a.sortOrder), 0) + 1,
    archivedAt: null,
    note: trimText(input.note, 500),
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  return guard(validateAccount(rec)) ?? { ok: true, changes: addTo(changes(), 'put', 'accounts', rec), record: rec };
}

export function updateAccount(state, id, patch, ctx) {
  const cur = state.accounts.find((a) => a.id === id);
  if (!cur) return fail('not_found', '口座が見つかりません');
  const next = { ...cur, updatedAt: ctx.now };
  if ('name' in patch) next.name = trimText(patch.name, 60);
  if ('note' in patch) next.note = trimText(patch.note, 500);
  if ('managedFrom' in patch) next.managedFrom = patch.managedFrom;
  if ('startKind' in patch) next.startKind = patch.startKind === 'new' ? 'new' : 'existing';
  if ('managedUntil' in patch) {
    next.managedUntil = patch.managedUntil || null;
    next.endKind = next.managedUntil ? (patch.endKind === 'zero' ? 'zero' : 'untracked') : null;
  }
  if ('initialPrincipalYen' in patch && cur.type === 'loan') next.initialPrincipalYen = patch.initialPrincipalYen ?? null;
  if (!next.name) return fail('invalid', '名前を入力してください');
  if (next.managedUntil && next.managedUntil <= next.managedFrom) return fail('invalid', '管理終了日は管理開始日より後にしてください');
  if (next.startKind === 'new') {
    const before = effectiveSnapshotsOf(state.snapshots, id).filter((s) => s.asOfDate < next.managedFrom);
    if (before.length) return fail('invalid', '開設日より前の残高記録があります。開設日を見直すか「以前から持っていた」を選んでください');
  }
  return guard(validateAccount(next)) ?? { ok: true, changes: addTo(changes(), 'put', 'accounts', next), record: next };
}

export function setAccountArchived(state, id, archived, ctx) {
  const cur = state.accounts.find((a) => a.id === id);
  if (!cur) return fail('not_found', '口座が見つかりません');
  const next = { ...cur, archivedAt: archived ? ctx.now : null, updatedAt: ctx.now };
  return { ok: true, changes: addTo(changes(), 'put', 'accounts', next), record: next };
}

/** 記録を1件も持たない口座だけ削除できる（登録の間違いを消すため）。履歴のある口座はアーカイブを使う */
export function deleteAccount(state, id) {
  const used =
    state.snapshots.some((s) => s.accountId === id) ||
    state.events.some((e) => e.accountId === id || e.fromAccountId === id || e.toAccountId === id) ||
    state.closes.some((c) => c.accountScope.includes(id));
  if (used) return fail('in_use', 'この口座には記録があるため削除できません。一覧から隠すには「アーカイブ」を使ってください');
  const ch = addTo(changes(), 'del', 'accounts', id);
  // 「いつもの動き」からの参照を外す
  const moves = state.settings.quickMoves ?? [];
  if (moves.some((m) => m.fromAccountId === id || m.toAccountId === id)) {
    ch.settings = {
      ...state.settings,
      quickMoves: moves.map((m) => ({
        ...m,
        fromAccountId: m.fromAccountId === id ? null : m.fromAccountId,
        toAccountId: m.toAccountId === id ? null : m.toAccountId,
      })),
    };
  }
  return { ok: true, changes: ch };
}

/**
 * はじめの準備：よくある組み合わせ（給与の口座・貯金の口座・NISA・奨学金など）をまとめて登録する。
 * input: { managedFrom, accounts: [{ role, name, type, initialPrincipalYen }], quickMoves: boolean }
 * quickMoves が true なら、毎月の振替・積立・返済を「いつもの動き」として用意する（金額は空欄）。
 */
export function setupAccounts(state, input, ctx) {
  const list = (input.accounts ?? []).filter((a) => a && trimText(a.name, 60));
  if (list.length === 0) return fail('invalid', '登録する口座を1つ以上選んでください');
  const res = chain(
    state,
    list.map(
      (a) => (s) =>
        createAccount(
          s,
          { name: a.name, type: a.type, managedFrom: input.managedFrom, startKind: 'existing', initialPrincipalYen: a.initialPrincipalYen ?? null, note: '' },
          ctx,
        ),
    ),
  );
  if (!res.ok) return res;
  const byRole = {};
  list.forEach((a, i) => {
    if (a.role) byRole[a.role] = res.results[i].record;
  });
  let ch = res.changes;
  if (input.quickMoves) {
    const moves = [];
    const salary = byRole.salary;
    const savings = byRole.savings;
    const nisa = byRole.nisa;
    const loan = byRole.loan;
    if (salary && savings) moves.push({ label: '貯金の口座へ', kind: 'transfer', fromAccountId: salary.id, toAccountId: savings.id });
    if (nisa && (salary || savings)) moves.push({ label: 'NISAの積立', kind: 'transfer', fromAccountId: (salary ?? savings).id, toAccountId: nisa.id });
    if (loan) moves.push({ label: '奨学金の返済（引き落とし）', kind: 'repayment', fromAccountId: (savings ?? salary)?.id ?? null, toAccountId: loan.id });
    if (salary) moves.push({ label: '給与', kind: 'income', fromAccountId: null, toAccountId: salary.id });
    let settings = res.state.settings;
    for (const m of moves) {
      const r = addQuickMove({ ...res.state, settings }, { ...m, amountYen: null }, ctx);
      if (!r.ok) return r;
      settings = r.settings;
    }
    ch = { ...ch, settings };
  }
  return { ok: true, changes: ch, records: res.results.map((r) => r.record) };
}

// ---------------------------------------------------------------------------
// 残高記録

/**
 * 残高を記録する（訂正なら revisionOf に訂正元を指定）。
 * 同じ口座・同じ基準日・同じ区分の有効な記録があり、訂正指定がない場合は code: 'same_day_exists' を返す。
 */
export function addSnapshot(state, input, ctx) {
  const account = state.accounts.find((a) => a.id === input.accountId);
  if (!account) return fail('not_found', '口座が見つかりません');
  const kind = input.kind === 'estimate' ? 'estimate' : 'actual';
  const asOfDate = input.asOfDate;
  if (!isValidDate(asOfDate)) return fail('invalid', '基準日が正しくありません');
  if (!isYen(input.amountYen)) return fail('invalid', '金額が正しくありません');
  if (input.amountYen < 0 && account.type !== 'bank') return fail('invalid', 'マイナスの残高は入力できません');
  if (kind === 'actual' && asOfDate > ctx.today) return fail('future_actual', '未来の日付は実残高にできません（推計として記録できます）');
  const monthEndVerified = !!input.monthEndVerified && kind === 'actual' && isLastDayOfMonth(asOfDate);

  const revisionOf = input.revisionOf ?? null;
  if (revisionOf) {
    const prev = state.snapshots.find((s) => s.id === revisionOf);
    if (!prev || prev.accountId !== account.id) return fail('invalid', '訂正元の記録が見つかりません');
    if (!isEffectiveSnapshot(state.snapshots, prev)) return fail('invalid', 'この記録はすでに訂正・取り消しされています');
  } else {
    const same = effectiveSnapshotsOf(state.snapshots, account.id).filter(
      (s) => s.asOfDate === asOfDate && s.kind === kind && s.monthEndVerified === monthEndVerified,
    );
    if (same.length) return fail('same_day_exists', '同じ日の記録があります', { existing: same });
  }
  if (account.managedUntil && asOfDate >= account.managedUntil) return fail('after_managed_until', '管理終了日以降の残高は記録できません');

  const ch = changes();
  let accountChanged = null;
  if (asOfDate < account.managedFrom) {
    if (account.startKind === 'new') return fail('before_opened', '開設日より前の残高は記録できません');
    if (!input.extendManagedFrom) return fail('before_managed_from', '管理開始日より前の日付です', { managedFrom: account.managedFrom });
    accountChanged = { ...account, managedFrom: asOfDate, updatedAt: ctx.now };
    addTo(ch, 'put', 'accounts', accountChanged);
  }
  const rec = {
    id: ctx.newId(ID_PREFIX.snapshots),
    accountId: account.id,
    amountYen: input.amountYen,
    asOfDate,
    recordedAt: ctx.now,
    kind,
    monthEndVerified,
    revisionOf,
    invalidatedAt: null,
    invalidReason: '',
    note: trimText(input.note, 500),
  };
  const err = guard(validateSnapshot(rec, account));
  if (err) return err;
  addTo(ch, 'put', 'snapshots', rec);
  return { ok: true, changes: ch, record: rec, accountChanged };
}

/** 記録の取り消し（無効化）。物理削除はしない */
export function invalidateSnapshot(state, id, reason, ctx) {
  const cur = state.snapshots.find((s) => s.id === id);
  if (!cur) return fail('not_found', '記録が見つかりません');
  if (!isEffectiveSnapshot(state.snapshots, cur)) return fail('invalid', 'この記録はすでに訂正・取り消しされています');
  const next = { ...cur, invalidatedAt: ctx.now, invalidReason: trimText(reason, 200) };
  return { ok: true, changes: addTo(changes(), 'put', 'snapshots', next), record: next };
}

// ---------------------------------------------------------------------------
// 月末確定

export function confirmMonth(state, ym, reason, ctx) {
  if (!isValidMonth(ym)) return fail('invalid', '月が正しくありません');
  const res = buildCloseRecord(state, ym, ctx.today, { id: ctx.newId(ID_PREFIX.closes), now: ctx.now, reason: trimText(reason, 500) });
  if (!res.ok) return fail('cannot_confirm', '月末の実残高がそろっていないため確定できません', { status: res.status });
  return guard(validateClose(res.record)) ?? { ok: true, changes: addTo(changes(), 'add', 'closes', res.record), record: res.record };
}

/**
 * 月末の残高をまとめて記録する（基準日＝月末、実測、月末の終了時点として確認）。
 * 「〇月末（終了時点）の残高として記録」という明示の操作で呼ぶ。confirm が true ならそのまま確定まで同じ保存で行う。
 * entries: [{ accountId, amountYen }]
 */
export function recordMonthEndBatch(state, ym, entries, { confirm = false, reason = '' } = {}, ctx) {
  if (!isValidMonth(ym)) return fail('invalid', '月が正しくありません');
  const end = lastDayOfMonth(ym);
  if (end > ctx.today) return fail('not_ended', 'まだ月末を迎えていません');
  if (!entries.length && !confirm) return fail('invalid', '記録する残高がありません');
  const steps = entries.map((e) => (s) => {
    const r = addSnapshot(
      s,
      { accountId: e.accountId, amountYen: e.amountYen, asOfDate: end, kind: 'actual', monthEndVerified: true, note: e.note ?? '' },
      ctx,
    );
    if (!r.ok) {
      const name = s.accounts.find((a) => a.id === e.accountId)?.name ?? '';
      return {
        ...r,
        message: `${name}：${r.code === 'same_day_exists' ? 'この月末の残高はすでに記録されています（訂正は口座の履歴から）' : r.message}`,
        accountId: e.accountId,
      };
    }
    return r;
  });
  if (confirm) steps.push((s) => confirmMonth(s, ym, reason, ctx));
  return chain(state, steps);
}

export function cancelClose(state, ym, reason, ctx) {
  const res = buildCancelRecord(state, ym, { id: ctx.newId(ID_PREFIX.closes), now: ctx.now, reason: trimText(reason, 500) });
  if (!res.ok) return fail('invalid', '取り消す確定がありません');
  return { ok: true, changes: addTo(changes(), 'add', 'closes', res.record), record: res.record };
}

// ---------------------------------------------------------------------------
// お金の動き（支出・入金・振替/積立・返済・カード精算）

function normalizeDate(input, ctx) {
  if (input.datePrecision === 'month') {
    if (!isValidMonth(input.yearMonth)) return { error: '年月が正しくありません' };
    return { datePrecision: 'month', occurredOn: null, yearMonth: input.yearMonth };
  }
  const d = input.occurredOn || ctx.today;
  if (!isValidDate(d)) return { error: '日付が正しくありません' };
  return { datePrecision: 'day', occurredOn: d, yearMonth: monthOf(d) };
}

function buildEventFields(state, input, ctx) {
  const kind = input.kind ?? 'expense';
  if (!EVENT_KINDS[kind]) return { error: '種類が正しくありません' };
  if (!isYen(input.amountYen) || input.amountYen <= 0) return { error: '金額を1円以上の整数で入力してください' };
  const date = normalizeDate(input, ctx);
  if (date.error) return date;
  const accById = new Map(state.accounts.map((a) => [a.id, a]));
  const acc = (id) => (id ? (accById.get(id) ?? null) : null);
  const f = {
    kind,
    amountYen: input.amountYen,
    ...date,
    categoryId: null,
    isLuxury: false,
    memo: trimText(input.memo, 200),
    paymentMethod: input.paymentMethod || null,
    accountId: null,
    fromAccountId: null,
    toAccountId: null,
    breakdownUnknown: false,
    incomeType: null,
  };
  if (kind === 'expense') {
    if (!CATEGORY_IDS.has(input.categoryId)) return { error: 'カテゴリーを選んでください' };
    f.categoryId = input.categoryId;
    f.isLuxury = !!input.isLuxury;
    if (input.accountId) {
      if (!acc(input.accountId) || acc(input.accountId).type === 'loan') return { error: '口座が正しくありません' };
      f.accountId = input.accountId;
    }
  } else if (kind === 'income') {
    f.incomeType = input.incomeType || null;
    if (input.toAccountId) {
      if (!acc(input.toAccountId) || acc(input.toAccountId).type === 'loan') return { error: '入金先の口座が正しくありません' };
      f.toAccountId = input.toAccountId;
    }
  } else if (kind === 'transfer') {
    const from = acc(input.fromAccountId);
    const to = acc(input.toAccountId);
    if (!from || !to) return { error: '移動元と移動先の口座を選んでください' };
    if (from.id === to.id) return { error: '移動元と移動先は別の口座にしてください' };
    if (from.type === 'loan' || to.type === 'loan') return { error: '奨学金への支払は「奨学金の返済」で記録してください' };
    f.fromAccountId = from.id;
    f.toAccountId = to.id;
  } else if (kind === 'repayment') {
    const loan = acc(input.toAccountId);
    if (!loan || loan.type !== 'loan') return { error: '返済した奨学金を選んでください' };
    f.toAccountId = loan.id;
    if (input.fromAccountId) {
      const from = acc(input.fromAccountId);
      if (!from || from.type === 'loan') return { error: '引き落とし口座が正しくありません' };
      f.fromAccountId = from.id;
    }
    f.breakdownUnknown = !!input.breakdownUnknown;
  } else if (kind === 'card_payment') {
    if (input.fromAccountId) {
      const from = acc(input.fromAccountId);
      if (!from || from.type === 'loan') return { error: '引き落とし口座が正しくありません' };
      f.fromAccountId = from.id;
    }
  }
  return { fields: f };
}

export function createEvent(state, input, ctx) {
  const { fields, error } = buildEventFields(state, input, ctx);
  if (error) return fail('invalid', error);
  const rec = { id: ctx.newId(ID_PREFIX.events), ...fields, createdAt: ctx.now, updatedAt: ctx.now, revision: 1, deletedAt: null };
  const err = guard(validateEvent(rec));
  if (err) return err;
  const ch = addTo(changes(), 'put', 'events', rec);
  const records = [rec];
  // 返済で利息が分かる場合：元金とは別の費用（その他）として1件記録する
  if (rec.kind === 'repayment' && input.interestYen) {
    if (!isYen(input.interestYen) || input.interestYen <= 0) return fail('invalid', '利息の金額が正しくありません');
    const interest = {
      id: ctx.newId(ID_PREFIX.events),
      kind: 'expense',
      amountYen: input.interestYen,
      datePrecision: rec.datePrecision,
      occurredOn: rec.occurredOn,
      yearMonth: rec.yearMonth,
      categoryId: 'other',
      isLuxury: false,
      memo: '奨学金の利息',
      paymentMethod: rec.paymentMethod,
      accountId: rec.fromAccountId,
      fromAccountId: null,
      toAccountId: null,
      breakdownUnknown: false,
      incomeType: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      revision: 1,
      deletedAt: null,
    };
    const e2 = guard(validateEvent(interest));
    if (e2) return e2;
    addTo(ch, 'put', 'events', interest);
    records.push(interest);
  }
  return { ok: true, changes: ch, record: rec, records };
}

/** 編集してもIDは変えない。種類は変えられない */
export function updateEvent(state, id, input, ctx) {
  const cur = state.events.find((e) => e.id === id && !e.deletedAt);
  if (!cur) return fail('not_found', '記録が見つかりません');
  const merged = { ...cur, ...input, kind: cur.kind };
  const { fields, error } = buildEventFields(state, merged, ctx);
  if (error) return fail('invalid', error);
  const rec = { ...cur, ...fields, updatedAt: ctx.now, revision: cur.revision + 1 };
  return guard(validateEvent(rec)) ?? { ok: true, changes: addTo(changes(), 'put', 'events', rec), record: rec, previous: cur };
}

export function setLuxury(state, id, isLuxury, ctx) {
  const cur = state.events.find((e) => e.id === id && !e.deletedAt);
  if (!cur || cur.kind !== 'expense') return fail('not_found', '支出が見つかりません');
  const rec = { ...cur, isLuxury: !!isLuxury, updatedAt: ctx.now, revision: cur.revision + 1 };
  return { ok: true, changes: addTo(changes(), 'put', 'events', rec), record: rec };
}

/** 削除（集計から外す）。サブスク支払の結び付きも同じ変更で外す */
export function deleteEvent(state, id, ctx) {
  const cur = state.events.find((e) => e.id === id && !e.deletedAt);
  if (!cur) return fail('not_found', '記録が見つかりません');
  const rec = { ...cur, deletedAt: ctx.now, updatedAt: ctx.now };
  const ch = addTo(changes(), 'put', 'events', rec);
  const link = linkForEvent(state, id);
  if (link) addTo(ch, 'del', 'paymentLinks', link.id);
  return { ok: true, changes: ch, record: rec, removedLink: link };
}

/** 削除の取り消し（直後の「元に戻す」用） */
export function restoreEvent(state, id, removedLink, ctx) {
  const cur = state.events.find((e) => e.id === id && e.deletedAt);
  if (!cur) return fail('not_found', '記録が見つかりません');
  const rec = { ...cur, deletedAt: null, updatedAt: ctx.now };
  const ch = addTo(changes(), 'put', 'events', rec);
  if (removedLink && !state.paymentLinks.some((l) => l.id === removedLink.id)) addTo(ch, 'add', 'paymentLinks', removedLink);
  return { ok: true, changes: ch, record: rec };
}

// ---------------------------------------------------------------------------
// サブスク荘

function dueFrom(nextDueOn, frequency) {
  if (!nextDueOn) return { dueDay: null, dueMonth: null };
  const day = Number(nextDueOn.slice(8, 10));
  const month = Number(nextDueOn.slice(5, 7));
  return { dueDay: day, dueMonth: frequency === 'yearly' ? month : null };
}

function priceOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  return v;
}

/**
 * 入居（契約の登録）。status: 'trial'（内見）か 'active'（有料）。
 * trial の priceYen は「内見後に予定される料金」（不明なら null）。
 */
export function createContract(state, input, ctx) {
  const displayName = trimText(input.displayName, 60);
  if (!displayName) return fail('invalid', 'サービス名を入力してください');
  const status = input.status === 'trial' ? 'trial' : 'active';
  const frequency = input.frequency === 'yearly' ? 'yearly' : 'monthly';
  const priceYen = priceOrNull(input.priceYen);
  if (priceYen !== null && (!isYen(priceYen) || priceYen < 0)) return fail('invalid', '料金が正しくありません');
  const startOn = input.startOn || ctx.today;
  if (!isValidDate(startOn)) return fail('invalid', '開始日が正しくありません');
  if (input.nextDueOn && !isValidDate(input.nextDueOn)) return fail('invalid', '次回支払日が正しくありません');
  if (input.trialEndsOn && !isValidDate(input.trialEndsOn)) return fail('invalid', '無料期間の終了日が正しくありません');
  const contract = {
    id: ctx.newId(ID_PREFIX.contracts),
    displayName,
    roomNo: nextRoomNo(state.contracts),
    archivedAt: null,
    note: trimText(input.note, 500),
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  const term = {
    id: ctx.newId(ID_PREFIX.contractTerms),
    contractId: contract.id,
    effectiveOn: startOn,
    status,
    priceYen,
    frequency,
    ...dueFrom(input.nextDueOn, frequency),
    trialEndsOn: status === 'trial' ? input.trialEndsOn || null : null,
    cancelledOn: null,
    recordedAt: ctx.now,
    note: '',
  };
  const err = guard([...validateContract(contract), ...validateTerm(term)]);
  if (err) return err;
  const ch = changes();
  addTo(ch, 'put', 'contracts', contract);
  addTo(ch, 'put', 'contractTerms', term);
  return { ok: true, changes: ch, record: contract, term };
}

export function updateContract(state, id, patch, ctx) {
  const cur = state.contracts.find((c) => c.id === id);
  if (!cur) return fail('not_found', '契約が見つかりません');
  const next = { ...cur, updatedAt: ctx.now };
  if ('displayName' in patch) next.displayName = trimText(patch.displayName, 60);
  if ('note' in patch) next.note = trimText(patch.note, 500);
  if ('archived' in patch) {
    if (patch.archived) {
      const t = termAt(termsOf(state, id), ctx.today);
      if (t && t.status !== 'ended') return fail('invalid', '退去（終了）した契約だけアーカイブできます');
    }
    next.archivedAt = patch.archived ? ctx.now : null;
  }
  return guard(validateContract(next)) ?? { ok: true, changes: addTo(changes(), 'put', 'contracts', next), record: next };
}

/**
 * 契約条件の変更（適用日つきの履歴として追加）。過去の支払記録は書き換えない。
 * input: { effectiveOn, status, priceYen, frequency, nextDueOn, trialEndsOn, cancelledOn, note }
 * 指定しなかった項目は、適用日時点の条件を引き継ぐ。
 */
export function changeTerms(state, contractId, input, ctx) {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return fail('not_found', '契約が見つかりません');
  const effectiveOn = input.effectiveOn;
  if (!isValidDate(effectiveOn)) return fail('invalid', '適用日が正しくありません');
  const terms = termsOf(state, contractId);
  const base = termAt(terms, effectiveOn) ?? terms[0];
  const status = input.status ?? base.status;
  const frequency = input.frequency ?? base.frequency;
  const priceYen = 'priceYen' in input ? priceOrNull(input.priceYen) : base.priceYen;
  if (priceYen !== null && (!isYen(priceYen) || priceYen < 0)) return fail('invalid', '料金が正しくありません');
  let due = { dueDay: base.dueDay, dueMonth: frequency === 'yearly' ? base.dueMonth : null };
  if ('nextDueOn' in input) due = dueFrom(input.nextDueOn || null, frequency);
  if (input.cancelledOn && !isValidDate(input.cancelledOn)) return fail('invalid', '解約手続きの日付が正しくありません');
  if (status === 'ended' && input.cancelledOn && input.cancelledOn > effectiveOn) {
    return fail('invalid', '解約手続きの日は、利用が終わる日以前にしてください');
  }
  const term = {
    id: ctx.newId(ID_PREFIX.contractTerms),
    contractId,
    effectiveOn,
    status,
    priceYen,
    frequency,
    ...due,
    trialEndsOn: status === 'trial' ? ('trialEndsOn' in input ? input.trialEndsOn || null : base.trialEndsOn) : null,
    cancelledOn: status === 'ended' ? input.cancelledOn || null : null,
    recordedAt: ctx.now,
    note: trimText(input.note, 500),
  };
  const err = guard(validateTerm(term));
  if (err) return err;
  return { ok: true, changes: addTo(changes(), 'put', 'contractTerms', term), record: term };
}

/** 契約条件の履歴を1件消す（入力の間違い用）。最後の1件は消せない */
export function deleteTerm(state, termId) {
  const t = state.contractTerms.find((x) => x.id === termId);
  if (!t) return fail('not_found', '契約条件が見つかりません');
  if (state.contractTerms.filter((x) => x.contractId === t.contractId).length <= 1) return fail('invalid', '最後の契約条件は削除できません');
  return { ok: true, changes: addTo(changes(), 'del', 'contractTerms', termId) };
}

export function deleteContract(state, id) {
  if (state.paymentLinks.some((l) => l.contractId === id)) {
    return fail('in_use', '支払の記録があるため削除できません。退去済みにしてアーカイブしてください');
  }
  const ch = addTo(changes(), 'del', 'contracts', id);
  for (const t of state.contractTerms.filter((x) => x.contractId === id)) addTo(ch, 'del', 'contractTerms', t.id);
  return { ok: true, changes: ch };
}

/**
 * 支払を確認して1件の支出（サブスク）として記録する。
 * 確認単位（契約＋請求月）ごとに1件だけ。連打・再試行でも二重にならない（add で一意制約）。
 * input: { contractId, ym, extra?: boolean, amountYen, datePrecision, occurredOn, memo, paymentMethod, accountId, isLuxury }
 */
export function confirmPayment(state, input, ctx) {
  const contract = state.contracts.find((c) => c.id === input.contractId);
  if (!contract) return fail('not_found', '契約が見つかりません');
  if (!isValidMonth(input.ym)) return fail('invalid', '請求月が正しくありません');
  const key = input.extra ? extraOccurrenceKey(contract.id, input.ym, input.extraSuffix ?? shortId()) : occurrenceKey(contract.id, input.ym);
  if (state.paymentLinks.some((l) => l.id === key)) return fail('already', 'この支払はすでに確認済みです');
  const ev = createEvent(
    state,
    {
      kind: 'expense',
      categoryId: 'subscription',
      amountYen: input.amountYen,
      datePrecision: input.datePrecision,
      occurredOn: input.occurredOn,
      yearMonth: input.datePrecision === 'month' ? (input.yearMonth ?? input.ym) : undefined,
      memo: input.memo ?? contract.displayName,
      paymentMethod: input.paymentMethod,
      accountId: input.accountId,
      isLuxury: input.isLuxury,
    },
    ctx,
  );
  if (!ev.ok) return ev;
  const link = {
    id: key,
    contractId: contract.id,
    yearMonth: input.ym,
    kind: input.extra ? 'extra' : 'regular',
    status: 'confirmed',
    moneyEventId: ev.record.id,
    confirmedAt: ctx.now,
  };
  const err = guard(validateLink(link));
  if (err) return err;
  const ch = changes();
  addTo(ch, 'put', 'events', ev.record);
  addTo(ch, 'add', 'paymentLinks', link);
  return { ok: true, changes: ch, record: ev.record, link };
}

/** 今月は支払なし（候補を片付ける。支出は作らない） */
export function skipPayment(state, { contractId, ym }, ctx) {
  const key = occurrenceKey(contractId, ym);
  if (state.paymentLinks.some((l) => l.id === key)) return fail('already', 'この支払はすでに確認済みです');
  const link = { id: key, contractId, yearMonth: ym, kind: 'regular', status: 'skipped', moneyEventId: null, confirmedAt: ctx.now };
  return guard(validateLink(link)) ?? { ok: true, changes: addTo(changes(), 'add', 'paymentLinks', link), link };
}

/**
 * 普通の支出として記録済みの支払を、契約の支払確認に結び付ける（新しい支出は作らない）。
 * 金額・日付の一致だけで自動結合はしない。本人が選んだ支出だけを結ぶ。
 */
export function linkExistingPayment(state, { contractId, ym, eventId, extra = false, setCategory = true }, ctx) {
  const ev = state.events.find((e) => e.id === eventId && !e.deletedAt);
  if (!ev || ev.kind !== 'expense') return fail('not_found', '支出が見つかりません');
  if (linkForEvent(state, eventId)) return fail('already_linked', 'この支出はすでに別の支払に結び付いています');
  const key = extra ? extraOccurrenceKey(contractId, ym, shortId()) : occurrenceKey(contractId, ym);
  if (state.paymentLinks.some((l) => l.id === key)) return fail('already', 'この支払はすでに確認済みです');
  const link = { id: key, contractId, yearMonth: ym, kind: extra ? 'extra' : 'regular', status: 'confirmed', moneyEventId: eventId, confirmedAt: ctx.now };
  const err = guard(validateLink(link));
  if (err) return err;
  const ch = addTo(changes(), 'add', 'paymentLinks', link);
  if (setCategory && ev.categoryId !== 'subscription') {
    addTo(ch, 'put', 'events', { ...ev, categoryId: 'subscription', updatedAt: ctx.now, revision: ev.revision + 1 });
  }
  return { ok: true, changes: ch, link };
}

/** 結び付きを外す（支出は残す）／支払なしの取り消し */
export function unlinkPayment(state, key) {
  if (!state.paymentLinks.some((l) => l.id === key)) return fail('not_found', '支払確認が見つかりません');
  return { ok: true, changes: addTo(changes(), 'del', 'paymentLinks', key) };
}

/** 確認した支払を取り消す（結び付きと支出の両方） */
export function removePayment(state, key, ctx) {
  const link = state.paymentLinks.find((l) => l.id === key);
  if (!link) return fail('not_found', '支払確認が見つかりません');
  const ch = addTo(changes(), 'del', 'paymentLinks', key);
  const ev = link.moneyEventId ? state.events.find((e) => e.id === link.moneyEventId && !e.deletedAt) : null;
  if (ev) addTo(ch, 'put', 'events', { ...ev, deletedAt: ctx.now, updatedAt: ctx.now });
  return { ok: true, changes: ch };
}

// ---------------------------------------------------------------------------
// いつもの動き（毎月の振替・積立・返済などのひな形。記録するときに中身を確認して使う）

export const QUICK_MOVE_LIMIT = 20;

export function addQuickMove(state, input, ctx) {
  const moves = state.settings.quickMoves ?? [];
  if (moves.length >= QUICK_MOVE_LIMIT) return fail('invalid', `いつもの動きは${QUICK_MOVE_LIMIT}件までです`);
  const label = trimText(input.label, 30);
  if (!label) return fail('invalid', '名前を入力してください');
  if (!['income', 'transfer', 'repayment', 'card_payment'].includes(input.kind)) return fail('invalid', '種類が正しくありません');
  if (input.amountYen !== null && input.amountYen !== undefined && (!isYen(input.amountYen) || input.amountYen <= 0))
    return fail('invalid', '金額が正しくありません');
  const accIds = new Set(state.accounts.map((a) => a.id));
  for (const k of ['fromAccountId', 'toAccountId']) if (input[k] && !accIds.has(input[k])) return fail('invalid', '口座が見つかりません');
  const move = {
    id: ctx.newId('move'),
    label,
    kind: input.kind,
    amountYen: input.amountYen ?? null,
    fromAccountId: input.fromAccountId ?? null,
    toAccountId: input.toAccountId ?? null,
  };
  const settings = { ...state.settings, quickMoves: [...moves, move] };
  const err = guard(validateSettings(settings));
  if (err) return err;
  const ch = changes();
  ch.settings = settings;
  return { ok: true, changes: ch, settings, record: move };
}

export function removeQuickMove(state, id) {
  const moves = state.settings.quickMoves ?? [];
  if (!moves.some((m) => m.id === id)) return fail('not_found', '見つかりません');
  const settings = { ...state.settings, quickMoves: moves.filter((m) => m.id !== id) };
  const ch = changes();
  ch.settings = settings;
  return { ok: true, changes: ch, settings };
}

// ---------------------------------------------------------------------------
// 設定

export function updateSettings(state, patch) {
  const next = { ...state.settings, ...patch };
  const ch = changes();
  ch.settings = next;
  return guard(validateSettings(next)) ?? { ok: true, changes: ch, settings: next };
}
