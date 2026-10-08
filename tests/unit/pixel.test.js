// ドット絵（ロゴ・アイコン・チリツモ山）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS, PIXEL_ICONS, pixelIconMarkup, wordmarkSvg, wordSvg, appIconSvg, mountainMarkup } from '../../app/js/ui/pixel.js';
import { CATEGORIES } from '../../app/js/core/constants.js';

test('ロゴと看板の文字がそろっている', () => {
  for (const ch of 'チリツモサブスク荘') assert.ok(GLYPHS[ch], `${ch} の字形がありません`);
  assert.match(wordmarkSvg(), /aria-label="チリツモ"/);
  assert.match(wordSvg('サブスク荘'), /aria-label="サブスク荘"/);
});

test('カテゴリー・口座の種類にドット絵がある（絵文字に頼らない）', () => {
  for (const c of CATEGORIES) assert.ok(PIXEL_ICONS.includes(c.id), `${c.id} の絵がありません`);
  for (const t of ['bank', 'investment', 'loan', 'coin', 'transfer', 'card', 'star']) assert.ok(PIXEL_ICONS.includes(t), t);
  assert.match(pixelIconMarkup('food'), /aria-hidden="true"/);
});

test('チリツモ山：確定した月の数だけ地層が積もり、画面に収まる。0か月は平地', () => {
  const rows = (m) =>
    new Set([...m.matchAll(/<rect x="\d+" y="(\d+)" width="1" height="1" fill="#(?:f5b700|e9a300|ffc933|dc9600|ffe9a6|c07f00)"/g)].map((x) => Number(x[1])));
  const flat = mountainMarkup({ phase: 'day', layers: 0 });
  const one = mountainMarkup({ phase: 'day', layers: 1 });
  const many = mountainMarkup({ phase: 'day', layers: 200, flag: true });
  assert.equal(rows(flat).size, 0);
  assert.ok(rows(one).size >= 1);
  assert.ok(rows(many).size > rows(one).size);
  assert.ok(Math.min(...rows(many)) >= 0, '空からはみ出さない');
  for (const phase of ['morning', 'day', 'evening', 'night']) assert.match(mountainMarkup({ phase, layers: 3 }), new RegExp(`phase-${phase}`));
});

test('アプリのアイコン（通常・マスク用）', () => {
  assert.match(appIconSvg({ size: 192 }), /width="192"/);
  assert.match(appIconSvg({ size: 512, maskable: true }), /viewBox="0 0 24 24"/);
});
