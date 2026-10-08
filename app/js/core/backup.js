// 手動バックアップ（JSON）の書き出し・検証・移行。
// 復元は「置換」。検証に通らないファイルでは既存データに一切触れない。

import { APP_ID, APP_VERSION, CATEGORIES, COLLECTIONS, SCHEMA_VERSION } from './constants.js';
import { validateDataset } from './validate.js';
import { currentOverview } from './assets.js';
import { effectiveClose } from './closes.js';
import { projection } from './subs.js';
import { sumYen } from './money.js';
import { stampToDateJST } from './dates.js';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/** 状態から保存対象のデータだけを取り出す（画面の一時入力などは含めない） */
export function pickData(state) {
  const data = {};
  for (const c of COLLECTIONS) data[c] = state[c].map((r) => structuredClone(r));
  data.settings = structuredClone(state.settings);
  return data;
}

/**
 * 復元後に元と一致するかを確かめるための集計。
 * 基準日を固定して計算するので、復元した日が違っても同じ値になる。
 */
export function summarize(data, referenceDate) {
  const active = data.events.filter((e) => !e.deletedAt);
  const expenses = active.filter((e) => e.kind === 'expense');
  const luxury = expenses.filter((e) => e.isLuxury);
  const overview = currentOverview(data, referenceDate);
  const months = [...new Set(data.closes.map((c) => c.yearMonth))].sort();
  const closes = {};
  for (const ym of months) {
    const e = effectiveClose(data, ym, referenceDate);
    closes[ym] = { status: e.status, revision: e.history.length, net: e.close?.totals?.net ?? null };
  }
  const proj = projection(data, referenceDate);
  return {
    referenceDate,
    counts: Object.fromEntries([...COLLECTIONS.map((c) => [c, data[c].length]), ['activeEvents', active.length]]),
    expenseTotal: sumYen(expenses.map((e) => e.amountYen)),
    expenseCount: expenses.length,
    luxuryTotal: sumYen(luxury.map((e) => e.amountYen)),
    luxuryCount: luxury.length,
    latest: { assets: overview.assets.total, loans: overview.loans.total, net: overview.net, missing: overview.missing.length },
    closes,
    subscriptions: { annualTotal: proj.annualTotal, activeCount: proj.activeCount, unknownCount: proj.unknownCount },
  };
}

export function buildExport(state, now) {
  const data = pickData(state);
  return {
    appId: APP_ID,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    note: 'ふところ町のバックアップです。本人の金融データを含みます。共有しないでください。',
    data: { ...data, categories: CATEGORIES },
    summary: summarize(data, stampToDateJST(now)),
  };
}

export function backupFileName(now) {
  // 2026-10-08T21:05:33.000+09:00 → futokoro-machi-backup-20261008-2105.json
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(now);
  const stamp = m ? `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}` : 'export';
  return `${APP_ID}-backup-${stamp}.json`;
}

// ---------------------------------------------------------------------------
// 移行（古い版 → 現在の版）。検証可能な関数として順に適用する。

const MIGRATIONS = {
  // 例： 1: (backup) => ({ ...backup, schemaVersion: 2, data: ... }),
};

export function migrate(backup) {
  let cur = backup;
  while (cur.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[cur.schemaVersion];
    if (!step) throw new Error(`版 ${cur.schemaVersion} からの移行方法がありません`);
    cur = step(cur);
  }
  return cur;
}

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * バックアップの文字列を検証する。ここでは何も書き換えない。
 * @returns {{ok: true, backup, data, summary} | {ok: false, code, errors: string[]}}
 */
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, code: 'empty', errors: ['ファイルが空です'] };
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, code: 'too_large', errors: ['ファイルが大きすぎます'] };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, code: 'json', errors: ['JSONとして読み込めません。ファイルが壊れているか、途中で切れている可能性があります'] };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, code: 'format', errors: ['バックアップの形式ではありません'] };
  if (obj.appId !== APP_ID) {
    return { ok: false, code: 'other_app', errors: ['ふところ町のバックアップではありません（別のアプリのファイルの可能性があります）'] };
  }
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) return { ok: false, code: 'format', errors: ['データの版が読み取れません'] };
  if (obj.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'too_new',
      errors: [`このファイルは新しい版（${obj.schemaVersion}）のアプリで作られています。アプリを更新してから復元してください`],
    };
  }
  let migrated;
  try {
    migrated = migrate(obj);
  } catch (e) {
    return { ok: false, code: 'migration', errors: [e.message] };
  }
  const src = migrated.data;
  if (!src || typeof src !== 'object') return { ok: false, code: 'format', errors: ['data がありません'] };
  const data = {};
  for (const c of COLLECTIONS) data[c] = src[c];
  data.settings = src.settings;
  const errors = validateDataset(data);
  if (Array.isArray(src.categories)) {
    const known = new Set(CATEGORIES.map((c) => c.id));
    for (const c of src.categories) if (!known.has(c?.id)) errors.push(`未対応のカテゴリーがあります（${c?.id}）`);
  }
  if (typeof migrated.exportedAt !== 'string' || Number.isNaN(Date.parse(migrated.exportedAt))) errors.push('書き出し日時が読み取れません');
  if (errors.length) return { ok: false, code: 'invalid', errors };

  let summary = null;
  if (migrated.summary) {
    summary = summarize(data, migrated.summary.referenceDate);
    if (!sameJSON(summary, migrated.summary)) {
      return { ok: false, code: 'summary_mismatch', errors: ['ファイル内の集計と中身が一致しません。ファイルが変更・破損している可能性があります'] };
    }
  }
  return { ok: true, backup: migrated, data, summary };
}
