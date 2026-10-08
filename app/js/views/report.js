// 振り返り：確定した月次資産と、記録済み支出・大きな出費・ごほうび
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { icon } from '../ui/icons.js';
import { card, cardOf, cardHead, pageTitle, helpButton, HELP, closeBadge, deltaView, emptyState, cols, catTile } from '../ui/parts.js';
import { segmented } from '../ui/fields.js';
import { columnChart, barList } from '../ui/charts.js';
import { eventRow } from './home.js';
import { openEditor } from '../ui/forms/event.js';
import { monthlySeries, monthReport, COMPARE_REASON_LABELS } from '../core/closes.js';
import { loansSummary, earliestManagedMonth } from '../core/assets.js';
import { summarizeExpenses, monthlyExpenseSeries, monthPeriod, weekPeriod, yearPeriod, shiftPeriod, periodLabel } from '../core/spending.js';
import { formatYen, formatPercent } from '../core/money.js';
import { formatMonth, formatMonthShort, monthOf, addMonths, prevMonth, isLastDayOfMonth, formatDateShort } from '../core/dates.js';
import { LUXURY_LABEL } from '../core/constants.js';

const view = { period: null };

export function renderReport(tab = 'assets') {
  const tabs = h(
    'nav',
    { class: 'tabs', 'aria-label': '振り返りの種類' },
    h('a', { href: '#/report/assets', class: 'tab', 'aria-current': tab === 'assets' ? 'page' : undefined }, '資産の月次'),
    h('a', { href: '#/report/spending', class: 'tab', 'aria-current': tab === 'spending' ? 'page' : undefined }, '支出の振り返り'),
  );
  return h('div', { class: 'page' }, pageTitle('振り返り'), tabs, tab === 'spending' ? spending() : assets());
}

function assets() {
  const state = app.state;
  const today = app.today();
  const lastEnded = isLastDayOfMonth(today) ? monthOf(today) : prevMonth(monthOf(today));
  // 管理を始める前の月は「未確定」ではないので並べない
  const start = earliestManagedMonth(state.accounts) ?? lastEnded;
  let from = addMonths(lastEnded, -11);
  if (start > from) from = start;
  if (from > lastEnded) from = lastEnded;
  const series = monthlySeries(state, from, lastEnded, today);
  const confirmed = series.filter((s) => s.totals);
  const chart = columnChart({
    title: '月末の管理上の純資産（確定した月だけ）',
    items: series.map((s) => ({
      key: s.ym,
      label: `${formatMonth(s.ym)}末`,
      short: formatMonthShort(s.ym).replace('月', ''),
      parts: s.totals ? [{ value: s.totals.net, cls: 'viz-1' }] : null,
      missingShort: s.status === 'needs_review' ? '要' : '未',
      missingLabel: s.status === 'needs_review' ? '要再確認（グラフに出しません）' : '未確定',
    })),
  });
  const rows = [...series].reverse().map((s) => {
    const r = monthReport(state, s.ym, today);
    let cmp;
    if (r.prevMonthComparison.available) cmp = h('span', null, h('span', { class: 'small muted' }, '前月比 '), deltaView(r.prevMonthComparison.delta.net));
    else if (r.periodComparison?.available)
      cmp = h('span', null, h('span', { class: 'small muted' }, `${formatMonth(r.periodComparison.from)}末から `), deltaView(r.periodComparison.delta.net));
    else if (s.status === 'confirmed')
      cmp = h(
        'span',
        { class: 'small muted' },
        `前月比 未算出（${(r.prevMonthComparison.reasons ?? []).map((x) => COMPARE_REASON_LABELS[x.type]).join('、')}）`,
      );
    else cmp = null;
    return h(
      'li',
      null,
      h(
        'a',
        { class: 'mrow', href: `#/assets/month/${s.ym}` },
        h('span', { class: 'mrow-name' }, `${formatMonth(s.ym)}末`),
        closeBadge(s.status),
        h('span', { class: 'mrow-val num' }, s.totals ? formatYen(s.totals.net) : '—'),
        cmp ? h('span', { class: 'mrow-cmp' }, cmp) : null,
      ),
    );
  });
  const loans = loansSummary(state, today);
  return cols(
    [
      cardOf(
        'chart',
        cardHead('月末の管理上の純資産', {
          action: helpButton('月末の確定', HELP.monthEnd),
          sub: '確定した月だけを描きます。未確定の月は空けたまま（0円や前の月の値で埋めません）。',
        }),
        confirmed.length
          ? chart
          : emptyState(
              'まだ確定した月がありません',
              '「資産」の月末チェックで、月末の残高がそろった月を確定すると、ここに並びます。',
              h('a', { class: 'btn', href: '#/assets' }, '月末チェックへ'),
            ),
      ),
      card(
        cardHead('月ごとの記録'),
        h('ul', { class: 'mrow-list', 'aria-label': '月末ごとの純資産' }, rows),
        h('p', { class: 'fine' }, '増減は確定した月末どうしの比較です。積立・評価額の変化・返済などが混ざっているため、節約額や投資の利益とは限りません。'),
      ),
    ],
    [
      loans.items.length
        ? card(
            cardHead('奨学金の進み具合'),
            loans.ratio !== null
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    {
                      class: 'progress big',
                      role: 'progressbar',
                      'aria-valuenow': Math.round(loans.ratio * 100),
                      'aria-valuemin': 0,
                      'aria-valuemax': 100,
                      'aria-label': '返済率',
                    },
                    h('span', { style: { width: `${loans.ratio * 100}%` } }),
                  ),
                  h(
                    'p',
                    null,
                    `当初 ${formatYen(loans.initialTotal)} のうち `,
                    h('strong', { class: 'num' }, formatYen(loans.repaidTotal)),
                    ` 返済済み（${formatPercent(loans.ratio * 100)}）`,
                  ),
                  loans.unknownCount ? h('p', { class: 'fine' }, `当初の元金が分からない${loans.unknownCount}件は含めていません。`) : null,
                )
              : h('p', { class: 'small muted' }, '当初の元金が分からないので返済率は出していません（口座の編集で入力できます）。'),
            loans.items.map((p) =>
              p.sinceFirst
                ? h(
                    'p',
                    { class: 'small' },
                    `${p.account.name}：${formatDateShort(p.sinceFirst.from.asOfDate)}→${formatDateShort(p.sinceFirst.to.asOfDate)} で ${formatYen(p.sinceFirst.decrease)} 減`,
                  )
                : null,
            ),
          )
        : null,
    ],
  );
}

function spending() {
  const today = app.today();
  if (!view.period) view.period = monthPeriod(monthOf(today));
  const p = view.period;
  const sum = summarizeExpenses(app.state.events, p);
  const prev = summarizeExpenses(app.state.events, shiftPeriod(p, -1));
  const typeSel = segmented(
    [
      ['week', '週'],
      ['month', '月'],
      ['year', '年'],
    ],
    p.type,
    (t) => {
      view.period = t === 'week' ? weekPeriod(today) : t === 'year' ? yearPeriod(today.slice(0, 4)) : monthPeriod(monthOf(today));
      app.rerender();
    },
    { label: '期間' },
  );
  const nav = h(
    'div',
    { class: 'month-nav' },
    h(
      'button',
      { class: 'icon-btn', type: 'button', 'aria-label': '前の期間', onclick: () => ((view.period = shiftPeriod(p, -1)), app.rerender()) },
      icon('left'),
    ),
    h('span', { class: 'month-nav-label' }, periodLabel(p)),
    h(
      'button',
      { class: 'icon-btn', type: 'button', 'aria-label': '次の期間', onclick: () => ((view.period = shiftPeriod(p, 1)), app.rerender()) },
      icon('right'),
    ),
  );

  const cats = sum.byCategory
    .filter((c) => c.total > 0 || prev.byCategory.find((x) => x.category.id === c.category.id).total > 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => {
      const pv = prev.byCategory.find((x) => x.category.id === c.category.id);
      return {
        name: c.category.label,
        tile: catTile(c.category.id, 's'),
        value: c.total,
        pct: formatPercent(c.percent),
        sub: prev.hasRecords ? `前の期間 ${formatYen(pv.total)}` : null,
      };
    });

  const trendTo = p.type === 'month' ? p.ym : monthOf(today);
  const trend = monthlyExpenseSeries(app.state.events, addMonths(trendTo, -11), trendTo);
  const trendChart = columnChart({
    title: '月ごとの記録済み支出',
    legend: [
      { cls: 'viz-1', name: `${LUXURY_LABEL}以外` },
      { cls: 'viz-2', name: LUXURY_LABEL },
    ],
    emphasizeLast: false,
    items: trend.map((m) => ({
      key: m.ym,
      label: formatMonth(m.ym),
      short: formatMonthShort(m.ym).replace('月', ''),
      parts: m.hasRecords
        ? [
            { value: m.total - m.luxury, cls: 'viz-1' },
            { value: m.luxury, cls: 'viz-2' },
          ]
        : null,
      tip: m.hasRecords ? `${formatYen(m.total)}（うち${LUXURY_LABEL} ${formatYen(m.luxury)}）` : undefined,
      missingShort: '—',
      missingLabel: '記録なし',
    })),
  });

  return cols(
    [
      card(
        h('div', { class: 'filters' }, typeSel.el, nav),
        h(
          'div',
          { class: 'card-head', style: { marginTop: '12px' } },
          h(
            'div',
            null,
            h('p', { class: 'mini-label' }, `${periodLabel(p)}の記録済み支出`),
            sum.hasRecords ? h('p', { class: 'hero-num small-hero num' }, formatYen(sum.total)) : h('p', { class: 'hero-num small-hero muted' }, '記録なし'),
          ),
          helpButton('記録済み支出', HELP.spending),
        ),
        sum.hasRecords
          ? h('p', { class: 'small muted' }, `${sum.count}件・記録していない支出は含みません`)
          : h('p', { class: 'small muted' }, 'この期間は記録がありません。支出が0円だった・節約できた、という意味ではありません。'),
        sum.undated.count
          ? h(
              'p',
              { class: 'note-line' },
              icon('calendar', 16),
              `日付不明（月だけ分かる）記録 ${sum.undated.count}件 ${formatYen(sum.undated.total)} は、この週の合計に入れていません。`,
            )
          : null,
      ),
      sum.hasRecords ? card(cardHead('カテゴリー別', { sub: '割合の分母は、同じ期間の記録済み支出だけです' }), barList(cats, { total: sum.total })) : null,
      cardOf('chart', cardHead('月ごとの推移', { sub: '記録のない月は「—」（0円ではありません）' }), trendChart),
    ],
    [
      card(
        cardHead(LUXURY_LABEL, { sub: '自分で印を付けた「ちょっと贅沢」。金額が大きいだけでは自動で付きません。' }),
        sum.luxury.count
          ? [
              h('p', { class: 'summary-line' }, `${sum.luxury.count}件 `, h('strong', { class: 'num' }, formatYen(sum.luxury.total))),
              h(
                'ul',
                { class: 'event-list' },
                sum.luxury.items.map((e) => eventRow(e, { onClick: () => openEditor(e) })),
              ),
            ]
          : h('p', { class: 'small muted' }, `この期間の${LUXURY_LABEL}はまだありません。支出を記録するときに ★ を付けると、ここに並びます。`),
      ),
      sum.big.length
        ? card(
            cardHead('大きな出費', { sub: '金額の大きい順（自動）' }),
            h(
              'ol',
              { class: 'rank-list' },
              sum.big.map((e, i) => {
                const row = eventRow(e, { onClick: () => openEditor(e) });
                row.prepend(h('span', { class: 'rank-badge num', 'aria-hidden': 'true' }, String(i + 1)));
                return row;
              }),
            ),
          )
        : null,
    ],
  );
}
