// 永続化に成功した変更を、メモリ上の状態へ反映する（DBの一意制約と同じ規則で）。
import { COLLECTIONS, DEFAULT_SETTINGS } from './constants.js';

export function emptyState() {
  const s = {};
  for (const c of COLLECTIONS) s[c] = [];
  s.settings = { ...DEFAULT_SETTINGS };
  return s;
}

export class DuplicateKeyError extends Error {
  constructor(coll, id) {
    super(`${coll} に同じID（${id}）がすでにあります`);
    this.name = 'ConstraintError';
  }
}

/** 変更を反映した新しい state を返す。変更のないコレクションは同じ配列を使い回す */
export function applyChanges(state, ch) {
  const next = { ...state };
  const touched = new Map();
  const getMap = (coll) => {
    if (!touched.has(coll)) touched.set(coll, new Map(state[coll].map((r) => [r.id, r])));
    return touched.get(coll);
  };
  for (const [coll, recs] of Object.entries(ch.add ?? {})) {
    const m = getMap(coll);
    for (const r of recs) {
      if (m.has(r.id)) throw new DuplicateKeyError(coll, r.id);
      m.set(r.id, r);
    }
  }
  for (const [coll, recs] of Object.entries(ch.put ?? {})) {
    const m = getMap(coll);
    for (const r of recs) m.set(r.id, r);
  }
  for (const [coll, ids] of Object.entries(ch.del ?? {})) {
    const m = getMap(coll);
    for (const id of ids) m.delete(id);
  }
  for (const [coll, m] of touched) next[coll] = [...m.values()];
  if (ch.settings) next.settings = ch.settings;
  return next;
}

export function touchedCollections(ch) {
  const set = new Set();
  for (const op of ['add', 'put', 'del']) for (const coll of Object.keys(ch[op] ?? {})) set.add(coll);
  return [...set];
}
