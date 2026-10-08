// 入力部品。文字入力を強制せず、タップ中心で入力できるようにする。

import { h, nextUid } from './dom.js';
import { icon } from './icons.js';
import { CATEGORIES, LUXURY_LABEL } from '../core/constants.js';
import { parseYenInput, formatPlain } from '../core/money.js';
import { addDays, formatDateShort, isValidDate, isValidMonth } from '../core/dates.js';

/** フィールドの見出し＋本体＋補足＋エラー */
export function field(label, control, { hint, id, error } = {}) {
  const errEl = h('p', { class: 'field-error', role: 'alert', hidden: !error }, error ?? '');
  return h(
    'div',
    { class: 'field' },
    label ? h('label', { class: 'field-label', for: id }, label) : null,
    control,
    hint ? h('p', { class: 'field-hint' }, hint) : null,
    errEl,
  );
}

export function setFieldError(fieldEl, message) {
  const e = fieldEl.querySelector(':scope > .field-error');
  if (!e) return;
  e.textContent = message ?? '';
  e.hidden = !message;
}

/**
 * 金額入力。数字キーボード。カンマ・全角も受け付け、離れたときにカンマ区切りへ整える。
 * @returns {{el, input, read(): {ok, value?, error?}, set(v)}}
 */
export function amountInput({ value = null, autofocus = false, allowNegative = false, allowZero = false, big = false, placeholder = '0', label = '金額' } = {}) {
  const id = nextUid('amt-');
  let negative = allowNegative && value !== null && value < 0;
  const input = h('input', {
    id,
    class: ['amount-input', big && 'big'],
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    enterkeyhint: 'done',
    placeholder,
    'aria-label': label,
    value: value === null ? '' : formatPlain(Math.abs(value)),
    'data-autofocus': autofocus || undefined,
  });
  input.addEventListener('blur', () => {
    const r = parseYenInput(input.value, { allowZero: true });
    if (r.ok) input.value = formatPlain(r.value);
  });
  input.addEventListener('focus', () => {
    input.value = input.value.replace(/,/g, '');
  });
  const signBtn = allowNegative
    ? h(
        'button',
        {
          type: 'button',
          class: 'sign-btn',
          'aria-pressed': String(negative),
          'aria-label': 'マイナスの残高',
          onclick: () => {
            negative = !negative;
            signBtn.setAttribute('aria-pressed', String(negative));
            signBtn.textContent = negative ? '−' : '+';
          },
        },
        negative ? '−' : '+',
      )
    : null;
  const el = h('div', { class: ['amount-wrap', big && 'big'] }, signBtn, h('span', { class: 'yen-mark', 'aria-hidden': 'true' }, '¥'), input);
  return {
    el,
    input,
    id,
    read() {
      const r = parseYenInput(input.value, { allowZero });
      if (!r.ok) return r;
      return { ok: true, value: negative ? -r.value : r.value };
    },
    set(v) {
      input.value = v === null ? '' : formatPlain(Math.abs(v));
    },
    isEmpty: () => input.value.trim() === '',
  };
}

/** カテゴリーをタップで選ぶ（必須） */
export function categoryPicker(selected, onChange) {
  let current = selected ?? null;
  const buttons = CATEGORIES.map((c) =>
    h(
      'button',
      {
        type: 'button',
        class: 'cat-btn',
        role: 'radio',
        'aria-checked': String(c.id === current),
        dataset: { cat: c.id },
        onclick: () => {
          current = c.id;
          for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.cat === current));
          onChange?.(current);
        },
      },
      h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, c.icon),
      h('span', { class: 'cat-label' }, c.label),
    ),
  );
  const el = h('div', { class: 'cat-grid', role: 'radiogroup', 'aria-label': 'カテゴリー' }, buttons);
  return { el, get: () => current };
}

/** 今日・昨日のチップ＋日付入力 */
export function dateInput({ value, today, label = '日付', allowFuture = true, quick = true, monthEndShortcut = false }) {
  const id = nextUid('date-');
  const input = h('input', { id, type: 'date', class: 'date-input', value, max: allowFuture ? undefined : today, 'aria-label': label });
  const chips = [];
  const mk = (text, date) => {
    const b = h('button', { type: 'button', class: 'chip', onclick: () => set(date) }, text);
    b.dataset.date = date;
    chips.push(b);
    return b;
  };
  const sync = () => {
    for (const b of chips) b.setAttribute('aria-pressed', String(b.dataset.date === input.value));
  };
  const set = (d) => {
    input.value = d;
    sync();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  input.addEventListener('change', sync);
  input.addEventListener('input', sync);
  const quickRow = [];
  if (quick) {
    quickRow.push(mk('今日', today), mk('昨日', addDays(today, -1)));
  }
  if (monthEndShortcut) {
    const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
    quickRow.push(mk(`先月末（${formatDateShort(lastMonthEnd)}）`, lastMonthEnd));
  }
  sync();
  const el = h('div', { class: 'date-row' }, quickRow, input);
  return {
    el,
    input,
    id,
    get: () => input.value,
    set,
    valid: () => isValidDate(input.value),
  };
}

export function monthInput({ value, label = '年月' }) {
  const id = nextUid('month-');
  const input = h('input', { id, type: 'month', class: 'date-input', value, 'aria-label': label });
  return { el: input, input, id, get: () => input.value, valid: () => isValidMonth(input.value) };
}

/** ごほうび（贅沢）のワンタップ切り替え */
export function luxuryToggle(on, onChange) {
  let state = !!on;
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'lux-toggle',
      'aria-pressed': String(state),
      onclick: () => {
        state = !state;
        btn.setAttribute('aria-pressed', String(state));
        onChange?.(state);
      },
    },
    icon('star', 20),
    h('span', null, LUXURY_LABEL),
  );
  return { el: btn, get: () => state };
}

/** 選択（セグメント） */
export function segmented(options, value, onChange, { label } = {}) {
  let current = value;
  const buttons = options.map(([v, text]) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': String(v === current),
        dataset: { v },
        onclick: () => {
          current = v;
          for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.v === current));
          onChange?.(v);
        },
      },
      text,
    ),
  );
  return { el: h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label }, buttons), get: () => current };
}

export function select(options, value, { id, label, emptyLabel } = {}) {
  const el = h(
    'select',
    { id: id ?? nextUid('sel-'), class: 'select', 'aria-label': label },
    emptyLabel !== undefined ? h('option', { value: '' }, emptyLabel) : null,
    options.map(([v, text]) => h('option', { value: v, selected: v === value || undefined }, text)),
  );
  if (value === null || value === undefined) el.value = emptyLabel !== undefined ? '' : el.value;
  return el;
}

export function textInput({ value = '', placeholder = '', maxlength = 200, id, label } = {}) {
  return h('input', { id: id ?? nextUid('txt-'), class: 'text-input', type: 'text', value, placeholder, maxlength, 'aria-label': label, autocomplete: 'off' });
}

export function checkbox(label, checked, { hint } = {}) {
  const id = nextUid('chk-');
  const input = h('input', { id, type: 'checkbox', checked });
  return {
    el: h('div', { class: 'check' }, input, h('label', { for: id }, label, hint ? h('span', { class: 'check-hint' }, hint) : null)),
    input,
    get: () => input.checked,
  };
}

/** 保存ボタン：保存中は無効にして連打を防ぐ */
export function saveButton(label, onSave, { kind = 'primary' } = {}) {
  const btn = h('button', { type: 'submit', class: ['btn', kind, 'wide'] }, label);
  let busy = false;
  const run = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    busy = true;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = '保存中…';
    try {
      await onSave();
    } finally {
      busy = false;
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = prev;
      }
    }
  };
  return { el: btn, run };
}

export function formError() {
  const el = h('div', { class: 'form-error', role: 'alert', hidden: true });
  return {
    el,
    show(msg, details) {
      el.replaceChildren(h('p', null, msg), details ? h('ul', null, details.map((d) => h('li', null, d))) : null);
      el.hidden = false;
      el.scrollIntoView?.({ block: 'nearest' });
    },
    clear() {
      el.hidden = true;
      el.replaceChildren();
    },
  };
}
