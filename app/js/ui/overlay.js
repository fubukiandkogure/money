// 下から出るシート・確認ダイアログ・トースト。
// Android の「戻る」でシートが閉じるよう、開くたびに履歴を1つ積む。

import { h, nextUid } from './dom.js';
import { icon } from './icons.js';

const stack = [];
let ignorePops = 0;
const afterPop = [];

window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops -= 1;
    const fn = afterPop.shift();
    if (fn) setTimeout(fn, 0);
    return;
  }
  const top = stack[stack.length - 1];
  if (top) top.close({ fromPop: true });
});

export function sheetsOpen() {
  return stack.length;
}

/**
 * @param {object} o
 * @param {string} o.title
 * @param {(api) => Node} o.build  api = { close, setBusy, el }
 * @param {() => boolean} [o.isDirty] 閉じる前に確認が必要か
 * @param {() => void} [o.onClose]
 */
export function openSheet({ title, build, isDirty, onClose, className }) {
  const titleId = nextUid('sheet-title-');
  let closed = false;
  const body = h('div', { class: 'sheet-body' });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '閉じる', onclick: () => requestClose() }, icon('close'));
  const panel = h(
    'div',
    { class: ['sheet', className], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, h('h2', { id: titleId, class: 'sheet-title' }, title), closeBtn),
    body,
  );
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: () => requestClose() });
  const root = h('div', { class: 'sheet-root' }, backdrop, panel);
  const prevFocus = document.activeElement;

  async function requestClose() {
    if (isDirty?.()) {
      const ok = await confirmDialog({
        title: '入力を破棄しますか？',
        message: '保存していない入力は消えます。',
        okLabel: '破棄する',
        cancelLabel: '入力に戻る',
        danger: true,
      });
      if (!ok) return;
    }
    api.close();
  }

  const api = {
    el: panel,
    body,
    close({ fromPop = false, then } = {}) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      root.classList.add('closing');
      setTimeout(() => root.remove(), 160);
      if (!fromPop) {
        ignorePops += 1;
        afterPop.push(then ?? null);
        history.back();
      } else if (then) setTimeout(then, 0);
      onClose?.();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.({ preventScroll: true });
    },
    requestClose,
    setTitle(t) {
      panel.querySelector('.sheet-title').textContent = t;
    },
  };
  body.append(build(api));
  document.body.append(root);
  history.pushState({ sheet: titleId }, '');
  stack.push(api);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
    }
  });
  requestAnimationFrame(() => {
    root.classList.add('open');
    const auto = panel.querySelector('[data-autofocus]');
    if (auto) auto.focus({ preventScroll: true });
    else closeBtn.focus({ preventScroll: true });
  });
  return api;
}

/** 開いているシートをすべて閉じてから fn を実行（画面遷移用） */
export function closeAllSheets(then) {
  if (stack.length === 0) {
    then?.();
    return;
  }
  const all = [...stack];
  all.forEach((s, i) => s.close({ then: i === all.length - 1 ? then : undefined }));
}

export function confirmDialog({ title, message, okLabel = 'OK', cancelLabel = 'やめる', danger = false, details }) {
  return new Promise((resolve) => {
    let result = false;
    openSheet({
      title,
      className: 'dialog',
      onClose: () => resolve(result),
      build: (api) =>
        h(
          'div',
          { class: 'stack' },
          message ? h('p', { class: 'dialog-message' }, message) : null,
          details ?? null,
          h(
            'div',
            { class: 'btn-row' },
            h('button', { class: 'btn ghost', type: 'button', onclick: () => api.close() }, cancelLabel),
            h(
              'button',
              {
                class: ['btn', danger ? 'danger' : 'primary'],
                type: 'button',
                'data-autofocus': true,
                onclick: () => {
                  result = true;
                  api.close();
                },
              },
              okLabel,
            ),
          ),
        ),
    });
  });
}

export function alertDialog({ title, message, details }) {
  return new Promise((resolve) => {
    openSheet({
      title,
      className: 'dialog',
      onClose: resolve,
      build: (api) =>
        h(
          'div',
          { class: 'stack' },
          message ? h('p', { class: 'dialog-message' }, message) : null,
          details ?? null,
          h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => api.close() }, 'OK')),
        ),
    });
  });
}

// ---------------------------------------------------------------------------
// トースト

let toastHost = null;

function host() {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  return toastHost;
}

/**
 * @param {string} message
 * @param {{kind?: 'ok'|'error'|'info', action?: {label: string, run: () => void}, duration?: number}} o
 */
export function toast(message, { kind = 'ok', action, duration } = {}) {
  const el = h(
    'div',
    { class: ['toast', `toast-${kind}`] },
    h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon(kind === 'error' ? 'alert' : kind === 'info' ? 'info' : 'check', 18)),
    h('span', { class: 'toast-msg' }, message),
  );
  const dismiss = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (action) {
    el.append(
      h(
        'button',
        {
          class: 'toast-action',
          type: 'button',
          onclick: () => {
            dismiss();
            action.run();
          },
        },
        action.label,
      ),
    );
  }
  el.append(h('button', { class: 'toast-close', type: 'button', 'aria-label': '閉じる', onclick: dismiss }, icon('close', 16)));
  // ふつうの通知は最新の1件だけ（エラーは閉じるまで残す）
  for (const old of host().querySelectorAll('.toast:not(.toast-error)')) old.remove();
  host().append(el);
  const ms = duration ?? (kind === 'error' ? 0 : action ? 7000 : 3500);
  if (ms > 0) setTimeout(dismiss, ms);
  return dismiss;
}

/** 月末を確定したとき：金色のブロックが1つ降ってきて積もる */
export function playStamp(text = '確定') {
  const el = h(
    'div',
    { class: 'stamp-anim play', 'aria-hidden': 'true' },
    h('span', { class: 'stamp-block' }, icon('check', 34)),
    h('span', { class: 'stamp-text' }, text),
  );
  document.body.append(el);
  setTimeout(() => el.remove(), 1300);
}
