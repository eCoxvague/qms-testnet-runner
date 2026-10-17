import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Interface, parseEther, ZeroAddress } from 'ethers';
import { campaign, streakWindow, dayWindow, operationId, streakProgress } from '../scripts/streak-calendar.mjs';
import { taskContext, assertTaskWindow } from '../scripts/task-context.mjs';
import { runDailyStreak } from '../scripts/streak-workflow.mjs';
import { verifyStreakTransaction } from '../scripts/streak-evidence.mjs';
import { config } from '../scripts/lib.mjs';
import { routerAbi } from '../scripts/abis.mjs';

const address = '0x0000000000000000000000000000000000000001';
const at = '2026-10-19T13:05:00.000Z';
function fixture() {
  const f = { now: new Date(at), evidence: [], commands: [], snapshots: [] };
  f.options = {
    address, broadcast: true, now: () => f.now,
    inspect: async () => structuredClone(f.evidence),
    checkpoint: state => f.snapshots.push(structuredClone(state)),
    execute: async (args, context) => {
      f.commands.push([...args]);
      if (context) f.evidence.push({ kind: args[0], status: 'confirmed', hash: 'fixture-' + args[0],
        operationId: context.operationId, timestamp: f.now.getTime(), blockNumber: 100, confirmations: 2 });
    },
  };
  return f;
}
test('13:00 UTC resets use half-open days; start and campaign end are enforced exactly', () => {
  assert.equal(streakWindow('2026-10-19T12:59:59.999Z').phase, 'before-start');
  assert.equal(streakWindow('2026-10-19T13:00:00.000Z').day, 1);
  assert.equal(streakWindow('2026-10-20T12:59:59.999Z').day, 1);
  assert.equal(streakWindow('2026-10-20T13:00:00.000Z').day, 2);
  assert.equal(streakWindow('2026-10-26T12:59:59.999Z').day, 7);
  assert.equal(streakWindow('2026-10-26T13:00:00.000Z').phase, 'ended');
  assert.equal(streakWindow('2026-10-19T16:00:00+03:00').day, 1);
});
test('no operations are executed before Monday or after the seven-day event', async () => {
  for (const time of ['2026-10-17T15:00:00Z', '2026-10-26T13:00:00Z']) {
    const f = fixture(); f.now = new Date(time);
    await runDailyStreak(f.options);
    assert.equal(f.commands.length, 0);
  }
});
test('daily runner sends only swap and liquidity and skips both on repeat runs', async () => {
  const f = fixture();
  const first = await runDailyStreak(f.options);
  assert.deepEqual(f.commands.map(a => a[0]), ['swap', 'liquidity']);
  assert.equal(first.progress.completedDays, 1);
  assert.equal(first.progress.estimatedQuanta, 8);
  const second = await runDailyStreak({ ...f.options, state: first.state });
  assert.equal(second.status, 'already-completed');
  assert.equal(f.commands.length, 2);
});
test('a failed liquidity attempt resumes liquidity without sending another swap', async () => {
  const f = fixture(), original = f.options.execute;
  let fail = true;
  f.options.execute = async (args, context) => {
    if (args[0] === 'liquidity' && fail) { f.commands.push(args); throw new Error('mock LP failure before send'); }
    await original(args, context);
  };
  await assert.rejects(runDailyStreak(f.options), /mock LP failure/);
  const saved = f.snapshots.at(-1);
  assert.equal(saved.days[1].swap.status, 'confirmed');
  fail = false;
  const done = await runDailyStreak({ ...f.options, state: saved });
  assert.equal(done.status, 'completed');
  assert.equal(f.commands.filter(a => a[0] === 'swap').length, 1);
});
test('a mined swap is recovered when the child fails after submitting it', async () => {
  const f = fixture(), original = f.options.execute;
  f.options.execute = async (args, context) => { await original(args, context); if (args[0] === 'swap') throw new Error('response lost'); };
  const result = await runDailyStreak(f.options);
  assert.equal(result.status, 'completed');
  assert.equal(f.commands.filter(a => a[0] === 'swap').length, 1);
});
test('uncertain transactions stop further sends rather than retrying blindly', async () => {
  const f = fixture();
  f.evidence = [{ status: 'pending', hash: 'fixture-pending' }];
  const result = await runDailyStreak(f.options);
  assert.equal(result.status, 'waiting'); assert.equal(f.commands.length, 0);
});
test('a day boundary between swap and LP stops the old day and credits only actual block times', async () => {
  const f = fixture(), original = f.options.execute;
  f.options.execute = async (args, context) => {
    if (args[0] === 'swap') f.now = new Date('2026-10-20T13:01:00Z');
    await original(args, context);
  };
  const first = await runDailyStreak(f.options);
  assert.equal(first.status, 'day-changed');
  assert.equal(first.state.days[1].completed, false);
  assert.equal(first.state.days[2].swap.status, 'confirmed');
  const resumed = await runDailyStreak({ ...f.options, state: first.state });
  assert.equal(resumed.status, 'completed');
  assert.deepEqual(f.commands.map(a => a[0]), ['swap', 'liquidity']);
  assert.equal(resumed.state.days[2].completed, true);
});
test('one missed day still permits the 6-of-7 bonus; role estimates remain explicitly unofficial', () => {
  const days = Object.fromEntries([1, 2, 3, 4, 5, 7].map(day => [day, { swap: { status: 'confirmed' }, liquidity: { status: 'confirmed' } }]));
  const regular = streakProgress({ days }, '2026-10-26T13:00:00Z');
  assert.equal(regular.completedDays, 6); assert.equal(regular.missedDays, 1);
  assert.equal(regular.bonusEligible, true); assert.equal(regular.estimatedQuanta, 62);
  for (const role of ['pioneer', 'qwabbit']) {
    const boosted = streakProgress({ days, role }, '2026-10-26T13:00:00Z');
    assert.equal(boosted.estimatedQuanta, 78); assert.equal(boosted.officialCreditVerified, false);
  }
  delete days[1];
  assert.equal(streakProgress({ days }, '2026-10-26T13:00:00Z').bonusStillPossible, false);
});
test('preflight and invalid roles never broadcast actions', async () => {
  const f = fixture();
  await runDailyStreak({ ...f.options, broadcast: false });
  assert.deepEqual(f.commands.map(a => a[0]), ['quote']);
  assert.ok(f.commands.every(a => !a.includes('--broadcast')));
  f.commands = [];
  await assert.rejects(runDailyStreak({ ...f.options, role: 'unsupported' }), /Rol/);
  assert.equal(f.commands.length, 0);
});
test('operation identifiers bind wallet, campaign, day and action; a closed day cannot send', () => {
  const period = dayWindow(1);
  const env = { QMS_OPERATION_ID: operationId(address, 1, 'swap'), QMS_TASK_NOT_BEFORE: period.startsAt, QMS_TASK_NOT_AFTER: period.endsAt };
  const context = taskContext(env);
  assert.doesNotThrow(() => assertTaskWindow(context, Date.parse(period.startsAt)));
  assert.throws(() => assertTaskWindow(context, Date.parse(period.endsAt)), /gunu disinda/);
  assert.throws(() => taskContext({ ...env, QMS_TASK_NOT_BEFORE: '2026-10-18T13:00:00Z' }), /baglami/);
});
test('approval receipts cannot satisfy LP; receipt sender, router calldata and token events are verified', async () => {
  const iface = new Interface(routerAbi), token = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
  const record = { hash: 'fixture', status: 'confirmed', operationId: operationId(address, 1, 'swap') };
  const transfer = token.encodeEventLog('Transfer', [config.contracts.wqmsUsdcPair, address, 100n]);
  const tx = { from: address, to: config.contracts.router, chainId: 19480n, value: parseEther('0.2'),
    data: iface.encodeFunctionData('swapExactETHForTokens', [1n, [config.contracts.wqms, config.contracts.usdc], address, 9999999999]) };
  const receipt = { status: 1, blockNumber: 100, logs: [{ address: config.contracts.usdc, ...transfer }] };
  const provider = { getTransactionReceipt: async () => receipt, getTransaction: async () => tx,
    getBlock: async () => ({ timestamp: Date.parse(at) / 1000 }) };
  const valid = await verifyStreakTransaction(provider, record, address, 101);
  assert.equal(valid.status, 'confirmed'); assert.equal(valid.kind, 'swap');
  tx.from = Wallet.createRandom().address;
  assert.equal((await verifyStreakTransaction(provider, record, address, 101)).status, 'invalid');
  tx.from = address;
  receipt.logs = [];
  assert.equal((await verifyStreakTransaction(provider, record, address, 101)).status, 'invalid');
  assert.equal((await verifyStreakTransaction(provider, { ...record, action: 'approve exact USDC for QWAP liquidity' }, address, 101)).status, 'approval-confirmed');
});
test('liquidity requires both a pair Mint and an LP transfer to the same wallet', async () => {
  const iface = new Interface(routerAbi), events = new Interface(['event Mint(address indexed sender,uint256 amount0,uint256 amount1)',
    'event Transfer(address indexed from,address indexed to,uint256 value)']);
  const mint = events.encodeEventLog('Mint', [config.contracts.router, 1000n, 100n]);
  const lp = events.encodeEventLog('Transfer', [ZeroAddress, address, 10n]);
  const receipt = { status: 1, blockNumber: 100, logs: [{ address: config.contracts.wqmsUsdcPair, ...mint }, { address: config.contracts.wqmsUsdcPair, ...lp }] };
  const provider = { getTransactionReceipt: async () => receipt, getBlock: async () => ({ timestamp: Date.parse(at) / 1000 }),
    getTransaction: async () => ({ from: address, to: config.contracts.router, chainId: 19480n, value: parseEther('0.1'),
      data: iface.encodeFunctionData('addLiquidityETH', [config.contracts.usdc, 100n, 1n, 1n, address, 9999999999]) }) };
  const record = { hash: 'fixture', operationId: operationId(address, 1, 'liquidity') };
  assert.equal((await verifyStreakTransaction(provider, record, address, 101)).kind, 'liquidity');
  receipt.logs.pop();
  assert.equal((await verifyStreakTransaction(provider, record, address, 101)).status, 'invalid');
});
