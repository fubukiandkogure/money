// 資産：口座一覧・残高の確認日・履歴・月末チェック
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { icon } from '../ui/icons.js';
import { yen, badge, card, cardHead, pageTitle, button, helpButton, HELP, closeBadge, emptyState, asOf, deltaView, kv } from '../ui/parts.js';
import { confirmDialog } from '../ui/overlay.js';
import { ACCOUNT_TYPES } from '../core/constants.js';
import { currentOverview, sortAccounts, latestActual, newerEstimate, monthEndStatus, PROBLEM_LABELS, loanProgress, snapshotIndex } from '../core/assets.js';
import { effectiveClose, checklistMonths, monthReport, REVIEW_REASON_LABELS, COMPARE_REASON_LABELS } from '../core/closes.js';
import { formatDateShort, formatDateLong, formatMonth, formatStamp, isLastDayOfMonth, lastDayOfMonth, isValidMonth } from '../core/dates.js';
import { formatYen, formatPercent } from '../core/money.js';
import * as A from '../core/actions.js';
import { openAccountSheet, openSnapshotSheet, invalidateSnapshotFlow, verifyAsMonthEnd } from '../ui/forms/assets.js';

const view = { showArchived: false };

export function renderAssets() {
  const state = app.state;
  const today = app.today();
  const ov = currentOverview(state, today);
  const active = sortAccounts(state.accounts.filter((a) => !a.archivedAt));
  const archived = sortAccounts(state.accounts.filter((a) => a.archivedAt));

  const groups = Object.entries(ACCOUNT_TYPES).map(([type, meta]) => {
    const list = active.filter((a) => a.type === type);
    if (list.length === 0) return null;
    return h('div', { class: 'acc-group' }, h('h3', { class: 'group-title' }, `${meta.icon} ${meta.label}`), h('ul', { class: 'acc-list' }, list.map((a) => accountRow(a, today))));
  });

  return h(
    'div',
    { class: 'page' },
    pageTitle('資産', { sub: '確認した残高だけを合計します', action: button('口座を追加', () => openAccountSheet(), { cls: 'btn small', iconName: 'plus' }) }),
    state.accounts.length === 0
      ? card(
          emptyState(
            '口座がまだありません',
            '銀行・投資（NISAなど）・奨学金を、それぞれ登録してください。複数あってもかまいません。',
            button('口座を追加', () => openAccountSheet(), { cls: 'btn primary', iconName: 'plus' }),
          ),
        )
      : [
          card(
            h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, '確認済み残高の合計'), helpButton('管理上の純資産', HELP.net)),
            h(
              'dl',
              { class: 'kv-list' },
              kv('総資産（銀行＋投資）', yen(ov.assets.total)),
              kv('奨学金の残り', yen(ov.loans.total)),
              kv('管理上の純資産', yen(ov.net, { cls: 'strong' })),
            ),
            ov.mixedDates ? h('p', { class: 'note-line' }, icon('calendar', 16), `確認日が混在（${formatDateShort(ov.oldestDate)}〜${formatDateShort(ov.newestDate)}）`) : null,
            ov.missing.length ? h('p', { class: 'note-line warn' }, icon('alert', 16), `未確認 ${ov.missing.length}件を含まない部分合計です`) : null,
          ),
          card(groups),
          monthChecklist(today),
          archived.length
            ? card(
                h(
                  'details',
                  { class: 'more', open: view.showArchived || undefined, ontoggle: (e) => (view.showArchived = e.target.open) },
                  h('summary', null, `アーカイブした口座（${archived.length}）`),
                  h('p', { class: 'fine' }, 'アーカイブは一覧の整理です。過去の残高・月末確定はそのまま残り、管理期間内なら月末の対象にもなります。'),
                  h('ul', { class: 'acc-list' }, archived.map((a) => accountRow(a, today))),
                ),
              )
            : null,
        ],
  );
}

function accountRow(a, today) {
  const { snapshot, conflict } = latestActual(app.state.snapshots, a.id, today);
  const est = newerEstimate(app.state.snapshots, a.id, snapshot?.asOfDate);
  const ended = a.managedUntil && a.managedUntil <= today;
  return h(
    'li',
    { class: 'acc-row' },
    h(
      'a',
      { class: 'acc-main', href: `#/assets/account/${encodeURIComponent(a.id)}` },
      h('span', { class: 'acc-name' }, a.name),
      h(
        'span',
        { class: 'acc-meta' },
        snapshot ? asOf(snapshot.asOfDate, today) : badge('未確認', 'warn', 'alert'),
        conflict ? badge('同じ日に複数', 'warn') : null,
        est ? badge(`推計 ${formatYen(est.amountYen)}（${formatDateShort(est.asOfDate)}）`, 'est') : null,
        ended ? badge(a.endKind === 'zero' ? '解約・完済' : '管理終了', 'neutral') : null,
      ),
    ),
    h('span', { class: 'acc-amount' }, snapshot ? yen(snapshot.amountYen) : h('span', { class: 'muted' }, '—')),
    ended ? null : button('', () => openSnapshotSheet({ account: a }), { cls: 'icon-btn update', iconName: 'edit', label: `${a.name}の残高を記録` }),
  );
}

function monthChecklist(today) {
  const months = checklistMonths(app.state, today).slice(0, 12);
  if (months.length === 0) return null;
  return card(
    cardHead('月末チェック', { action: helpButton('月末の確定', HELP.monthEnd), sub: '月末の終了時点の残高がそろった月を確定します' }),
    h(
      'ul',
      { class: 'month-list' },
      months.map((ym) => {
        const e = effectiveClose(app.state, ym, today);
        const ms = monthEndStatus(app.state, ym, today);
        const missing = ms.items.filter((i) => !i.adopted).length;
        let info;
        if (e.status === 'confirmed') info = h('span', { class: 'num' }, `純資産 ${formatYen(e.close.totals.net)}`);
        else if (e.status === 'needs_review') info = h('span', { class: 'warn-text' }, '確定に使った残高・対象が変わりました');
        else if (ms.items.length === 0) info = h('span', { class: 'muted' }, '対象の口座なし');
        else if (missing) info = h('span', { class: 'muted' }, `月末の残高があと${missing}件`);
        else info = h('span', { class: 'ok-text' }, '確定できます');
        return h('li', null, h('a', { class: 'month-row', href: `#/assets/month/${ym}` }, h('span', { class: 'month-name' }, `${formatMonth(ym)}末`), closeBadge(e.status), info, icon('right', 18)));
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// 口座の詳細

export function renderAccount(id) {
  const state = app.state;
  const today = app.today();
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return h('div', { class: 'page' }, pageTitle('口座', { back: '#/assets' }), card(emptyState('口座が見つかりません')));
  const { snapshot: latest, conflict } = latestActual(state.snapshots, a.id, today);
  const idx = snapshotIndex(state.snapshots);
  const all = state.snapshots
    .filter((s) => s.accountId === a.id)
    .sort((x, y) => y.asOfDate.localeCompare(x.asOfDate) || y.recordedAt.localeCompare(x.recordedAt));
  const ended = a.managedUntil && a.managedUntil <= today;
  const loan = a.type === 'loan' ? loanProgress(state, a, today) : null;

  const info = h(
    'dl',
    { class: 'kv-list' },
    kv('種類', ACCOUNT_TYPES[a.type].label),
    kv('管理期間', `${formatDateLong(a.managedFrom)} 〜 ${a.managedUntil ? `${formatDateLong(a.managedUntil)}（${a.endKind === 'zero' ? '解約・完済' : '管理終了'}）` : ''}`),
    kv('始まり', a.startKind === 'new' ? 'この日に新しく開設（それ以前は0円）' : '以前から持っていた'),
    a.type === 'loan' ? kv('当初の元金', a.initialPrincipalYen === null ? '不明（未入力）' : formatYen(a.initialPrincipalYen)) : null,
    a.note ? kv('メモ', a.note) : null,
  );

  return h(
    'div',
    { class: 'page' },
    pageTitle(a.name, { back: '#/assets', sub: `${ACCOUNT_TYPES[a.type].icon} ${ACCOUNT_TYPES[a.type].label}${a.archivedAt ? '（アーカイブ中）' : ''}` }),
    card(
      h('p', { class: 'mini-label' }, '最新の確認済み残高'),
      latest ? h('p', { class: ['hero-num', 'small-hero'] }, formatYen(latest.amountYen)) : h('p', { class: 'hero-num small-hero muted' }, '未確認'),
      latest ? h('p', { class: 'note-line' }, icon('calendar', 16), `${asOf(latest.asOfDate, today)}・記録 ${formatStamp(latest.recordedAt)}`) : null,
      conflict ? h('p', { class: 'note-line warn' }, icon('alert', 16), '同じ日に複数の記録があります。どちらかを訂正か取り消ししてください。') : null,
      loan && loan.ratio !== null
        ? h('div', null, h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(loan.ratio * 100), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': '返済率' }, h('span', { style: { width: `${loan.ratio * 100}%` } })), h('p', { class: 'small muted' }, `返済済み ${formatYen(loan.repaid)}（${formatPercent(loan.ratio * 100)}）`))
        : null,
      loan && loan.ratio === null && loan.sinceFirst ? h('p', { class: 'small muted' }, `記録を始めた ${formatDateShort(loan.sinceFirst.from.asOfDate)} から ${formatYen(loan.sinceFirst.decrease)} 減少（当初の元金が不明なので返済率は出しません）`) : null,
      h('div', { class: 'card-actions' }, ended ? null : button('残高を記録', () => openSnapshotSheet({ account: a }), { cls: 'btn primary', iconName: 'plus' })),
    ),
    card(cardHead('残高の履歴', { sub: '訂正・取り消しした記録も残ります' }), all.length ? h('ul', { class: 'snap-list' }, all.map((s) => snapRow(s, a, idx))) : h('p', { class: 'muted small' }, 'まだ記録がありません。')),
    card(
      cardHead('口座の情報'),
      info,
      h(
        'div',
        { class: 'card-actions wrap' },
        button('編集', () => openAccountSheet({ account: a }), { cls: 'btn', iconName: 'edit' }),
        button(a.archivedAt ? 'アーカイブから戻す' : 'アーカイブ', async () => {
          if (!a.archivedAt) {
            const ok = await confirmDialog({ title: '一覧から隠しますか？', message: 'アーカイブは一覧の整理です。残高の履歴・月末確定・管理期間は変わりません。解約・完済した場合は「編集」から管理終了日を記録してください。', okLabel: 'アーカイブ' });
            if (!ok) return;
          }
          await app.save(A.setAccountArchived(state, a.id, !a.archivedAt, app.ctx()), { okMessage: a.archivedAt ? '一覧に戻しました' : 'アーカイブしました' });
        }, { cls: 'btn ghost' }),
        all.length === 0
          ? button('削除', async () => {
              const ok = await confirmDialog({ title: 'この口座を削除しますか？', message: '記録のない口座だけ削除できます。', okLabel: '削除する', danger: true });
              if (!ok) return;
              const res = A.deleteAccount(app.state, a.id);
              if (!res.ok) return confirmDialog({ title: '削除できません', message: res.message, okLabel: 'OK' });
              const saved = await app.save(res, { okMessage: '削除しました' });
              if (saved.ok) app.navigate('assets');
            }, { cls: 'btn ghost danger-text' })
          : null,
      ),
    ),
  );
}

function snapRow(s, account, idx) {
  const effective = !s.invalidatedAt && !idx.supersededBy.has(s.id);
  const corrected = idx.supersededBy.has(s.id);
  const badges = [
    s.kind === 'actual' ? badge('実残高', 'ok') : badge('推計', 'est'),
    s.monthEndVerified ? badge('月末の終了時点', 'info') : null,
    s.revisionOf ? badge('訂正版', 'neutral') : null,
    corrected ? badge('訂正済み', 'neutral', 'history') : null,
    s.invalidatedAt ? badge('取り消し', 'neutral') : null,
  ];
  const actions = [];
  if (effective) {
    if (s.kind === 'actual' && !s.monthEndVerified && isLastDayOfMonth(s.asOfDate)) actions.push(button('月末値として確認', () => verifyAsMonthEnd(s), { cls: 'btn tiny' }));
    actions.push(button('訂正', () => openSnapshotSheet({ account, correct: s }), { cls: 'btn tiny' }), button('取り消し', () => invalidateSnapshotFlow(s), { cls: 'btn tiny ghost' }));
  }
  return h(
    'li',
    { class: ['snap', !effective && 'inactive'] },
    h('div', { class: 'snap-top' }, h('span', { class: 'snap-date' }, formatDateLong(s.asOfDate)), h('span', { class: ['num', 'snap-amount', !effective && 'strike'] }, formatYen(s.amountYen))),
    h('div', { class: 'snap-badges' }, badges),
    h('p', { class: 'snap-meta' }, `記録 ${formatStamp(s.recordedAt)}`, s.invalidatedAt ? `・取り消し ${formatStamp(s.invalidatedAt)}${s.invalidReason ? `（${s.invalidReason}）` : ''}` : '', s.note ? `・${s.note}` : ''),
    actions.length ? h('div', { class: 'snap-actions' }, actions) : null,
  );
}

// ---------------------------------------------------------------------------
// 月末の詳細と確定

export function renderMonth(ym) {
  if (!isValidMonth(ym)) return h('div', { class: 'page' }, pageTitle('月末チェック', { back: '#/assets' }), card(emptyState('月が正しくありません')));
  const state = app.state;
  const today = app.today();
  const ms = monthEndStatus(state, ym, today);
  const e = effectiveClose(state, ym, today);
  const report = monthReport(state, ym, today);
  const end = lastDayOfMonth(ym);

  const items = ms.items.map((i) => {
    const a = i.account;
    let right;
    let detail = null;
    if (i.adopted) right = yen(i.adopted.amountYen);
    else {
      right = badge('不足', 'warn', 'alert');
      detail = h(
        'div',
        { class: 'me-problem' },
        h('p', { class: 'small' }, PROBLEM_LABELS[i.problem]),
        i.problem === 'time_unknown'
          ? i.related.map((s) => button(`${formatYen(s.amountYen)} を月末の値として確認`, () => verifyAsMonthEnd(s), { cls: 'btn tiny' }))
          : i.problem === 'conflict'
            ? h('a', { class: 'btn tiny', href: `#/assets/account/${encodeURIComponent(a.id)}` }, '履歴で整理する')
            : button(`${formatDateShort(end)}の残高を記録`, () => openSnapshotSheet({ account: a, monthEnd: ym }), { cls: 'btn tiny primary' }),
      );
    }
    return h('li', { class: 'me-item' }, h('div', { class: 'row between' }, h('a', { href: `#/assets/account/${encodeURIComponent(a.id)}` }, `${ACCOUNT_TYPES[a.type].icon} ${a.name}`), right), detail);
  });

  const confirmBtn = button(e.status === 'needs_review' ? 'いまの残高で確定し直す' : `${formatMonth(ym)}末を確定する`, async () => {
    let reasonInput = null;
    const ok = await confirmDialog({
      title: `${formatMonth(ym)}末を確定しますか？`,
      message: `総資産 ${formatYen(ms.totals.assets)}、奨学金 ${formatYen(ms.totals.loans)}、管理上の純資産 ${formatYen(ms.totals.net)} で確定します。使った残高記録と対象口座を固定して保存します。`,
      okLabel: '確定する',
      details: e.history.length ? h('div', null, (reasonInput = h('input', { class: 'text-input', type: 'text', placeholder: '確定し直す理由（任意）', 'aria-label': '理由' }))) : null,
    });
    if (!ok) return;
    const res = A.confirmMonth(app.state, ym, reasonInput?.value ?? '', app.ctx());
    if (!res.ok) return confirmDialog({ title: '確定できません', message: res.message, okLabel: 'OK' });
    const saved = await app.save(res, { okMessage: `${formatMonth(ym)}末を確定しました` });
    if (saved.ok) document.querySelector('.stamp-anim')?.classList.add('play');
  }, { cls: 'btn primary wide big', iconName: 'stamp', disabled: !ms.canConfirm || undefined });

  let blockers = null;
  if (!ms.canConfirm) {
    const msgs = [];
    if (ms.blockers.includes('not_ended')) msgs.push(`${formatDateLong(end)} がまだ終わっていません。`);
    if (ms.blockers.includes('no_accounts')) msgs.push('この月末に管理している口座がありません。');
    if (ms.blockers.includes('missing')) msgs.push('すべての口座の月末の実残高がそろうと確定できます。');
    blockers = h('p', { class: 'note-line' }, icon('info', 16), msgs.join(' '));
  }

  const statusCard = card(
    h(
      'div',
      { class: 'me-status' },
      e.status === 'confirmed' ? h('div', { class: 'hanko', 'aria-hidden': 'true' }, h('span', null, '確定')) : null,
      h('div', null, h('p', { class: 'mini-label' }, '状態'), h('p', { class: 'status-line' }, closeBadge(e.status), e.close ? h('span', { class: 'small muted' }, ` 第${e.close.revision}版・${formatStamp(e.close.createdAt)}`) : null)),
    ),
    e.status === 'needs_review'
      ? h(
          'div',
          { class: 'warn-box' },
          h('p', null, '確定したあとで、次の変更がありました。確定した値は「現在の実績」としては使いません。'),
          h('ul', null, e.reasons.map((r) => h('li', null, `${REVIEW_REASON_LABELS[r.type]}${r.accountId ? `：${state.accounts.find((x) => x.id === r.accountId)?.name ?? '（削除された口座）'}` : ''}`))),
        )
      : null,
    e.close?.totals && e.status !== 'unconfirmed'
      ? h(
          'dl',
          { class: 'kv-list' },
          kv(e.status === 'needs_review' ? '前回確定した純資産（参考）' : '管理上の純資産', yen(e.close.totals.net, { cls: 'strong' })),
          kv('総資産', yen(e.close.totals.assets)),
          kv('奨学金', yen(e.close.totals.loans)),
        )
      : null,
    e.status === 'confirmed' ? comparison(report) : null,
    h('div', { class: 'stamp-anim', 'aria-hidden': 'true' }, h('span', null, '確定')),
  );

  const itemsCard = card(
    cardHead(`${formatMonth(ym)}末の対象口座`, { sub: `${formatDateLong(end)} の終了時点。今日の値・前月の値・推計では補いません。` }),
    ms.items.length ? h('ul', { class: 'me-list' }, items) : h('p', { class: 'muted small' }, 'この月末に管理している口座はありません。'),
    ms.complete && e.status !== 'confirmed'
      ? h('dl', { class: 'kv-list' }, kv('総資産', yen(ms.totals.assets)), kv('奨学金', yen(ms.totals.loans)), kv('管理上の純資産', yen(ms.totals.net, { cls: 'strong' })))
      : null,
    e.status !== 'confirmed' ? h('div', { class: 'card-actions' }, blockers, confirmBtn) : null,
  );

  const history = e.history.length
    ? card(
        h(
          'details',
          { class: 'more' },
          h('summary', null, `確定の履歴（${e.history.length}件）`),
          h(
            'ol',
            { class: 'history-list', reversed: true },
            [...e.history].reverse().map((c) =>
              h(
                'li',
                null,
                h('span', null, `第${c.revision}版 ${c.status === 'confirmed' ? '確定' : '取り消し'}`),
                h('span', { class: 'small muted' }, ` ${formatStamp(c.createdAt)}`),
                c.totals ? h('span', { class: 'num small' }, ` 純資産 ${formatYen(c.totals.net)}`) : null,
                c.reason ? h('p', { class: 'small muted' }, `理由：${c.reason}`) : null,
              ),
            ),
          ),
          e.status !== 'unconfirmed'
            ? button('確定を取り消す', async () => {
                let reasonInput;
                const ok = await confirmDialog({
                  title: '確定を取り消しますか？',
                  message: '未確定に戻します。確定の履歴は残ります。',
                  okLabel: '取り消す',
                  danger: true,
                  details: h('div', null, (reasonInput = h('input', { class: 'text-input', type: 'text', placeholder: '理由（任意）', 'aria-label': '理由' }))),
                });
                if (!ok) return;
                await app.save(A.cancelClose(app.state, ym, reasonInput.value, app.ctx()), { okMessage: '確定を取り消しました' });
              }, { cls: 'btn ghost danger-text' })
            : null,
        ),
      )
    : null;

  return h('div', { class: 'page' }, pageTitle(`${formatMonth(ym)}末`, { back: '#/assets', action: helpButton('月末の確定', HELP.monthEnd) }), statusCard, itemsCard, history);
}

function comparison(report) {
  const p = report.prevMonthComparison;
  const rows = [];
  if (p.available) {
    rows.push(kv('前月比（管理上の純資産）', deltaView(p.delta.net)), kv('総資産', deltaView(p.delta.assets)), kv('奨学金', deltaView(p.delta.loans)));
    for (const n of p.notes ?? []) rows.push(h('p', { class: 'fine' }, n.type === 'opened' ? `「${n.account.name}」は期間中に新しく開設（開設前は0円として比較）` : `「${n.account.name}」は解約・完済で0円（管理終了）`));
  } else {
    const reasons = (p.reasons ?? []).map((r) => COMPARE_REASON_LABELS[r.type] + (r.account ? `（${r.account.name}）` : ''));
    rows.push(kv('前月比', h('span', { class: 'muted' }, `未算出：${reasons.join('、') || '直前の月末と比べられません'}`)));
    if (report.periodComparison?.available) {
      const pc = report.periodComparison;
      rows.push(kv(`${formatMonth(pc.from)}末→${formatMonth(pc.to)}末（${pc.months}か月）`, deltaView(pc.delta.net)));
    }
  }
  return h('dl', { class: 'kv-list compare' }, rows, h('p', { class: 'fine' }, '増減は節約額や投資の利益とは限りません。'));
}

