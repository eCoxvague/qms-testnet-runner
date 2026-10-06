import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { Wallet, Transaction, parseEther, keccak256 } from 'ethers';
import { root, submit, childEnvironment, safeError } from '../scripts/lib.mjs';
import { createJournal } from '../scripts/tx-journal.mjs';

function fixture() {
  const cache = resolve(root, '.cache');
  mkdirSync(cache, { recursive: true });
  const folder = mkdtempSync(join(cache, 'transaction-safety-'));
  const account = Wallet.createRandom();
  const state = { signatures: 0, broadcasts: 0, nonce: 7 };
  const records = () => {
    try { return readdirSync(join(folder, 'reports')).filter(f => f.startsWith('tx-')).map(f =>
      JSON.parse(readFileSync(join(folder, 'reports', f), 'utf8'))); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  };
  const provider = {
    send: async () => '0x4c18', estimateGas: async () => 21000n,
    getFeeData: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }),
    getBalance: async () => parseEther('5'),
    getTransactionReceipt: async () => null,
    getBlockNumber: async () => 101,
    broadcastTransaction: async raw => {
      state.broadcasts++;
      const decoded = Transaction.from(raw);
      state.hash = keccak256(raw);
      assert.equal(decoded.chainId, 19480n);
      assert.equal(records().find(r => r.hash === state.hash)?.status, 'prepared', 'Hash must be durable before network send');
      return { hash: state.hash };
    },
    waitForTransaction: async hash => ({ hash, status: 1, blockNumber: 100, fee: 42000n,
      gasUsed: 21000n, contractAddress: null }),
  };
  const wallet = { address: account.address,
    populateTransaction: async tx => ({ ...tx, nonce: state.nonce++ }),
    signTransaction: async tx => { state.signatures++; state.raw = await account.signTransaction(tx); return state.raw; },
  };
  const send = broadcast => submit(provider, wallet, { to: '0x0000000000000000000000000000000000000002', value: 0n },
    'audit test', broadcast, folder, () => {});
  const cleanup = () => {
    assert.equal(dirname(resolve(folder)), cache);
    rmSync(folder, { recursive: true, force: true });
  };
  return { folder, account, wallet, provider, state, records, send, cleanup };
}

test('transaction hash is persisted before broadcast while private key and signed bytes stay out of files', async () => {
  const f = fixture();
  try {
    await f.send(true);
    assert.equal(f.records()[0].status, 'confirmed');
    assert.equal(f.state.broadcasts, 1);
    const text = JSON.stringify(f.records());
    assert.ok(!text.includes(f.account.privateKey));
    assert.ok(!text.includes(f.state.raw));
  } finally { f.cleanup(); }
});
test('accepted request followed by lost RPC response preserves the hash and blocks a duplicate attempt', async () => {
  const f = fixture();
  try {
    const original = f.provider.broadcastTransaction;
    f.provider.broadcastTransaction = async raw => { await original(raw); throw new Error('mock response loss'); };
    await assert.rejects(f.send(true), /belirsiz/);
    assert.equal(f.records()[0].status, 'broadcast-unknown');
    assert.equal(f.records()[0].hash, f.state.hash);
    await assert.rejects(f.send(true), /sonucu belirsiz/);
    assert.equal(f.state.broadcasts, 1);
    assert.equal(f.state.signatures, 1);
  } finally { f.cleanup(); }
});
test('receipt timeout is recoverable and a later mined receipt is reconciled before the next send', async () => {
  const f = fixture();
  try {
    const healthyWait = f.provider.waitForTransaction;
    f.provider.waitForTransaction = async () => { throw new Error('mock timeout'); };
    await assert.rejects(f.send(true), /Receipt/);
    assert.equal(f.records()[0].status, 'receipt-timeout');
    f.provider.getTransactionReceipt = healthyWait;
    f.provider.waitForTransaction = healthyWait;
    await f.send(true);
    assert.equal(f.records().length, 2);
    assert.ok(f.records().every(r => r.status === 'confirmed'));
  } finally { f.cleanup(); }
});
test('reverted receipt is recorded as reverted and is never reported as confirmed', async () => {
  const f = fixture();
  try {
    const original = f.provider.waitForTransaction;
    f.provider.waitForTransaction = async (...args) => ({ ...await original(...args), status: 0 });
    await assert.rejects(f.send(true), /revert/);
    assert.equal(f.records()[0].status, 'reverted');
  } finally { f.cleanup(); }
});
test('wrong chain and dry runs do not sign or broadcast transactions', async () => {
  const f = fixture();
  try {
    await f.send(false);
    assert.equal(f.state.signatures, 0);
    assert.equal(f.state.broadcasts, 0);
    let reads = 0;
    f.provider.send = async () => ++reads === 1 ? '0x4c18' : '0x1';
    await assert.rejects(f.send(true), /Chain ID/);
    assert.equal(f.state.signatures, 0);
    assert.equal(f.state.broadcasts, 0);
  } finally { f.cleanup(); }
});
test('a wallet lock prevents simultaneous submissions', () => {
  const f = fixture();
  try {
    const journal = createJournal(f.folder, 19480, f.account.address);
    const release = journal.acquire();
    try { assert.throws(() => journal.acquire(), /baska islem/); }
    finally { release(); }
    const again = journal.acquire(); again();
  } finally { f.cleanup(); }
});
test('a mismatched signing key cannot broadcast a transaction under the expected wallet identity', async () => {
  const f = fixture();
  try {
    const other = Wallet.createRandom();
    f.wallet.signTransaction = async tx => { const { from, ...rest } = tx; return other.signTransaction(rest); };
    await assert.rejects(f.send(true), /beklenen cuzdan/);
    assert.equal(f.state.broadcasts, 0);
    assert.equal(f.records().length, 0);
  } finally { f.cleanup(); }
});
test('read-only subprocesses cannot inherit key or password environment variables', () => {
  const beforeKey = process.env.QMS_PRIVATE_KEY, beforePassword = process.env.QMS_KEYSTORE_PASSWORD;
  try {
    process.env.QMS_PRIVATE_KEY = 'test-key-only'; process.env.QMS_KEYSTORE_PASSWORD = 'test-password-only';
    for (const command of ['status', 'quote', 'block', 'compile', 'help']) {
      const env = childEnvironment(command);
      assert.equal(env.QMS_PRIVATE_KEY, undefined); assert.equal(env.QMS_KEYSTORE_PASSWORD, undefined);
    }
    assert.equal(childEnvironment('deploy', 'expected-public-address').QMS_EXPECTED_ADDRESS, 'expected-public-address');
  } finally {
    if (beforeKey === undefined) delete process.env.QMS_PRIVATE_KEY; else process.env.QMS_PRIVATE_KEY = beforeKey;
    if (beforePassword === undefined) delete process.env.QMS_KEYSTORE_PASSWORD; else process.env.QMS_KEYSTORE_PASSWORD = beforePassword;
  }
});
test('untrusted error messages cannot emit terminal escape sequences, bidi controls or forged log lines', () => {
  const text = safeError(new Error('\x1b]52;c;dGVzdA==\x07\x1b[31merror\nforged\u202ereversed'));
  assert.ok(!/[\x00-\x1f\x7f-\x9f\u202a-\u202e]/.test(text));
  assert.ok(!text.includes('dGVzdA=='));
});
