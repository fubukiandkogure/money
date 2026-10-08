// サブスク荘の外観（姉妹アプリ「サブスク荘」と同じ建物）。1契約＝1部屋。
// 窓：入居中はカーテン（夜は明かり）、内見中は角にリボン、退去予定はテープ、空室はガラスだけ。
// 色は CSS（.fa-*）で決めるので、テーマを切り替えても描き直さずに昼と夜が入れ替わる。
import { svgFromString, s } from './dom.js';
import { wordSvg, textWidth } from './pixel.js';
import { ROOMS_PER_FLOOR } from '../core/subs.js';

const W = 360;
const FH = 46;
const UW = 66;
const BX = 20;
const r1 = (n) => Math.round(n * 10) / 10;

/** 部屋ごとのカーテンの色（6色。部屋番号で決まる） */
export const curtainOf = (no) => ((Math.floor(no / 100) - 1) * 4 + (no % 100) - 1) % 6;
const STARS = [
  [18, 10],
  [52, 22],
  [88, 8],
  [130, 18],
  [170, 6],
  [205, 24],
  [240, 12],
  [300, 20],
  [338, 8],
  [112, 30],
  [262, 30],
  [348, 30],
];

/**
 * 窓を押すとその部屋へ。読み上げとキーボードでは、下の部屋の一覧（同じリンク）を使う。
 * @param {{no: number, href: string, label: string, state: 'active'|'trial'|'leaving'|'ended'|'scheduled'}[]} rooms
 */
export function facade(rooms) {
  const byNo = new Map(rooms.map((r) => [r.no, r]));
  const floors = Math.max(2, ...rooms.map((r) => Math.floor(r.no / 100)));
  const bw = UW * ROOMS_PER_FLOOR;
  const TOP = 40;
  const ground = TOP + floors * FH;
  const H = ground + 14;
  const bottomOf = (f) => TOP + (floors - f + 1) * FH;
  const out = [];

  out.push(`<rect class="fa-sky" width="${W}" height="${H}"/>`);
  out.push(
    `<g class="fa-night">${STARS.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.9 : 1.4}" fill="#fff" opacity="${i % 2 ? 0.55 : 0.85}"/>`).join('')}`,
  );
  out.push(`<circle cx="322" cy="18" r="9" fill="#ffe7a8"/><circle class="fa-moon-cut" cx="326" cy="15" r="8"/></g>`);
  out.push(
    `<g class="fa-day" fill="#fff" opacity="0.85"><ellipse cx="58" cy="16" rx="18" ry="6"/><ellipse cx="70" cy="12" rx="11" ry="6"/><ellipse cx="276" cy="20" rx="15" ry="5"/><ellipse cx="286" cy="16" rx="9" ry="5"/></g>`,
  );
  out.push(`<rect class="fa-ground" x="0" y="${ground}" width="${W}" height="14"/>`);

  // 屋根・板張りの壁
  out.push(`<polygon class="fa-roof" points="${BX - 10},${TOP} ${BX + bw + 10},${TOP} ${BX + bw - 2},${TOP - 11} ${BX + 2},${TOP - 11}"/>`);
  out.push(`<rect class="fa-wall" x="${BX}" y="${TOP}" width="${bw}" height="${floors * FH}"/>`);
  for (let y = TOP + 6; y < ground; y += 6) out.push(`<line class="fa-wall-line" x1="${BX}" y1="${y}" x2="${BX + bw}" y2="${y}"/>`);

  // 屋根の上の看板（ドット文字）
  const sx = BX + bw / 2 - 38;
  const sy = TOP - 29;
  out.push(`<rect class="fa-sign" x="${sx}" y="${sy}" width="76" height="18" rx="3"/>`);
  const sign = (cls, ink, shadow) =>
    wordSvg('サブスク荘', { ink, shadow, cls, x: sx + 6, y: sy + 3, width: 64, height: r1((64 * 13) / textWidth('サブスク荘')) });
  out.push(sign('fa-day', '#2b2420', '#f0b44a'));
  out.push(sign('fa-night fa-neon', '#ffd27a', '#d4462c'));

  // 外階段（右側）
  const sx1 = BX + bw + 4;
  const sx2 = W - 18;
  for (let f = 1; f < floors; f++) {
    const yLow = bottomOf(f);
    const yHigh = bottomOf(f + 1);
    const steps = [];
    for (let k = 1; k <= 7; k++) {
      const t = k / 8;
      const px = sx2 - (sx2 - sx1 - 6) * t;
      const py = yLow - (yLow - yHigh) * t;
      steps.push(`M${r1(px - 5)} ${r1(py)}h10`);
    }
    out.push(`<path class="fa-slab-line" d="M${sx2} ${yLow}L${sx1 + 6} ${yHigh}M${sx2} ${yLow - 11}L${sx1 + 6} ${yHigh - 11}${steps.join('')}"/>`);
    out.push(`<rect class="fa-slab" x="${BX + bw}" y="${yHigh - 3}" width="${sx2 - BX - bw + 4}" height="3"/>`);
  }
  // 自転車
  const gx = sx2 - 30;
  const gy = ground - 6;
  out.push(
    `<g class="fa-bike"><circle cx="${gx}" cy="${gy}" r="5"/><circle cx="${gx + 18}" cy="${gy}" r="5"/><path d="M${gx} ${gy}l6-8h8l4 8M${gx + 6} ${gy - 8}l3 8h4M${gx + 4} ${gy - 11}h4M${gx + 14} ${gy - 8}l-1-3h3"/></g>`,
  );

  // 部屋（ドア・窓・番号）
  let i = 0;
  for (let f = floors; f >= 1; f--) {
    const yb = bottomOf(f);
    const yt = yb - FH;
    for (let k = 1; k <= ROOMS_PER_FLOOR; k++) {
      const no = f * 100 + k;
      const r = byNo.get(no);
      const x = BX + (k - 1) * UW;
      const g = [];
      g.push(
        `<rect class="fa-door" x="${x + 7}" y="${yb - 30}" width="15" height="27" rx="1.5"/><circle class="fa-ink" cx="${x + 19}" cy="${yb - 16}" r="1.2"/>`,
      );
      g.push(`<text class="fa-no" x="${x + 14.5}" y="${yb - 33}" text-anchor="middle">${no}</text>`);
      const wx = x + 28;
      const wy = yt + 9;
      const ww = 32;
      const wh = 21;
      const lived = r && r.state !== 'ended' && r.state !== 'scheduled';
      if (lived) {
        g.push(`<rect class="fa-glow" x="${wx - 4}" y="${wy - 4}" width="${ww + 8}" height="${wh + 8}" rx="6"/>`);
        g.push(`<rect class="fa-pane lit cur-${curtainOf(no)}" x="${wx}" y="${wy}" width="${ww}" height="${wh}"/>`);
        g.push(
          `<path class="fa-curtain" d="M${wx + 5} ${wy + 1}v${wh - 2}M${wx + 11} ${wy + 1}v${wh - 2}M${wx + ww - 5} ${wy + 1}v${wh - 2}M${wx + ww - 11} ${wy + 1}v${wh - 2}"/>`,
        );
        if (r.state === 'leaving')
          g.push(`<path class="fa-tape" d="M${wx - 2} ${wy + 2}L${wx + ww + 2} ${wy + wh - 2}M${wx - 2} ${wy + wh - 2}L${wx + ww + 2} ${wy + 2}"/>`);
        if (r.state === 'trial') g.push(`<path class="fa-ribbon" d="M${wx} ${wy}h9l-9 9z"/>`);
      } else {
        g.push(`<rect class="fa-pane" x="${wx}" y="${wy}" width="${ww}" height="${wh}"/>`);
      }
      g.push(`<path class="fa-mullion" d="M${wx + ww / 2} ${wy}v${wh}"/>`);
      // 名前などの入力された文字は、あとで DOM の操作で入れる（文字列の SVG には入れない）
      const body = `<rect x="${x}" y="${yt}" width="${UW}" height="${FH}" fill="transparent"/>${g.join('')}`;
      out.push(r ? `<a class="fa-room" data-no="${no}" style="--i:${i++}">${body}</a>` : `<g class="fa-room vacant" data-no="${no}">${body}</g>`);
    }
    if (f >= 2) {
      const ry = yb - 12;
      const bal = [];
      for (let x = BX + 2; x < BX + bw; x += 6) bal.push(`M${x} ${ry}v9`);
      out.push(`<path class="fa-slab-line thin" d="M${BX - 4} ${ry}h${bw + 8}${bal.join('')}" pointer-events="none"/>`);
    }
    out.push(`<rect class="fa-slab" x="${BX - 4}" y="${yb - 3}" width="${bw + 8}" height="3" pointer-events="none"/>`);
  }

  const svg = svgFromString(
    `<svg class="facade-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${out.join('')}</svg>`,
  );
  for (const el of svg.querySelectorAll('.fa-room')) {
    const no = Number(el.dataset.no);
    const r = byNo.get(no);
    const label = r ? r.label : `${no}号室 空室`;
    el.prepend(s('title', null, label));
    if (r) {
      el.setAttribute('href', r.href);
      el.setAttribute('tabindex', '-1');
    }
  }
  return svg;
}
