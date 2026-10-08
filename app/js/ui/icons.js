// 線画アイコン（装飾用の固定SVG）
import { svgFromString } from './dom.js';

const wrap = (body, size = 22) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  // 蔵（資産）
  kura: '<path d="M3 9.5 12 4l9 5.5"/><path d="M4.5 8.6h15"/><rect x="5.5" y="9.5" width="13" height="10" rx="1"/><circle cx="12" cy="13" r="1.6"/><path d="M5.5 16.2h13"/>',
  // 帳面（記録）
  book: '<path d="M6 3.5h11.5a1 1 0 0 1 1 1V20a.5.5 0 0 1-.5.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M4 18.5a2 2 0 0 1 2-2h12.5"/><path d="M8.5 8h6M8.5 11h4"/>',
  // 振り返り
  chart: '<path d="M4 19.5h16"/><rect x="5.5" y="11" width="3" height="6.5" rx=".6"/><rect x="10.5" y="7" width="3" height="10.5" rx=".6"/><rect x="15.5" y="13" width="3" height="4.5" rx=".6"/>',
  // アパート（サブスク荘）
  apartment:
    '<path d="M3.5 8.5 12 4l8.5 4.5"/><rect x="5" y="8.5" width="14" height="11" rx=".8"/><path d="M8 11.5h2.2M13.8 11.5H16M8 14.8h2.2M13.8 14.8H16"/><path d="M11 19.5v-2.8h2v2.8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8Z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 15.5v-11M7 9l5-5 5 5"/><path d="M4.5 19.5h15"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>',
  stamp: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.5l3 3 5.5-6"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v3.8h3.8"/><path d="M12 8v4.5l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 8.5 12 13l3.5-4.5M12 13v5M9 13.5h6M9 16h6"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
};

export function icon(name, size) {
  return svgFromString(wrap(PATHS[name] ?? PATHS.info, size));
}
