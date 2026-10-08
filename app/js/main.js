// 起動・画面の切り替え・テーマ・Service Worker
import { app } from './app.js';
import { h, replace } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { logo, wordmark } from './ui/art.js';
import { toast, sheetsOpen, confirmDialog } from './ui/overlay.js';
import { Store, LoadError, openForRescue } from './data/store.js';
import { APP_ID, APP_NAME, DB_NAME, DEMO_DB_NAME, SCHEMA_VERSION } from './core/constants.js';
import { nowStampJST, formatStamp } from './core/dates.js';
import { parseBackup } from './core/backup.js';
import { renderHome } from './views/home.js';
import { renderAssets, renderAccount, renderMonth } from './views/assets.js';
import { renderRecords } from './views/records.js';
import { renderReport } from './views/report.js';
import { renderSubs, renderContract } from './views/subs.js';
import { renderSettings, downloadText } from './views/settings.js';
import { openExpenseSheet } from './ui/forms/expense.js';

const params = new URLSearchParams(location.search);
app.demo = params.has('demo');
const THEME_KEY = `${APP_ID}:theme${app.demo ? ':demo' : ''}`;

const ROUTES = [
  [/^\/(home)?$/, () => renderHome(), 'home'],
  [/^\/assets$/, () => renderAssets(), 'assets'],
  [/^\/assets\/account\/(.+)$/, (m) => renderAccount(decodeURIComponent(m[1])), 'assets'],
  [/^\/assets\/month\/(\d{4}-\d{2})$/, (m) => renderMonth(m[1]), 'assets'],
  [/^\/records(?:\/(\d{4}-\d{2}))?$/, (m) => renderRecords(m[1]), 'records'],
  [/^\/report(?:\/(assets|spending))?$/, (m) => renderReport(m[1] ?? 'assets'), 'report'],
  [/^\/subs(?:\/(\d{4}-\d{2}))?$/, (m) => renderSubs(m[1]), 'subs'],
  [/^\/subs\/(.+)$/, (m) => renderContract(decodeURIComponent(m[1])), 'subs'],
  [/^\/settings$/, () => renderSettings(), 'settings'],
];

const TABS = [
  ['home', '#/home', 'ホーム', 'home'],
  ['assets', '#/assets', '資産', 'kura'],
  ['records', '#/records', '記録', 'book'],
  ['report', '#/report', '振り返り', 'chart'],
  ['subs', '#/subs', 'サブスク荘', 'apartment'],
];

const TITLES = { home: 'ホーム', assets: '資産', records: '記録', report: '振り返り', subs: 'サブスク荘', settings: '設定' };

let main;
let tabbar;
let fab;

function shell() {
  main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
  tabbar = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'メインメニュー' },
    // 開いた画面（左のメニュー）でだけ見えるアイコン
    h('a', { class: 'rail-brand', href: '#/home', 'aria-label': `${APP_NAME} ホーム`, tabindex: '-1' }, logo(44)),
    TABS.map(([key, href, label, ic]) => h('a', { href, class: 'tab-link', dataset: { tab: key } }, icon(ic, 24), h('span', null, label))),
    h('a', { href: '#/settings', class: 'tab-link rail-settings', dataset: { tab: 'settings' } }, icon('gear', 24), h('span', null, '設定')),
  );
  fab = h(
    'button',
    { class: 'fab', type: 'button', 'aria-label': '支出を記録', onclick: () => openExpenseSheet() },
    icon('plus', 24),
    h('span', { 'aria-hidden': 'true' }, '支出'),
  );
  const top = h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: '#/home', 'aria-label': `${APP_NAME} ホーム` }, wordmark({ scale: 2 })),
    app.demo ? h('span', { class: 'demo-flag' }, 'デモ（架空データ）') : null,
    h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': '設定・データ管理' }, icon('gear')),
  );
  replace(document.getElementById('app'), top, main, fab, tabbar);
}

function currentPath() {
  const raw = location.hash.replace(/^#/, '');
  return raw === '' ? '/home' : raw.split('?')[0];
}

function render({ scroll = false } = {}) {
  if (!main) return;
  const path = currentPath();
  let node;
  let tab = 'home';
  try {
    const route = ROUTES.find(([re]) => re.test(path));
    if (!route) {
      node = h(
        'div',
        { class: 'page' },
        h('div', { class: 'card' }, h('p', null, 'ページが見つかりません。'), h('a', { class: 'btn', href: '#/home' }, 'ホームへ')),
      );
    } else {
      const m = path.match(route[0]);
      tab = route[2];
      node = route[1](m);
    }
  } catch (e) {
    console.error(e);
    node = h(
      'div',
      { class: 'page' },
      h(
        'div',
        { class: 'card error-box', role: 'alert' },
        h('p', null, h('strong', null, '画面の表示中に問題が起きました。'), ' データは変更していません。'),
        h('p', { class: 'small' }, String(e?.message ?? e)),
        h('a', { class: 'btn', href: '#/home' }, 'ホームへ'),
      ),
    );
  }
  main.replaceChildren(node);
  for (const a of tabbar.querySelectorAll('.tab-link')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  fab.hidden = !['home', 'records', 'report'].includes(tab);
  document.title = `${TITLES[tab] ?? ''}｜${APP_NAME}${app.demo ? '（デモ）' : ''}`;
  if (scroll) {
    window.scrollTo(0, 0);
    if (sheetsOpen() === 0) main.focus({ preventScroll: true });
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* 端末ごとの表示の記憶。保存できなくても問題ない */
  }
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101114' : '#f3f1eb');
}

/** 読み込みエラーの画面から、検証済みのバックアップで置き換える（壊れたデータを直す手段） */
function rescueRestoreBox() {
  const status = h('div', { role: 'status' });
  const input = h('input', { type: 'file', accept: '.json,application/json', class: 'file-input', 'aria-label': 'バックアップのファイルを選ぶ' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      status.replaceChildren(
        h(
          'div',
          { class: 'error-box' },
          h('p', null, '復元できないファイルです。何も変更していません。'),
          h(
            'ul',
            null,
            parsed.errors.slice(0, 6).map((e) => h('li', null, e)),
          ),
        ),
      );
      return;
    }
    const ok = await confirmDialog({
      title: 'バックアップで置き換えますか？',
      message: `${formatStamp(parsed.backup.exportedAt)} に書き出したバックアップで、この端末のデータ（読み込めなかったもの）をすべて置き換えます。必要なら先に「中身をそのまま書き出す」で保存してください。`,
      okLabel: '置き換えて復元',
      danger: true,
    });
    if (!ok) return;
    try {
      const s = await openForRescue(app.demo ? DEMO_DB_NAME : DB_NAME);
      await s.replaceAll(parsed.data, { exportedAt: parsed.backup.exportedAt });
      location.reload();
    } catch (e) {
      status.replaceChildren(h('div', { class: 'error-box' }, h('p', null, `置き換えできませんでした（${e.message}）。元のデータはそのままです。`)));
    }
  });
  return h(
    'div',
    { class: 'stack tight' },
    h('p', { class: 'small' }, '端末の外に保管したバックアップ（JSON）があれば、それで置き換えて使い続けられます。ファイルは中身を確かめてから使います。'),
    h('label', { class: 'btn' }, icon('upload', 18), 'バックアップから復元…', input),
    status,
  );
}

function showLoadError(err) {
  const details = err instanceof LoadError ? err.details : [];
  const box = h(
    'main',
    { class: 'main page' },
    h(
      'div',
      { class: 'card error-box', role: 'alert' },
      h('h1', { class: 'page-title' }, '保存データを読み込めませんでした'),
      h('p', null, err.message ?? String(err)),
      h('p', null, 'データを初期化したり、見本のデータで置き換えたりはしていません。'),
      details.length
        ? h(
            'details',
            { class: 'more' },
            h('summary', null, `くわしい内容（${details.length}件）`),
            h(
              'ul',
              { class: 'small' },
              details.slice(0, 20).map((d) => h('li', null, d)),
            ),
          )
        : null,
      h(
        'div',
        { class: 'card-actions wrap' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, '再読み込み'),
        err.kind === 'corrupt'
          ? h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => {
                  try {
                    const s = await openForRescue(app.demo ? DEMO_DB_NAME : DB_NAME);
                    const dump = await s.rescueDump();
                    const now = nowStampJST();
                    downloadText(
                      `${APP_ID}-rescue-${now.slice(0, 10)}.json`,
                      JSON.stringify({ appId: APP_ID, rescue: true, schemaVersion: SCHEMA_VERSION, exportedAt: now, data: dump }, null, 1),
                    );
                  } catch (e) {
                    toast(`取り出せませんでした（${e.message}）`, { kind: 'error' });
                  }
                },
              },
              '中身をそのまま書き出す（調査用）',
            )
          : null,
      ),
      err.kind === 'corrupt'
        ? rescueRestoreBox()
        : h('p', { class: 'fine' }, 'ページを再読み込みしても直らない場合は、ブラウザを最新にしてからもう一度開いてください。'),
    ),
  );
  replace(document.getElementById('app'), box);
}

let swReg = null;
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      swReg = reg;
    })
    .catch((e) => console.warn('service worker', e));
  window.__checkForUpdate = async () => {
    if (!swReg) {
      toast('この環境では更新の確認ができません', { kind: 'info' });
      return;
    }
    try {
      await swReg.update();
      toast('最新の画面を確認しました。変わっていれば、次に開いたときから新しい版になります', { kind: 'info' });
    } catch {
      toast('いまは更新を確認できません（オフラインかもしれません）', { kind: 'info' });
    }
  };
}

async function boot() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
  } catch {
    /* 無視 */
  }
  const store = new Store({
    dbName: app.demo ? DEMO_DB_NAME : DB_NAME,
    onExternalChange: (err) => {
      if (err) toast('別のタブの変更を読み込めませんでした。ページを再読み込みしてください', { kind: 'error' });
      else toast('別のタブで保存された変更を読み込みました', { kind: 'info' });
    },
    onVersionChange: () => toast('アプリが更新されました。ページを再読み込みしてください', { kind: 'error' }),
  });
  try {
    await store.open();
  } catch (e) {
    console.error(e);
    showLoadError(e);
    return;
  }
  app.store = store;
  app.rerender = () => render();
  shell();
  applyTheme(store.state.settings.theme);
  store.subscribe((state) => {
    applyTheme(state.settings.theme);
    render();
  });
  window.addEventListener('hashchange', () => render({ scroll: true }));
  render({ scroll: true });
  let lastDay = app.today();
  setInterval(() => {
    const d = app.today();
    if (d !== lastDay) {
      lastDay = d;
      render();
    }
  }, 60_000);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(store.state.settings.theme));
  if (!app.demo) Store.requestPersist();
  registerServiceWorker();
  if (app.demo && store.state.accounts.length === 0) {
    const { seedDemo } = await import('./demo.js');
    await store.replaceAll(seedDemo(app.today()));
    toast('デモ用の架空データを入れました（本人のデータとは別の場所です）', { kind: 'info' });
  }
  document.documentElement.dataset.ready = '1';
}

boot();
