// チリツモの絵（装飾。数字の根拠を表すものではない）
import { h, svgFromString } from './dom.js';
import { wordmarkSvg, appIconSvg, mountainMarkup } from './pixel.js';

/** ロゴ（山のしるし＋文字）。昼と夜の2枚を用意して、テーマで切り替える */
export function wordmark({ scale = 2, mark = true } = {}) {
  return h('span', { class: 'wordmark' }, svgFromString(wordmarkSvg({ scale, mark })), svgFromString(wordmarkSvg({ scale, mark, night: true })));
}

/** アプリのアイコン（墨の地に金の山） */
export function logo(size = 32) {
  const el = svgFromString(appIconSvg({ size }));
  el.classList.add('logo');
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** 日本時間の時刻から空の様子 */
export function skyPhase(date = new Date()) {
  const hour = new Date(date.getTime() + 9 * 3600 * 1000).getUTCHours();
  if (hour >= 5 && hour < 9) return 'morning';
  if (hour >= 9 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'evening';
  return 'night';
}

/**
 * チリツモ山：月末を確定した月の数だけ地層が積もる。最新の月末が確定していると旗が立つ。
 * 金額の大小は表さない（純資産が減った月も、確定すれば1段）。
 */
export function mountain({ phase, layers, flag }) {
  return svgFromString(mountainMarkup({ phase, layers, flag }));
}
