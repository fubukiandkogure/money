// 最小限の静的チェック（未定義の変数・使っていない import など）： npx eslint app tests
const browser = Object.fromEntries(
  [
    'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'indexedDB', 'crypto', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'requestAnimationFrame', 'matchMedia', 'URL', 'URLSearchParams',
    'Blob', 'File', 'DOMException', 'Event', 'Node', 'BroadcastChannel', 'structuredClone', 'self', 'caches', 'fetch',
    'Request', 'Response', 'globalThis', 'Proxy',
  ].map((k) => [k, 'readonly']),
);
const node = Object.fromEntries(['process', 'console', 'setTimeout', 'URL', 'globalThis', 'structuredClone'].map((k) => [k, 'readonly']));

export default [
  {
    files: ['app/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: browser },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], 'no-var': 'error', 'prefer-const': 'error' },
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...node, ...browser } },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
];
