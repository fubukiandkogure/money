// ホーム：資産が主役。支出は最近の出来事として添える。
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { icon } from '../ui/icons.js';
import { townScene, skyPhase } from '../ui/art.js';
import { yen, badge, card, cardHead, linkBtn, button, helpButton, HELP, deltaView, closeBadge, emptyState } from '../ui/parts.js';
import { currentOverview, loansSummary } from '../core/assets.js';
import { monthReport, latestConfirmed, effectiveClose } from '../core/closes.js';
import { summarizeExpenses, monthPeriod, sortKey } from '../core/spending.js';
import { projection } from '../core/subs.js';
import { categoryById, LUXURY_LABEL, EVENT_KINDS } from '../core/constants.js';
import { formatDateShort, formatMonth, prevMonth, monthOf, isLastDayOfMonth, formatDateLong, weekday } from '../core/dates.js';
import { formatYen, formatPercent } from '../core/money.js';
import { monthEndStatus } from '../core/assets.js';
import { openEditor } from '../ui/forms/event.js';
import { openAccountSheet } from '../ui/forms/assets.js';

const WD = ['日', '月', '火', '水', '木', '金', '土'];

function greeting(phase) {
  return { morning: 'おはようございます', day: 'こんにちは', evening: 'こんばんは', night: 'こんばんは' }[phase];
}

export function renderHome() {
  const state = app.state;
  const today = app.today();
  const ov = currentOverview(state, today);
  const proj = projection(state, today);
  const phase = skyPhase();

  const hero = h(
    'div',
    { class: 'hero', dataset: { phase } },
    townScene({ phase, litRooms: proj.activeCount + proj.trialCount, totalRooms: proj.views.length }),
    h('div', { class: 'hero-text' }, h('p', { class: 'hero-greet' }, greeting(phase)), h('p', { class: 'hero-date' }, `${formatDateLong(today)}（${WD[weekday(today)]}）`)),
  );

  return h('div', { class: 'page home' }, hero, netCard(ov, today), monthCard(today), loanCard(today), spendingCard(today));
}

function netCard(ov, today) {
  if (ov.accountCount === 0) {
    return card(
      cardHead('管理上の純資産'),
      emptyState(
        'まずは口座を登録しましょう',
        '銀行・投資（NISAなど）・奨学金を登録して、確認した残高を記録すると、ここに合計が出ます。金融機関のIDやパスワードは使いません。',
        button('口座を追加', () => openAccountSheet(), { cls: 'btn primary', iconName: 'plus' }),
      ),
    );
  }
  const noneKnown = ov.assets.knownCount + ov.loans.knownCount === 0;
  const notes = [];
  if (ov.mixedDates) notes.push(h('p', { class: 'note-line' }, icon('calendar', 16), `確認日が口座ごとに違います（${formatDateShort(ov.oldestDate)}〜${formatDateShort(ov.newestDate)}）。同じ日の正確な総額ではありません。`));
  else if (ov.newestDate) notes.push(h('p', { class: 'note-line' }, icon('calendar', 16), `${formatDateShort(ov.newestDate)} 時点の確認済み残高`));
  if (ov.missing.length) {
    notes.push(
      h(
        'p',
        { class: 'note-line warn' },
        icon('alert', 16),
        `未確認 ${ov.missing.length}件（${ov.missing.map((a) => a.name).join('、')}）を含まない${noneKnown ? '' : '部分合計'}です。`,
      ),
    );
  }
  if (ov.conflicts.length) notes.push(h('p', { class: 'note-line warn' }, icon('alert', 16), `同じ日に複数の記録がある口座があります（${ov.conflicts.map((a) => a.name).join('、')}）。`));
  return card(
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, '管理上の純資産', ov.partial ? badge('部分合計', 'warn') : null), helpButton('管理上の純資産', HELP.net)),
    noneKnown ? h('p', { class: 'hero-num muted' }, '—') : h('p', { class: ['hero-num', ov.net < 0 && 'neg'] }, formatYen(ov.net)),
    h(
      'div',
      { class: 'split' },
      h('div', null, h('p', { class: 'mini-label' }, '総資産（銀行＋投資）'), yen(ov.assets.total, { cls: 'mid-num' })),
      h('div', null, h('p', { class: 'mini-label' }, '奨学金の残り'), yen(ov.loans.total, { cls: 'mid-num' })),
    ),
    notes,
    h('div', { class: 'card-actions' }, linkBtn('残高を確認・更新', '#/assets', { cls: 'btn', iconName: 'kura' })),
  );
}

function monthCard(today) {
  const state = app.state;
  if (state.accounts.length === 0) return null;
  const lastEnded = isLastDayOfMonth(today) ? monthOf(today) : prevMonth(monthOf(today));
  const lastStatus = effectiveClose(state, lastEnded, today);
  const latest = latestConfirmed(state, today);
  const rows = [];
  if (latest) {
    const r = monthReport(state, latest.ym, today);
    rows.push(
      h(
        'div',
        { class: 'month-line' },
        h('div', null, h('p', { class: 'mini-label' }, `${formatMonth(latest.ym)}末（確定）`), yen(latest.close.totals.net, { cls: 'mid-num' })),
        r.prevMonthComparison.available
          ? h('div', { class: 'right' }, h('p', { class: 'mini-label' }, '前月比'), deltaView(r.prevMonthComparison.delta.net))
          : r.periodComparison?.available
            ? h('div', { class: 'right' }, h('p', { class: 'mini-label' }, `${formatMonth(r.periodComparison.from)}末→${formatMonth(r.periodComparison.to)}末`), deltaView(r.periodComparison.delta.net))
            : h('div', { class: 'right' }, h('p', { class: 'mini-label' }, '前月比'), h('span', { class: 'muted small' }, '比べられる前月がありません')),
      ),
    );
  }
  const ms = monthEndStatus(state, lastEnded, today);
  if ((!latest || latest.ym !== lastEnded) && ms.items.length > 0) {
    const missing = ms.items.filter((i) => !i.adopted).length;
    rows.push(
      h(
        'a',
        { class: 'month-todo', href: `#/assets/month/${lastEnded}` },
        h('span', null, `${formatMonth(lastEnded)}末 `, closeBadge(lastStatus.status)),
        h('span', { class: 'muted small' }, lastStatus.status === 'needs_review' ? '確定に使った残高が変わりました' : missing ? `月末の残高があと${missing}件` : '確定できます'),
        icon('right', 18),
      ),
    );
  }
  if (rows.length === 0) {
    rows.push(h('p', { class: 'small muted' }, `${formatMonth(monthOf(today))}末の残高がそろったら、ここで月末を確定できます。`));
  }
  return card(cardHead('月末の記録', { action: helpButton('月末の確定', HELP.monthEnd) }), rows, h('p', { class: 'fine' }, '増減は確定した月末どうしの比較です。節約額や投資の利益とは限りません。'));
}

function loanCard(today) {
  const sum = loansSummary(app.state, today);
  if (sum.items.length === 0) return null;
  const rows = sum.items.map((p) => {
    const parts = [h('div', { class: 'row between' }, h('span', null, p.account.name), p.latest ? yen(p.latest.amountYen) : badge('未確認', 'warn'))];
    if (p.ratio !== null) {
      parts.push(
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p.ratio * 100), 'aria-label': `${p.account.name}の返済率` }, h('span', { style: { width: `${p.ratio * 100}%` } })),
        h('p', { class: 'small muted' }, `当初 ${formatYen(p.initial)} のうち ${formatYen(p.repaid)} 返済済み（${formatPercent(p.ratio * 100)}）`),
      );
    } else if (p.sinceFirst && p.sinceFirst.decrease > 0) {
      parts.push(h('p', { class: 'small muted' }, `記録を始めた ${formatDateShort(p.sinceFirst.from.asOfDate)} から ${formatYen(p.sinceFirst.decrease)} 減りました`));
    }
    return h('div', { class: 'loan-row' }, parts);
  });
  return card(
    cardHead('奨学金', { sub: sum.unknownCount && sum.knownCount ? `返済率は当初の元金が分かる${sum.knownCount}件だけで計算しています` : undefined }),
    rows,
    h('p', { class: 'fine' }, '返済しても純資産は増えません（預金と元金が同じだけ減るため）。残りが減っていく様子を見守りましょう。'),
  );
}

function spendingCard(today) {
  const state = app.state;
  const ym = monthOf(today);
  const sum = summarizeExpenses(state.events, monthPeriod(ym));
  const recent = state.events
    .filter((e) => !e.deletedAt)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  return card(
    cardHead('最近のお金の動き', { sub: sum.hasRecords ? `${formatMonth(ym)}の記録済み支出 ${formatYen(sum.total)}（${sum.count}件）${sum.luxury.count ? `・${LUXURY_LABEL} ${sum.luxury.count}件` : ''}` : `${formatMonth(ym)}の支出はまだ記録なし` }),
    recent.length
      ? h('ul', { class: 'event-list compact' }, recent.map((e) => eventRow(e, { onClick: () => openEditor(e) })))
      : h('p', { class: 'muted small' }, '気が向いたときに、金額とカテゴリーだけで記録できます。週末にまとめて入力しても大丈夫です。'),
    h('div', { class: 'card-actions' }, linkBtn('記録一覧', '#/records', { cls: 'btn ghost' }), linkBtn('振り返り', '#/report/spending', { cls: 'btn ghost' })),
  );
}

export function eventRow(e, { onClick, hideDate = false } = {}) {
  const cat = e.kind === 'expense' ? categoryById(e.categoryId) : null;
  const title = cat ? e.memo || cat.label : e.memo || EVENT_KINDS[e.kind].label;
  const dateText = e.datePrecision === 'month' ? `${formatMonth(e.yearMonth)}（日付不明）` : formatDateShort(e.occurredOn);
  const sub = [hideDate ? null : dateText, cat ? cat.label : EVENT_KINDS[e.kind].label, e.paymentMethod === 'card' ? 'カード' : null].filter(Boolean).join('・');
  const content = [
    h('span', { class: 'ev-icon', 'aria-hidden': 'true' }, cat ? cat.icon : kindIcon(e.kind)),
    h('span', { class: 'ev-main' }, h('span', { class: 'ev-title' }, title), h('span', { class: 'ev-sub' }, sub)),
    e.isLuxury ? h('span', { class: 'lux-mark', title: LUXURY_LABEL }, icon('star', 16), h('span', { class: 'sr-only' }, LUXURY_LABEL)) : null,
    h('span', { class: ['ev-amount', 'num', e.kind !== 'expense' && 'not-expense'] }, e.kind === 'expense' ? formatYen(e.amountYen) : `(${formatYen(e.amountYen)})`),
  ];
  return h('li', null, onClick ? h('button', { type: 'button', class: 'ev-row', onclick: onClick }, content) : h('div', { class: 'ev-row' }, content));
}

export function kindIcon(kind) {
  return { income: '💴', transfer: '🔁', repayment: '🎓', card_payment: '💳' }[kind] ?? '•';
}

