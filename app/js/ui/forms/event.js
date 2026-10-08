// 支出以外のお金の動き（入金・振替/積立・奨学金の返済・カードの引き落とし）。
// どれも記録済み支出には入らず、確認済みの残高も自動では変えない。
import { h } from '../dom.js';
import { app } from '../../app.js';
import { openSheet, confirmDialog } from '../overlay.js';
import { amountInput, dateInput, field, setFieldError, textInput, select, checkbox, saveButton, formError, segmented } from '../fields.js';
import * as A from '../../core/actions.js';
import { EVENT_KINDS, INCOME_TYPES } from '../../core/constants.js';
import { formatYen } from '../../core/money.js';
import { sortAccounts } from '../../core/assets.js';
import { deleteEventWithUndo, openExpenseSheet } from './expense.js';

const KIND_HELP = {
  income: '給与・ボーナスなどの入金。記録は任意です。支出の合計には入りません。',
  transfer: '銀行→別の銀行、銀行→NISA積立など、自分の口座どうしの移動。支出ではありません。',
  repayment: '奨学金の元金の返済。支出には入りません。利息が分かる場合だけ、利息を別の費用として記録できます。',
  card_payment: 'カード利用分の後日の引き落とし。買い物はカードで使った日に支出として記録済みなので、ここでは支出に足しません。',
};

export function openEventSheet({ event, kind: initialKind = 'income' } = {}) {
  const editing = !!event;
  const today = app.today();
  let kind = event?.kind ?? initialKind;
  openSheet({
    title: editing ? `${EVENT_KINDS[kind].label}を編集` : 'お金の動きを記録',
    build: (sheet) => {
      const body = h('div', { class: 'stack' });
      const kindSel = editing
        ? null
        : segmented(
            [
              ['income', '入金'],
              ['transfer', '振替・積立'],
              ['repayment', '返済'],
              ['card_payment', 'カード精算'],
            ],
            kind,
            (k) => {
              kind = k;
              renderBody();
            },
            { label: '種類' },
          );
      const renderBody = () => body.replaceChildren(buildBody());
      const buildBody = () => {
        const init = event ?? {};
        const all = sortAccounts(app.state.accounts.filter((a) => !a.archivedAt || [init.fromAccountId, init.toAccountId].includes(a.id)));
        const assetOpts = all.filter((a) => a.type !== 'loan').map((a) => [a.id, a.name]);
        const loanOpts = all.filter((a) => a.type === 'loan').map((a) => [a.id, a.name]);
        const amount = amountInput({ value: init.amountYen ?? null, autofocus: !editing });
        const amountField = field(kind === 'repayment' ? '元金の返済額（内訳不明なら返済した総額）' : '金額', amount.el, { id: amount.id });
        const date = dateInput({ value: init.occurredOn ?? today, today });
        const memo = textInput({ value: init.memo ?? '', placeholder: '任意', label: 'メモ' });
        const err = formError();
        const parts = [h('p', { class: 'note' }, KIND_HELP[kind]), amountField, field('日付', date.el)];
        let from = null;
        let to = null;
        let incomeType = null;
        let interest = null;
        let unknown = null;
        if (kind === 'income') {
          incomeType = select(Object.entries(INCOME_TYPES), init.incomeType ?? 'salary', { label: '入金の種類' });
          to = select(assetOpts, init.toAccountId ?? null, { emptyLabel: '指定しない', label: '入金先' });
          parts.push(field('種類', incomeType, { id: incomeType.id }), field('入金先の口座（任意）', to, { id: to.id }));
        } else if (kind === 'transfer') {
          if (assetOpts.length < 2) parts.push(h('p', { class: 'warn-box' }, '振替には銀行・投資の口座が2つ以上必要です。先に「資産」で口座を登録してください。'));
          from = select(assetOpts, init.fromAccountId ?? null, { emptyLabel: '選んでください', label: '移動元' });
          to = select(assetOpts, init.toAccountId ?? null, { emptyLabel: '選んでください', label: '移動先' });
          parts.push(field('移動元', from, { id: from.id }), field('移動先（NISAなど）', to, { id: to.id }));
        } else if (kind === 'repayment') {
          if (loanOpts.length === 0) parts.push(h('p', { class: 'warn-box' }, '先に「資産」で奨学金を登録してください。'));
          to = select(loanOpts, init.toAccountId ?? loanOpts[0]?.[0] ?? null, { emptyLabel: '選んでください', label: '奨学金' });
          from = select(assetOpts, init.fromAccountId ?? null, { emptyLabel: '指定しない', label: '引き落とし口座' });
          unknown = checkbox('元金と利息の内訳が分からない', init.breakdownUnknown ?? false, { hint: '分からない場合は勝手に分けません。' });
          parts.push(field('奨学金', to, { id: to.id }), field('引き落とし口座（任意）', from, { id: from.id }), unknown.el);
          if (!editing) {
            interest = amountInput({ value: null });
            parts.push(field('利息（分かる場合だけ）', interest.el, { id: interest.id, hint: '入力すると、利息だけを「その他」の支出として別に記録します。' }));
          }
        } else if (kind === 'card_payment') {
          from = select(assetOpts, init.fromAccountId ?? null, { emptyLabel: '指定しない', label: '引き落とし口座' });
          parts.push(field('引き落とし口座（任意）', from, { id: from.id }));
        }
        parts.push(field('メモ', memo, { id: memo.id }), h('p', { class: 'field-hint' }, '記録しても、確認済みの残高は自動では変わりません。残高は「資産」で確認した値を記録してください。'), err.el);

        const save = saveButton(editing ? '保存する' : '記録する', async () => {
          err.clear();
          const a = amount.read();
          setFieldError(amountField, a.ok ? (a.value > 0 ? null : '1円以上で入力してください') : a.error);
          if (!a.ok || a.value <= 0) return;
          let interestYen = null;
          if (interest && !interest.isEmpty()) {
            const r = interest.read();
            if (!r.ok || r.value <= 0) {
              err.show('利息の金額が正しくありません');
              return;
            }
            interestYen = r.value;
          }
          const input = {
            kind,
            amountYen: a.value,
            datePrecision: 'day',
            occurredOn: date.get(),
            memo: memo.value,
            incomeType: incomeType?.value || null,
            fromAccountId: from?.value || null,
            toAccountId: to?.value || null,
            breakdownUnknown: unknown?.get() ?? false,
            interestYen,
          };
          const res = editing ? A.updateEvent(app.state, event.id, input, app.ctx()) : A.createEvent(app.state, input, app.ctx());
          if (!res.ok) {
            err.show(res.message);
            return;
          }
          const saved = await app.save(res, { okMessage: editing ? '保存しました' : `${EVENT_KINDS[kind].label} ${formatYen(a.value)} を記録しました` });
          if (!saved.ok) {
            err.show(`${saved.message}。入力はそのまま残っています。`);
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
                  if (!(await confirmDialog({ title: 'この記録を削除しますか？', okLabel: '削除する', danger: true }))) return;
                  const saved = await deleteEventWithUndo(event);
                  if (saved.ok) sheet.close();
                },
              },
              '削除',
            )
          : null;
        return h('form', { class: 'stack', onsubmit: save.run, novalidate: true }, parts, h('div', { class: 'btn-row' }, delBtn, save.el));
      };
      renderBody();
      return h('div', { class: 'stack' }, kindSel?.el, body);
    },
  });
}

/** 記録の種類に合った編集シートを開く */
export function openEditor(ev) {
  if (ev.kind === 'expense') openExpenseSheet({ event: ev });
  else openEventSheet({ event: ev });
}
