// ふところ町の Service Worker。
// - 自分の担当パス（このファイルのあるディレクトリ）と、自分のキャッシュ（futokoro-machi-shell-*）だけを扱う
// - 同じドメインの別アプリ（例：/subseat/）のキャッシュや保存データには触れない
// - 入力データは IndexedDB にあり、ここでは扱わない（更新でデータは消えない）
// - 通信できるときは最新の画面を取り、オフラインのときだけ保存した画面を使う

const VERSION = '1.1.0';
const CACHE_PREFIX = 'futokoro-machi-shell-';
const CACHE = `${CACHE_PREFIX}${VERSION}`;
// 書体は版をまたいで使い回す（中身が変わったら名前の数字を上げる）
const FONT_CACHE = 'futokoro-machi-fonts-1';
const SCOPE = new URL('./', self.location).href;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './fonts/fonts.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/main.js',
  './js/app.js',
  './js/demo.js',
  './js/core/actions.js',
  './js/core/apply.js',
  './js/core/assets.js',
  './js/core/backup.js',
  './js/core/closes.js',
  './js/core/constants.js',
  './js/core/dates.js',
  './js/core/ids.js',
  './js/core/money.js',
  './js/core/spending.js',
  './js/core/subs.js',
  './js/core/validate.js',
  './js/data/store.js',
  './js/ui/art.js',
  './js/ui/charts.js',
  './js/ui/dom.js',
  './js/ui/fields.js',
  './js/ui/icons.js',
  './js/ui/overlay.js',
  './js/ui/parts.js',
  './js/ui/forms/assets.js',
  './js/ui/forms/event.js',
  './js/ui/forms/expense.js',
  './js/ui/forms/setup.js',
  './js/ui/forms/subs.js',
  './js/views/assets.js',
  './js/views/home.js',
  './js/views/records.js',
  './js/views/report.js',
  './js/views/settings.js',
  './js/views/subs.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!req.url.startsWith(SCOPE)) return;
  const url = new URL(req.url);
  // 書体の分割ファイルは中身が変わらないので、一度読んだものを使う（使う文字の分だけ読み込まれる）
  if (url.href.startsWith(`${SCOPE}fonts/`) && url.pathname.endsWith('.woff2')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(FONT_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }
  // 画面（index.html）を開くときはクエリ（?demo=1 など）を無視してキャッシュを探す
  const isNav = req.mode === 'navigate';
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const net = fetch(req).then((res) => {
        if (res.ok && url.origin === self.location.origin) cache.put(isNav ? './index.html' : req, res.clone());
        return res;
      });
      try {
        // 通信が遅いときは、保存した画面があればそれを先に使う
        return await Promise.race([net, timeout(5000)]);
      } catch {
        const hit = isNav ? await cache.match('./index.html') : await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        return net;
      }
    })(),
  );
});
