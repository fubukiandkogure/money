// 日付は Asia/Tokyo で区切る。
// 日本時間には夏時間がないため、UTC+9 の固定オフセットで暦日を求める。
// （UTC の ISO 文字列をそのまま切り出して日付・月を判定することはしない）

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');

function jstParts(now) {
  const d = new Date(now.getTime() + JST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    ss: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
  };
}

/** 日本時間の今日 'YYYY-MM-DD' */
export function todayJST(now = new Date()) {
  const p = jstParts(now);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** 日本時間の時差付きタイムスタンプ 'YYYY-MM-DDTHH:mm:ss.sss+09:00' */
export function nowStampJST(now = new Date()) {
  const p = jstParts(now);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}.${pad3(p.ms)}+09:00`;
}

/** タイムスタンプ（時差付き）→ 日本時間の日付 */
export function stampToDateJST(stamp) {
  const t = Date.parse(stamp);
  if (Number.isNaN(t)) return null;
  return todayJST(new Date(t));
}

export function isValidStamp(stamp) {
  return typeof stamp === 'string' && /T.*(Z|[+-]\d{2}:\d{2})$/.test(stamp) && !Number.isNaN(Date.parse(stamp));
}

export function isValidDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(`${m[1]}-${m[2]}`);
}

export function isValidMonth(s) {
  if (typeof s !== 'string') return false;
  const m = MONTH_RE.exec(s);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  return y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12;
}

export function monthOf(date) {
  return date.slice(0, 7);
}

export function yearOf(dateOrMonth) {
  return dateOrMonth.slice(0, 4);
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function firstDayOfMonth(ym) {
  return `${ym}-01`;
}

export function lastDayOfMonth(ym) {
  return `${ym}-${pad2(daysInMonth(ym))}`;
}

export function isLastDayOfMonth(date) {
  return isValidDate(date) && date === lastDayOfMonth(monthOf(date));
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

export const prevMonth = (ym) => addMonths(ym, -1);
export const nextMonth = (ym) => addMonths(ym, 1);

/** b - a（月数） */
export function monthDiff(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return yb * 12 + mb - (ya * 12 + ma);
}

/** a〜b（両端含む）の月の配列 */
export function monthRange(a, b) {
  const out = [];
  if (monthDiff(a, b) < 0) return out;
  for (let ym = a; ym <= b; ym = nextMonth(ym)) out.push(ym);
  return out;
}

function toUTC(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(date, n) {
  return fromUTC(toUTC(date) + n * 86400000);
}

/** b - a（日数） */
export function dayDiff(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** 0=日 … 6=土 */
export function weekday(date) {
  return new Date(toUTC(date)).getUTCDay();
}

/** 月曜始まりの週の初日 */
export function weekStart(date) {
  const wd = weekday(date);
  return addDays(date, -((wd + 6) % 7));
}

/** 'YYYY-MM' の月に day 日を当てはめる（月末を超える日は月末に寄せる） */
export function dateInMonth(ym, day) {
  const d = Math.min(Math.max(1, day), daysInMonth(ym));
  return `${ym}-${pad2(d)}`;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

/** 10/3（金） */
export function formatDateShort(date, { weekdayLabel = false } = {}) {
  if (!date) return '—';
  const [, m, d] = date.split('-').map(Number);
  return weekdayLabel ? `${m}/${d}（${WD[weekday(date)]}）` : `${m}/${d}`;
}

/** 2026/10/3 */
export function formatDateLong(date) {
  if (!date) return '—';
  const [y, m, d] = date.split('-').map(Number);
  return `${y}/${m}/${d}`;
}

/** 2026年10月 */
export function formatMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 10月 */
export function formatMonthShort(ym) {
  return `${Number(ym.slice(5, 7))}月`;
}

/** タイムスタンプ → 2026/10/5 12:34（日本時間） */
export function formatStamp(stamp) {
  if (!stamp) return '—';
  const t = Date.parse(stamp);
  if (Number.isNaN(t)) return '—';
  const p = jstParts(new Date(t));
  return `${p.y}/${p.m}/${p.d} ${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** 今日からの経過日数の短い表現 */
export function relativeDays(date, today) {
  const n = dayDiff(date, today);
  if (n === 0) return '今日';
  if (n === 1) return '昨日';
  if (n > 0) return `${n}日前`;
  return `${-n}日後`;
}
