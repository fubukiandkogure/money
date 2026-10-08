// ふところ町の絵（装飾。数字の根拠を表すものではない）
import { s, svgFromString } from './dom.js';

/** ロゴ：瓦屋根の蔵と、灯りのともる丸窓 */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
<rect width="64" height="64" rx="15" fill="#22406b"/>
<path d="M9 27.5 32 13l23 14.5" fill="none" stroke="#f4ecdc" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14 26.5h36" stroke="#f4ecdc" stroke-width="2.4" stroke-linecap="round"/>
<rect x="17" y="29" width="30" height="23" rx="2.5" fill="#f4ecdc"/>
<path d="M17 45.5h30" stroke="#22406b" stroke-width="1.6" opacity=".35"/>
<circle cx="32" cy="37.5" r="6.2" fill="#e0a92b"/>
<circle cx="32" cy="37.5" r="6.2" fill="none" stroke="#22406b" stroke-width="1.4"/>
<path d="M32 31.3v12.4M25.8 37.5h12.4" stroke="#22406b" stroke-width="1.1" opacity=".55"/>
</svg>`;

export function logo(size = 32) {
  const el = svgFromString(LOGO_SVG);
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.classList.add('logo');
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

const SKY = {
  morning: ['#f9d9b8', '#cfe3ef'],
  day: ['#bfe0f2', '#e9f4f8'],
  evening: ['#f0a774', '#f6d6a4'],
  night: ['#162447', '#2c3e6b'],
};

/**
 * 町並み（ホームの見出し）。サブスク荘の灯る窓の数＝入居中の部屋の数。
 * @param {{phase, litRooms: number, totalRooms: number}} o
 */
export function townScene({ phase, litRooms = 0, totalRooms = 0 }) {
  const [top, bottom] = SKY[phase];
  const night = phase === 'night' || phase === 'evening';
  const svg = s('svg', { viewBox: '0 0 360 120', class: 'town', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMax slice' });
  const gid = `sky-${phase}`;
  svg.append(
    s('defs', null, s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0', 'stop-color': top }), s('stop', { offset: '1', 'stop-color': bottom }))),
    s('rect', { width: 360, height: 120, fill: `url(#${gid})` }),
  );
  if (phase === 'night') {
    for (const [x, y, r] of [
      [40, 18, 1.2],
      [92, 30, 0.9],
      [150, 14, 1.1],
      [210, 26, 0.8],
      [300, 12, 1.3],
      [330, 34, 0.9],
      [255, 40, 0.7],
    ])
      svg.append(s('circle', { cx: x, cy: y, r, fill: '#fff6d8', opacity: 0.85 }));
    svg.append(s('circle', { cx: 300, cy: 30, r: 11, fill: '#fff1c4' }), s('circle', { cx: 305, cy: 26, r: 10, fill: top }));
  } else if (phase === 'evening') {
    svg.append(s('circle', { cx: 300, cy: 70, r: 18, fill: '#ffd38a', opacity: 0.9 }));
  } else {
    svg.append(s('circle', { cx: 302, cy: 26, r: 12, fill: phase === 'morning' ? '#ffd9a0' : '#fff3c4' }));
    svg.append(s('path', { d: 'M60 30q8-8 18 0q8-6 14 2q-2 6-10 5H62q-6-1-2-7z', fill: '#ffffff', opacity: 0.8 }));
  }
  // 遠くの山
  svg.append(s('path', { d: 'M0 92 Q60 60 120 86 T240 80 T360 88 V120 H0Z', fill: night ? '#22335a' : '#a9c7b6', opacity: 0.7 }));
  // 地面
  svg.append(s('rect', { x: 0, y: 104, width: 360, height: 16, fill: night ? '#1b2238' : '#c9b48c' }));
  svg.append(s('rect', { x: 0, y: 104, width: 360, height: 2, fill: night ? '#2b3554' : '#b39d72' }));

  // 蔵（資産）
  const kura = s('g', { transform: 'translate(22 58)' });
  kura.append(
    s('path', { d: 'M-4 14 L28 0 L60 14 Z', fill: night ? '#2a2f3d' : '#3b3f4a' }),
    s('rect', { x: 2, y: 14, width: 52, height: 32, fill: night ? '#d8d1c0' : '#f5f0e4' }),
    s('rect', { x: 2, y: 36, width: 52, height: 10, fill: night ? '#3a4152' : '#5b6170' }),
    s('path', { d: 'M2 39h52M2 43h52', stroke: night ? '#4f5872' : '#7a8091', 'stroke-width': 0.8 }),
    s('circle', { cx: 28, cy: 25, r: 5, fill: night ? '#f2c14e' : '#e0a92b' }),
    s('rect', { x: 22, y: 34, width: 12, height: 12, fill: night ? '#2b2f3a' : '#6b4b2a' }),
  );
  svg.append(kura);

  // 電柱と電線
  svg.append(
    s('rect', { x: 98, y: 40, width: 3, height: 64, fill: night ? '#3b3b44' : '#6d5a43' }),
    s('rect', { x: 91, y: 46, width: 17, height: 2.5, fill: night ? '#3b3b44' : '#6d5a43' }),
    s('path', { d: 'M0 50 Q50 58 99 47 Q200 60 360 46', stroke: night ? '#4a5270' : '#5b5048', 'stroke-width': 0.8, fill: 'none' }),
  );

  // サブスク荘（2階建て）
  const ap = s('g', { transform: 'translate(150 46)' });
  ap.append(
    s('path', { d: 'M-6 12 L56 0 L118 12 Z', fill: night ? '#5a2f2a' : '#8c3b2e' }),
    s('rect', { x: 0, y: 12, width: 112, height: 46, fill: night ? '#5d4a39' : '#c9a77a' }),
    s('rect', { x: 0, y: 34, width: 112, height: 2.5, fill: night ? '#3f3226' : '#8a6a46' }),
    s('rect', { x: 36, y: 15, width: 40, height: 8, rx: 1.5, fill: night ? '#f6ecd6' : '#fffaf0', stroke: '#6b4b2a', 'stroke-width': 0.8 }),
  );
  const sign = s('text', { x: 56, y: 21.4, 'text-anchor': 'middle', 'font-size': 6, fill: '#6b2b20', 'font-weight': 700 }, 'サブスク荘');
  ap.append(sign);
  const windows = [
    [6, 25],
    [32, 25],
    [80, 25],
    [98, 25],
    [6, 42],
    [32, 42],
    [80, 42],
    [98, 42],
  ];
  const lit = Math.min(litRooms, windows.length);
  windows.forEach(([x, y], i) => {
    const on = i < lit;
    ap.append(s('rect', { x, y, width: 11, height: 8, rx: 1, fill: on ? (night ? '#ffd56a' : '#ffe9a8') : night ? '#2b2f3e' : '#8fb4c9', stroke: night ? '#3f3226' : '#8a6a46', 'stroke-width': 0.6 }));
  });
  ap.append(s('rect', { x: 50, y: 40, width: 12, height: 18, fill: night ? '#3a2c20' : '#7b5634' }));
  svg.append(ap);

  // 街灯
  svg.append(
    s('rect', { x: 290, y: 66, width: 2.4, height: 38, fill: night ? '#3c4258' : '#4b4e57' }),
    s('path', { d: 'M284 66h14l-2.5 6h-9z', fill: night ? '#3c4258' : '#4b4e57' }),
    s('circle', { cx: 291, cy: 73, r: night ? 4.5 : 2.5, fill: night ? '#ffe08a' : '#f3e7c4', opacity: night ? 0.95 : 0.8 }),
  );
  if (night) svg.append(s('circle', { cx: 291, cy: 76, r: 18, fill: '#ffe08a', opacity: 0.12 }));
  // 小さな商店
  svg.append(
    s('rect', { x: 312, y: 78, width: 44, height: 26, fill: night ? '#4a3f37' : '#e7d3b0' }),
    s('path', { d: 'M310 78h48l-3-7h-42z', fill: night ? '#2f5a4a' : '#3f7a5a' }),
    s('rect', { x: 318, y: 86, width: 14, height: 10, fill: night ? '#ffd56a' : '#9cc0d2', opacity: 0.9 }),
  );
  svg.dataset.rooms = String(totalRooms);
  return svg;
}
