// 記録：支出などの一覧・編集・削除・絞り込み
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { card, pageTitle, button, monthNav, emptyState, helpButton, HELP } from '../ui/parts.js';
import { segmented, select } from '../ui/fields.js';
import { eventRow } from './home.js';
import { openEditor, openEventSheet } from '../ui/forms/event.js';
import { openExpenseSheet } from '../ui/forms/expense.js';
import { groupByDay, inMonth, isExpense } from '../core/spending.js';
import { CATEGORIES, LUXURY_LABEL } from '../core/constants.js';
import { formatYen, sumYen } from '../core/money.js';
import { formatDateShort, formatMonth, monthOf, isValidMonth, weekday } from '../core/dates.js';

const view = { ym: null, kind: 'expense', category: '', luxuryOnly: false };
const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function renderRecords(ymParam) {
  const today = app.today();
  if (ymParam && isValidMonth(ymParam)) view.ym = ymParam;
  if (!view.ym) view.ym = monthOf(today);
  const ym = view.ym;
  const all = app.state.events.filter((e) => !e.deletedAt && inMonth(e, ym));
  const expenses = all.filter(isExpense);
  let list = all;
  if (view.kind === 'expense') list = list.filter(isExpense);
  if (view.kind === 'other') list = list.filter((e) => e.kind !== 'expense');
  if (view.kind !== 'other' && view.category) list = list.filter((e) => e.categoryId === view.category);
  if (view.kind !== 'other' && view.luxuryOnly) list = list.filter((e) => e.isLuxury);
  const groups = groupByDay(list);
  const total = sumYen(expenses.map((e) => e.amountYen));
  const lux = expenses.filter((e) => e.isLuxury);

  const rerender = () => app.rerender();
  const kindSel = segmented(
    [
      ['expense', '支出'],
      ['all', 'すべて'],
      ['other', '入金・振替など'],
    ],
    view.kind,
    (v) => {
      view.kind = v;
      rerender();
    },
    { label: '表示する種類' },
  );
  const catSel = select(CATEGORIES.map((c) => [c.id, `${c.icon} ${c.label}`]), view.category || null, { emptyLabel: 'カテゴリー：すべて', label: 'カテゴリー' });
  catSel.addEventListener('change', () => {
    view.category = catSel.value;
    rerender();
  });
  const luxBtn = h(
    'button',
    {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(view.luxuryOnly),
      onclick: () => {
        view.luxuryOnly = !view.luxuryOnly;
        rerender();
      },
    },
    `★ ${LUXURY_LABEL}だけ`,
  );

  const day = (g) =>
    h(
      'li',
      { class: 'day-group' },
      h('div', { class: 'day-head' }, h('span', null, `${formatDateShort(g.date)}（${WD[weekday(g.date)]}）`), g.expenseTotal ? h('span', { class: 'num' }, formatYen(g.expenseTotal)) : null),
      h('ul', { class: 'event-list' }, g.items.map((e) => eventRow(e, { onClick: () => openEditor(e), hideDate: true }))),
    );

  return h(
    'div',
    { class: 'page' },
    pageTitle('記録', { action: helpButton('記録済み支出', HELP.spending) }),
    card(
      monthNav(ym, (m) => {
        view.ym = m;
        rerender();
      }),
      expenses.length
        ? h('p', { class: 'summary-line' }, `記録済み支出 `, h('strong', { class: 'num' }, formatYen(total)), `（${expenses.length}件）`, lux.length ? `・★${LUXURY_LABEL} ${lux.length}件 ${formatYen(sumYen(lux.map((e) => e.amountYen)))}` : '')
        : h('p', { class: 'summary-line muted' }, `${formatMonth(ym)}の支出は記録なし`),
      h('div', { class: 'filters' }, kindSel.el, view.kind !== 'other' ? h('div', { class: 'row gap wrap' }, catSel, luxBtn) : null),
    ),
    list.length === 0
      ? card(emptyState('この条件の記録はありません', '記録がない月は「記録なし」として扱います（0円や節約とは判定しません）。'))
      : card(
          groups.undated.length
            ? h('div', { class: 'day-group' }, h('div', { class: 'day-head' }, h('span', null, `日付不明（${formatMonth(ym)}）`)), h('ul', { class: 'event-list' }, groups.undated.map((e) => eventRow(e, { onClick: () => openEditor(e), hideDate: true }))))
            : null,
          h('ul', { class: 'day-list' }, groups.days.map(day)),
        ),
    h(
      'div',
      { class: 'card-actions wrap' },
      button('支出を記録', () => openExpenseSheet({ preset: ym !== monthOf(today) ? { occurredOn: `${ym}-01` } : {} }), { cls: 'btn primary', iconName: 'plus' }),
      button('入金・振替・返済など', () => openEventSheet(), { cls: 'btn' }),
    ),
    h('p', { class: 'fine center' }, '給与・振替・積立・返済の記録は任意です。記録しても残高は自動では変わりません。'),
  );
}
