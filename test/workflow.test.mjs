import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow, parseOutput } from '../scripts/workflow.mjs';

const address = '0x0000000000000000000000000000000000000001';
const contract = '0x0000000000000000000000000000000000000002';
function fixture({ fail, invalid, balance = '5' } = {}) {
  const commands = [], checkpoints = [];
  let wallets = 0;
  return { commands, checkpoints,
    checkpoint: report => checkpoints.push(JSON.parse(JSON.stringify(report))),
    execute: async args => {
      commands.push([...args]);
      if (args[0] === fail) throw new Error('Injected action failure');
      let results;
      switch (args[0]) {
        case 'status': results = [{ network: 'QMS Testnet', chainId: 19480, dexVerified: true }]; break;
        case 'wallet': results = [{ address, qms: wallets++ === 0 ? balance : '4.69', usdc: '0.7' }]; break;
        case 'deploy': results = [{ status: 'confirmed' }, { address: contract, count: '0', bytecodeVerified: true, blockNumber: 12 }]; break;
        case 'increment': results = [{ status: 'confirmed' }, { before: '0', after: '1', eventVerified: true }]; break;
        case 'swap': results = [{ status: 'confirmed' }, { usdcBefore: '0.7', usdcAfter: '0.9' }]; break;
        case 'liquidity': results = [{ status: 'confirmed' }, { mintedLp: '50' }]; break;
        case 'block': results = [{ objectiveVerification: { verified: true } }]; break;
        default: throw new Error('Unexpected action');
      }
      return args[0] === invalid ? [{}] : results;
    },
  };
}

test('complete flow uses the newly deployed contract, waits for each step, and includes final checks', async () => {
  const f = fixture();
  const report = await runWorkflow({ ...f, broadcast: true });
  assert.deepEqual(f.commands.map(args => args[0]), ['status', 'wallet', 'deploy', 'increment', 'swap', 'liquidity', 'wallet', 'block']);
  assert.deepEqual(f.commands[3], ['increment', '--contract', contract, '--broadcast']);
  assert.deepEqual(f.commands[7], ['block', '--number', '12', '--download']);
  assert.equal(report.status, 'completed');
  assert.equal(report.contract, contract);
  assert.ok(report.steps.every(s => s.status === 'passed'));
  assert.equal(f.checkpoints.at(-1).status, 'completed');
});

test('failed swap prevents liquidity and preserves the completed deploy and increment records', async () => {
  const f = fixture({ fail: 'swap' });
  await assert.rejects(runWorkflow({ ...f, broadcast: true }), /Injected action failure/);
  assert.ok(!f.commands.some(args => args[0] === 'liquidity'));
  const last = f.checkpoints.at(-1);
  assert.equal(last.status, 'failed');
  assert.equal(last.steps.find(s => s.command?.[0] === 'deploy').status, 'passed');
  assert.equal(last.steps.at(-1).status, 'failed');
});

test('successful process exit alone cannot bypass missing deploy verification', async () => {
  const f = fixture({ invalid: 'deploy' });
  await assert.rejects(runWorkflow({ ...f, broadcast: true }), /receipt/);
  assert.ok(!f.commands.some(args => args[0] === 'increment' || args[0] === 'swap'));
});

test('whole-flow gas reserve rejects insufficient balance before any broadcast', async () => {
  const f = fixture({ balance: '0.649999999999999999' });
  await assert.rejects(runWorkflow({ ...f, broadcast: true }), /0.65 QMS/);
  assert.deepEqual(f.commands.map(args => args[0]), ['status', 'wallet']);
});

test('preflight contains no broadcast flags and does not claim dependent actions happened', async () => {
  const f = fixture();
  const report = await runWorkflow({ ...f, broadcast: false });
  assert.ok(f.commands.every(args => !args.includes('--broadcast')));
  assert.ok(!f.commands.some(args => ['increment', 'liquidity'].includes(args[0])));
  assert.equal(report.status, 'preflight-passed');
  assert.equal(report.steps.filter(s => s.status === 'skipped').length, 2);
});

test('bad amount/slippage fails without executing any child command', async () => {
  for (const options of [{ swapAmount: '2' }, { liquidityAmount: '-1' }, { slippageBps: 10000 }]) {
    const f = fixture();
    await assert.rejects(runWorkflow({ ...f, broadcast: true, ...options }));
    assert.equal(f.commands.length, 0);
  }
});

test('USDC balance verification preserves tiny changes even on very large balances', async () => {
  const f = fixture();
  const original = f.execute;
  f.execute = async args => {
    const results = await original(args);
    return args[0] === 'swap' ? [{ status: 'confirmed' },
      { usdcBefore: '9007199254740992.000000', usdcAfter: '9007199254740992.000001' }] : results;
  };
  const report = await runWorkflow({ ...f, broadcast: true });
  assert.equal(report.status, 'completed');
});

test('JSON parser handles nested objects and braces or escaped quotes inside strings', () => {
  const first = { nested: [{ note: '} { \\ " quoted', a: { value: 1 } }] };
  const second = { status: 'confirmed' };
  assert.deepEqual(parseOutput(JSON.stringify(first, null, 2) + '\n\n' + JSON.stringify(second)), [first, second]);
  assert.throws(() => parseOutput('{"status":'));
  assert.throws(() => parseOutput('unexpected output'));
});
