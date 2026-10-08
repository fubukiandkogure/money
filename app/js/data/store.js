// 端末内保存（IndexedDB）。
// - 関連する変更は1つのトランザクションでまとめて永続化し、完了してから画面へ反映する
// - 各書き込みで「読み込んだときのリビジョン」を確かめ、別タブの新しい内容を古い画面で上書きしない
// - 読み込みで不整合があればエラーにする（黙って初期化・サンプル投入しない）
// - 復元は全ストアを1トランザクションで置換。途中で失敗すれば既存データはそのまま

import { COLLECTIONS, DEFAULT_SETTINGS, SCHEMA_VERSION } from '../core/constants.js';
import { applyChanges, emptyState, touchedCollections } from '../core/apply.js';
import { validateDataset } from '../core/validate.js';
import { nowStampJST } from '../core/dates.js';

/** IndexedDB の構造の版。ストアの追加・データ移行が必要になったら上げ、upgrade() に手順を足す */
export const DB_VERSION = 1;
const META = 'meta';

export class SaveError extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.name = 'SaveError';
    this.kind = kind; // 'stale' | 'constraint' | 'quota' | 'closed' | 'unknown'
    this.cause = cause;
  }
}

export class LoadError extends Error {
  constructor(kind, message, details = []) {
    super(message);
    this.name = 'LoadError';
    this.kind = kind; // 'unsupported' | 'open_failed' | 'blocked' | 'too_new' | 'corrupt'
    this.details = details;
  }
}

function describeSaveError(err) {
  const name = err?.name ?? '';
  if (name === 'QuotaExceededError') return new SaveError('quota', '端末の保存容量が足りないため保存できませんでした', err);
  if (name === 'ConstraintError') return new SaveError('constraint', '同じ記録がすでに保存されています', err);
  if (name === 'InvalidStateError') return new SaveError('closed', 'データベースが閉じられています。ページを再読み込みしてください', err);
  return new SaveError('unknown', `保存できませんでした（${name || err?.message || '不明なエラー'}）`, err);
}

function upgrade(db, tx, oldVersion) {
  if (oldVersion < 1) {
    for (const c of COLLECTIONS) db.createObjectStore(c, { keyPath: 'id' });
    const meta = db.createObjectStore(META, { keyPath: 'key' });
    meta.put({ key: 'state', revision: 0, schemaVersion: SCHEMA_VERSION, createdAt: nowStampJST() });
    meta.put({ key: 'settings', value: { ...DEFAULT_SETTINGS } });
    meta.put({ key: 'device', lastExportAt: null, lastExportFile: null, lastRestoreAt: null, restoredFromExportedAt: null });
  }
  // 将来：if (oldVersion < 2) { ...tx を使って移行。失敗すれば upgrade 全体が中止され、旧データは残る }
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('aborted', 'AbortError'));
    tx.onerror = () => {}; // onabort でまとめて扱う
  });
}

export class Store {
  constructor({ dbName, onExternalChange, onVersionChange } = {}) {
    this.dbName = dbName;
    this.db = null;
    this.state = emptyState();
    this.revision = 0;
    this.device = {};
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.onExternalChange = onExternalChange;
    this.onVersionChange = onVersionChange;
    this.tabId = Math.random().toString(36).slice(2);
    this.lastSavedAt = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason) {
    for (const fn of this.listeners) fn(this.state, reason);
  }

  async open() {
    if (!('indexedDB' in globalThis)) throw new LoadError('unsupported', 'このブラウザでは端末内保存（IndexedDB）が使えません');
    this.db = await new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(this.dbName, DB_VERSION);
      } catch (e) {
        reject(new LoadError('open_failed', `データベースを開けませんでした（${e.name}）`));
        return;
      }
      req.onupgradeneeded = (ev) => upgrade(req.result, req.transaction, ev.oldVersion);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        const e = req.error;
        if (e?.name === 'VersionError') reject(new LoadError('too_new', 'このデータは新しい版のアプリで更新されています。ページを再読み込みして最新版を使ってください'));
        else reject(new LoadError('open_failed', `データベースを開けませんでした（${e?.name ?? '不明'}）`));
      };
      req.onblocked = () => reject(new LoadError('blocked', '別のタブで古い版のアプリが開いています。ほかのタブを閉じてから再読み込みしてください'));
    });
    this.db.onversionchange = () => {
      this.db.close();
      this.db = null;
      this.onVersionChange?.();
    };
    await this.load();
    this.setupSync();
  }

  /** 全ストアを1つの読み取りトランザクションで読み、検証してから使う */
  async load() {
    const raw = await this.readRaw();
    const meta = raw.meta;
    const st = meta.state;
    if (!st) throw new LoadError('corrupt', '保存データの管理情報がありません', ['meta.state がありません']);
    if (st.schemaVersion > SCHEMA_VERSION) throw new LoadError('too_new', 'このデータは新しい版のアプリで保存されています。ページを再読み込みしてください');
    const data = { ...raw.data, settings: meta.settings?.value };
    const errors = validateDataset(data);
    if (errors.length) throw new LoadError('corrupt', '保存データに不整合が見つかりました', errors);
    this.state = data;
    this.revision = st.revision;
    this.device = meta.device ?? {};
    return this.state;
  }

  async readRaw() {
    const tx = this.db.transaction([...COLLECTIONS, META], 'readonly');
    const data = {};
    const reads = COLLECTIONS.map(async (c) => {
      data[c] = await reqP(tx.objectStore(c).getAll());
    });
    const metaList = reqP(tx.objectStore(META).getAll());
    await Promise.all(reads);
    const meta = Object.fromEntries((await metaList).map((m) => [m.key, m]));
    return { data, meta };
  }

  /**
   * 変更を1トランザクションで保存する。成功するまで画面の状態は変えない。
   * 同じタブ内の保存は順番に処理する（連打しても入れ違いにならない）。
   */
  commit(changes) {
    const run = () => this._commit(changes);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async _commit(changes) {
    if (!this.db) throw new SaveError('closed', 'データベースが閉じられています。ページを再読み込みしてください');
    const colls = touchedCollections(changes);
    const expected = this.revision;
    // メモリ上で先に適用してみる（一意制約などの矛盾を保存前に検出）
    let nextState;
    try {
      nextState = applyChanges(this.state, changes);
    } catch (e) {
      throw new SaveError('constraint', '同じ記録がすでに保存されています', e);
    }
    let tx;
    try {
      tx = this.db.transaction([...colls, META], 'readwrite', { durability: 'strict' });
    } catch (e) {
      throw describeSaveError(e);
    }
    const done = txDone(tx);
    let stale = false;
    let thrown = null;
    const meta = tx.objectStore(META);
    meta.get('state').onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur || cur.revision !== expected) {
        stale = true;
        tx.abort();
        return;
      }
      try {
        for (const [coll, recs] of Object.entries(changes.add ?? {})) for (const r of recs) tx.objectStore(coll).add(r);
        for (const [coll, recs] of Object.entries(changes.put ?? {})) for (const r of recs) tx.objectStore(coll).put(r);
        for (const [coll, ids] of Object.entries(changes.del ?? {})) for (const id of ids) tx.objectStore(coll).delete(id);
        if (changes.settings) meta.put({ key: 'settings', value: changes.settings });
        meta.put({ ...cur, revision: expected + 1, updatedAt: nowStampJST() });
      } catch (e) {
        thrown = e;
        try {
          tx.abort();
        } catch {
          /* すでに中止 */
        }
      }
    };
    try {
      await done;
    } catch (e) {
      if (stale) {
        await this.reloadFromDb('stale');
        throw new SaveError('stale', '別のタブ（または別の画面）でデータが更新されていたため、保存しませんでした。最新の内容を読み込んだので、もう一度保存してください');
      }
      throw describeSaveError(thrown ?? e);
    }
    this.state = nextState;
    this.revision = expected + 1;
    this.lastSavedAt = nowStampJST();
    this.broadcast();
    this.emit('commit');
    return this.state;
  }

  /** 復元・全削除：全ストアを1トランザクションで置き換える */
  replaceAll(data, { exportedAt = null } = {}) {
    const run = () => this._replaceAll(data, exportedAt);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async _replaceAll(data, exportedAt) {
    if (!this.db) throw new SaveError('closed', 'データベースが閉じられています');
    const expected = this.revision;
    let tx;
    try {
      tx = this.db.transaction([...COLLECTIONS, META], 'readwrite', { durability: 'strict' });
    } catch (e) {
      throw describeSaveError(e);
    }
    const done = txDone(tx);
    let stale = false;
    let thrown = null;
    const meta = tx.objectStore(META);
    const now = nowStampJST();
    meta.get('state').onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur || cur.revision !== expected) {
        stale = true;
        tx.abort();
        return;
      }
      try {
        for (const c of COLLECTIONS) {
          const os = tx.objectStore(c);
          os.clear();
          for (const r of data[c]) os.add(r);
        }
        meta.put({ key: 'settings', value: data.settings });
        meta.put({ ...cur, revision: expected + 1, updatedAt: now });
        if (exportedAt) meta.put({ ...this.device, key: 'device', lastRestoreAt: now, restoredFromExportedAt: exportedAt });
      } catch (e) {
        thrown = e;
        try {
          tx.abort();
        } catch {
          /* すでに中止 */
        }
      }
    };
    try {
      await done;
    } catch (e) {
      if (stale) {
        await this.reloadFromDb('stale');
        throw new SaveError('stale', '別のタブでデータが更新されていたため、置き換えを中止しました。もう一度やり直してください');
      }
      throw describeSaveError(thrown ?? e);
    }
    // 実際に保存された内容を読み直して使う（復元後の確認のため）
    await this.load();
    this.lastSavedAt = now;
    this.broadcast();
    this.emit('replace');
    return this.state;
  }

  /** 端末ごとの情報（最終書き出し日時など）。バックアップには含めない */
  async setDevice(patch) {
    const tx = this.db.transaction([META], 'readwrite', { durability: 'strict' });
    const done = txDone(tx);
    const next = { key: 'device', ...this.device, ...patch };
    tx.objectStore(META).put(next);
    await done;
    this.device = next;
    this.emit('device');
  }

  async reloadFromDb(reason) {
    await this.load();
    this.emit(reason);
  }

  setupSync() {
    if ('BroadcastChannel' in globalThis) {
      this.channel = new BroadcastChannel(`${this.dbName}-sync`);
      this.channel.onmessage = (ev) => {
        if (ev.data?.type === 'changed' && ev.data.from !== this.tabId && ev.data.revision !== this.revision) {
          this.checkExternal();
        }
      };
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkExternal();
    });
  }

  broadcast() {
    this.channel?.postMessage({ type: 'changed', revision: this.revision, from: this.tabId });
  }

  /** 他のタブで更新されていれば読み直す */
  async checkExternal() {
    if (!this.db) return;
    try {
      const tx = this.db.transaction([META], 'readonly');
      const st = await reqP(tx.objectStore(META).get('state'));
      if (st && st.revision !== this.revision) {
        await this.load();
        this.emit('external');
        this.onExternalChange?.();
      }
    } catch (e) {
      console.error(e);
      this.onExternalChange?.(e);
    }
  }

  /** 読み込みに失敗したときの救出用：検証せずに中身をそのまま取り出す */
  async rescueDump() {
    const raw = await this.readRaw();
    return { ...raw.data, settings: raw.meta.settings?.value ?? null, meta: raw.meta };
  }

  /** 永続化（ブラウザによる自動削除の対象外）を依頼する */
  static async requestPersist() {
    try {
      if (!navigator.storage?.persist) return null;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return null;
    }
  }

  static async persistStatus() {
    try {
      if (!navigator.storage?.persisted) return null;
      return await navigator.storage.persisted();
    } catch {
      return null;
    }
  }

  static async estimate() {
    try {
      return (await navigator.storage?.estimate?.()) ?? null;
    } catch {
      return null;
    }
  }
}

/** 読み込みに失敗した状態でも、DB を開かずに生データを取り出す（救出用） */
export async function openForRescue(dbName) {
  const s = new Store({ dbName });
  s.db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return s;
}
