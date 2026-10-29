import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { Wallet, Transaction, parseEther, keccak256 } from 'ethers';
import { root, config, submit, childEnvironment, safeError } from '../scripts/lib.mjs';
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
  const send = (broadcast, label = 'audit test') => submit(provider, wallet, { to: '0x0000000000000000000000000000000000000002', value: 0n },
    label, broadcast, folder, () => {});
  const cleanup = () => {
    assert.equal(dirname(resolve(folder)), cache);
    rmSync(folder, { recursive: true, force: true });
  };
  return { folder, account, wallet, provider, state, records, send, cleanup };
}

test('daily journal permits two separate swaps, rejects duplicates and never signs a sixth transaction',async()=>{
  const f=fixture(),seen=new Map();
  const start=new Date(Date.now()-13*3600000).toISOString().slice(0,10)+'T13:00:00.000Z';
  const end=new Date(Date.parse(start)+86400000).toISOString();
  const day=start.slice(0,10),counter='0x0000000000000000000000000000000000000002';
  const keys=['QMS_OPERATION_ID','QMS_TASK_NOT_BEFORE','QMS_TASK_NOT_AFTER','QMS_DAILY_COUNTER'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const original=f.provider.broadcastTransaction;
  f.provider.broadcastTransaction=async raw=>{const result=await original(raw);seen.set(result.hash,Transaction.from(raw));return result;};
  f.provider.getTransactionReceipt=async hash=>seen.has(hash)?{hash,status:1,blockNumber:100,fee:42000n,gasUsed:21000n}:null;
  f.provider.getTransaction=async hash=>seen.get(hash);
  f.provider.getBlock=async()=>({timestamp:Date.parse(start)/1000+60});
  function context(kind){Object.assign(process.env,{QMS_OPERATION_ID:`daily-${day}:${f.wallet.address.slice(2).toLowerCase()}:${day}:${kind}`,
    QMS_TASK_NOT_BEFORE:start,QMS_TASK_NOT_AFTER:end,QMS_DAILY_COUNTER:counter});}
  const send=(kind,action,to,value)=>{context(kind);return submit(f.provider,f.wallet,{to,value},action,true,f.folder,()=>{});};
  try{
    await send('swap-1','QWAP QMS -> USDC',config.contracts.router,parseEther('0.1'));
    await assert.rejects(send('swap-1','QWAP QMS -> USDC',config.contracts.router,parseEther('0.1')),/zaten basarili/);
    await send('swap-2','QWAP QMS -> USDC',config.contracts.router,parseEther('0.1'));
    await send('liquidity','approve exact USDC for QWAP liquidity',config.contracts.usdc,0n);
    await send('liquidity','QWAP add WQMS/USDC liquidity',config.contracts.router,parseEther('0.05'));
    await send('increment','increment QmsCounter',counter,0n);
    await assert.rejects(send('liquidity','approve exact USDC for QWAP liquidity',config.contracts.usdc,0n),/5 zincir islemi/);
    context('swap-1');
    const yesterday=new Date(Date.parse(start)-86400000).toISOString().slice(0,10);
    process.env.QMS_OPERATION_ID=process.env.QMS_OPERATION_ID.replace(`daily-${day}:`,`daily-${yesterday}:`);
    await assert.rejects(submit(f.provider,f.wallet,{to:config.contracts.router,value:parseEther('0.1')},'QWAP QMS -> USDC',true,f.folder,()=>{}),/zaten basarili/);
    assert.equal(f.state.broadcasts,5);assert.equal(f.state.signatures,5);
    context('increment');await assert.rejects(f.send(true,'deploy QmsCounter'),/hedefi/);
  }finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}f.cleanup();}
});

test('daily native and gas limits use canonical receipts, including other daily profiles',async()=>{
  const f=fixture(),journal=createJournal(f.folder,19480,f.wallet.address);
  const start=Date.parse('2026-10-29T13:00:00Z');
  const context={type:'daily',group:`daily-2026-10-29:${f.wallet.address.slice(2).toLowerCase()}:`,kind:'swap-2',start,end:start+86400000};
  const hash=keccak256(new Uint8Array([8]));
  journal.write({hash,chainId:19480,from:f.wallet.address,status:'confirmed',action:'prior daily action',
    operationId:`daily-2026-10-28:${f.wallet.address.slice(2).toLowerCase()}:2026-10-29:swap-1`});
  let priorValue=parseEther('0.25'),fee=0n;
  f.provider.getTransactionReceipt=async()=>({status:1,blockNumber:100,fee});
  f.provider.getBlock=async()=>({timestamp:start/1000+60});
  f.provider.getTransaction=async()=>({from:f.wallet.address,chainId:19480n,value:priorValue});
  try{
    await assert.rejects(journal.checkDailyOperation(f.provider,context,'QWAP QMS -> USDC',parseEther('0.1'),1n),/native harcama/);
    priorValue=0n;fee=parseEther('0.24');
    await assert.rejects(journal.checkDailyOperation(f.provider,context,'QWAP QMS -> USDC',parseEther('0.1'),parseEther('0.02')),/gas siniri/);
  }finally{f.cleanup();}
});

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

function scopedTask(t, f) {
  const start = Date.parse('2026-10-19T13:00:00Z');
  const current = { time: start + 300000 };
  t.mock.method(Date, 'now', () => current.time);
  const vars = { QMS_OPERATION_ID: `streak-2026-10-19:${f.account.address.slice(2).toLowerCase()}:1:swap`,
    QMS_TASK_NOT_BEFORE: new Date(start).toISOString(), QMS_TASK_NOT_AFTER: new Date(start + 86400000).toISOString() };
  const before = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => { for (const k of Object.keys(vars)) if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
  f.provider.getBlock = async () => ({ timestamp: current.time / 1000 });
  return { start, current, vars };
}
test('streak journal blocks a second successful action in the same UTC task day even if the parent state was lost', async t => {
  const f = fixture();
  try {
    const { vars } = scopedTask(t, f);
    await f.send(true, 'QWAP QMS -> USDC');
    assert.equal(f.records()[0].operationId, vars.QMS_OPERATION_ID);
    f.provider.getTransactionReceipt = f.provider.waitForTransaction;
    await assert.rejects(f.send(true, 'QWAP QMS -> USDC'), /zaten basarili/);
    assert.equal(f.state.broadcasts, 1); assert.equal(f.state.signatures, 1);
  } finally { f.cleanup(); }
});
test('expiry between signing and sending records not-broadcast and never calls the network send', async t => {
  const f = fixture();
  try {
    const { start, current } = scopedTask(t, f), sign = f.wallet.signTransaction;
    f.wallet.signTransaction = async tx => { const raw = await sign(tx); current.time = start + 86400000; return raw; };
    await assert.rejects(f.send(true, 'QWAP QMS -> USDC'), /gunu disinda/);
    assert.equal(f.state.broadcasts, 0);
    assert.equal(f.records()[0].status, 'not-broadcast');
  } finally { f.cleanup(); }
});
test('a local clock ahead of campaign start cannot bypass the latest chain block time', async t => {
  const f = fixture();
  try {
    const { start } = scopedTask(t, f);
    f.provider.getBlock = async () => ({ timestamp: (start - 1000) / 1000 });
    await assert.rejects(f.send(true, 'QWAP QMS -> USDC'), /gunu disinda/);
    assert.equal(f.state.broadcasts, 0); assert.equal(f.state.signatures, 0);
  } finally { f.cleanup(); }
});
