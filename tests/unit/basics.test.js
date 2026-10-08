// 金額・日付の基本規則
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYenInput, formatYen, formatDelta, sumYen, MAX_YEN, formatPercent } from '../../app/js/core/money.js';
import { isValidDate, isValidMonth, lastDayOfMonth, addMonths, weekStart, monthRange, dateInMonth, stampToDateJST } from '../../app/js/core/dates.js';

test('金額：カンマ・全角・円記号は入力補助として受け付ける', () => {
  assert.deepEqual(parseYenInput('1,234'), { ok: true, value: 1234 });
  assert.deepEqual(parseYenInput('１２３４'), { ok: true, value: 1234 });
  assert.deepEqual(parseYenInput('¥6,800'), { ok: true, value: 6800 });
  assert.deepEqual(parseYenInput(' 980円 '), { ok: true, value: 980 });
  assert.deepEqual(parseYenInput('0'), { ok: true, value: 0 });
});

test('金額：小数・文字・NaN・Infinity・桁あふれ・空は拒否', () => {
  for (const bad of ['1.5', 'abc', 'NaN', 'Infinity', '1e5', '', '   ', '12a', '9999999999999', '0x10']) {
    assert.equal(parseYenInput(bad).ok, false, bad);
  }
  assert.equal(parseYenInput('-100').ok, false);
  assert.deepEqual(parseYenInput('-100', { allowNegative: true }), { ok: true, value: -100 });
  assert.equal(parseYenInput('0', { allowZero: false }).ok, false);
  assert.equal(parseYenInput(String(MAX_YEN)).ok, true);
});

test('金額：合計は安全な整数範囲で検査する', () => {
  assert.equal(sumYen([1, 2, 3]), 6);
  assert.throws(() => sumYen([0.5]));
  assert.throws(() => sumYen([Number.MAX_SAFE_INTEGER, 1]));
});

test('金額の表示（負数・増減・割合）', () => {
  assert.equal(formatYen(-200000), '−¥200,000');
  assert.equal(formatYen(0), '¥0');
  assert.equal(formatDelta(70000), '+¥70,000');
  assert.equal(formatDelta(-20000), '−¥20,000');
  assert.equal(formatDelta(0), '±¥0');
  assert.equal(formatPercent(null), '未算出');
  assert.equal(formatPercent(33.333), '33.3%');
});

test('日付の検証と月の計算', () => {
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2026-02-29'));
  assert.ok(!isValidDate('2026-13-01'));
  assert.ok(!isValidDate('2026-1-01'));
  assert.ok(isValidMonth('2026-10'));
  assert.ok(!isValidMonth('2026-00'));
  assert.equal(lastDayOfMonth('2026-02'), '2026-02-28');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 14), '2028-01');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(dateInMonth('2026-04', 31), '2026-04-30');
  assert.equal(stampToDateJST('2026-10-31T15:30:00Z'), '2026-11-01');
});
