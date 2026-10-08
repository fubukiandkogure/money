// サブスク荘：入居（契約登録）・条件の変更・退去・支払の確認
import { h } from '../dom.js';
import { app } from '../../app.js';
import { openSheet, confirmDialog } from '../overlay.js';
import { amountInput, dateInput, field, setFieldError, textInput, checkbox, saveButton, formError, segmented, select } from '../fields.js';
import * as A from '../../core/actions.js';
import { FREQUENCIES, PAYMENT_METHODS, categoryById } from '../../core/constants.js';
import { formatYen } from '../../core/money.js';
import { addDays, formatDateShort, formatMonth, addMonths, formatDateLong } from '../../core/dates.js';
import { termAt, termsOf, linkForEvent } from '../../core/subs.js';
import { sortAccounts } from '../../core/assets.js';
import { isExpense, sortKey } from '../../core/spending.js';

function priceField(label, value, { hint } = {}) {
  const amount = amountInput({ value: value ?? null, allowZero: true });
  const unknown = checkbox('料金が分からない', value === null, { hint: '分からない料金は0円とは別に扱い、見込みの合計に入れません。' });
  const sync = () => {
    amount.input.disabled = unknown.get();
  };
  unknown.input.addEventListener('change', sync);
  sync();
  const f = field(label, h('div', { class: 'stack tight' }, amount.el, unknown.el), { id: amount.id, hint });
  return {
    el: f,
    read() {
      if (unknown.get()) return { ok: true, value: null };
      const r = amount.read();
      if (!r.ok) setFieldError(f, r.error);
      else setFieldError(f, null);
      return r;
    },
  };
}

export function openContractSheet() {
  const today = app.today();
  openSheet({
    title: '入居（サブスクを登録）',
    build: (sheet) => {
      const name = textInput({ placeholder: '例：動画配信、音楽、クラウド', maxlength: 60, label: 'サービス名' });
      name.setAttribute('data-autofocus', '');
      const nameField = field('サービス名', name, { id: name.id });
      let status = 'active';
      let frequency = 'monthly';
      const statusSel = segmented(
        [
          ['active', '入居中（有料）'],
          ['trial', '内見中（無料体験）'],
        ],
        status,
        (v) => {
          status = v;
          sync();
        },
        { label: '状態' },
      );
      const freqSel = segmented(
        Object.entries(FREQUENCIES).map(([k, v]) => [k, v.label]),
        frequency,
        (v) => (frequency = v),
        { label: '支払の周期' },
      );
      const price = priceField('料金', 980);
      const start = dateInput({ value: `${today.slice(0, 7)}-01`, today, quick: false });
      const due = dateInput({ value: '', today, quick: false, label: '次回の支払予定日' });
      const trialEnd = dateInput({ value: '', today, quick: false, label: '無料期間の終了日' });
      const trialBox = h('div', { hidden: true }, field('無料期間の終了日（分かれば）', trialEnd.el));
      const priceLabel = price.el.querySelector('.field-label');
      const dueBox = field('次回の支払予定日（任意）', due.el, {
        hint: '分かれば、毎月（年払いなら毎年）その日を支払の候補日として出します。候補は実績ではありません。',
      });
      const sync = () => {
        trialBox.hidden = status !== 'trial';
        dueBox.hidden = status === 'trial';
        priceLabel.textContent = status === 'trial' ? '内見のあとの料金（予定）' : '料金';
      };
      sync();
      const note = textInput({ placeholder: '任意', maxlength: 500, label: 'メモ' });
      const err = formError();
      const save = saveButton('入居する', async () => {
        err.clear();
        if (!name.value.trim()) {
          setFieldError(nameField, 'サービス名を入力してください');
          return;
        }
        setFieldError(nameField, null);
        const p = price.read();
        if (!p.ok) return;
        const res = A.createContract(
          app.state,
          {
            displayName: name.value,
            status,
            priceYen: p.value,
            frequency,
            startOn: start.get(),
            nextDueOn: status === 'active' ? due.get() || null : null,
            trialEndsOn: status === 'trial' ? trialEnd.get() || null : null,
            note: note.value,
          },
          app.ctx(),
        );
        if (!res.ok) {
          err.show(res.message);
          return;
        }
        const saved = await app.save(res, {
          okMessage: `${res.record.roomNo}号室に「${res.record.displayName}」が${status === 'trial' ? '内見に来ました' : '入居しました'}`,
        });
        if (!saved.ok) {
          err.show(`${saved.message}。入力はそのまま残っています。`);
          return;
        }
        sheet.close();
      });
      return h(
        'form',
        { class: 'stack', onsubmit: save.run, novalidate: true },
        h('p', { class: 'note' }, '1つのサービス＝1部屋。合計額ではなく、サービスごとに登録します。'),
        nameField,
        field('状態', statusSel.el),
        price.el,
        field('支払の周期', freqSel.el),
        field('いつから（この条件で）', start.el, {
          hint: '以前から使っている場合は、分かる範囲の日付で大丈夫です（今月1日のままでも構いません）。この日より前の月には支払の候補を出しません。',
        }),
        dueBox,
        trialBox,
        field('メモ', note, { id: note.id }),
        err.el,
        h('div', { class: 'btn-row' }, save.el),
      );
    },
  });
}

export function openContractEditSheet(contract) {
  openSheet({
    title: '部屋の名札を編集',
    build: (sheet) => {
      const name = textInput({ value: contract.displayName, maxlength: 60, label: 'サービス名' });
      const note = textInput({ value: contract.note, maxlength: 500, label: 'メモ' });
      const err = formError();
      const save = saveButton('保存する', async () => {
        const res = A.updateContract(app.state, contract.id, { displayName: name.value, note: note.value }, app.ctx());
        if (!res.ok) return err.show(res.message);
        const saved = await app.save(res, { okMessage: '保存しました' });
        if (!saved.ok) return err.show(saved.message);
        sheet.close();
      });
      return h(
        'form',
        { class: 'stack', onsubmit: save.run, novalidate: true },
        field('サービス名', name, { id: name.id }),
        field('メモ', note, { id: note.id }),
        err.el,
        h('div', { class: 'btn-row' }, save.el),
      );
    },
  });
}

/**
 * 条件の変更。mode: 'change'（料金・周期・支払日）| 'start_paid'（内見→入居）| 'end'（退去）
 */
export function openTermsSheet(contract, mode) {
  const today = app.today();
  const terms = termsOf(app.state, contract.id);
  const cur = termAt(terms, today) ?? terms[terms.length - 1];
  const titles = { change: '料金・周期を変更', start_paid: '入居（有料に切り替え）', end: '退去（解約）' };
  openSheet({
    title: titles[mode],
    build: (sheet) => {
      const parts = [];
      const err = formError();
      let effDefault = today;
      if (mode === 'start_paid' && cur.trialEndsOn) effDefault = addDays(cur.trialEndsOn, 1);
      const eff = dateInput({ value: effDefault, today, quick: false });
      let price = null;
      let frequency = cur.frequency;
      let due = null;
      let cancelled = null;
      if (mode === 'end') {
        cancelled = dateInput({ value: today, today, quick: false });
        parts.push(
          h(
            'p',
            { class: 'note' },
            '解約の手続きをした日と、実際に利用・課金が終わる日（退去日）は分けて記録します。退去日までは今の見込みのまま、退去日から見込みが0になります。',
          ),
          field('解約の手続きをした日', cancelled.el),
          field('退去日（利用・課金が終わる日）', eff.el, { hint: 'この日から終了として扱います。未来の日付なら「退去予定」になります。' }),
        );
      } else {
        price = priceField(mode === 'start_paid' ? '入居後の料金' : '新しい料金', cur.priceYen);
        const freqSel = segmented(
          Object.entries(FREQUENCIES).map(([k, v]) => [k, v.label]),
          frequency,
          (v) => (frequency = v),
          { label: '支払の周期' },
        );
        due = dateInput({ value: '', today, quick: false });
        parts.push(
          mode === 'change'
            ? h('p', { class: 'note' }, '適用する日以降の見込みだけが変わります。過去の支払記録の金額は変わりません。')
            : h('p', { class: 'note' }, '内見（無料体験）から有料の利用に切り替えます。自動では切り替わりません。'),
          price.el,
          field('支払の周期', freqSel.el),
          field(mode === 'start_paid' ? '有料になる日' : '適用する日', eff.el),
          field('次回の支払予定日（任意）', due.el, { hint: '空欄なら今の支払日のままです。' }),
        );
      }
      const note = textInput({ placeholder: '任意', maxlength: 500, label: 'メモ' });
      parts.push(field('メモ', note, { id: note.id }), err.el);
      const save = saveButton(mode === 'end' ? '退去を記録' : '保存する', async () => {
        err.clear();
        const input = { effectiveOn: eff.get(), note: note.value };
        if (mode === 'end') {
          input.status = 'ended';
          input.cancelledOn = cancelled.get() || null;
        } else {
          const p = price.read();
          if (!p.ok) return;
          input.status = 'active';
          input.priceYen = p.value;
          input.frequency = frequency;
          if (due.get()) input.nextDueOn = due.get();
        }
        const res = A.changeTerms(app.state, contract.id, input, app.ctx());
        if (!res.ok) return err.show(res.message);
        const msg =
          mode === 'end' ? (input.effectiveOn > today ? `${formatDateShort(input.effectiveOn)} に退去予定です` : '退去しました') : '条件を記録しました';
        const saved = await app.save(res, { okMessage: msg });
        if (!saved.ok) return err.show(`${saved.message}。入力はそのまま残っています。`);
        sheet.close();
      });
      return h('form', { class: 'stack', onsubmit: save.run, novalidate: true }, parts, h('div', { class: 'btn-row' }, save.el));
    },
  });
}

/**
 * 支払の確認。row = paymentChecklist の行、または { contract, ym, extra: true }
 * 確認した支払だけを「サブスク」の支出として1件保存する。
 */
export function openPaymentSheet({ row, contract, ym, extra = false }) {
  const today = app.today();
  contract = contract ?? row.contract;
  ym = ym ?? row.ym;
  const expected = row?.expectedYen ?? null;
  const dueOn = row?.dueOn ?? null;
  openSheet({
    title: extra ? `${contract.displayName}：支払を追加` : `${contract.displayName}：${formatMonth(ym)}の支払`,
    build: (sheet) => {
      const mode = segmented(
        [
          ['new', '支払を記録'],
          ['link', '記録済みの支出と結ぶ'],
        ],
        'new',
        (v) => {
          newBox.hidden = v !== 'new';
          linkBox.hidden = v !== 'link';
        },
        { label: '方法' },
      );
      // 新しく記録
      const amount = amountInput({ value: expected, autofocus: true });
      const amountField = field('支払った金額', amount.el, {
        id: amount.id,
        hint: expected === null ? '料金が分からない契約です。実際に支払った金額を入力してください。' : '予定の金額です。実際と違えば直してください。',
      });
      let precision = 'day';
      const initDate = dueOn && dueOn <= today ? dueOn : ym === today.slice(0, 7) ? today : (dueOn ?? `${ym}-01`);
      const date = dateInput({ value: initDate, today });
      const dayBox = h('div', null, date.el);
      const monthNote = h(
        'p',
        { class: 'note', hidden: true },
        `日付不明（${formatMonth(ym)}）として記録します。月の合計には入り、日別・週別には配分しません。`,
      );
      const unknownDate = checkbox('支払った日が分からない（月だけ分かる）', false);
      unknownDate.input.addEventListener('change', () => {
        precision = unknownDate.get() ? 'month' : 'day';
        dayBox.hidden = precision === 'month';
        monthNote.hidden = precision !== 'month';
      });
      const pm = select(Object.entries(PAYMENT_METHODS), 'card', { emptyLabel: '指定しない', label: '支払方法' });
      const accounts = sortAccounts(app.state.accounts.filter((a) => a.type !== 'loan' && !a.archivedAt));
      const acc = select(
        accounts.map((a) => [a.id, a.name]),
        null,
        { emptyLabel: '指定しない', label: '口座' },
      );
      const err = formError();
      const save = saveButton('支払を記録', async () => {
        err.clear();
        const a = amount.read();
        setFieldError(amountField, a.ok ? (a.value > 0 ? null : '1円以上で入力してください') : a.error);
        if (!a.ok || a.value <= 0) return;
        const res = A.confirmPayment(
          app.state,
          {
            contractId: contract.id,
            ym,
            extra,
            amountYen: a.value,
            datePrecision: precision,
            occurredOn: precision === 'day' ? date.get() : null,
            yearMonth: precision === 'month' ? ym : undefined,
            paymentMethod: pm.value || null,
            accountId: acc.value || null,
          },
          app.ctx(),
        );
        if (!res.ok) return err.show(res.message);
        const saved = await app.save(res, { okMessage: `${contract.displayName} ${formatYen(a.value)} を支払済みにしました` });
        if (!saved.ok) {
          if (saved.kind === 'constraint') {
            err.show('この支払はすでに記録されています（二重には記録しません）。');
            return;
          }
          return err.show(`${saved.message}。入力はそのまま残っています。`);
        }
        sheet.close();
      });
      const newBox = h(
        'form',
        { class: 'stack', onsubmit: save.run, novalidate: true },
        amountField,
        field('支払った日', h('div', null, dayBox, monthNote)),
        unknownDate.el,
        h(
          'details',
          { class: 'more' },
          h('summary', null, 'くわしく（支払方法・口座）'),
          field('支払方法', pm, { id: pm.id }),
          field('口座', acc, { id: acc.id }),
        ),
        h('p', { class: 'field-hint' }, 'カテゴリー「サブスク」の支出として1件だけ記録されます。'),
        err.el,
        h('div', { class: 'btn-row' }, save.el),
      );

      // 既存の支出と結ぶ
      const linkBox = h('div', { class: 'stack', hidden: true });
      const months = [addMonths(ym, -1), ym, addMonths(ym, 1)];
      const candidates = app.state.events
        .filter((e) => isExpense(e) && months.includes(e.yearMonth) && !linkForEvent(app.state, e.id))
        .sort(
          (a, b) =>
            Math.abs(a.amountYen - (expected ?? a.amountYen)) - Math.abs(b.amountYen - (expected ?? b.amountYen)) || sortKey(b).localeCompare(sortKey(a)),
        );
      const setCat = checkbox('カテゴリーを「サブスク」に変える', true);
      if (candidates.length === 0) {
        linkBox.append(h('p', { class: 'empty' }, `${formatMonth(months[0])}〜${formatMonth(months[2])}に、結び付けられる支出がありません。`));
      } else {
        linkBox.append(
          h(
            'p',
            { class: 'note' },
            '普通の支出として記録済みの支払を選ぶと、その1件をこの支払として扱います（新しい支出は増えません）。金額や日付が一致しても自動では結び付けません。',
          ),
          setCat.el,
          h(
            'ul',
            { class: 'pick-list' },
            candidates.slice(0, 30).map((e) =>
              h(
                'li',
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'pick',
                    onclick: async (ev) => {
                      ev.currentTarget.disabled = true;
                      const res = A.linkExistingPayment(app.state, { contractId: contract.id, ym, eventId: e.id, extra, setCategory: setCat.get() }, app.ctx());
                      if (!res.ok) {
                        ev.currentTarget.disabled = false;
                        return err.show(res.message);
                      }
                      const saved = await app.save(res, { okMessage: '支出を結び付けました' });
                      if (saved.ok) sheet.close();
                      else ev.currentTarget.disabled = false;
                    },
                  },
                  h('span', { class: 'pick-date' }, e.datePrecision === 'month' ? `${formatMonth(e.yearMonth)}（日付不明）` : formatDateLong(e.occurredOn)),
                  h('span', { class: 'pick-main' }, `${categoryById(e.categoryId).icon} ${e.memo || categoryById(e.categoryId).label}`),
                  h('span', { class: 'pick-amount num' }, formatYen(e.amountYen)),
                ),
              ),
            ),
          ),
        );
      }
      return h('div', { class: 'stack' }, mode.el, newBox, linkBox);
    },
  });
}

export async function skipPaymentFlow(row) {
  const ok = await confirmDialog({
    title: `${formatMonth(row.ym)}は支払なし？`,
    message: `${row.contract.displayName} の ${formatMonth(row.ym)} 分は支払がなかったことにします（支出は作りません）。あとで取り消せます。`,
    okLabel: '支払なしにする',
  });
  if (!ok) return;
  await app.save(A.skipPayment(app.state, { contractId: row.contractId, ym: row.ym }, app.ctx()), { okMessage: '支払なしにしました' });
}

export async function undoPaymentFlow(row) {
  if (row.state === 'skipped') {
    await app.save(A.unlinkPayment(app.state, row.key), { okMessage: '未確認に戻しました' });
    return;
  }
  const choice = await new Promise((resolve) => {
    let result = null;
    openSheet({
      title: '支払の確認を取り消す',
      className: 'dialog',
      onClose: () => resolve(result),
      build: (api) =>
        h(
          'div',
          { class: 'stack' },
          h(
            'p',
            { class: 'dialog-message' },
            `${row.contract.displayName}：${formatYen(row.event.amountYen)}（${row.event.occurredOn ? formatDateLong(row.event.occurredOn) : '日付不明'}）`,
          ),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () => {
                result = 'unlink';
                api.close();
              },
            },
            '結び付けだけ外す（支出は残す）',
          ),
          h(
            'button',
            {
              class: 'btn danger',
              type: 'button',
              onclick: () => {
                result = 'remove';
                api.close();
              },
            },
            '支払の記録ごと削除する',
          ),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => api.close() }, 'やめる'),
        ),
    });
  });
  if (choice === 'unlink') await app.save(A.unlinkPayment(app.state, row.key), { okMessage: '結び付けを外しました（支出は残っています）' });
  if (choice === 'remove') await app.save(A.removePayment(app.state, row.key, app.ctx()), { okMessage: '支払の記録を削除しました' });
}

export async function deleteTermFlow(term) {
  const ok = await confirmDialog({
    title: 'この条件の記録を削除しますか？',
    message: `${formatDateLong(term.effectiveOn)} からの条件を削除します（入力の間違いを消すため）。支払の記録は変わりません。`,
    okLabel: '削除する',
    danger: true,
  });
  if (!ok) return;
  await app.save(A.deleteTerm(app.state, term.id), { okMessage: '削除しました' });
}
