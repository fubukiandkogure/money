// 金額は「円単位の整数」だけを扱う。浮動小数・NaN・Infinity・桁あふれは受け付けない。

/** 1件の金額として受け付ける上限（1兆円未満）。合計しても安全な整数範囲に十分収まる。 */
export const MAX_YEN = 999_999_999_999;

export function isYen(v) {
  return Number.isSafeInteger(v) && Math.abs(v) <= MAX_YEN;
}

const FULLWIDTH_DIGITS = /[０-９]/g;
const MINUS_CHARS = /^[-−ー－]/;

/**
 * 入力欄の文字列を円単位の整数にする。
 * カンマ・空白・「円」「¥」は入力補助として取り除く。小数や記号混じりは拒否する。
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
export function parseYenInput(raw, { allowZero = true, allowNegative = false } = {}) {
  if (raw === null || raw === undefined) return { ok: false, error: '金額を入力してください' };
  let s = String(raw)
    .replace(FULLWIDTH_DIGITS, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s,，、]/g, '')
    .replace(/^[¥￥]/, '')
    .replace(/円$/, '');
  if (s === '') return { ok: false, error: '金額を入力してください' };
  let negative = false;
  if (MINUS_CHARS.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+$/.test(s)) {
    if (/^\d*[.．]\d*$/.test(s)) return { ok: false, error: '円単位の整数で入力してください' };
    return { ok: false, error: '数字で入力してください' };
  }
  if (s.length > 12) return { ok: false, error: '金額が大きすぎます' };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n > MAX_YEN) return { ok: false, error: '金額が大きすぎます' };
  if (negative && n !== 0) {
    if (!allowNegative) return { ok: false, error: 'マイナスの金額は入力できません' };
    return { ok: true, value: -n };
  }
  if (n === 0 && !allowZero) return { ok: false, error: '1円以上で入力してください' };
  return { ok: true, value: n };
}

/** 整数の合計。途中で安全な整数範囲を超えたら例外にする（黙って誤差を出さない）。 */
export function sumYen(values) {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new RangeError(`金額が整数ではありません: ${v}`);
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError('合計が扱える範囲を超えました');
  }
  return total;
}

const nf = new Intl.NumberFormat('ja-JP');

/** ¥1,234 / −¥1,234 */
export function formatYen(v) {
  if (v === null || v === undefined) return '—';
  if (v < 0) return `−¥${nf.format(-v)}`;
  return `¥${nf.format(v)}`;
}

/** 増減表示：+¥70,000 / −¥20,000 / ±¥0 */
export function formatDelta(v) {
  if (v === null || v === undefined) return '—';
  if (v > 0) return `+¥${nf.format(v)}`;
  if (v < 0) return `−¥${nf.format(-v)}`;
  return '±¥0';
}

/** 入力欄の表示用（カンマ区切り、記号なし） */
export function formatPlain(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return nf.format(v);
}

/**
 * 割合（%）。分母0は null（未算出）。表示用に小数1桁へ丸める前の値を返す。
 * 整数の比から計算するので、表示直前まで丸めない。
 */
export function ratioPercent(part, whole) {
  if (!whole) return null;
  return (part * 100) / whole;
}

export function formatPercent(p, digits = 1) {
  if (p === null || p === undefined) return '未算出';
  const f = Math.round(p * 10 ** digits) / 10 ** digits;
  return `${f.toFixed(digits).replace(/\.0+$/, '')}%`;
}

/** 年額（整数）から月額相当を表示用に丸める。丸めは最後に1回だけ。 */
export function monthlyFromAnnual(annualYen) {
  return Math.round(annualYen / 12);
}
