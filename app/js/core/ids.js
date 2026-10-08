// 端末内で衝突しないID。編集しても変えない。

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId(prefix) {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID().replace(/-/g, '') : randomHex(16);
  return `${prefix}_${uuid}`;
}

export const ID_PREFIX = {
  accounts: 'acc',
  snapshots: 'bal',
  events: 'evt',
  contracts: 'sub',
  contractTerms: 'term',
  closes: 'close',
};

export function shortId() {
  return randomHex(4);
}
