// チリツモのドット絵。ロゴの文字・山・カテゴリーの絵を、ここで1ドットずつ描く（フォントや画像は使わない）。
// 「塵も積もれば山となる」：1つ1つのドット（塵）が積もって山になる。
// 地図の記号：'.' は透明。そのほかの文字は、渡したパレットの色で塗る。

// ---------------------------------------------------------------------------
// 文字（12×12、線は1ドット。描くときに縦線を2ドットにして太字にする）

export const GLYPHS = {
  チ: [
    '.........##.',
    '...######...',
    '......#.....',
    '......#.....',
    '......#.....',
    '############',
    '......#.....',
    '......#.....',
    '.....#......',
    '.....#......',
    '...##.......',
    '.##.........',
  ],
  リ: [
    '............',
    '.#.......#..',
    '.#.......#..',
    '.#.......#..',
    '.#.......#..',
    '.#.......#..',
    '.........#..',
    '.........#..',
    '........#...',
    '.......#....',
    '.....##.....',
    '...##.......',
  ],
  ツ: [
    '............',
    '#...#.....#.',
    '.#...#....#.',
    '..#...#...#.',
    '..........#.',
    '.........#..',
    '.........#..',
    '........#...',
    '.......#....',
    '.....##.....',
    '...##.......',
    '.##.........',
  ],
  モ: [
    '............',
    '.##########.',
    '....#.......',
    '....#.......',
    '....#.......',
    '############',
    '....#.......',
    '....#.......',
    '....#.......',
    '....#.......',
    '....#.......',
    '.....######.',
  ],
  // サブスク荘の看板（同じ作りの姉妹アプリ「サブスク荘」と同じ字形）
  サ: [
    '..#....#....',
    '..#....#....',
    '############',
    '..#....#....',
    '..#....#....',
    '..#....#....',
    '.......#....',
    '.......#....',
    '......#.....',
    '.....#......',
    '...##.......',
    '.##.........',
  ],
  ブ: [
    '........#..#',
    '........#..#',
    '#######.....',
    '......#.....',
    '......#.....',
    '......#.....',
    '.....#......',
    '.....#......',
    '....#.......',
    '...#........',
    '.##.........',
    '#...........',
  ],
  ス: [
    '............',
    '............',
    '.#########..',
    '.........#..',
    '........#...',
    '.......#....',
    '......##....',
    '.....#..#...',
    '....#....#..',
    '...#......#.',
    '.##........#',
    '#...........',
  ],
  ク: [
    '...#........',
    '..#.........',
    '.##########.',
    '.#........#.',
    '#.........#.',
    '..........#.',
    '.........#..',
    '........#...',
    '.......#....',
    '......#.....',
    '....##......',
    '.###........',
  ],
  荘: [
    '...#....#...',
    '############',
    '...#....#...',
    '............',
    '...#....#...',
    '#..#.#######',
    '.#.#....#...',
    '...#....#...',
    '..##....#...',
    '.#.#....#...',
    '#..#.######.',
    '...#........',
  ],
};
const GW = 12;
const GAP = 1;
// 昔のゲームの太字と同じやり方：右どなりにも1ドット足す
const bold = (g) => g.map((row) => [...row, '.'].map((c, x, a) => (c === '#' || a[x - 1] === '#' ? '#' : '.')).join(''));
const BW = GW + 1;

// ---------------------------------------------------------------------------
// 山のしるし（16×16）。上から塵が降ってきて、金色の山に積もる

export const MARK = [
  '................',
  '..........o.....',
  '................',
  '....o...........',
  '................',
  '.........o......',
  '................',
  '.......##.......',
  '......#h##......',
  '.....#hh###.....',
  '....##h##d##....',
  '...##h###d###...',
  '..##h##d#####d..',
  '.#h####d###d###.',
  '##############dd',
  '................',
];

export const COLORS = {
  ink: '#19191c',
  gold: '#f5b700',
  goldDeep: '#c98800',
  goldLight: '#ffe48a',
  night: '#ffcf4a',
};

/** 地図 → 横に続く同じ色をまとめた rect の文字列 */
export function rects(map, pal, ox = 0, oy = 0) {
  let out = '';
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let n = 1;
      while (x + n < row.length && row[x + n] === ch) n++;
      const fill = typeof pal === 'string' ? (ch === '#' ? pal : null) : pal[ch];
      if (fill && ch !== '.') out += `<rect x="${ox + x}" y="${oy + y}" width="${n}" height="1" fill="${fill}"/>`;
      x += n;
    }
  });
  return out;
}

function textRects(text, ink, shadow, ox = 0, oy = 0) {
  let sh = '';
  let fg = '';
  [...text].forEach((ch, i) => {
    const g = bold(GLYPHS[ch]);
    const gx = ox + i * (BW + GAP);
    if (shadow) sh += rects(g, shadow, gx + 1, oy + 1);
    fg += rects(g, ink, gx, oy);
  });
  return `<g class="px-shadow">${sh}</g><g class="px-ink">${fg}</g>`;
}

export function textWidth(text) {
  return text.length * BW + (text.length - 1) * GAP + 1;
}

const markPalette = (night) => ({
  '#': night ? '#ffcf4a' : COLORS.gold,
  h: night ? '#fff0b8' : COLORS.goldLight,
  d: night ? '#d99a1a' : COLORS.goldDeep,
  o: night ? '#ffe9a0' : COLORS.gold,
});

/**
 * ロゴ（山のしるし＋「チリツモ」）。scale は1ドットの大きさ（整数だとくっきり）
 * 昼：墨の文字に金の影。夜：金の文字がネオンのように光る。
 */
export function wordmarkSvg({ night = false, scale = 2, text = 'チリツモ', mark = true, label = 'チリツモ' } = {}) {
  const ink = night ? '#ffd45c' : COLORS.ink;
  const shadow = night ? '#c2410c' : COLORS.gold;
  const mw = mark ? 16 : 0;
  const gap = mark ? 3 : 0;
  const tw = textWidth(text);
  const w = mw + gap + tw;
  const hgt = 16;
  const ty = 3;
  return (
    `<svg class="px-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}" width="${w * scale}" height="${hgt * scale}" shape-rendering="crispEdges" role="img" aria-label="${label}">` +
    (mark ? `<g class="px-mark">${rects(MARK, markPalette(night))}</g>` : '') +
    `<g transform="translate(${mw + gap} 0)">${textRects(text, ink, shadow, 0, ty)}</g></svg>`
  );
}

/** 看板などに使う文字だけ。x・y・width・height を渡すと、ほかの SVG の中に置ける */
export function wordSvg(text, { ink = COLORS.ink, shadow = COLORS.gold, scale = 2, label, cls = '', x, y, width, height } = {}) {
  const w = textWidth(text);
  const pos = x === undefined ? '' : `x="${x}" y="${y}" `;
  return `<svg class="px-word ${cls}" xmlns="http://www.w3.org/2000/svg" ${pos}viewBox="0 0 ${w} ${GW + 1}" width="${width ?? w * scale}" height="${height ?? (GW + 1) * scale}" shape-rendering="crispEdges" role="img" aria-label="${label ?? text}">${textRects(text, ink, shadow)}</svg>`;
}

/** アプリのアイコン（正方形）。maskable は外周に余白をとる */
export function appIconSvg({ size = 512, maskable = false, rounded = true } = {}) {
  const pad = maskable ? 4 : 2;
  const n = 16 + pad * 2;
  const r = rounded && !maskable ? 4.4 : 0;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" rx="${r}" fill="${COLORS.ink}" shape-rendering="geometricPrecision"/>` +
    rects(MARK, markPalette(false), pad, pad - 0.5) +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// 絵のアイコン（12×12）。'#' は文字色、'o' はタイルの濃い色

const ICONS = {
  // おにぎり
  food: [
    '.....##.....',
    '....####....',
    '...##..##...',
    '...#....#...',
    '..##....##..',
    '..#......#..',
    '.##.####.##.',
    '.#..####..#.',
    '##..####..##',
    '#...####...#',
    '############',
    '............',
  ],
  // ポンプの容器（日用品）
  daily: [
    '..#####.....',
    '......#.....',
    '....###.....',
    '....#.#.....',
    '..#######...',
    '.#.......#..',
    '.#.#####.#..',
    '.#.#...#.#..',
    '.#.#####.#..',
    '.#.......#..',
    '..#######...',
    '............',
  ],
  // 紙袋
  shopping: [
    '....####....',
    '...#....#...',
    '...#....#...',
    '.##########.',
    '.#........#.',
    '.#.#....#.#.',
    '.#..####..#.',
    '.#........#.',
    '.#........#.',
    '.#........#.',
    '.##########.',
    '............',
  ],
  // ゲーム機（遊び）
  play: [
    '............',
    '............',
    '.##########.',
    '#..........#',
    '#.#......#.#',
    '###....#.#.#',
    '#.#......#.#',
    '#..........#',
    '#...####...#',
    '.###....###.',
    '............',
    '............',
  ],
  // 電車（交通）
  transport: [
    '..########..',
    '.#........#.',
    '.#.######.#.',
    '.#.#....#.#.',
    '.#.######.#.',
    '.#........#.',
    '.#.##..##.#.',
    '.#........#.',
    '..########..',
    '...#....#...',
    '..#......#..',
    '.#........#.',
  ],
  // 飛行機（旅行）
  travel: [
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '....####....',
    '.##########.',
    '############',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '....####....',
    '...######...',
    '............',
  ],
  // 画面と再生（サブスク）
  subscription: [
    '............',
    '############',
    '#..........#',
    '#...#......#',
    '#...##.....#',
    '#...###....#',
    '#...##.....#',
    '#...#......#',
    '#..........#',
    '############',
    '....####....',
    '..########..',
  ],
  // 箱（その他）
  other: [
    '............',
    '.##########.',
    '.#...##...#.',
    '############',
    '#....##....#',
    '#....##....#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '############',
    '............',
  ],
  // 銀行
  bank: [
    '.....##.....',
    '...######...',
    '.##########.',
    '############',
    '............',
    '.##.##.##.##',
    '.##.##.##.##',
    '.##.##.##.##',
    '.##.##.##.##',
    '............',
    '############',
    '############',
  ],
  // 芽（投資）
  investment: [
    '.......###..',
    '..##..####..',
    '.####.###...',
    '.####.##....',
    '..###.#.....',
    '....###.....',
    '.....#......',
    '.....#......',
    '..########..',
    '...######...',
    '...######...',
    '....####....',
  ],
  // 角帽（奨学金）
  loan: [
    '............',
    '.....##.....',
    '...######...',
    '.##########.',
    '############',
    '.##########.',
    '..#.####.#..',
    '..#......#..',
    '..#......#..',
    '..########..',
    '..........#.',
    '............',
  ],
  // 硬貨（入金）
  coin: [
    '...######...',
    '..#......#..',
    '.#.#....#.#.',
    '#...#..#...#',
    '#....##....#',
    '#..######..#',
    '#....##....#',
    '#..######..#',
    '#....##....#',
    '.#........#.',
    '..#......#..',
    '...######...',
  ],
  // 矢印（振替）
  transfer: [
    '............',
    '.......#....',
    '.......##...',
    '.##########.',
    '.......##...',
    '.......#....',
    '....#.......',
    '...##.......',
    '.##########.',
    '...##.......',
    '....#.......',
    '............',
  ],
  // カード
  card: [
    '............',
    '............',
    '############',
    '#..........#',
    '############',
    '############',
    '#..........#',
    '#.####.....#',
    '#..........#',
    '############',
    '............',
    '............',
  ],
  // 星（ごほうび）
  star: [
    '.....##.....',
    '.....##.....',
    '....####....',
    '############',
    '.##########.',
    '..########..',
    '...######...',
    '...######...',
    '..###..###..',
    '..##....##..',
    '.#........#.',
    '............',
  ],
};

export const PIXEL_ICONS = Object.keys(ICONS);

export function pixelIconMarkup(name, size = 24) {
  const map = ICONS[name] ?? ICONS.other;
  return `<svg class="px-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects(map, { '#': 'currentColor', o: 'var(--px-2, currentColor)' })}</svg>`;
}

// ---------------------------------------------------------------------------
// ホームの景色：「チリツモ山」。月末を確定した月の数だけ、地層が1段ずつ積もる。
// 金額の大小は表さない（純資産が減った月も、確定すれば1段）。

const SKY = {
  morning: ['#f9d9b8', '#fbe6cc', '#fdf1e0'],
  day: ['#bfe0f2', '#d6ebf6', '#e8f4fa'],
  evening: ['#f2a477', '#f7c493', '#fadfb5'],
  night: ['#0d1230', '#151c42', '#1e2753'],
};
const HILL = { morning: '#e7c9a6', day: '#cfe3d2', evening: '#d79d7e', night: '#232c57' };
const GROUND = { morning: '#d9b98f', day: '#c7d6b9', evening: '#b98265', night: '#1a2045' };
const STRATA = {
  light: ['#f5b700', '#e9a300', '#ffc933', '#dc9600'],
  night: ['#f2b630', '#dda020', '#ffc94a', '#c98d14'],
};

// 決まった並びの「でたらめ」（描くたびに形が変わらないように）
function noise(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = ((n ^ (n >>> 13)) * 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * @param {{phase: 'morning'|'day'|'evening'|'night', layers: number, flag?: boolean}} o
 *   layers：確定した月の数。flag：最新の月末が確定済み
 */
export function mountainMarkup({ phase = 'day', layers = 0, flag = false, width = 128, height = 38 }) {
  const night = phase === 'night';
  const W = width;
  const H = height;
  const groundY = H - 7; // 地面は厚め（下の帯に文字の札を置く）
  const cx = Math.floor(W / 2);
  // 1段の厚み：少ないうちは厚く（小さくても見えるように）、増えたら薄く。高さは空に収まる分まで
  const room = groundY - 9;
  const shown = Math.min(layers, room);
  const thick = shown ? Math.max(1, Math.min(4, Math.floor(room / shown))) : 0;
  const ph = shown * thick;
  const parts = [];
  const px = (x, y, w, hh, fill, cls) => parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${fill}"${cls ? ` class="${cls}"` : ''}/>`);

  // 空（ドット絵らしく、色の帯で）
  const [s1, s2, s3] = SKY[phase];
  px(0, 0, W, H, s3);
  px(0, 0, W, Math.round(H * 0.45), s2);
  px(0, 0, W, Math.round(H * 0.22), s1);

  if (night) {
    for (let i = 0; i < 22; i++) {
      const x = Math.floor(noise(i, 7) * W);
      const y = Math.floor(noise(i, 11) * (groundY - 12));
      px(x, y, 1, 1, noise(i, 3) > 0.7 ? '#ffffff' : '#9aa6e6', `star s${i % 3}`);
    }
    const mx = cx + 30;
    const my = 4;
    ['..###..', '.#####.', '####...', '###....', '####...', '.#####.', '..###..'].forEach((r, y) =>
      [...r].forEach((c, x) => c === '#' && px(mx + x, my + y, 1, 1, '#fff3c4')),
    );
  } else {
    const sx = cx + 30;
    const sy = phase === 'evening' ? 10 : 4;
    const sun = phase === 'evening' ? '#ffe2a8' : '#fff2c2';
    ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'].forEach((r, y) =>
      [...r].forEach((c, x) => c === '#' && px(sx + x, sy + y, 1, 1, sun)),
    );
    const cloud = (x, y, cls) => {
      const c = phase === 'evening' ? '#fde6cf' : '#ffffff';
      parts.push(
        `<g class="${cls}"><rect x="${x + 2}" y="${y}" width="5" height="1" fill="${c}"/><rect x="${x}" y="${y + 1}" width="11" height="2" fill="${c}"/><rect x="${x + 8}" y="${y}" width="2" height="1" fill="${c}"/></g>`,
      );
    };
    cloud(cx - 40, 6, 'cloud c1');
    cloud(cx + 12, 12, 'cloud c2');
  }

  // 遠くの丘
  const hill = HILL[phase];
  for (let x = 0; x < W; x++) {
    const hh = Math.round(3 + 2 * Math.sin(x / 9) + 1.5 * Math.sin(x / 4.3 + 1));
    px(x, groundY - hh, 1, hh, hill);
  }

  // 山（地層）：上から1段ずつ。てっぺんが最新の確定
  if (shown > 0) {
    const pal = night ? STRATA.night : STRATA.light;
    const light = night ? '#ffe08a' : '#ffe9a6';
    const shade = night ? '#a86f0a' : '#c07f00';
    for (let r = 0; r < ph; r++) {
      const y = groundY - ph + r;
      const half = Math.round(1 + r * 1.15 + Math.max(0, r - 4) * 0.45);
      const layer = Math.floor((ph - 1 - r) / thick); // 0 が一番下（最初に確定した月）
      const base = pal[layer % pal.length];
      for (let x = cx - half; x <= cx + half - 1; x++) {
        let c = base;
        const n = noise(x, y);
        if (x <= cx - half + 1)
          c = light; // 左の縁に光
        else if (x >= cx + half - 2)
          c = shade; // 右の縁は影
        else if (n > 0.93) c = shade;
        else if (n < 0.05) c = light;
        px(x, y, 1, 1, c);
      }
    }
    if (flag) {
      const fy = groundY - ph - 7;
      px(cx, fy, 1, 7, night ? '#d9d4ff' : '#3a3530');
      px(cx + 1, fy, 4, 1, '#e5484d');
      px(cx + 1, fy + 1, 5, 1, '#e5484d');
      px(cx + 1, fy + 2, 4, 1, '#e5484d');
    }
  } else {
    // まだ平地：小さな塵の粒だけ
    px(cx - 2, groundY - 1, 4, 1, night ? STRATA.night[0] : STRATA.light[0]);
    px(cx - 1, groundY - 2, 2, 1, night ? STRATA.night[2] : STRATA.light[2]);
  }

  // 降ってくる塵
  const dust = night ? '#ffe08a' : '#e9a300';
  const top = groundY - ph - (flag ? 9 : 2);
  [
    [-5, 0.15],
    [3, 0.5],
    [-1, 0.8],
    [7, 0.3],
    [-9, 0.6],
  ].forEach(([dx, t], i) => {
    const y = Math.max(1, Math.round(t * Math.max(3, top - 2)));
    parts.push(`<rect class="dust d${i}" x="${cx + dx}" y="${y}" width="1" height="1" fill="${dust}"/>`);
  });

  // 地面
  px(0, groundY, W, H - groundY, GROUND[phase]);
  px(0, groundY, W, 1, night ? '#2a3266' : '#ffffff55');
  return `<svg class="mountain phase-${phase}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
}

// 形のチェック（描き間違いで行の長さがずれていないか）
for (const [k, g] of Object.entries(GLYPHS)) if (g.length !== GW || g.some((r) => r.length !== GW)) throw new Error(`ドット文字 ${k} の大きさがずれています`);
for (const [k, g] of Object.entries(ICONS)) if (g.length !== 12 || g.some((r) => r.length !== 12)) throw new Error(`ドットの絵 ${k} の大きさがずれています`);
if (MARK.length !== 16 || MARK.some((r) => r.length !== 16)) throw new Error('山のしるしの大きさがずれています');
