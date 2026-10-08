// はじめの準備（よくある口座の組み合わせをまとめて登録）と、月末の残高のまとめ入力
import { h } from '../dom.js';
import { app } from '../../app.js';
import { openSheet, toast, playStamp } from '../overlay.js';
import { amountInput, field, textInput, checkbox, saveButton, formError, segmented, select } from '../fields.js';
import { accTile } from '../parts.js';
import { icon } from '../icons.js';
import * as A from '../../core/actions.js';
import { ACCOUNT_TYPES } from '../../core/constants.js';
import { formatYen } from '../../core/money.js';
import { addDays, formatDateShort, formatMonth, lastDayOfMonth, monthOf } from '../../core/dates.js';
import { monthEndStatus } from '../../core/assets.js';

const PRESETS = [
  { role: 'salary', type: 'bank', name: '給与の口座', hint: 'お給料が入る・ふだん使いの口座' },
  { role: 'savings', type: 'bank', name: '貯金の口座', hint: '貯めておく口座（奨学金の引き落としなど）' },
  { role: 'nisa', type: 'investment', name: 'NISA', hint: 'つみたて投資の評価額' },
  { role: 'loan', type: 'loan', name: '奨学金', hint: '元金の残り' },
];

export function openSetupSheet() {
  const today = app.today();
  const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  openSheet({
    title: 'はじめの準備',
    build: (sheet) => {
      let start = 'lastMonth';
      const startSel = segmented(
        [
          ['lastMonth', `先月末（${formatDateShort(lastMonthEnd)}）の残高から`],
          ['today', '今日から'],
        ],
        start,
        (v) => (start = v),
        { label: '始める時点' },
      );
      const rows = [];
      const list = h('div', { class: 'stack tight' });
      const addRow = (preset) => {
        const on = checkbox('', true);
        on.input.setAttribute('aria-label', `${preset.name}を登録する`);
        const name = textInput({ value: preset.name, maxlength: 60, label: '名前' });
        let type = preset.type;
        let typeCtl = null;
        if (!preset.role) {
          typeCtl = select(
            Object.entries(ACCOUNT_TYPES).map(([k, v]) => [k, v.label]),
            type,
            { label: '種類' },
          );
          typeCtl.addEventListener('change', () => {
            type = typeCtl.value;
            principalBox.hidden = type !== 'loan';
          });
        }
        const principal = amountInput({ allowZero: false, label: '当初の元金' });
        const principalBox = h(
          'div',
          { class: 'extra', hidden: type !== 'loan' },
          field('当初の元金（分かれば）', principal.el, { id: principal.id, hint: '分かると、奨学金の進み具合をメーターで見られます。' }),
        );
        const row = h(
          'div',
          { class: 'setup-row' },
          on.input,
          accTile(type, 'm'),
          h('div', { class: 'stack tight' }, name, preset.hint ? h('span', { class: 'field-hint' }, preset.hint) : typeCtl),
          principalBox,
        );
        on.input.addEventListener('change', () => row.classList.toggle('off', !on.input.checked));
        rows.push({
          preset,
          on,
          name,
          principal,
          get type() {
            return type;
          },
        });
        list.append(row);
      };
      PRESETS.forEach(addRow);
      const moves = checkbox('毎月の振替・積立・返済・給与を「いつもの動き」として用意する', true, {
        hint: '記録するときに1タップで呼び出せるひな形です（金額は空欄。最初に使うときに入れられます）。記録は任意です。',
      });
      const err = formError();
      const save = saveButton('この内容で始める', async () => {
        err.clear();
        const accounts = [];
        for (const r of rows) {
          if (!r.on.input.checked) continue;
          let initialPrincipalYen = null;
          if (r.type === 'loan' && !r.principal.isEmpty()) {
            const v = r.principal.read();
            if (!v.ok) return err.show(`${r.name.value}：${v.error}`);
            initialPrincipalYen = v.value;
          }
          accounts.push({ role: r.preset.role, name: r.name.value, type: r.type, initialPrincipalYen });
        }
        const managedFrom = start === 'lastMonth' ? lastMonthEnd : today;
        const res = A.setupAccounts(app.state, { managedFrom, accounts, quickMoves: moves.get() }, app.ctx());
        if (!res.ok) return err.show(res.message);
        const saved = await app.save(res, { okMessage: `${res.records.length}つの口座を登録しました` });
        if (!saved.ok) return err.show(`${saved.message}。入力はそのまま残っています。`);
        sheet.close({ then: () => (start === 'lastMonth' ? openMonthEndBulkSheet(monthOf(lastMonthEnd)) : app.navigate('assets')) });
      });
      return h(
        'form',
        { class: 'stack', onsubmit: save.run, novalidate: true },
        h(
          'p',
          { class: 'note' },
          'よくある組み合わせを用意しました。名前は自由に変えられます（銀行名を入れても、入れなくても大丈夫）。使わないものはチェックを外してください。',
        ),
        list,
        h('button', { type: 'button', class: 'link-btn', onclick: () => addRow({ type: 'bank', name: '' }) }, '＋ 口座をもう1つ'),
        field('どこから管理を始める？', startSel.el, {
          hint: '先月末から始めると、すぐに先月末の残高をまとめて記録して月末を確定できます。金融機関の履歴で先月末の残高を確認してください。',
        }),
        moves.el,
        err.el,
        h('div', { class: 'btn-row' }, save.el),
      );
    },
  });
}

/**
 * 月末の残高をまとめて記録。基準日＝月末、実残高、月末の終了時点として確認（ボタンを押すことが確認の操作）。
 */
export function openMonthEndBulkSheet(ym) {
  const today = app.today();
  const end = lastDayOfMonth(ym);
  const ms = monthEndStatus(app.state, ym, today);
  const todo = ms.items.filter((i) => !i.adopted && i.problem !== 'conflict');
  const done = ms.items.filter((i) => i.adopted);
  openSheet({
    title: `${formatMonth(ym)}末の残高`,
    build: (sheet) => {
      if (todo.length === 0) {
        return h(
          'div',
          { class: 'stack' },
          h('p', null, ms.items.length ? 'この月末の残高はそろっています。' : 'この月末に管理している口座はありません。'),
          h(
            'div',
            { class: 'btn-row' },
            h(
              'button',
              { type: 'button', class: 'btn primary', onclick: () => sheet.close({ then: () => app.navigate(`assets/month/${ym}`) }) },
              '月末のページへ',
            ),
          ),
        );
      }
      const inputs = todo.map((item, i) => {
        const prefill = item.problem === 'time_unknown' ? item.related[0].amountYen : null;
        const amount = amountInput({
          value: prefill,
          allowZero: true,

          autofocus: i === 0,
          label: `${item.account.name}の${item.account.type === 'loan' ? '元金の残高' : item.account.type === 'investment' ? '評価額' : '残高'}`,
        });
        const hint =
          item.problem === 'time_unknown'
            ? `${formatDateShort(end)} の値 ${formatYen(prefill)} が記録済み（終了時点か未確認）。終了時点の値なら、そのまま記録できます。`
            : item.problem === 'estimate_only'
              ? '推計だけが記録されています。実際の残高を入力してください。'
              : item.account.type === 'loan'
                ? '利息を含まない元金の残り'
                : item.account.type === 'investment'
                  ? '月末の評価額（金融機関が示す月末の値）'
                  : '月末の終了時点の残高';
        return {
          item,
          amount,
          el: h(
            'li',
            { class: 'bulk-row' },
            accTile(item.account.type, 's'),
            h('span', { class: 'bulk-name' }, item.account.name),
            amount.el,
            h('p', { class: 'field-hint', style: { gridColumn: '1 / -1' } }, hint),
          ),
        };
      });
      const confirmChk = checkbox(`記録したら、そのまま${formatMonth(ym)}末を確定する`, true, { hint: '空欄の口座があるときは確定しません。' });
      const err = formError();
      const save = saveButton(`${formatDateShort(end)} の終了時点の残高として記録`, async () => {
        err.clear();
        const entries = [];
        let empty = 0;
        for (const it of inputs) {
          if (it.amount.isEmpty()) {
            empty += 1;
            continue;
          }
          const r = it.amount.read();
          if (!r.ok) {
            it.amount.input.focus();
            return err.show(`${it.item.account.name}：${r.error}`);
          }
          entries.push({ accountId: it.item.account.id, amountYen: r.value });
        }
        if (entries.length === 0) return err.show('金額を入力してください');
        const confirm = confirmChk.get() && empty === 0;
        const res = A.recordMonthEndBatch(app.state, ym, entries, { confirm }, app.ctx());
        if (!res.ok) return err.show(res.message);
        const saved = await app.save(res, {
          okMessage: confirm ? `${formatMonth(ym)}末を確定しました` : `${entries.length}件の月末残高を記録しました${empty ? `（あと${empty}件）` : ''}`,
        });
        if (!saved.ok) return err.show(`${saved.message}。入力はそのまま残っています。`);
        sheet.close();
        if (confirm) playStamp();
        else if (confirmChk.get() && empty) toast(`空欄が${empty}件あるので、まだ確定していません`, { kind: 'info' });
      });
      return h(
        'form',
        { class: 'stack', onsubmit: save.run, novalidate: true },
        h(
          'p',
          { class: 'note' },
          `${formatDateLong(end)} の終わりの時点の残高を、金融機関の履歴や月末の評価額で確かめて入力してください。今日の値で代わりにしないでください。`,
        ),
        h(
          'ul',
          { class: 'bulk-list' },
          inputs.map((i) => i.el),
        ),
        done.length
          ? h(
              'p',
              { class: 'small muted' },
              icon('check', 14),
              ` 記録済み：${done.map((d) => `${d.account.name} ${formatYen(d.adopted.amountYen)}`).join('、')}`,
            )
          : null,
        confirmChk.el,
        err.el,
        h('div', { class: 'btn-row' }, save.el),
      );
    },
  });
}

function formatDateLong(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return `${y}年${m}月${dd}日`;
}
