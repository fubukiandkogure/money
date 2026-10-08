// 口座の登録・編集と、残高の記録・訂正・取り消し
import { h } from '../dom.js';
import { app } from '../../app.js';
import { openSheet, confirmDialog } from '../overlay.js';
import { amountInput, dateInput, field, setFieldError, textInput, checkbox, saveButton, formError, segmented } from '../fields.js';
import * as A from '../../core/actions.js';
import { ACCOUNT_TYPES } from '../../core/constants.js';
import { formatYen } from '../../core/money.js';
import { formatDateLong, formatDateShort, isLastDayOfMonth, monthOf, lastDayOfMonth, formatMonth } from '../../core/dates.js';

export function openAccountSheet({ account } = {}) {
  const editing = !!account;
  const today = app.today();
  const hasRecords = editing && app.state.snapshots.some((s) => s.accountId === account.id);
  openSheet({
    title: editing ? '口座を編集' : '口座を追加',
    build: (sheet) => {
      let type = account?.type ?? 'bank';
      const typeSel = segmented(
        Object.entries(ACCOUNT_TYPES).map(([k, v]) => [k, `${v.icon} ${v.label}`]),
        type,
        (t) => {
          type = t;
          loanBox.hidden = t !== 'loan';
        },
        { label: '種類' },
      );
      if (hasRecords) typeSel.el.querySelectorAll('button').forEach((b) => (b.disabled = true));
      const name = textInput({ value: account?.name ?? '', placeholder: '例：給与の口座、つみたてNISA', maxlength: 60, label: '名前' });
      name.setAttribute('data-autofocus', '');
      const nameField = field('名前', name, { id: name.id, hint: '自分が分かる呼び名で十分です。口座番号やパスワードは入力しないでください。' });
      const from = dateInput({ value: account?.managedFrom ?? today, today, quick: false });
      let startKind = account?.startKind ?? 'existing';
      const startSel = segmented(
        [
          ['existing', '以前から持っている'],
          ['new', 'この日に新しく開設'],
        ],
        startKind,
        (v) => (startKind = v),
        { label: '開始の種類' },
      );
      const principal = amountInput({ value: account?.initialPrincipalYen ?? null, allowZero: false });
      const loanBox = h(
        'div',
        { hidden: type !== 'loan' },
        field('当初の元金（任意）', principal.el, {
          id: principal.id,
          hint: '分かる場合だけ。入力すると返済済み額と返済率を表示します。分からなければ空欄のままで大丈夫です。',
        }),
      );
      const note = textInput({ value: account?.note ?? '', placeholder: '任意', maxlength: 500, label: 'メモ' });

      // 管理終了（編集時のみ）
      let endBox = null;
      let until = null;
      let endKind = account?.endKind ?? 'zero';
      let endOn = !!account?.managedUntil;
      if (editing) {
        until = dateInput({ value: account.managedUntil ?? today, today, quick: false });
        const endSel = segmented(
          [
            ['zero', '解約・完済して0円になった'],
            ['untracked', '管理をやめた（残高は不明）'],
          ],
          endKind,
          (v) => (endKind = v),
          { label: '終了の種類' },
        );
        const endChk = checkbox('この口座の管理を終える', endOn);
        const inner = h('div', { class: 'stack', hidden: !endOn }, field('終了した日', until.el, { hint: 'この日以降の月末は対象外になります。' }), endSel.el);
        endChk.input.addEventListener('change', () => {
          endOn = endChk.get();
          inner.hidden = !endOn;
        });
        endBox = h('details', { class: 'more', open: endOn || undefined }, h('summary', null, '解約・完済・管理終了'), endChk.el, inner);
      }

      const err = formError();
      const save = saveButton(editing ? '保存する' : '追加する', async () => {
        err.clear();
        if (!name.value.trim()) {
          setFieldError(nameField, '名前を入力してください');
          return;
        }
        setFieldError(nameField, null);
        let initialPrincipalYen = null;
        if (type === 'loan' && !principal.isEmpty()) {
          const r = principal.read();
          if (!r.ok) {
            err.show(`当初の元金：${r.error}`);
            return;
          }
          initialPrincipalYen = r.value;
        }
        let res;
        if (editing) {
          const patch = { name: name.value, note: note.value, managedFrom: from.get(), startKind, managedUntil: endOn ? until.get() : null, endKind };
          if (type === 'loan') patch.initialPrincipalYen = initialPrincipalYen;
          const scopeChanged = patch.managedFrom !== account.managedFrom || (patch.managedUntil ?? null) !== (account.managedUntil ?? null);
          const closed = app.state.closes.length > 0;
          if (scopeChanged && closed) {
            const ok = await confirmDialog({
              title: '管理期間を変更しますか？',
              message: '対象口座が変わる月の月末確定は「要再確認」になります。確定の履歴は残ります。',
              okLabel: '変更する',
            });
            if (!ok) return;
          }
          res = A.updateAccount(app.state, account.id, patch, app.ctx());
        } else {
          res = A.createAccount(app.state, { name: name.value, type, managedFrom: from.get(), startKind, initialPrincipalYen, note: note.value }, app.ctx());
        }
        if (!res.ok) {
          err.show(res.message);
          return;
        }
        const saved = await app.save(res, { okMessage: editing ? '保存しました' : `「${res.record.name}」を追加しました` });
        if (!saved.ok) {
          err.show(`${saved.message}。入力はそのまま残っています。`);
          return;
        }
        sheet.close({
          then: editing ? undefined : () => openSnapshotSheet({ account: res.record, firstTime: true }),
        });
      });
      return h(
        'form',
        { class: 'stack', onsubmit: save.run, novalidate: true },
        field('種類', typeSel.el, { hint: hasRecords ? '残高の記録がある口座は種類を変えられません。' : undefined }),
        nameField,
        field('管理を始める日', from.el, { hint: 'この日以降の月末に、この口座の残高が必要になります。登録前の月を0円とはみなしません。' }),
        field('この口座は', startSel.el, {
          hint: '「新しく開設」なら開設前を0円として前の月と比べられます。以前からある口座を途中から管理し始めた場合は、増えた分を成果と誤解しないよう前月比を保留します。',
        }),
        loanBox,
        field('メモ', note, { id: note.id }),
        endBox,
        err.el,
        h('div', { class: 'btn-row' }, save.el),
      );
    },
  });
}

/**
 * 残高の記録。correct を渡すと訂正（新しい版として保存し、旧記録は履歴に残す）。
 * monthEnd に 'YYYY-MM' を渡すと、その月末の終了時点の値として入力する前提で開く。
 */
export function openSnapshotSheet({ account, correct, monthEnd, firstTime = false } = {}) {
  const today = app.today();
  const loan = account.type === 'loan';
  openSheet({
    title: correct ? '残高を訂正' : `${account.name} の残高`,
    build: (sheet) => {
      const initDate = correct?.asOfDate ?? (monthEnd ? lastDayOfMonth(monthEnd) : today);
      const amount = amountInput({
        value: correct?.amountYen ?? null,
        autofocus: true,
        allowZero: true,
        allowNegative: account.type === 'bank',
        big: true,
        label: loan ? '元金の残高' : '残高',
      });
      const amountField = field(loan ? '元金の残高' : account.type === 'investment' ? '評価額' : '残高', amount.el, {
        id: amount.id,
        hint: loan ? '利息を含まない元金の残り。返済の記録からは自動計算しません。' : '金融機関で確認した金額。0円も有効な値です。',
      });
      let kind = correct?.kind ?? 'actual';
      const date = dateInput({ value: initDate, today, monthEndShortcut: true });
      const meChk = checkbox('月末の終了時点の残高として確認した', correct ? correct.monthEndVerified : !!monthEnd, {
        hint: '金融機関の履歴・月末の評価額などで確認した値だけ。月末の朝に見た値は、その日の終わりの残高とは限りません。',
      });
      const meBox = h('div', { class: 'me-box' }, meChk.el);
      const kindSel = segmented(
        [
          ['actual', '確認した実残高'],
          ['estimate', '推計（概算）'],
        ],
        kind,
        (v) => {
          kind = v;
          sync();
        },
        { label: '区分' },
      );
      const kindHint = h('p', { class: 'field-hint' });
      const sync = () => {
        const d = date.get();
        meBox.hidden = !(kind === 'actual' && isLastDayOfMonth(d));
        kindHint.textContent =
          kind === 'estimate'
            ? '推計は合計や月末確定には使いません（参考表示のみ）。未来の日付も推計なら記録できます。'
            : '実残高は今日までの日付だけ。合計・月末確定の基準になります。';
      };
      date.input.addEventListener('change', sync);
      sync();
      const note = textInput({ value: correct?.note ?? '', placeholder: '任意', maxlength: 500, label: 'メモ' });
      const err = formError();
      const doSave = async (extra = {}) => {
        const a = amount.read();
        setFieldError(amountField, a.ok ? null : a.error);
        if (!a.ok) return;
        const input = {
          accountId: account.id,
          amountYen: a.value,
          asOfDate: date.get(),
          kind,
          monthEndVerified: kind === 'actual' && isLastDayOfMonth(date.get()) && meChk.get(),
          note: note.value,
          revisionOf: correct?.id ?? null,
          ...extra,
        };
        const res = A.addSnapshot(app.state, input, app.ctx());
        if (!res.ok) {
          if (res.code === 'same_day_exists') {
            const ex = [...res.existing].sort((x, y) => y.recordedAt.localeCompare(x.recordedAt))[0];
            const ok = await confirmDialog({
              title: '同じ日の記録があります',
              message: `${formatDateLong(ex.asOfDate)} の${ex.kind === 'actual' ? '実残高' : '推計'} ${formatYen(ex.amountYen)} があります。この記録を新しい金額に訂正しますか？ 元の記録は履歴に残ります。`,
              okLabel: '訂正として保存',
            });
            if (ok) return doSave({ ...extra, revisionOf: ex.id });
            return;
          }
          if (res.code === 'before_managed_from') {
            const ok = await confirmDialog({
              title: '管理開始日より前の日付です',
              message: `この口座の管理開始日は ${formatDateLong(res.managedFrom)} です。管理開始日を ${formatDateLong(input.asOfDate)} に変更して保存しますか？`,
              okLabel: '変更して保存',
            });
            if (ok) return doSave({ ...extra, extendManagedFrom: true });
            return;
          }
          err.show(res.message);
          return;
        }
        const saved = await app.save(res, {
          okMessage: correct
            ? '訂正しました（元の記録は履歴に残っています）'
            : `${formatDateShort(input.asOfDate)} の${kind === 'actual' ? '残高' : '推計'}を記録しました`,
        });
        if (!saved.ok) {
          err.show(`${saved.message}。入力はそのまま残っています。`);
          return;
        }
        sheet.close();
      };
      const save = saveButton(correct ? '訂正を保存' : '記録する', () => doSave());
      return h(
        'form',
        { class: 'stack', onsubmit: save.run, novalidate: true },
        firstTime ? h('p', { class: 'note' }, `「${account.name}」を追加しました。続けて、確認した残高を記録しましょう（あとからでも大丈夫です）。`) : null,
        correct
          ? h(
              'p',
              { class: 'note' },
              `元の記録：${formatDateLong(correct.asOfDate)} ${formatYen(correct.amountYen)}（${correct.kind === 'actual' ? '実残高' : '推計'}）。訂正しても元の記録は履歴に残ります。`,
            )
          : null,
        amountField,
        field('いつ時点の残高？（基準日）', date.el, {
          hint: '確認した日ではなく、その金額が表す日付です。後日に確認した月末の残高は、月末日を選んでください。',
        }),
        meBox,
        field('区分', h('div', null, kindSel.el, kindHint)),
        field('メモ', note, { id: note.id }),
        err.el,
        h('div', { class: 'btn-row' }, save.el),
      );
    },
  });
}

export async function invalidateSnapshotFlow(snap) {
  let reasonInput;
  const ok = await confirmDialog({
    title: 'この記録を取り消しますか？',
    message: `${formatDateLong(snap.asOfDate)} ${formatYen(snap.amountYen)}。合計や月末確定には使われなくなりますが、記録は履歴に残ります。この記録を使った月末確定は「要再確認」になります。`,
    okLabel: '取り消す',
    danger: true,
    details: h('div', null, (reasonInput = textInput({ placeholder: '理由（任意）', label: '理由' }))),
  });
  if (!ok) return;
  await app.save(A.invalidateSnapshot(app.state, snap.id, reasonInput.value, app.ctx()), { okMessage: '取り消しました' });
}

/** 月末日の実残高（終了時点か未確認）を、終了時点の値として確認し直す（訂正の版として保存） */
export async function verifyAsMonthEnd(snap) {
  const ok = await confirmDialog({
    title: `${formatMonth(monthOf(snap.asOfDate))}末の終了時点の値ですか？`,
    message: `${formatDateLong(snap.asOfDate)} ${formatYen(snap.amountYen)} を、月末の終了時点の残高として確認します。金融機関の履歴などで確かめた場合だけ「はい」にしてください。`,
    okLabel: 'はい、終了時点の値です',
  });
  if (!ok) return;
  const res = A.addSnapshot(
    app.state,
    {
      accountId: snap.accountId,
      amountYen: snap.amountYen,
      asOfDate: snap.asOfDate,
      kind: 'actual',
      monthEndVerified: true,
      note: snap.note,
      revisionOf: snap.id,
    },
    app.ctx(),
  );
  await app.save(res, { okMessage: '月末の値として確認しました' });
}
