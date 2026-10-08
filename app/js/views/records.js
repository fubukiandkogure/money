// 記録：支出などの一覧・編集・削除・絞り込み
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { card, pageTitle, button, monthNav, emptyState, helpButton, HELP, cols } from '../ui/parts.js';
import { segmented, select } from '../ui/fields.js';
import { eventRow } from './home.js';
import { openEditor, openEventSheet, quickMoveSub } from '../ui/forms/event.js';
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
  const catSel = select(
    CATEGORIES.map((c) => [c.id, c.label]),
    view.category || null,
    { emptyLabel: 'カテゴリー：すべて', label: 'カテゴリー' },
  );
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

  const dayGroup = (title, items, totalYen) =>
    h(
      'li',
      { class: 'day-group' },
      h(
        'div',
        { class: 'day-head' },
        h('span', { class: 'date' }, title),
        totalYen ? h('span', { class: 'num' }, formatYen(totalYen)) : h('span', { class: 'small muted' }, '支出なし'),
      ),
      h(
        'ul',
        { class: 'event-list' },
        items.map((e) => eventRow(e, { onClick: () => openEditor(e), hideDate: true })),
      ),
    );

  const side = card(
    monthNav(ym, (m) => {
      view.ym = m;
      rerender();
    }),
    expenses.length
      ? h(
          'p',
          { class: 'summary-line' },
          `記録済み支出 `,
          h('strong', { class: 'num' }, formatYen(total)),
          `（${expenses.length}件）`,
          lux.length ? `・★${LUXURY_LABEL} ${lux.length}件 ${formatYen(sumYen(lux.map((e) => e.amountYen)))}` : '',
        )
      : h('p', { class: 'summary-line muted' }, `${formatMonth(ym)}の支出は記録なし`),
    h('div', { class: 'filters' }, kindSel.el, view.kind !== 'other' ? h('div', { class: 'row gap wrap' }, catSel, luxBtn) : null),
    h(
      'div',
      { class: 'card-actions wrap' },
      button('入金・振替・返済など', () => openEventSheet(), { cls: 'btn small', iconName: 'repeat' }),
      ym !== monthOf(today)
        ? button(`${formatMonth(ym)}の支出を記録`, () => openExpenseSheet({ preset: { occurredOn: `${ym}-01` } }), { cls: 'btn small ghost', iconName: 'plus' })
        : null,
    ),
    (app.state.settings.quickMoves ?? []).length
      ? h(
          'div',
          { class: 'field', style: { marginTop: '12px' } },
          h('span', { class: 'field-label' }, 'いつもの動き'),
          h(
            'div',
            { class: 'quick-moves' },
            app.state.settings.quickMoves.map((m) =>
              h(
                'button',
                { type: 'button', class: 'quick-move', onclick: () => openEventSheet({ quickMove: m }) },
                h('span', { class: 'qm-label' }, m.label),
                h('span', { class: 'qm-sub' }, quickMoveSub(m)),
              ),
            ),
          ),
        )
      : null,
    h('p', { class: 'fine' }, '給与・振替・積立・返済の記録は任意です。記録しても残高は自動では変わりません。'),
  );

  const listing =
    list.length === 0
      ? card(emptyState('この条件の記録はありません', '記録がない月は「記録なし」として扱います（0円や節約とは判定しません）。'))
      : h(
          'ul',
          { class: 'day-list', 'aria-label': `${formatMonth(ym)}の記録` },
          groups.undated.length
            ? dayGroup(`日付不明（${formatMonth(ym)}）`, groups.undated, sumYen(groups.undated.filter(isExpense).map((e) => e.amountYen)))
            : null,
          groups.days.map((g) => dayGroup(`${formatDateShort(g.date)}（${WD[weekday(g.date)]}）`, g.items, g.expenseTotal)),
        );

  return h(
    'div',
    { class: 'page' },
    pageTitle('記録', { action: helpButton('記録済み支出', HELP.spending) }),
    cols([side], [listing], { ratio: 'wide-right' }),
  );
}
