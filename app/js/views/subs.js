// サブスク荘：1契約＝1部屋。見込みと、実際に支払った記録を分けて見せる。
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { icon } from '../ui/icons.js';
import { card, cardHead, pageTitle, button, monthNav, helpButton, HELP, emptyState, badge, kv, cols } from '../ui/parts.js';
import { confirmDialog } from '../ui/overlay.js';
import { projection, paymentChecklist, contractView, ROOMS_PER_FLOOR, termsOf, paymentsOfContract, trialDaysLeft } from '../core/subs.js';
import { FREQUENCIES, CONTRACT_STATUSES } from '../core/constants.js';
import { formatYen, monthlyFromAnnual } from '../core/money.js';
import { formatDateShort, formatDateLong, formatMonth, monthOf, isValidMonth, formatStamp } from '../core/dates.js';
import * as A from '../core/actions.js';
import {
  openContractSheet,
  openContractEditSheet,
  openTermsSheet,
  openPaymentSheet,
  skipPaymentFlow,
  undoPaymentFlow,
  deleteTermFlow,
} from '../ui/forms/subs.js';
import { openExpenseSheet } from '../ui/forms/expense.js';

const view = { ym: null };

function statusOf(v, today) {
  if (v.status === 'ended') return { key: 'ended', label: '退去済み' };
  if (v.status === 'scheduled') return { key: 'scheduled', label: '入居予定' };
  if (v.nextEnd) return { key: 'leaving', label: '退去予定', note: `${formatDateShort(v.nextEnd.effectiveOn)}に退去` };
  if (v.status === 'trial') {
    const left = trialDaysLeft(v.current, today);
    return { key: 'trial', label: '内見中', note: left === null ? null : left >= 0 ? `あと${left}日` : '内見期間終了？' };
  }
  return { key: 'active', label: '入居中' };
}

function priceText(v) {
  const t = v.current;
  if (!t) return '';
  if (v.status === 'trial') return t.priceYen === null ? '内見後の料金：不明' : `内見後 ${formatYen(t.priceYen)}/${FREQUENCIES[t.frequency].unit}`;
  if (v.status !== 'active') return '';
  if (t.priceYen === null) return '料金不明';
  return t.frequency === 'yearly' ? `${formatYen(t.priceYen)}/年（月あたり約${formatYen(monthlyFromAnnual(t.priceYen))}）` : `${formatYen(t.priceYen)}/月`;
}

function building(views, today) {
  const byRoom = new Map(views.map((v) => [v.contract.roomNo, v]));
  const maxFloor = Math.max(1, ...views.map((v) => Math.floor(v.contract.roomNo / 100)));
  const floors = [];
  for (let f = maxFloor; f >= 1; f--) {
    const rooms = [];
    for (let r = 1; r <= ROOMS_PER_FLOOR; r++) {
      const no = f * 100 + r;
      const v = byRoom.get(no);
      if (!v) {
        rooms.push(
          h(
            'div',
            { class: 'room vacant', 'aria-label': `${no}号室 空室` },
            h('span', { class: 'room-no' }, no),
            h('span', { class: 'room-vacant' }, '入居者', h('br'), '募集中'),
          ),
        );
        continue;
      }
      const st = statusOf(v, today);
      rooms.push(
        h(
          'a',
          {
            class: ['room', `st-${st.key}`],
            href: `#/subs/${encodeURIComponent(v.contract.id)}`,
            'aria-label': `${no}号室 ${v.contract.displayName} ${st.label}`,
          },
          h('span', { class: 'room-window', 'aria-hidden': 'true' }),
          h('span', { class: 'room-no' }, no),
          h('span', { class: 'room-name' }, v.contract.displayName),
          h('span', { class: 'room-status' }, st.label),
          st.note ? h('span', { class: 'room-note' }, st.note) : null,
          h('span', { class: 'room-price num' }, st.key === 'ended' ? '' : priceText(v)),
        ),
      );
    }
    floors.push(
      h(
        'div',
        { class: 'apt-floor', role: 'group', 'aria-label': `${f}階` },
        h('span', { class: 'apt-floor-label', 'aria-hidden': 'true' }, `${f}F`),
        h('div', { class: 'apt-rooms' }, rooms),
      ),
    );
  }
  const boxes = Math.min(8, maxFloor * ROOMS_PER_FLOOR);
  return h(
    'div',
    { class: 'apt' },
    h('div', { class: 'apt-roof', 'aria-hidden': 'true' }),
    h('div', { class: 'apt-sign' }, h('span', null, 'サブスク荘')),
    h('div', { class: 'apt-body' }, h('div', { class: 'apt-stairs', 'aria-hidden': 'true' }), floors),
    h(
      'div',
      { class: 'apt-ground', 'aria-hidden': 'true' },
      Array.from({ length: boxes }, () => h('span', { class: 'mailbox' })),
      h('span', { class: 'plant' }),
    ),
  );
}

export function renderSubs(ymParam) {
  const state = app.state;
  const today = app.today();
  if (ymParam && isValidMonth(ymParam)) view.ym = ymParam;
  if (!view.ym) view.ym = monthOf(today);
  const proj = projection(state, today);
  const archived = state.contracts.filter((c) => c.archivedAt);

  const summary = card(
    h(
      'div',
      { class: 'card-head' },
      h('div', null, h('h2', { class: 'card-title' }, '家賃の見込み'), h('p', { class: 'card-sub' }, '今の契約条件を月・年に換算した見込み')),
      helpButton('サブスク荘', HELP.subs),
    ),
    h(
      'div',
      { class: 'split' },
      h('div', null, h('p', { class: 'mini-label' }, '月あたり'), h('p', { class: 'mid-num num' }, formatYen(proj.monthlyTotal))),
      h('div', null, h('p', { class: 'mini-label' }, '年あたり'), h('p', { class: 'mid-num num' }, formatYen(proj.annualTotal))),
    ),
    h('p', { class: 'small muted' }, `入居中 ${proj.activeCount}部屋${proj.trialCount ? `・内見中 ${proj.trialCount}部屋（現在0円）` : ''}`),
    proj.unknownCount
      ? h('p', { class: 'note-line warn' }, icon('alert', 16), `料金不明の部屋が${proj.unknownCount}件あります（合計に入っていません）。`)
      : null,
    proj.trialCount
      ? h(
          'p',
          { class: 'note-line' },
          icon('info', 16),
          `内見のあとも続けると、見込みが月あたり約${formatYen(monthlyFromAnnual(proj.trialAfterAnnual))}増えます${proj.trialAfterUnknown ? `（料金不明 ${proj.trialAfterUnknown}件を除く）` : ''}。自動では有料になりません。`,
        )
      : null,
    proj.ending.length
      ? h(
          'p',
          { class: 'note-line' },
          icon('info', 16),
          `退去予定：${proj.ending.map((e) => `${e.contract.displayName}（${formatDateShort(e.on)}〜、見込み 月約${formatYen(monthlyFromAnnual(e.annual ?? 0))}減）`).join('、')}。これからの見込みが減るだけで、節約できた実績ではありません。`,
        )
      : null,
    h('p', { class: 'fine' }, '年払いは12で割った月額相当です。今年実際に払う額とは違います。'),
  );

  const cl = paymentChecklist(state, view.ym, today);
  const rows = cl.rows.map((r) => {
    const name = r.contract?.displayName ?? '（削除された契約）';
    let right;
    if (r.state === 'confirmed') {
      right = h(
        'div',
        { class: 'pay-right' },
        badge('支払済み', 'ok', 'check'),
        h('span', { class: 'num' }, formatYen(r.event.amountYen)),
        h('span', { class: 'small muted' }, r.event.datePrecision === 'month' ? '日付不明' : formatDateShort(r.event.occurredOn)),
        button('', () => undoPaymentFlow(r), { cls: 'icon-btn', iconName: 'history', label: `${name}の支払確認を取り消す` }),
      );
    } else if (r.state === 'skipped') {
      right = h(
        'div',
        { class: 'pay-right' },
        badge('支払なし', 'neutral'),
        button('', () => undoPaymentFlow(r), { cls: 'icon-btn', iconName: 'history', label: '未確認に戻す' }),
      );
    } else {
      right = h(
        'div',
        { class: 'pay-right' },
        button('支払った', () => openPaymentSheet({ row: r }), { cls: 'btn tiny primary' }),
        button('なし', () => skipPaymentFlow(r), { cls: 'btn tiny ghost', label: `${name}は支払なし` }),
      );
    }
    return h(
      'li',
      { class: ['pay-row', `pay-${r.state}`] },
      h(
        'div',
        { class: 'pay-left' },
        h('span', { class: 'pay-name' }, r.contract ? `${r.contract.roomNo} ${name}` : name),
        h(
          'span',
          { class: 'small muted' },
          r.extra
            ? '追加の支払'
            : [
                r.dueOn ? `予定 ${formatDateShort(r.dueOn)}` : '予定日不明',
                r.expectedYen !== null && r.expectedYen !== undefined ? `・予定額 ${formatYen(r.expectedYen)}` : r.frequency ? '・料金不明' : '',
              ].join(''),
        ),
      ),
      right,
    );
  });

  const checklist = card(
    cardHead('支払の確認', { sub: '支払った分だけを、サブスクの支出として1件ずつ記録します。予定日が来ても自動では記録しません。' }),
    monthNav(view.ym, (m) => {
      view.ym = m;
      app.rerender();
    }),
    rows.length ? h('ul', { class: 'pay-list' }, rows) : h('p', { class: 'small muted' }, `${formatMonth(view.ym)}に支払予定の部屋はありません。`),
    h(
      'p',
      { class: 'summary-line' },
      `${formatMonth(view.ym)}の支払済み `,
      h('strong', { class: 'num' }, formatYen(cl.confirmedTotal)),
      `（${cl.confirmedCount}件）`,
      cl.pendingCount ? `・未確認 ${cl.pendingCount}件` : '',
    ),
    h('p', { class: 'fine' }, '確認しない月があっても、資産の確認や契約の管理はそのまま使えます。'),
  );

  return h(
    'div',
    { class: 'page subs' },
    pageTitle('サブスク荘', {
      kicker: 'SUBSCRIPTION',
      sub: '1契約＝1部屋。内見＝無料体験、退去＝解約',
      action: button('入居', () => openContractSheet(), { cls: 'btn small', iconName: 'plus' }),
    }),
    proj.views.length === 0 && archived.length === 0
      ? card(
          building([], today),
          emptyState(
            'まだ誰も住んでいません',
            '使っているサブスクを1つずつ登録すると、部屋に灯りがともります。合計額ではなく、サービスごとに登録します。',
            button('最初の入居者を迎える', () => openContractSheet(), { cls: 'btn primary', iconName: 'plus' }),
          ),
        )
      : [card(building(proj.views, today)), cols([summary], [checklist])],
    archived.length
      ? card(
          h(
            'details',
            { class: 'more' },
            h('summary', null, `アーカイブ（退去済み ${archived.length}件）`),
            h(
              'ul',
              { class: 'plain-list' },
              archived.map((c) => h('li', null, h('a', { href: `#/subs/${encodeURIComponent(c.id)}` }, `${c.roomNo} ${c.displayName}`))),
            ),
          ),
        )
      : null,
  );
}

export function renderContract(id) {
  const state = app.state;
  const today = app.today();
  const c = state.contracts.find((x) => x.id === id);
  if (!c) return h('div', { class: 'page' }, pageTitle('部屋', { back: '#/subs' }), card(emptyState('部屋が見つかりません')));
  const v = contractView(state, c, today);
  const st = statusOf(v, today);
  const terms = termsOf(state, c.id);
  const pays = paymentsOfContract(state, c.id);

  const termRow = (t) =>
    h(
      'li',
      { class: ['term', t.effectiveOn > today && 'future'] },
      h(
        'div',
        { class: 'row between' },
        h('span', null, `${formatDateLong(t.effectiveOn)}〜`, t.effectiveOn > today ? badge('予定', 'info') : null),
        h('span', null, CONTRACT_STATUSES[t.status].label),
      ),
      h(
        'p',
        { class: 'small muted' },
        t.status === 'ended'
          ? `退去${t.cancelledOn ? `（解約手続き ${formatDateLong(t.cancelledOn)}）` : ''}`
          : [
              t.status === 'trial' ? '内見後 ' : '',
              t.priceYen === null ? '料金不明' : `${formatYen(t.priceYen)}/${FREQUENCIES[t.frequency].unit}`,
              t.dueDay ? `・支払日 ${t.frequency === 'yearly' && t.dueMonth ? `${t.dueMonth}月` : '毎月'}${t.dueDay}日` : '',
              t.trialEndsOn ? `・無料期間 〜${formatDateLong(t.trialEndsOn)}` : '',
            ].join(''),
        t.note ? `・${t.note}` : '',
      ),
      terms.length > 1 ? button('この条件を削除', () => deleteTermFlow(t), { cls: 'btn tiny ghost' }) : null,
    );

  const actions = [];
  if (v.status === 'trial') actions.push(button('入居（有料にする）', () => openTermsSheet(c, 'start_paid'), { cls: 'btn primary' }));
  if (v.status === 'active' || v.status === 'trial') actions.push(button('料金・周期を変更', () => openTermsSheet(c, 'change'), { cls: 'btn' }));
  if (v.status !== 'ended') actions.push(button(v.nextEnd ? '退去日を変更' : '退去（解約）', () => openTermsSheet(c, 'end'), { cls: 'btn' }));
  if (v.status === 'ended') actions.push(button('再入居', () => openTermsSheet(c, 'change'), { cls: 'btn' }));

  const doorCard = card(
    h(
      'div',
      { class: ['door', `st-${st.key}`] },
      h('span', { class: 'door-plate' }, `${c.roomNo}`),
      h('span', { class: 'door-name' }, c.displayName),
      h('span', { class: 'door-status' }, st.label),
    ),
    h(
      'dl',
      { class: 'kv-list' },
      kv('現在', v.current ? CONTRACT_STATUSES[v.current.status].long : '開始前'),
      kv('料金', priceText(v) || '—'),
      v.status === 'active' && v.annual !== null ? kv('見込み（換算）', `月 ${formatYen(monthlyFromAnnual(v.annual))}・年 ${formatYen(v.annual)}`) : null,
      v.nextDue ? kv('次回の支払予定', formatDateLong(v.nextDue)) : null,
      v.nextEnd ? kv('退去予定', `${formatDateLong(v.nextEnd.effectiveOn)}（それ以降は見込み0）`) : null,
      c.note ? kv('メモ', c.note) : null,
    ),
    v.trialOverdue
      ? h(
          'p',
          { class: 'warn-box' },
          '無料期間の終了日を過ぎています。有料で続けているなら「入居」、やめたなら「退去」を記録してください（自動では切り替えません）。',
        )
      : null,
    h('div', { class: 'card-actions wrap' }, actions),
  );
  const paysCard = card(
    cardHead('支払の記録', { sub: '確認して記録した実際の支払。契約の予定とは別です。' }),
    pays.length
      ? h(
          'ul',
          { class: 'plain-list' },
          pays.map(({ link, event }) =>
            h(
              'li',
              { class: 'row between' },
              h('span', null, `${formatMonth(link.yearMonth)}分${link.kind === 'extra' ? '（追加）' : ''}`),
              link.status === 'skipped'
                ? badge('支払なし', 'neutral')
                : event
                  ? h(
                      'span',
                      { class: 'num' },
                      `${formatYen(event.amountYen)}（${event.datePrecision === 'month' ? '日付不明' : formatDateShort(event.occurredOn)}）`,
                    )
                  : badge('記録なし', 'warn'),
              event ? button('', () => openExpenseSheet({ event }), { cls: 'icon-btn', iconName: 'edit', label: '支払記録を編集' }) : null,
            ),
          ),
        )
      : h('p', { class: 'small muted' }, 'まだ支払の記録はありません。'),
    h(
      'div',
      { class: 'card-actions' },
      button('支払を追加（遅れた引き落とし等）', () => openPaymentSheet({ contract: c, ym: monthOf(today), extra: true }), { cls: 'btn small' }),
    ),
  );
  const termsCard = card(
    cardHead('契約条件の履歴', { sub: '適用日ごとに残します。過去の支払記録は書き換えません。' }),
    h('ul', { class: 'term-list' }, [...terms].reverse().map(termRow)),
  );
  const manageCard = card(
    h(
      'div',
      { class: 'card-actions wrap' },
      button('名札を編集', () => openContractEditSheet(c), { cls: 'btn', iconName: 'edit' }),
      v.status === 'ended'
        ? button(
            c.archivedAt ? 'アーカイブから戻す' : 'アーカイブ',
            () =>
              app.save(A.updateContract(app.state, c.id, { archived: !c.archivedAt }, app.ctx()), {
                okMessage: c.archivedAt ? '戻しました' : 'アーカイブしました',
              }),
            { cls: 'btn ghost' },
          )
        : null,
      pays.length === 0
        ? button(
            'この部屋を削除',
            async () => {
              const ok = await confirmDialog({
                title: '部屋を削除しますか？',
                message: '登録の間違いを消すためのものです。支払の記録がある部屋は削除できません（退去してアーカイブしてください）。',
                okLabel: '削除する',
                danger: true,
              });
              if (!ok) return;
              const saved = await app.save(A.deleteContract(app.state, c.id), { okMessage: '削除しました' });
              if (saved.ok) app.navigate('subs');
            },
            { cls: 'btn ghost danger-text' },
          )
        : null,
    ),
    h('p', { class: 'fine' }, `登録 ${formatStamp(c.createdAt)}`),
  );
  return h(
    'div',
    { class: 'page' },
    pageTitle(`${c.roomNo}号室`, { back: '#/subs', kicker: 'サブスク荘', sub: c.displayName }),
    cols([doorCard, manageCard], [paysCard, termsCard]),
  );
}
