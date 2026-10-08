// 画面で共通に使う小さな部品
import { h } from './dom.js';
import { icon, catIcon, accIcon } from './icons.js';
import { formatYen, formatDelta } from '../core/money.js';
import { formatDateShort, formatDateLong, relativeDays, formatMonth, addMonths } from '../core/dates.js';
import { CLOSE_STATUS, categoryById } from '../core/constants.js';
import { openSheet } from './overlay.js';

export function yen(v, { cls, signed = false } = {}) {
  return h('span', { class: ['num', v < 0 && 'neg', cls] }, signed ? formatDelta(v) : formatYen(v));
}

/** 状態バッジ（色だけに頼らず、文字とアイコンで示す） */
export function badge(text, kind = 'neutral', iconName) {
  return h('span', { class: ['badge', `badge-${kind}`] }, iconName ? icon(iconName, 14) : null, text);
}

export function closeBadge(status) {
  const map = { confirmed: ['ok', 'stamp'], needs_review: ['warn', 'alert'], unconfirmed: ['neutral', null] };
  const [kind, ic] = map[status];
  return badge(CLOSE_STATUS[status], kind, ic);
}

export function card(...children) {
  return h('section', { class: 'card' }, ...children);
}

/** 種類つきのカード（紙の質感を変える：'ledger' 罫線, 'grid' 方眼, 'passbook' 通帳） */
export function cardOf(kind, ...children) {
  return h('section', { class: ['card', `card-${kind}`] }, ...children);
}

/** 2段組み（広い画面＝開いた Fold・タブレットで左右に並ぶ。狭い画面では縦に積む） */
export function cols(left, right, { ratio } = {}) {
  return h('div', { class: ['cols', ratio && `cols-${ratio}`] }, h('div', { class: 'col' }, left), h('div', { class: 'col' }, right));
}

/** 消印ふうの日付（確認日など） */
export function postmark(date, { top = '確認', title } = {}) {
  if (!date) return h('span', { class: 'postmark empty', title }, h('span', { class: 'pm-top' }, top), h('span', { class: 'pm-mid' }, '—'));
  const [y, m, d] = date.split('-').map(Number);
  return h(
    'span',
    { class: 'postmark', title: title ?? `${y}年${m}月${d}日`, 'aria-label': `${top} ${y}年${m}月${d}日` },
    h('span', { class: 'pm-top', 'aria-hidden': 'true' }, top),
    h('span', { class: 'pm-mid num', 'aria-hidden': 'true' }, `${m}.${d}`),
    h('span', { class: 'pm-bot num', 'aria-hidden': 'true' }, String(y)),
  );
}

/** 判子の欄：月ごとの確定状態（確＝確定、要＝要再確認、空欄＝未確定） */
export function hankoRow(items) {
  return h(
    'ol',
    { class: 'hanko-row' },
    items.map((it) => {
      const mark = it.status === 'confirmed' ? '確' : it.status === 'needs_review' ? '要' : '';
      return h(
        'li',
        null,
        h(
          'a',
          { class: ['hanko-slot', `st-${it.status}`], href: it.href, 'aria-label': `${it.label}末 ${CLOSE_STATUS[it.status]}` },
          h('span', { class: 'hanko-mark', 'aria-hidden': 'true' }, mark),
          h('span', { class: 'hanko-label', 'aria-hidden': 'true' }, it.short),
        ),
      );
    }),
  );
}

/** カテゴリーの絵のタイル */
export function catTile(categoryId, size = 'm') {
  const c = categoryById(categoryId);
  return h(
    'span',
    { class: ['cat-tile', `cat-${categoryId}`, `tile-${size}`], 'aria-hidden': 'true' },
    catIcon(c?.id ?? 'other', size === 's' ? 18 : size === 'l' ? 28 : 22),
  );
}

/** 口座の種類の絵のタイル */
export function accTile(type, size = 'm') {
  return h('span', { class: ['acc-tile', `acc-${type}`, `tile-${size}`], 'aria-hidden': 'true' }, accIcon(type, size === 's' ? 18 : 22));
}

export function cardHead(title, { action, sub, level = 'h2' } = {}) {
  return h(
    'div',
    { class: 'card-head' },
    h('div', null, h(level, { class: 'card-title' }, title), sub ? h('p', { class: 'card-sub' }, sub) : null),
    action ?? null,
  );
}

export function pageTitle(title, { back, action, sub, kicker } = {}) {
  return h(
    'header',
    { class: 'page-head' },
    back ? h('a', { class: 'icon-btn back', href: back, 'aria-label': '戻る' }, icon('left')) : null,
    h(
      'div',
      { class: 'page-head-text' },
      kicker ? h('p', { class: 'page-kicker' }, kicker) : null,
      h('h1', { class: 'page-title' }, title),
      sub ? h('p', { class: 'page-sub' }, sub) : null,
    ),
    action ?? null,
  );
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty-state' }, h('p', { class: 'empty-title' }, title), text ? h('p', { class: 'empty-text' }, text) : null, action ?? null);
}

export function asOf(date, today) {
  if (!date) return '未確認';
  return `${formatDateShort(date)} 時点（${relativeDays(date, today)}）`;
}

export function linkBtn(text, href, { cls = 'btn', iconName } = {}) {
  return h('a', { class: cls, href }, iconName ? icon(iconName, 18) : null, text);
}

export function button(text, onclick, { cls = 'btn', iconName, label, type = 'button', disabled } = {}) {
  return h('button', { class: cls, type, onclick, 'aria-label': label, disabled }, iconName ? icon(iconName, 18) : null, text);
}

/** 月の前後切り替え */
export function monthNav(ym, onChange, { max } = {}) {
  return h(
    'div',
    { class: 'month-nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '前の月', onclick: () => onChange(addMonths(ym, -1)) }, icon('left')),
    h('span', { class: 'month-nav-label', 'aria-live': 'polite' }, formatMonth(ym)),
    h(
      'button',
      { class: 'icon-btn', type: 'button', 'aria-label': '次の月', disabled: max && ym >= max ? true : undefined, onclick: () => onChange(addMonths(ym, 1)) },
      icon('right'),
    ),
  );
}

/** 説明のシート（「？」から開く） */
export function helpButton(title, build) {
  return h(
    'button',
    {
      class: 'icon-btn help',
      type: 'button',
      'aria-label': `${title}の説明`,
      onclick: () => openSheet({ title, build: () => h('div', { class: 'prose' }, build()) }),
    },
    icon('info', 18),
  );
}

export function kv(label, value) {
  return h('div', { class: 'kv' }, h('dt', null, label), h('dd', null, value));
}

export function dateLong(d) {
  return formatDateLong(d);
}

/** ふつうの説明文 */
export const HELP = {
  net: () => [
    h('p', null, '管理上の純資産 ＝ 総資産（銀行預金＋投資の評価額）− 奨学金の元金残高。'),
    h('p', null, '財布の現金・電子マネー・カードの未払い分・奨学金以外の借入は含まないので、完全な純資産とは違うことがあります。'),
    h(
      'p',
      null,
      '各口座の「最新の確認済み残高」を合計しています。確認した日が口座ごとに違うときは、同じ日の正確な総額ではありません（確認日が混在していると表示します）。',
    ),
    h('p', null, '支出・入金・返済を記録しても、残高は自動では変わりません。残高は、金融機関で確認した値を記録したときだけ更新されます。'),
    h('p', null, '預金の残高は「自由に使えるお金」ではありません（引き落とし予定のカード代などは含まれていません）。'),
  ],
  monthEnd: () => [
    h('p', null, '月末の確定は、対象のすべての口座について「月末の終了時点の実残高」がそろった月だけできます。'),
    h('p', null, '月末当日に確認する必要はありません。後日、金融機関の履歴や月末の評価額を見て、基準日を月末にして記録すれば大丈夫です。'),
    h('p', null, '今日の値・別の日の値・前の月の値・推計では補いません。支出の記録がそろっていなくても、残高がそろえば確定できます。'),
    h(
      'p',
      null,
      '前月比は、その月と直前の月がどちらも確定していて、対象の口座が同じときだけ出します。間の月が未確定なら「8月末→10月末」のように期間をはっきり書いて比べます。',
    ),
    h(
      'p',
      null,
      '確定に使った残高を訂正・取り消ししたり、口座の管理期間を変えたりすると「要再確認」になります。もう一度確定すると新しい版として残ります（前の版もたどれます）。',
    ),
    h('p', null, '純資産の増減は、節約できた額や投資の利益とは限りません（積立・評価額の変化・返済などが混ざっています）。'),
  ],
  spending: () => [
    h('p', null, '合計は「記録済み支出」です。記録していない支出は含まないので、実際の生活の総支出とは違うことがあります。'),
    h('p', null, '割合の分母は、同じ期間の記録済み支出だけ。入金・振替や積立・奨学金の元金返済・カードの引き落とし・サブスクの見込み額は含めません。'),
    h('p', null, '記録のない月は「記録なし」と表示します。支出が0円だった・節約できた、という意味ではありません。'),
    h('p', null, '「大きな出費」は金額の大きい順に自動で並べたもの。「ごほうび」は自分で印を付けた支出です。金額が大きくても自動ではごほうびにしません。'),
  ],
  subs: () => [
    h('p', null, '1つのサービス＝1部屋。無料体験は「内見」、解約は「退去」です。'),
    h(
      'p',
      null,
      '見込みは、今の契約条件を月額・年額に換算した値です。年払いは12で割って月額相当にしますが、毎月の支払実績にはしません。今年実際に払う額とも違います。',
    ),
    h('p', null, '支払予定日が来ても、自動で支出にはしません。月に1回ほど、支払った分を確認して記録してください（記録しない月があっても大丈夫です）。'),
    h('p', null, '解約で減るのは「これからの見込み」で、実際に節約できた額ではありません。'),
  ],
};

export function deltaView(delta) {
  return h('span', { class: ['num', 'delta', delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'] }, formatDelta(delta));
}
