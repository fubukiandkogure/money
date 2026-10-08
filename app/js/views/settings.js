// 設定・データ管理：書き出し（手動バックアップ）、置換復元、保存状態、表示、使い方
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { icon } from '../ui/icons.js';
import { card, cardHead, pageTitle, button, kv, HELP, badge, cols } from '../ui/parts.js';
import { quickMoveSub } from '../ui/forms/event.js';
import { openSetupSheet } from '../ui/forms/setup.js';
import { confirmDialog, alertDialog, toast } from '../ui/overlay.js';
import { segmented, checkbox } from '../ui/fields.js';
import { buildExport, backupFileName, parseBackup, summarize, MAX_BACKUP_BYTES } from '../core/backup.js';
import { emptyState as emptyData } from '../core/apply.js';
import { COLLECTIONS, APP_VERSION, SCHEMA_VERSION, APP_NAME } from '../core/constants.js';
import { formatStamp, nowStampJST } from '../core/dates.js';
import { formatYen } from '../core/money.js';
import * as A from '../core/actions.js';
import { Store } from '../data/store.js';
import { seedDemo } from '../demo.js';

const LABELS = {
  accounts: '口座',
  snapshots: '残高の記録',
  events: 'お金の動き',
  contracts: 'サブスクの部屋',
  contractTerms: '契約条件',
  paymentLinks: '支払の確認',
  closes: '月末確定の版',
};

const view = { persisted: null, estimate: null, restore: null };

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** 保存の順番待ちを終えてから、整合した一時点のデータを書き出す */
async function makeBackup() {
  await app.store.queue;
  const now = nowStampJST();
  const backup = buildExport(app.store.state, now);
  return { backup, text: JSON.stringify(backup, null, 1), filename: backupFileName(now), now, revision: app.store.revision };
}

export async function exportDownload() {
  try {
    const { text, filename, now, revision } = await makeBackup();
    downloadText(filename, text);
    await app.store.setDevice({ lastExportAt: now, lastExportFile: filename, lastExportRevision: revision, lastExportMethod: 'download' });
    toast(`${filename} を書き出しました。Google ドライブなど端末の外に保管してください`, { kind: 'info', duration: 8000 });
  } catch (e) {
    console.error(e);
    toast(`書き出しできませんでした（${e.message}）`, { kind: 'error' });
  }
}

async function exportShare() {
  try {
    const { text, filename, now, revision } = await makeBackup();
    const file = new File([text], filename, { type: 'application/json' });
    if (!navigator.canShare?.({ files: [file] })) {
      toast('この端末では共有で書き出せません。「ダウンロード」を使ってください', { kind: 'error' });
      return;
    }
    await navigator.share({ files: [file], title: `${APP_NAME} バックアップ` });
    await app.store.setDevice({ lastExportAt: now, lastExportFile: filename, lastExportRevision: revision, lastExportMethod: 'share' });
    toast('共有の画面にファイルを渡しました。保存先で保存できたか確認してください', { kind: 'info', duration: 8000 });
  } catch (e) {
    if (e?.name === 'AbortError') return;
    toast(`共有できませんでした（${e.message}）`, { kind: 'error' });
  }
}

function countsTable(current, incoming) {
  return h(
    'table',
    { class: 'table compact' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'right' }, '今のデータ'), h('th', { class: 'right' }, 'ファイル'))),
    h(
      'tbody',
      null,
      COLLECTIONS.map((c) =>
        h(
          'tr',
          null,
          h('th', { scope: 'row' }, LABELS[c]),
          h('td', { class: 'num right' }, current[c].length),
          h('td', { class: 'num right' }, incoming[c].length),
        ),
      ),
    ),
  );
}

async function onRestoreFile(file, rerender) {
  view.restore = null;
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) {
    view.restore = { error: ['ファイルが大きすぎます'] };
    rerender();
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    view.restore = { error: ['ファイルを読み込めませんでした'] };
    rerender();
    return;
  }
  const parsed = parseBackup(text);
  view.restore = parsed.ok ? { parsed, fileName: file.name } : { error: parsed.errors, code: parsed.code, fileName: file.name };
  rerender();
}

async function doRestore(parsed, rerender) {
  const ok = await confirmDialog({
    title: '置き換えて復元しますか？',
    message: 'この端末の今のデータは、ファイルの内容にすべて置き換わります（合わせる・足すことはしません）。',
    okLabel: '置き換えて復元',
    danger: true,
  });
  if (!ok) return;
  try {
    await app.store.replaceAll(parsed.data, { exportedAt: parsed.backup.exportedAt });
  } catch (e) {
    console.error(e);
    await alertDialog({ title: '復元できませんでした', message: `${e.message}。今のデータはそのまま残っています。` });
    return;
  }
  // 保存された内容から集計し直し、書き出し時と一致するか確かめる
  const after = parsed.summary ? summarize(app.store.state, parsed.summary.referenceDate) : null;
  const match = after ? JSON.stringify(after) === JSON.stringify(parsed.summary) : null;
  view.restore = { done: true, match, summary: after, exportedAt: parsed.backup.exportedAt };
  rerender();
}

export function renderSettings() {
  const store = app.store;
  const state = app.state;
  const rerender = () => app.rerender();
  if (view.persisted === null) {
    Store.persistStatus().then((p) => {
      if (p !== view.persisted) {
        view.persisted = p;
        rerender();
      }
    });
    Store.estimate().then((e) => (view.estimate = e));
  }
  const dev = store.device ?? {};
  const changedSinceExport = dev.lastExportAt && dev.lastExportRevision !== undefined && store.revision !== dev.lastExportRevision;

  const storageCard = card(
    cardHead('データの保存場所'),
    h('p', null, 'この端末の、このブラウザの中（IndexedDB）にだけ保存しています。サーバーには送りません。'),
    h(
      'dl',
      { class: 'kv-list' },
      kv(
        'ブラウザによる自動削除',
        view.persisted === true
          ? badge('されにくい設定（永続化済み）', 'ok', 'check')
          : view.persisted === false
            ? badge('ブラウザ次第（永続化なし）', 'warn')
            : '確認中…',
      ),
      kv('最後に保存した日時', store.lastSavedAt ? formatStamp(store.lastSavedAt) : 'この画面を開いてからはまだ保存していません'),
      kv(
        '記録の件数',
        `${state.accounts.length}口座・残高 ${state.snapshots.length}件・お金の動き ${state.events.filter((e) => !e.deletedAt).length}件・部屋 ${state.contracts.length}件`,
      ),
    ),
    h(
      'ul',
      { class: 'bullets small' },
      h('li', null, 'ブラウザのデータ削除、端末の紛失・故障で消えます。守れるのは、端末の外に保管したバックアップまでです。'),
      h('li', null, '別のスマホや別のブラウザでは別のデータです（自動同期はありません）。移すときはバックアップを書き出して、移した先で復元します。'),
    ),
    view.persisted === false
      ? button(
          '自動削除されにくくするよう依頼する',
          async () => {
            const r = await Store.requestPersist();
            view.persisted = r;
            toast(r ? '永続化されました' : 'ブラウザが許可しませんでした（ホーム画面に追加すると許可されやすくなります）', { kind: r ? 'ok' : 'info' });
            rerender();
          },
          { cls: 'btn small' },
        )
      : null,
  );

  const exportCard = card(
    cardHead('バックアップ（書き出し）', { sub: '履歴・ID・月末確定・設定まで含む JSON ファイル' }),
    h(
      'div',
      { class: 'export-status' },
      dev.lastExportAt
        ? h(
            'p',
            null,
            '最後に書き出した日時：',
            h('strong', null, formatStamp(dev.lastExportAt)),
            h('br'),
            h(
              'span',
              { class: 'small muted' },
              `${dev.lastExportFile ?? ''}（${dev.lastExportMethod === 'share' ? '共有の画面に渡した' : 'ダウンロードの操作をした'}日時です。Google ドライブなどへの保存が完了したかは、アプリでは確認できません）`,
            ),
          )
        : h('p', { class: 'warn-text' }, icon('alert', 16), ' まだこの端末から書き出したことがありません。'),
      changedSinceExport ? h('p', { class: 'note-line' }, icon('info', 16), '最後の書き出しのあとに変更があります。') : null,
    ),
    h(
      'div',
      { class: 'card-actions wrap' },
      button('JSONを書き出す（ダウンロード）', exportDownload, { cls: 'btn primary', iconName: 'download' }),
      'share' in navigator ? button('共有して保存（ドライブなど）', exportShare, { cls: 'btn', iconName: 'share' }) : null,
    ),
    h(
      'p',
      { class: 'fine' },
      '書き出したファイルは、Google ドライブなど端末の外に保管してください。本人の金融データが入っているので、人に送らないでください。月末の確定後や、大きな更新のあとに書き出すと安心です。',
    ),
  );

  const restoreCard = card(cardHead('復元（置き換え）', { sub: 'バックアップのファイルで、この端末のデータを置き換えます' }), restoreBody(rerender));

  const theme = segmented(
    [
      ['auto', '端末に合わせる'],
      ['light', 'ひる'],
      ['dark', 'よる'],
    ],
    state.settings.theme,
    async (t) => {
      const res = A.updateSettings(app.state, { theme: t });
      await app.save(res, { silent: true });
    },
    { label: '表示テーマ' },
  );

  const helpCard = card(
    cardHead('使い方と計算のきまり'),
    h('details', { class: 'more' }, h('summary', null, '管理上の純資産とは'), h('div', { class: 'prose' }, HELP.net())),
    h('details', { class: 'more' }, h('summary', null, '月末の確定と前月比'), h('div', { class: 'prose' }, HELP.monthEnd())),
    h('details', { class: 'more' }, h('summary', null, '記録済み支出とごほうび'), h('div', { class: 'prose' }, HELP.spending())),
    h('details', { class: 'more' }, h('summary', null, 'サブスク荘の見込みと支払'), h('div', { class: 'prose' }, HELP.subs())),
    h(
      'details',
      { class: 'more' },
      h('summary', null, 'Android で使い始める'),
      h(
        'ol',
        { class: 'prose' },
        h('li', null, 'Chrome でこのページを開き、メニュー（︙）から「ホーム画面に追加」（または「アプリをインストール」）。追加しなくても使えます。'),
        h('li', null, '「資産」で銀行・投資・奨学金を登録し、確認した残高と、その金額が表す日（基準日）を記録します。'),
        h('li', null, '毎月、前の月末の残高がそろったら「月末チェック」で確定します。'),
        h('li', null, '支出は ＋ ボタンから、金額とカテゴリーだけで記録できます。'),
        h('li', null, 'ときどき「JSONを書き出す」で、端末の外にバックアップを残します。'),
      ),
    ),
  );

  const demoCard = app.demo
    ? card(
        cardHead('デモ（架空データ）'),
        h('p', null, 'いまは本人のデータとは別の「デモ用」の保存場所を使っています。'),
        h(
          'div',
          { class: 'card-actions wrap' },
          button(
            '架空データを入れ直す',
            async () => {
              const ok = await confirmDialog({
                title: 'デモのデータを入れ直しますか？',
                message: 'デモ用の保存場所だけを置き換えます。本人のデータには触れません。',
                okLabel: '入れ直す',
              });
              if (!ok) return;
              await app.store.replaceAll(seedDemo(app.today()));
              toast('架空データを入れました');
            },
            { cls: 'btn' },
          ),
          h('a', { class: 'btn ghost', href: './#/home' }, 'デモを終えて本人のデータへ'),
        ),
      )
    : card(
        cardHead('デモ'),
        h('p', { class: 'small' }, '架空のデータで画面を試せます。本人のデータとは別の場所に保存され、混ざりません。'),
        h('a', { class: 'btn small', href: './?demo=1#/settings', target: '_blank', rel: 'noopener' }, 'デモを別のタブで開く'),
      );

  const dangerCard = card(
    h(
      'details',
      { class: 'more danger-zone' },
      h('summary', null, 'すべてのデータを削除'),
      h(
        'p',
        { class: 'small' },
        'この端末のデータ（口座・残高・記録・サブスク・月末確定・設定）をすべて削除します。元に戻せません。先にバックアップを書き出してください。',
      ),
      button('先にバックアップを書き出す', exportDownload, { cls: 'btn small', iconName: 'download' }),
      button(
        'すべて削除する…',
        async () => {
          let input;
          const ok = await confirmDialog({
            title: '本当にすべて削除しますか？',
            message: '確認のため「削除」と入力してください。',
            okLabel: 'すべて削除',
            danger: true,
            details: h('div', null, (input = h('input', { class: 'text-input', type: 'text', 'aria-label': '確認の入力', autocomplete: 'off' }))),
          });
          if (!ok) return;
          if (input.value.trim() !== '削除') {
            toast('「削除」と入力されなかったので、削除しませんでした', { kind: 'info' });
            return;
          }
          try {
            await app.store.replaceAll(emptyData());
            toast('すべてのデータを削除しました');
          } catch (e) {
            toast(`削除できませんでした（${e.message}）。データはそのまま残っています`, { kind: 'error' });
          }
        },
        { cls: 'btn danger small' },
      ),
    ),
  );

  const moves = state.settings.quickMoves ?? [];
  const movesCard = card(
    cardHead('いつもの動き', { sub: '毎月の振替・積立・返済・給与などのひな形。記録は任意です。' }),
    moves.length
      ? h(
          'ul',
          { class: 'plain-list' },
          moves.map((m) =>
            h(
              'li',
              { class: 'row between' },
              h('span', { class: 'stack tight', style: { gap: '0' } }, h('strong', null, m.label), h('span', { class: 'small muted' }, quickMoveSub(m))),
              button(
                '',
                async () => {
                  const ok = await confirmDialog({
                    title: `「${m.label}」を消しますか？`,
                    message: 'ひな形だけを消します。記録済みのお金の動きはそのまま残ります。',
                    okLabel: '消す',
                    danger: true,
                  });
                  if (!ok) return;
                  await app.save(A.removeQuickMove(app.state, m.id), { okMessage: '消しました' });
                },
                { cls: 'icon-btn', iconName: 'trash', label: `${m.label}を消す` },
              ),
            ),
          ),
        )
      : h('p', { class: 'small muted' }, '「記録」の「入金・振替・返済など」で、記録するときに「いつもの動きに登録」を選ぶと、ここに並びます。'),
    state.accounts.length === 0 ? button('はじめの準備をする', () => openSetupSheet(), { cls: 'btn small', iconName: 'sparkle' }) : null,
  );

  return h(
    'div',
    { class: 'page' },
    pageTitle('設定・データ', { kicker: 'KANRININSHITSU' }),
    cols([exportCard, restoreCard, movesCard], [storageCard, card(cardHead('表示'), theme.el), helpCard, demoCard, dangerCard, aboutCard()]),
  );
}

function aboutCard() {
  return card(
    cardHead('このアプリについて'),
    h('dl', { class: 'kv-list' }, kv('名前', APP_NAME), kv('版', APP_VERSION), kv('データの版', String(SCHEMA_VERSION))),
    h(
      'p',
      { class: 'fine' },
      'GitHub Pages から配信される画面と、この端末の保存領域だけで動きます。日々の利用に有料の契約やサーバーは不要です。金融機関のID・パスワードは扱いません。',
    ),
    button('更新を確認', () => window.__checkForUpdate?.(), { cls: 'btn small' }),
  );
}

function restoreBody(rerender) {
  const r = view.restore;
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'file-input', 'aria-label': 'バックアップのファイルを選ぶ' });
  fileInput.addEventListener('change', () => onRestoreFile(fileInput.files?.[0], rerender));
  const picker = h('label', { class: 'btn' }, icon('upload', 18), 'ファイルを選ぶ', fileInput);
  if (!r) return [h('p', { class: 'small' }, 'ファイルを選んでも、すぐには書き換えません。中身を確かめてから、置き換えるかどうかを選べます。'), picker];
  if (r.error) {
    return [
      h(
        'div',
        { class: 'error-box', role: 'alert' },
        h('p', null, h('strong', null, '復元できないファイルです。'), ' 今のデータには何も変更していません。'),
        h(
          'ul',
          null,
          r.error.slice(0, 8).map((e) => h('li', null, e)),
        ),
      ),
      picker,
    ];
  }
  if (r.done) {
    return [
      h(
        'div',
        { class: r.match === false ? 'error-box' : 'ok-box', role: 'status' },
        h('p', null, h('strong', null, '復元しました。')),
        r.match === true
          ? h(
              'p',
              null,
              '保存し直した内容から集計し直し、書き出したときの集計（件数・残高・月末確定・支出・ごほうび・サブスクの見込み）と一致することを確かめました。',
            )
          : null,
        r.match === false ? h('p', null, '集計が書き出し時と一致しませんでした。元のファイルを保管したまま、もう一度お試しください。') : null,
        r.summary
          ? h(
              'dl',
              { class: 'kv-list' },
              kv('書き出した日時', formatStamp(r.exportedAt)),
              kv('記録済み支出（全期間）', formatYen(r.summary.expenseTotal)),
              kv('最新の管理上の純資産（書き出し日基準）', formatYen(r.summary.latest.net)),
              kv('月末確定の月数', String(Object.keys(r.summary.closes).length)),
            )
          : null,
      ),
      picker,
    ];
  }
  const { parsed } = r;
  const understood = checkbox('今のデータがすべてファイルの内容に置き換わることを理解しました', false);
  const go = button('置き換えて復元する', () => doRestore(parsed, rerender), { cls: 'btn danger', disabled: true });
  understood.input.addEventListener('change', () => (go.disabled = !understood.get()));
  return [
    h(
      'div',
      { class: 'ok-box' },
      h('p', null, h('strong', null, '読み込めるファイルです。'), ` ${r.fileName}`),
      h('p', { class: 'small' }, `書き出した日時：${formatStamp(parsed.backup.exportedAt)}`),
    ),
    countsTable(app.state, parsed.data),
    h('p', { class: 'small' }, '復元は「置き換え」です。今のデータとファイルを合わせることはしません。念のため、先に今のデータを書き出しておけます。'),
    h('div', { class: 'card-actions wrap' }, button('今のデータを先に書き出す', exportDownload, { cls: 'btn', iconName: 'download' })),
    understood.el,
    h(
      'div',
      { class: 'card-actions wrap' },
      go,
      button('やめる', () => ((view.restore = null), rerender()), { cls: 'btn ghost' }),
    ),
  ];
}
