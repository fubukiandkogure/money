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
  morning: ['#f7cfa8', '#d5e7f0'],
  day: ['#a9d4ee', '#e6f3f8'],
  evening: ['#e98d5f', '#f5d29b'],
  night: ['#101a3a', '#2b3d6b'],
};

function lantern(x, y, lit, i) {
  const g = s('g', { class: ['lantern', lit ? 'lit' : 'unlit'].join(' '), transform: `translate(${x} ${y})`, style: `--i:${i}` });
  if (lit) g.append(s('circle', { cx: 0, cy: 7, r: 11, class: 'lantern-glow' }));
  g.append(
    s('line', { x1: 0, y1: -4, x2: 0, y2: 0, stroke: '#4b3a2a', 'stroke-width': 0.8 }),
    s('rect', { x: -3.4, y: 0, width: 6.8, height: 1.8, rx: 0.6, fill: '#2b2420' }),
    s('path', { d: 'M-4.6 1.8h9.2c1.4 1.8 1.9 3.5 1.9 5.3s-.5 3.5-1.9 5.3h-9.2c-1.4-1.8-1.9-3.5-1.9-5.3s.5-3.5 1.9-5.3Z', class: 'lantern-body' }),
    s('path', { d: 'M-6.2 5.4h12.4M-6.2 8.8h12.4', stroke: lit ? '#8f2a16' : '#b9a98c', 'stroke-width': 0.5, opacity: 0.7 }),
    s('rect', { x: -3.4, y: 12.4, width: 6.8, height: 1.8, rx: 0.6, fill: '#2b2420' }),
  );
  return g;
}

function cat(x, y) {
  return s(
    'g',
    { class: 'cat', transform: `translate(${x} ${y})` },
    s('path', { d: 'M-9 0c0-4.5 4-7 9-7s8.5 2.4 8.5 6.2c0 .5-.1.8-.3.8H-8.6c-.3 0-.4-.4-.4 0Z', fill: '#2a2320' }),
    s('circle', { cx: 8, cy: -4.2, r: 3.6, fill: '#2a2320' }),
    s('path', { d: 'M5.4 -6.6 5.6 -10l2.4 2.2M8.8 -7.4l1.6-2.9.9 3.3', fill: '#2a2320' }),
    s('path', { d: 'M-9 -1.2c-3.5 0-5.5-1.5-5-4', fill: 'none', stroke: '#2a2320', 'stroke-width': 1.6, 'stroke-linecap': 'round', class: 'cat-tail' }),
    s('text', { x: 14, y: -11, class: 'cat-z', 'font-size': 6, fill: '#fff6d8' }, 'z'),
  );
}

/**
 * 町並み（ホームの見出し）。
 * - 提灯：月末を確定した月の数だけ灯る（直近6か月。管理を始める前の月は数えない）
 * - サブスク荘の窓：入居・内見中の部屋の数だけ灯る
 * - 猫：最新の月末が確定していると、屋根で昼寝している
 * @param {{phase, litRooms: number, lanterns: {ym, status}[], cat: boolean}} o
 */
export function townScene({ phase, litRooms = 0, lanterns = [], cat: showCat = false }) {
  const [top, bottom] = SKY[phase];
  const night = phase === 'night';
  const dusk = phase === 'evening' || night;
  const svg = s('svg', {
    viewBox: '0 0 400 160',
    class: `town phase-${phase}`,
    'aria-hidden': 'true',
    focusable: 'false',
    preserveAspectRatio: 'xMidYMax slice',
  });
  const gid = `sky-${phase}`;
  svg.append(
    s(
      'defs',
      null,
      s(
        'linearGradient',
        { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
        s('stop', { offset: '0', 'stop-color': top }),
        s('stop', { offset: '1', 'stop-color': bottom }),
      ),
      s(
        'pattern',
        { id: 'kawara', width: 6, height: 4, patternUnits: 'userSpaceOnUse' },
        s('path', { d: 'M0 4a3 3 0 0 1 6 0', fill: 'none', stroke: 'rgba(255,255,255,.18)', 'stroke-width': 0.8 }),
      ),
      s(
        'pattern',
        { id: 'namako', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        s('rect', { width: 6, height: 6, fill: night ? '#3a4152' : '#59606f' }),
        s('rect', { x: 0.8, y: 0.8, width: 4.4, height: 4.4, rx: 1.4, fill: night ? '#cfc7b4' : '#eee8dc' }),
      ),
    ),
    s('rect', { width: 400, height: 160, fill: `url(#${gid})` }),
  );

  // 空
  if (night) {
    const stars = [
      [30, 16, 1.2],
      [70, 34, 0.8],
      [118, 12, 1.1],
      [170, 28, 0.7],
      [214, 10, 1.0],
      [262, 30, 0.9],
      [306, 14, 0.8],
      [350, 36, 1.2],
      [380, 12, 0.8],
      [140, 44, 0.6],
    ];
    stars.forEach(([x, y, r], i) => svg.append(s('circle', { cx: x, cy: y, r, fill: '#fff6d8', class: 'star', style: `--i:${i}` })));
    svg.append(s('circle', { cx: 336, cy: 30, r: 12, fill: '#fff1c4' }), s('circle', { cx: 341, cy: 26, r: 11, fill: top }));
  } else if (phase === 'evening') {
    svg.append(s('circle', { cx: 330, cy: 92, r: 22, fill: '#ffd38a', opacity: 0.85 }));
  } else {
    svg.append(s('circle', { cx: 340, cy: 30, r: 13, fill: phase === 'morning' ? '#ffd9a0' : '#fff3c4' }));
  }
  if (!night) {
    const clouds = s('g', { class: 'clouds', fill: '#ffffff', opacity: dusk ? 0.55 : 0.85 });
    clouds.append(s('path', { d: 'M40 34q8-9 19-1q9-7 16 2q-2 7-11 6H42q-7-1-2-7z' }), s('path', { d: 'M220 22q7-7 15-1q7-5 12 2q-2 5-8 4h-17q-5-1-2-5z' }));
    svg.append(clouds);
  }

  // 遠くの山と屋根
  svg.append(s('path', { d: 'M0 110 Q60 76 120 100 T240 94 T400 100 V160 H0Z', fill: night ? '#1f2f55' : dusk ? '#9a8a9e' : '#a7c6b3', opacity: 0.75 }));
  svg.append(
    s('path', {
      d: 'M0 122h30l8-8 8 8h40l10-9 10 9h70l6-6 6 6h60l10-10 10 10h60l8-7 8 7h56V160H0Z',
      fill: night ? '#1a2440' : dusk ? '#8e7c80' : '#bcd3c4',
      opacity: 0.6,
    }),
  );

  // 提灯のひも（確定の灯り）
  if (lanterns.length) {
    const path = 'M12 44 Q200 82 388 44';
    svg.append(s('path', { d: path, fill: 'none', stroke: night ? '#4a5270' : '#5b5048', 'stroke-width': 0.9 }));
    const n = lanterns.length;
    lanterns.forEach((l, i) => {
      const t = (i + 1) / (n + 1);
      const x = (1 - t) * (1 - t) * 12 + 2 * (1 - t) * t * 200 + t * t * 388;
      const y = (1 - t) * (1 - t) * 44 + 2 * (1 - t) * t * 82 + t * t * 44;
      svg.append(lantern(x, y + 3, l.status === 'confirmed', i));
    });
  }

  // 地面と石畳
  const ground = night ? '#161d33' : dusk ? '#7d6a58' : '#c9b48c';
  svg.append(s('rect', { x: 0, y: 140, width: 400, height: 20, fill: ground }));
  svg.append(s('path', { d: 'M0 146h400M0 153h400', stroke: night ? '#232c48' : 'rgba(90,70,40,.25)', 'stroke-width': 0.8 }));
  svg.append(s('rect', { x: 0, y: 139, width: 400, height: 2, fill: night ? '#2b3554' : '#a99067' }));

  // 蔵（資産）
  const wall = night ? '#d8d0bc' : '#f5f0e4';
  const roof = night ? '#252a36' : '#3b3f4a';
  const kura = s('g', { transform: 'translate(22 82)' });
  kura.append(
    s('path', { d: 'M-6 16 Q30 -2 66 16 L60 18 Q30 6 0 18Z', fill: roof }),
    s('path', { d: 'M-4 16 Q30 1 64 16Z', fill: 'url(#kawara)' }),
    s('rect', { x: 4, y: 17, width: 52, height: 41, fill: wall }),
    s('rect', { x: 4, y: 42, width: 52, height: 16, fill: 'url(#namako)' }),
    s('circle', { cx: 30, cy: 29, r: 6, fill: dusk ? '#f2c14e' : '#e0a92b', class: dusk ? 'window-glow' : '' }),
    s('path', { d: 'M24 29h12M30 23v12', stroke: roof, 'stroke-width': 0.9, opacity: 0.6 }),
    s('rect', { x: 23, y: 44, width: 14, height: 14, fill: night ? '#2b2f3a' : '#6b4b2a' }),
    s('path', { d: 'M30 44v14', stroke: night ? '#1b1f2a' : '#4a321b', 'stroke-width': 0.8 }),
  );
  svg.append(kura);

  // 電柱と電線
  svg.append(
    s('rect', { x: 104, y: 58, width: 3.2, height: 82, fill: night ? '#3b3b44' : '#6d5a43' }),
    s('rect', { x: 96, y: 64, width: 19, height: 2.6, fill: night ? '#3b3b44' : '#6d5a43' }),
    s('path', { d: 'M0 70 Q52 78 105 65 Q220 80 400 64', stroke: night ? '#4a5270' : '#5b5048', 'stroke-width': 0.7, fill: 'none' }),
  );

  // サブスク荘（2階建て・外階段）
  const ap = s('g', { transform: 'translate(140 66)' });
  const wood = night ? '#5d4a39' : dusk ? '#a8865e' : '#c9a77a';
  const trim = night ? '#3f3226' : '#7a5a3a';
  ap.append(
    s('path', { d: 'M-8 12 L62 0 L132 12 Z', fill: night ? '#5a2f2a' : '#8c3b2e' }),
    s('path', { d: 'M-4 12 L62 1 L128 12Z', fill: 'url(#kawara)' }),
    s('rect', { x: 0, y: 12, width: 124, height: 62, fill: wood }),
    s('rect', { x: 0, y: 42, width: 124, height: 3, fill: trim }),
    s('path', { d: 'M0 40h124M0 72h124', stroke: trim, 'stroke-width': 1 }),
    // 外廊下の手すり
    s('path', { d: 'M0 34h124M0 64h124', stroke: trim, 'stroke-width': 1.2 }),
    s('path', {
      d: 'M6 34v6M18 34v6M30 34v6M42 34v6M54 34v6M66 34v6M78 34v6M90 34v6M102 34v6M114 34v6M6 64v8M18 64v8M30 64v8M42 64v8M54 64v8M66 64v8M78 64v8M90 64v8M102 64v8M114 64v8',
      stroke: trim,
      'stroke-width': 0.6,
      opacity: 0.8,
    }),
    // 外階段
    s('path', { d: 'M124 74 L148 44 L148 46 L126 74Z', fill: trim }),
    s('path', { d: 'M128 70h4M132 65h4M136 60h4M140 55h4M144 50h4', stroke: trim, 'stroke-width': 1.2 }),
    // 看板
    s('rect', { x: 40, y: 14.5, width: 44, height: 9, rx: 1.5, fill: night ? '#f6ecd6' : '#fffaf0', stroke: '#6b4b2a', 'stroke-width': 0.8 }),
  );
  ap.append(s('text', { x: 62, y: 21.4, 'text-anchor': 'middle', 'font-size': 6.2, fill: '#7a2b1e', 'font-weight': 700, class: 'sign-text' }, 'サブスク荘'));
  const windows = [
    [6, 25],
    [32, 25],
    [82, 25],
    [106, 25],
    [6, 51],
    [32, 51],
    [82, 51],
    [106, 51],
  ];
  const lit = Math.min(litRooms, windows.length);
  windows.forEach(([x, y], i) => {
    const on = i < lit;
    ap.append(
      s('rect', {
        x,
        y,
        width: 13,
        height: 8,
        rx: 1,
        fill: on ? (dusk ? '#ffd56a' : '#ffe9a8') : night ? '#25293a' : '#8fb4c9',
        stroke: trim,
        'stroke-width': 0.6,
        class: on && dusk ? 'window-glow' : '',
      }),
    );
  });
  ap.append(s('rect', { x: 56, y: 52, width: 12, height: 22, fill: night ? '#3a2c20' : '#7b5634' }));
  if (showCat) ap.append(cat(98, 7));
  svg.append(ap);

  // 街灯
  svg.append(
    s('rect', { x: 306, y: 92, width: 2.4, height: 48, fill: night ? '#3c4258' : '#4b4e57' }),
    s('path', { d: 'M300 92h14l-2.5 6h-9z', fill: night ? '#3c4258' : '#4b4e57' }),
    s('circle', { cx: 307, cy: 99, r: dusk ? 4.5 : 2.5, fill: dusk ? '#ffe08a' : '#f3e7c4', opacity: dusk ? 0.95 : 0.8 }),
  );
  if (dusk) svg.append(s('circle', { cx: 307, cy: 102, r: 20, fill: '#ffe08a', opacity: 0.12, class: 'lamp-glow' }));

  // 商店（のれん）
  svg.append(
    s('rect', { x: 326, y: 100, width: 70, height: 40, fill: night ? '#4a3f37' : '#e7d3b0' }),
    s('path', { d: 'M322 100h78l-4-9h-70z', fill: night ? '#2f5a4a' : '#3f7a5a' }),
    s('rect', { x: 334, y: 106, width: 54, height: 13, fill: '#22406b' }),
    s('path', { d: 'M347.5 106v13M361 106v13M374.5 106v13', stroke: night ? '#4a3f37' : '#e7d3b0', 'stroke-width': 1.4 }),
    s('circle', { cx: 361, cy: 112, r: 3.2, fill: 'none', stroke: '#f4ecdc', 'stroke-width': 1 }),
    s('rect', { x: 338, y: 122, width: 46, height: 18, fill: dusk ? '#ffd56a' : '#9cc0d2', opacity: 0.9, class: dusk ? 'window-glow' : '' }),
  );
  return svg;
}

/**
 * 奨学金の坂道。ratio（0〜1）は当初の元金が分かるときだけ渡す。
 */
export function slopeScene(ratio) {
  const svg = s('svg', { viewBox: '0 0 300 96', class: 'slope', 'aria-hidden': 'true', focusable: 'false' });
  const p = (t) => {
    // 坂の道のり（左下 → 右上）
    const x = 14 + t * 250;
    const y = 82 - Math.pow(t, 1.15) * 56;
    return [x, y];
  };
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push(p(i / 20));
  svg.append(
    s('path', { d: `M0 96 L${pts.map(([x, y]) => `${x} ${y}`).join(' L')} L300 26 V96Z`, class: 'slope-hill' }),
    s('path', { d: `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')}`, class: 'slope-road' }),
  );
  // 旗（完済）
  const [fx, fy] = p(1);
  svg.append(s('path', { d: `M${fx + 4} ${fy} v-26`, class: 'slope-pole' }), s('path', { d: `M${fx + 4} ${fy - 26} l16 5 -16 5Z`, class: 'slope-flag' }));
  if (ratio !== null && ratio !== undefined) {
    const t = Math.min(1, Math.max(0, ratio));
    // 歩いてきた跡
    for (let i = 1; i <= 8; i++) {
      const tt = (t * i) / 9;
      const [x, y] = p(tt);
      svg.append(s('circle', { cx: x, cy: y - 2, r: 1.1, class: 'slope-step' }));
    }
    const [x, y] = p(t);
    svg.append(
      s(
        'g',
        { class: 'walker', transform: `translate(${x} ${y - 2})` },
        s('circle', { cx: 0, cy: -15, r: 3.6 }),
        s('path', { d: 'M0 -11v7M0 -9l-4 3M0 -9l4 2M0 -4l-3 5M0 -4l3 5', fill: 'none', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
        s('path', { d: 'M-3 -15.5h6', 'stroke-width': 1, fill: 'none' }),
      ),
    );
  }
  return svg;
}
