// ホーム：資産が主役。支出は最近の出来事として添える。
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { icon, pxIcon } from '../ui/icons.js';
import { mountain, skyPhase } from '../ui/art.js';
import {
  yen,
  badge,
  card,
  cardHead,
  linkBtn,
  button,
  helpButton,
  HELP,
  deltaView,
  closeBadge,
  cols,
  dateChip,
  monthBlocks,
  dotMeter,
  catTile,
} from '../ui/parts.js';
import { currentOverview, loansSummary, monthEndStatus, earliestManagedMonth } from '../core/assets.js';
import { monthReport, latestConfirmed, effectiveClose, monthlySeries } from '../core/closes.js';
import { summarizeExpenses, monthPeriod, sortKey } from '../core/spending.js';
import { categoryById, LUXURY_LABEL, EVENT_KINDS, APP_NAME } from '../core/constants.js';
import { formatDateShort, formatMonth, formatMonthShort, prevMonth, monthOf, isLastDayOfMonth, weekday, addMonths } from '../core/dates.js';
import { formatYen, formatPercent } from '../core/money.js';
import { openAccountSheet } from '../ui/forms/assets.js';
import { openEditor } from '../ui/forms/event.js';
import { openSetupSheet, openMonthEndBulkSheet } from '../ui/forms/setup.js';

const WD = ['日', '月', '火', '水', '木', '金', '土'];

function greeting(phase) {
  return { morning: 'おはようございます', day: 'こんにちは', evening: 'こんばんは', night: 'こんばんは' }[phase];
}

/** 月末を迎えた最新の月 */
export function lastEndedMonth(today) {
  return isLastDayOfMonth(today) ? monthOf(today) : prevMonth(monthOf(today));
}

/** 直近6か月の月末（管理を始める前の月は除く） */
export function recentMonths(state, today, n = 6) {
  const start = earliestManagedMonth(state.accounts);
  if (!start) return [];
  const last = lastEndedMonth(today);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ym = addMonths(last, -i);
    if (ym >= start) out.push({ ym, status: effectiveClose(state, ym, today).status });
  }
  return out;
}

// 純資産の数字は、値が変わったときに前の値から数え上げる（最初は0から）
let lastCounted = null;
function countUp(el, value) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from = lastCounted ?? 0;
  lastCounted = value;
  if (reduce || from === value || Math.abs(value - from) < 1000) return;
  el.setAttribute('aria-label', formatYen(value));
  const t0 = performance.now();
  const dur = 700;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatYen(Math.round(from + (value - from) * eased));
    if (p < 1 && el.isConnected) requestAnimationFrame(step);
    else el.textContent = formatYen(value);
  };
  requestAnimationFrame(step);
}

/** 確定した月の数（チリツモ山の地層の数。要再確認・取り消しは数えない） */
function confirmedCount(state, today) {
  const start = earliestManagedMonth(state.accounts);
  if (!start) return 0;
  const last = lastEndedMonth(today);
  if (start > last) return 0;
  return monthlySeries(state, start, last, today).filter((m) => m.status === 'confirmed').length;
}

export function renderHome() {
  const state = app.state;
  const today = app.today();
  const ov = currentOverview(state, today);
  const months = recentMonths(state, today);
  // 口座がなくても、支出の記録だけで使える（支出の欄はいつも出す）
  if (ov.accountCount === 0) return h('div', { class: 'page home' }, cols([welcomeCard()], [spendingCard(today)]));
  return h('div', { class: 'page home' }, cols([heroCard(ov, today), loanCard(today)], [monthCard(today, months), spendingCard(today)]));
}

function heroArt(today) {
  const state = app.state;
  const phase = skyPhase();
  const layers = confirmedCount(state, today);
  const flag = effectiveClose(state, lastEndedMonth(today), today).status === 'confirmed' && earliestManagedMonth(state.accounts) <= lastEndedMonth(today);
  return h(
    'div',
    { class: 'hero-art', dataset: { phase } },
    mountain({ phase, layers, flag }),
    h(
      'p',
      { class: 'hero-caption', title: '月末を確定するたびに、山が1段高くなります（金額の増減は表しません）' },
      h('span', null, `${greeting(phase)}・${formatDateShort(today)}（${WD[weekday(today)]}）`),
      h('strong', null, layers ? `確定 ${layers}か月` : 'まだ平地'),
    ),
  );
}

function welcomeCard() {
  const today = app.today();
  return h(
    'section',
    { class: 'card hero' },
    heroArt(today),
    h(
      'div',
      { class: 'hero-body' },
      h('h2', { class: 'welcome-title' }, `${APP_NAME}へようこそ`),
      h('p', { class: 'welcome-text' }, '塵も積もれば山となる。月末の残高を確定するたびに、上の山が1段ずつ高くなります。'),
      h(
        'p',
        { class: 'small muted' },
        '給与の口座・貯金の口座・NISA・奨学金など、よくある組み合わせをまとめて登録できます。金融機関のIDやパスワードは使いません。',
      ),
      h(
        'div',
        { class: 'stack tight' },
        button('はじめの準備をする', () => openSetupSheet(), { cls: 'btn primary big', iconName: 'sparkle' }),
        button('口座を1つずつ追加する', () => openAccountSheet(), { cls: 'btn ghost' }),
      ),
    ),
  );
}

function heroCard(ov, today) {
  const noneKnown = ov.assets.knownCount + ov.loans.knownCount === 0;
  const num = h('span', { class: 'num' }, formatYen(ov.net));
  if (!noneKnown) countUp(num, ov.net);
  const notes = [];
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
  if (ov.conflicts.length)
    notes.push(
      h('p', { class: 'note-line warn' }, icon('alert', 16), `同じ日に複数の記録がある口座があります（${ov.conflicts.map((a) => a.name).join('、')}）。`),
    );
  return h(
    'section',
    { class: 'card hero' },
    heroArt(today),
    h(
      'div',
      { class: 'hero-body' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { class: 'card-title' }, '管理上の純資産', ov.partial ? badge('部分合計', 'warn') : null),
        helpButton('管理上の純資産', HELP.net),
      ),
      noneKnown ? h('p', { class: 'hero-num muted' }, '—') : h('p', { class: ['hero-num', ov.net < 0 && 'neg'] }, num),
      ov.newestDate
        ? h(
            'p',
            { class: 'asof-line' },
            ov.mixedDates
              ? [dateChip(ov.oldestDate), '〜', dateChip(ov.newestDate), ' 口座ごとに確認日が違います']
              : [dateChip(ov.newestDate), ' に確認した残高の合計'],
          )
        : null,
      h(
        'div',
        { class: 'split' },
        h('div', null, h('p', { class: 'mini-label' }, '総資産（銀行＋投資）'), yen(ov.assets.total, { cls: 'mid-num' })),
        h('div', null, h('p', { class: 'mini-label' }, '奨学金の残り'), yen(ov.loans.total, { cls: 'mid-num' })),
      ),
      ov.mixedDates ? h('p', { class: 'fine' }, '同じ日の正確な総額ではありません。') : null,
      notes,
      h('div', { class: 'card-actions' }, linkBtn('残高を確認・更新', '#/assets', { cls: 'btn', iconName: 'kura' })),
    ),
  );
}

function monthCard(today, months) {
  const state = app.state;
  if (state.accounts.length === 0) return null;
  const lastEnded = lastEndedMonth(today);
  const latest = latestConfirmed(state, today);
  const rows = [];
  if (months.length) {
    rows.push(monthBlocks(months.map((m) => ({ ...m, href: `#/assets/month/${m.ym}`, label: formatMonth(m.ym), short: formatMonthShort(m.ym) }))));
  }
  if (latest) {
    const r = monthReport(state, latest.ym, today);
    rows.push(
      h(
        'div',
        { class: 'split' },
        h('div', null, h('p', { class: 'mini-label' }, `${formatMonth(latest.ym)}末（確定）`), yen(latest.close.totals.net, { cls: 'mid-num' })),
        r.prevMonthComparison.available
          ? h('div', null, h('p', { class: 'mini-label' }, '前月比'), h('p', { class: 'mid-num' }, deltaView(r.prevMonthComparison.delta.net)))
          : r.periodComparison?.available
            ? h(
                'div',
                null,
                h('p', { class: 'mini-label' }, `${formatMonthShort(r.periodComparison.from)}末→${formatMonthShort(r.periodComparison.to)}末`),
                h('p', { class: 'mid-num' }, deltaView(r.periodComparison.delta.net)),
              )
            : h('div', null, h('p', { class: 'mini-label' }, '前月比'), h('p', { class: 'small muted' }, '比べられる前月がありません')),
      ),
    );
  }
  const ms = monthEndStatus(state, lastEnded, today);
  const lastStatus = effectiveClose(state, lastEnded, today);
  if (lastStatus.status !== 'confirmed' && ms.items.length > 0) {
    const missing = ms.items.filter((i) => !i.adopted).length;
    rows.push(
      h(
        'div',
        { class: lastStatus.status === 'needs_review' ? 'warn-box' : 'todo-box' },
        h(
          'p',
          null,
          h('strong', null, `${formatMonth(lastEnded)}末 `),
          closeBadge(lastStatus.status),
          ' ',
          lastStatus.status === 'needs_review'
            ? '確定に使った残高が変わりました。'
            : missing
              ? `月末の残高があと${missing}件です。`
              : '残高がそろいました。確定できます。',
        ),
        h(
          'div',
          { class: 'card-actions wrap' },
          missing
            ? button(`${formatMonthShort(lastEnded)}末の残高をまとめて記録`, () => openMonthEndBulkSheet(lastEnded), {
                cls: 'btn primary small',
                iconName: 'edit',
              })
            : linkBtn('確定する', `#/assets/month/${lastEnded}`, { cls: 'btn primary small', iconName: 'check' }),
          linkBtn('くわしく', `#/assets/month/${lastEnded}`, { cls: 'btn ghost small' }),
        ),
      ),
    );
  }
  if (rows.length === 0) rows.push(h('p', { class: 'small muted' }, `${formatMonth(monthOf(today))}末の残高がそろったら、ここで月末を確定できます。`));
  return card(
    cardHead('月末の確定', { action: helpButton('月末の確定', HELP.monthEnd), sub: '確定した月は金色のブロックに。増減は確定した月末どうしで比べます。' }),
    rows,
    h('p', { class: 'fine' }, '増減は節約額や投資の利益とは限りません。'),
  );
}

function loanCard(today) {
  const sum = loansSummary(app.state, today);
  if (sum.items.length === 0) return null;
  const rows = sum.items.map((p) => {
    const parts = [
      h(
        'div',
        { class: 'row between' },
        h('span', { class: 'strong' }, p.account.name),
        p.latest ? h('span', null, h('span', { class: 'mini-label' }, '残り '), yen(p.latest.amountYen, { cls: 'strong' })) : badge('未確認', 'warn'),
      ),
    ];
    if (p.ratio !== null) {
      parts.push(
        dotMeter(p.ratio, { label: `${p.account.name}の返済率` }),
        h(
          'p',
          { class: 'small' },
          `当初 ${formatYen(p.initial)} のうち `,
          h('strong', { class: 'num' }, formatYen(p.repaid)),
          ` 返済済み（${formatPercent(p.ratio * 100)}）`,
        ),
      );
    } else if (p.sinceFirst && p.sinceFirst.decrease > 0) {
      parts.push(
        h(
          'p',
          { class: 'small muted' },
          `記録を始めた ${formatDateShort(p.sinceFirst.from.asOfDate)} から ${formatYen(p.sinceFirst.decrease)} 減りました。当初の元金を入れると、進み具合をメーターで見られます。`,
        ),
      );
    } else {
      parts.push(h('p', { class: 'small muted' }, '当初の元金を入れると、進み具合をメーターで見られます（分からなければそのままで大丈夫です）。'));
    }
    return h('div', { class: 'loan-row' }, parts);
  });
  return card(
    cardHead('奨学金の返済', { sub: sum.unknownCount && sum.knownCount ? `返済率は当初の元金が分かる${sum.knownCount}件だけで計算しています` : undefined }),
    rows,
    h('p', { class: 'fine' }, '返済しても純資産は増えません（預金と元金が同じだけ減るため）。'),
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
    cardHead('最近のお金の動き', {
      sub: sum.hasRecords
        ? `${formatMonth(ym)}の記録済み支出 ${formatYen(sum.total)}（${sum.count}件）${sum.luxury.count ? `・★${LUXURY_LABEL} ${sum.luxury.count}件` : ''}`
        : `${formatMonth(ym)}の支出はまだ記録なし`,
    }),
    recent.length
      ? h(
          'ul',
          { class: 'event-list' },
          recent.map((e) => eventRow(e, { onClick: () => openEditor(e) })),
        )
      : h('p', { class: 'muted small' }, '気が向いたときに、金額とカテゴリーだけで記録できます。週末にまとめて入力しても大丈夫です。'),
    h(
      'div',
      { class: 'card-actions' },
      linkBtn('記録一覧', '#/records', { cls: 'btn ghost small' }),
      linkBtn('振り返り', '#/report/spending', { cls: 'btn ghost small' }),
    ),
  );
}

export function kindIcon(e) {
  if (e.kind === 'income') return pxIcon('coin', 24);
  if (e.kind === 'transfer') return pxIcon('transfer', 24);
  if (e.kind === 'repayment') return pxIcon('loan', 24);
  return pxIcon('card', 24);
}

export function eventRow(e, { onClick, hideDate = false } = {}) {
  const cat = e.kind === 'expense' ? categoryById(e.categoryId) : null;
  const title = cat ? e.memo || cat.label : e.memo || EVENT_KINDS[e.kind].label;
  const dateText = e.datePrecision === 'month' ? `${formatMonth(e.yearMonth)}（日付不明）` : formatDateShort(e.occurredOn);
  // メモがあるときだけ、種類（カテゴリー）を小さく添える（タイトルと同じ言葉を繰り返さない）
  const kindLabel = cat ? cat.label : EVENT_KINDS[e.kind].label;
  const sub = [hideDate ? null : dateText, title !== kindLabel ? kindLabel : null, e.paymentMethod === 'card' ? 'カード' : null].filter(Boolean).join('・');
  const content = [
    cat ? catTile(cat.id) : h('span', { class: ['ev-icon', `kind-${e.kind}`], 'aria-hidden': 'true' }, kindIcon(e)),
    h('span', { class: 'ev-main' }, h('span', { class: 'ev-title' }, title), h('span', { class: 'ev-sub' }, sub)),
    e.isLuxury ? h('span', { class: 'lux-mark', title: LUXURY_LABEL }, pxIcon('star', 16), h('span', { class: 'sr-only' }, LUXURY_LABEL)) : null,
    h(
      'span',
      { class: ['ev-amount', 'num', e.kind !== 'expense' && 'not-expense'] },
      e.kind === 'expense' ? formatYen(e.amountYen) : `(${formatYen(e.amountYen)})`,
    ),
  ];
  return h('li', null, onClick ? h('button', { type: 'button', class: 'ev-row', onclick: onClick }, content) : h('div', { class: 'ev-row' }, content));
}
