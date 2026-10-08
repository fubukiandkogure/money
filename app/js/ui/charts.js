// 縦棒グラフ（SVG）。欠測の月は棒を描かず「未確定」「記録なし」と示す（0円や補間で埋めない）。
// 色は CSS 変数（--viz-1, --viz-2）。文字は文字用の色。ホバー／フォーカスで値を表示し、同じ値は表でも読める。

import { h, s } from './dom.js';
import { formatYen } from '../core/money.js';

export function compactYen(v) {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e8) return `${sign}${trim(a / 1e8)}億`;
  if (a >= 1e4) return `${sign}${trim(a / 1e4)}万`;
  return `${sign}${a.toLocaleString('ja-JP')}`;
}
function trim(x) {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function niceStep(range, target = 4) {
  if (range <= 0) return 1;
  const raw = range / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/**
 * @param {object} o
 * @param {{key, label, parts: {value, cls, name}[] | null, missingLabel?: string, tip?: string}[]} o.items
 * @param {string} o.title  グラフの説明（aria-label）
 * @param {{cls, name}[]} [o.legend]
 */
export function columnChart({ items, title, legend, height = 180, emphasizeLast = true }) {
  const W = 340;
  const H = height;
  const padL = 40;
  const padR = 8;
  const padT = 18;
  const padB = 22;
  const totals = items.filter((i) => i.parts).map((i) => i.parts.reduce((a, p) => a + p.value, 0));
  let max = Math.max(0, ...totals);
  let min = Math.min(0, ...totals);
  if (max === min) max = min + 1;
  const step = niceStep(max - min);
  max = Math.ceil(max / step) * step;
  min = Math.floor(min / step) * step;
  const y = (v) => padT + ((max - v) / (max - min)) * (H - padT - padB);
  const band = (W - padL - padR) / Math.max(1, items.length);
  const barW = Math.min(24, band * 0.62);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': title });
  // 目盛り（細い実線）
  for (let v = min; v <= max + step / 2; v += step) {
    svg.append(s('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: v === 0 ? 'chart-base' : 'chart-grid' }));
    svg.append(s('text', { x: padL - 6, y: y(v) + 3.5, class: 'chart-tick', 'text-anchor': 'end' }, v === 0 ? '0' : compactYen(v)));
  }
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip', role: 'tooltip', hidden: true });
  const showTip = (g, text) => {
    tip.textContent = text;
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    const gr = g.getBoundingClientRect();
    const left = Math.min(Math.max(gr.left - wr.left + gr.width / 2, 60), wr.width - 60);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, gr.top - wr.top - 8)}px`;
  };
  const hideTip = () => (tip.hidden = true);

  items.forEach((it, i) => {
    const cx = padL + band * i + band / 2;
    const g = s('g', { class: 'chart-col', tabindex: 0 });
    // ヒット領域（棒より大きい）
    g.append(s('rect', { x: padL + band * i, y: padT, width: band, height: H - padT - padB, class: 'chart-hit' }));
    let label;
    if (!it.parts) {
      g.append(s('text', { x: cx, y: y(0) - 4, class: 'chart-missing', 'text-anchor': 'middle' }, it.missingShort ?? '—'));
      label = `${it.label}：${it.missingLabel ?? 'データなし'}`;
    } else {
      let acc = 0;
      const total = it.parts.reduce((a, p) => a + p.value, 0);
      const visible = it.parts.filter((p) => p.value !== 0);
      visible.forEach((p, idx) => {
        const from = acc;
        acc += p.value;
        const top = Math.min(y(from), y(acc));
        const bottom = Math.max(y(from), y(acc));
        const isEnd = idx === visible.length - 1;
        const gap = idx > 0 ? 1 : 0; // 積み重ねの間に2pxの面の隙間（上下1pxずつ）
        const hgt = Math.max(0, bottom - top - gap * 2);
        const yy = top + gap;
        if (hgt <= 0) return;
        if (isEnd && hgt > 4) {
          // データ側の端だけ4pxの角丸
          const r = 4;
          const neg = total < 0;
          const x0 = cx - barW / 2;
          const x1 = cx + barW / 2;
          const d = neg
            ? `M${x0},${yy} H${x1} V${yy + hgt - r} Q${x1},${yy + hgt} ${x1 - r},${yy + hgt} H${x0 + r} Q${x0},${yy + hgt} ${x0},${yy + hgt - r} Z`
            : `M${x0},${yy + hgt} V${yy + r} Q${x0},${yy} ${x0 + r},${yy} H${x1 - r} Q${x1},${yy} ${x1},${yy + r} V${yy + hgt} Z`;
          g.append(s('path', { d, class: p.cls }));
        } else {
          g.append(s('rect', { x: cx - barW / 2, y: yy, width: barW, height: hgt, class: p.cls }));
        }
      });
      label = `${it.label}：${it.tip ?? formatYen(total)}`;
      if (emphasizeLast && i === items.length - 1 - [...items].reverse().findIndex((x) => x.parts)) {
        const ty = total >= 0 ? y(total) - 5 : y(total) + 12;
        g.append(s('text', { x: cx, y: ty, class: 'chart-value', 'text-anchor': 'middle' }, compactYen(total)));
      }
    }
    g.append(s('text', { x: cx, y: H - 6, class: 'chart-x', 'text-anchor': 'middle' }, it.short ?? it.label));
    g.setAttribute('aria-label', label);
    g.addEventListener('pointerenter', () => showTip(g, label));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('focus', () => showTip(g, label));
    g.addEventListener('blur', hideTip);
    svg.append(g);
  });
  wrap.append(svg, tip);
  if (legend?.length > 1) {
    wrap.append(
      h(
        'div',
        { class: 'chart-legend' },
        legend.map((l) => h('span', { class: 'legend-item' }, h('span', { class: ['legend-swatch', l.cls], 'aria-hidden': 'true' }), l.name)),
      ),
    );
  }
  return wrap;
}

/** カテゴリー別の横棒（表＋棒。8分類は色ではなく行の名前で区別する） */
export function barList(rows, { total }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h(
    'ul',
    { class: 'barlist' },
    rows.map((r) =>
      h(
        'li',
        { class: ['barlist-row', r.value === 0 && 'zero'] },
        r.tile ?? null,
        h('span', { class: 'barlist-name' }, r.name),
        h('span', { class: 'barlist-val num' }, formatYen(r.value)),
        h('span', { class: 'barlist-pct num' }, r.pct),
        h(
          'span',
          { class: 'barlist-track', 'aria-hidden': 'true' },
          h('span', { class: 'barlist-fill', style: { width: `${total ? (r.value / max) * 100 : 0}%` } }),
        ),
        r.sub ? h('span', { class: 'barlist-sub' }, r.sub) : null,
      ),
    ),
  );
}
