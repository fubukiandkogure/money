// アプリ固有の識別子。旧サブスク荘（subseat:v1 等）とは別の名前を使う。
export const APP_ID = 'futokoro-machi';
export const APP_NAME = 'ふところ町';
export const APP_VERSION = '1.0.0';

/** バックアップJSON・端末内データの構造の版 */
export const SCHEMA_VERSION = 1;
/** 月末確定の計算方法の版。計算の意味を変えたら上げる（既存の確定は要再確認になる） */
export const CALC_VERSION = 1;

export const DB_NAME = 'futokoro-machi';
export const DEMO_DB_NAME = 'futokoro-machi-demo';

/** データを持つコレクション（IndexedDB のオブジェクトストア名と同じ） */
export const COLLECTIONS = [
  'accounts',
  'snapshots',
  'events',
  'contracts',
  'contractTerms',
  'paymentLinks',
  'closes',
];

export const ACCOUNT_TYPES = {
  bank: { label: '銀行', group: 'asset', icon: '🏦' },
  investment: { label: '投資', group: 'asset', icon: '🌱' },
  loan: { label: '奨学金', group: 'loan', icon: '🎓' },
};

/** 初期8カテゴリー（固定ID） */
export const CATEGORIES = [
  { id: 'food', label: '食費', icon: '🍙', sortOrder: 1 },
  { id: 'daily', label: '日用品', icon: '🧻', sortOrder: 2 },
  { id: 'shopping', label: '買い物・趣味', icon: '🛍️', sortOrder: 3 },
  { id: 'play', label: '遊び', icon: '🎳', sortOrder: 4 },
  { id: 'transport', label: '交通', icon: '🚃', sortOrder: 5 },
  { id: 'travel', label: '旅行', icon: '🧳', sortOrder: 6 },
  { id: 'subscription', label: 'サブスク', icon: '🏠', sortOrder: 7 },
  { id: 'other', label: 'その他', icon: '📦', sortOrder: 8 },
];
export const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
export const categoryById = (id) => CATEGORIES.find((c) => c.id === id) ?? null;

export const EVENT_KINDS = {
  expense: { label: '支出', short: '支出' },
  income: { label: '入金', short: '入金' },
  transfer: { label: '振替・積立', short: '振替' },
  repayment: { label: '奨学金の返済', short: '返済' },
  card_payment: { label: 'カードの引き落とし', short: 'カード精算' },
};

export const PAYMENT_METHODS = {
  cash: '現金',
  card: 'カード',
  bank: '口座から',
  emoney: '電子マネー・QR',
  other: 'その他',
};

export const INCOME_TYPES = {
  salary: '給与',
  bonus: 'ボーナス',
  other: 'その他の入金',
};

export const CONTRACT_STATUSES = {
  trial: { label: '内見中', long: '無料体験中（内見）' },
  active: { label: '入居中', long: '有料で利用中' },
  ended: { label: '退去', long: '終了（退去）' },
};

export const FREQUENCIES = {
  monthly: { label: '月払い', unit: '月' },
  yearly: { label: '年払い', unit: '年' },
};

/** 月末確定の状態 */
export const CLOSE_STATUS = {
  unconfirmed: '未確定',
  confirmed: '確定',
  needs_review: '要再確認',
};

/** 贅沢マークの表示名 */
export const LUXURY_LABEL = 'ごほうび';

export const DEFAULT_SETTINGS = Object.freeze({
  timeZone: 'Asia/Tokyo',
  currency: 'JPY',
  theme: 'auto',
});
