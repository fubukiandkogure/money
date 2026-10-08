// アプリ全体で共有する文脈（保存・日付・画面遷移）
import { newId } from './core/ids.js';
import { todayJST, nowStampJST } from './core/dates.js';
import { toast, closeAllSheets } from './ui/overlay.js';

export const app = {
  store: null,
  demo: false,
  rerender: () => {},

  get state() {
    return this.store.state;
  },

  today() {
    return todayJST(new Date());
  },

  /** 変更の組み立てに渡す文脈（今日・記録日時・ID） */
  ctx() {
    const d = new Date();
    return { today: todayJST(d), now: nowStampJST(d), newId };
  },

  /**
   * 組み立てた変更を保存する。保存に成功してから画面を更新し、成功を表示する。
   * 失敗したときは入力を残せるよう { ok: false } を返す（画面は呼び出し側がそのまま保つ）。
   */
  async save(res, { okMessage, undo, silent = false } = {}) {
    if (!res.ok) return res;
    try {
      await this.store.commit(res.changes);
    } catch (e) {
      console.error(e);
      toast(e.message ?? '保存できませんでした', { kind: 'error' });
      return { ok: false, code: 'save_failed', kind: e.kind, message: e.message ?? '保存できませんでした' };
    }
    if (!silent && okMessage) toast(okMessage, { action: undo ? { label: '取り消す', run: undo } : undefined });
    return res;
  },

  navigate(path) {
    closeAllSheets(() => {
      const target = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
      if (location.hash === target) this.rerender();
      else location.hash = target;
    });
  },
};
