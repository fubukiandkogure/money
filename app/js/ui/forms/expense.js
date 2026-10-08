// 支出の入力・編集。必須は金額とカテゴリーだけ。
import { h } from '../dom.js';
import { app } from '../../app.js';
import { openSheet, confirmDialog, toast } from '../overlay.js';
import {
  amountInput,
  categoryPicker,
  dateInput,
  luxuryToggle,
  field,
  setFieldError,
  textInput,
  select,
  checkbox,
  saveButton,
  formError,
  monthInput,
} from '../fields.js';
import * as A from '../../core/actions.js';
import { categoryById, PAYMENT_METHODS, LUXURY_LABEL } from '../../core/constants.js';
import { formatYen } from '../../core/money.js';
import { sortAccounts } from '../../core/assets.js';
import { linkForEvent } from '../../core/subs.js';

const CONT_KEY = 'futokoro-machi:continuous-entry';

function readPref(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writePref(key, on) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* 保存できなくても動作に影響しない */
  }
}

/** 削除して「元に戻す」を出す（記録一覧などからも使う） */
export async function deleteEventWithUndo(ev) {
  const res = A.deleteEvent(app.state, ev.id, app.ctx());
  const saved = await app.save(res, {
    okMessage: '削除しました',
    undo: async () => {
      const r = A.restoreEvent(app.state, ev.id, res.removedLink, app.ctx());
      await app.save(r, { okMessage: '元に戻しました' });
    },
  });
  return saved;
}

/**
 * @param {object} [o]
 * @param {object} [o.event] 編集する支出
 * @param {object} [o.preset] 初期値（categoryId, occurredOn など）
 */
export function openExpenseSheet({ event, preset = {} } = {}) {
  const editing = !!event;
  const today = app.today();
  const init = event ?? {
    amountYen: null,
    categoryId: null,
    datePrecision: 'day',
    occurredOn: today,
    yearMonth: today.slice(0, 7),
    isLuxury: false,
    memo: '',
    paymentMethod: null,
    accountId: null,
    ...preset,
  };

  let amountCtl = null;
  openSheet({
    title: editing ? '支出を編集' : '支出を記録',
    isDirty: () => !!amountCtl && !amountCtl.isEmpty() && amountCtl.input.value.replace(/,/g, '') !== String(init.amountYen ?? ''),
    build: (sheet) => {
      const amount = amountInput({ value: init.amountYen, autofocus: !editing, big: true });
      amountCtl = amount;
      const amountField = field(null, amount.el, { id: amount.id });
      const cat = categoryPicker(init.categoryId, () => setFieldError(catField, null));
      const catField = field('カテゴリー', cat.el);
      let precision = init.datePrecision;
      const date = dateInput({ value: init.occurredOn ?? today, today });
      const month = monthInput({ value: init.yearMonth });
      const dayBox = h('div', { hidden: precision === 'month' }, date.el);
      const monthBox = h(
        'div',
        { hidden: precision !== 'month' },
        month.el,
        h('p', { class: 'field-hint' }, '日付が分からない記録は、月の合計にだけ入り、日別・週別には配分しません。'),
      );
      const precisionToggle = h(
        'button',
        {
          type: 'button',
          class: 'link-btn',
          onclick: () => {
            precision = precision === 'month' ? 'day' : 'month';
            dayBox.hidden = precision === 'month';
            monthBox.hidden = precision !== 'month';
            precisionToggle.textContent = precision === 'month' ? '日付を指定する' : '日付が分からない（月だけ）';
          },
        },
        precision === 'month' ? '日付を指定する' : '日付が分からない（月だけ）',
      );
      const lux = luxuryToggle(init.isLuxury);
      const memo = textInput({ value: init.memo, placeholder: '任意', maxlength: 200, label: 'メモ' });
      const pm = select(Object.entries(PAYMENT_METHODS), init.paymentMethod, { emptyLabel: '指定しない', label: '支払方法' });
      const accounts = sortAccounts(app.state.accounts.filter((a) => a.type !== 'loan' && (!a.archivedAt || a.id === init.accountId)));
      const acc = select(
        accounts.map((a) => [a.id, a.name]),
        init.accountId,
        { emptyLabel: '指定しない', label: '口座' },
      );
      const details = h(
        'details',
        { class: 'more', open: !!(init.paymentMethod || init.accountId) || undefined },
        h('summary', null, 'くわしく（支払方法・口座）'),
        field('支払方法', pm, { id: pm.id }),
        field('口座', acc, { id: acc.id, hint: '口座を選んでも、確認済みの残高は自動で変わりません。' }),
      );
      const cont = editing ? null : checkbox('続けて記録する', readPref(CONT_KEY));
      const err = formError();

      const save = saveButton(editing ? '保存する' : '記録する', async () => {
        err.clear();
        const a = amount.read();
        setFieldError(amountField, a.ok ? null : a.error);
        const categoryId = cat.get();
        setFieldError(catField, categoryId ? null : 'カテゴリーを選んでください');
        if (!a.ok || a.value <= 0) {
          if (a.ok) setFieldError(amountField, '1円以上で入力してください');
          amount.input.focus();
          amount.input.scrollIntoView({ block: 'center' });
          return;
        }
        if (!categoryId) {
          catField.scrollIntoView({ block: 'center' });
          return;
        }
        const input = {
          kind: 'expense',
          amountYen: a.value,
          categoryId,
          datePrecision: precision,
          occurredOn: precision === 'day' ? date.get() : null,
          yearMonth: precision === 'month' ? month.get() : undefined,
          isLuxury: lux.get(),
          memo: memo.value,
          paymentMethod: pm.value || null,
          accountId: acc.value || null,
        };
        const res = editing ? A.updateEvent(app.state, event.id, input, app.ctx()) : A.createEvent(app.state, input, app.ctx());
        if (!res.ok) {
          err.show(res.message);
          return;
        }
        const c = categoryById(categoryId);
        const saved = await app.save(res, {
          okMessage: editing ? '保存しました' : `${formatYen(a.value)}（${c.label}）を記録しました`,
          undo: editing
            ? undefined
            : async () => {
                const r = A.deleteEvent(app.state, res.record.id, app.ctx());
                await app.save(r, { okMessage: '記録を取り消しました' });
              },
        });
        if (!saved.ok) {
          err.show(`${saved.message}。入力はそのまま残っています。もう一度「${editing ? '保存する' : '記録する'}」を押してください。`);
          return;
        }
        if (cont) writePref(CONT_KEY, cont.get());
        if (!editing && cont?.get()) {
          amount.set(null);
          amount.input.focus();
          init.amountYen = null;
          memo.value = '';
          return;
        }
        sheet.close();
      });

      const delBtn = editing
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn ghost danger-text',
              onclick: async () => {
                const link = linkForEvent(app.state, event.id);
                const ok = await confirmDialog({
                  title: 'この支出を削除しますか？',
                  message: link ? 'サブスクの支払確認との結び付きも外れます（契約そのものは残ります）。' : '集計から外れます。',
                  okLabel: '削除する',
                  danger: true,
                });
                if (!ok) return;
                const saved = await deleteEventWithUndo(event);
                if (saved.ok) sheet.close();
              },
            },
            '削除',
          )
        : null;

      const form = h(
        'form',
        { class: 'stack', onsubmit: save.run, novalidate: true },
        amountField,
        catField,
        field('日付', h('div', null, dayBox, monthBox, precisionToggle)),
        h(
          'div',
          { class: 'row gap' },
          lux.el,
          h('p', { class: 'field-hint grow' }, `${LUXURY_LABEL}は、自分で「ちょっと贅沢」と思った支出の印。金額や集計は変わりません。`),
        ),
        field('メモ', memo, { id: memo.id }),
        details,
        err.el,
        cont?.el,
        h('div', { class: 'btn-row' }, delBtn, save.el),
      );
      amount.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          amount.input.blur();
        }
      });
      return form;
    },
  });
}

/** 支出のごほうび印をワンタップで切り替え */
export async function toggleLuxury(ev) {
  const res = A.setLuxury(app.state, ev.id, !ev.isLuxury, app.ctx());
  const saved = await app.save(res, { okMessage: ev.isLuxury ? `${LUXURY_LABEL}の印を外しました` : `${LUXURY_LABEL}にしました` });
  if (!saved.ok) toast('変更できませんでした', { kind: 'error' });
}
