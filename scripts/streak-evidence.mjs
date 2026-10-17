import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Interface, ZeroAddress } from 'ethers';
import { config } from './lib.mjs';
import { routerAbi } from './abis.mjs';

const events = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)',
  'event Mint(address indexed sender,uint256 amount0,uint256 amount1)']);
const router = new Interface(routerAbi);
const eq = (a, b) => a?.toLowerCase() === b?.toLowerCase();
export async function verifyStreakTransaction(provider, record, address, head) {
  const base = { hash: record.hash, operationId: record.operationId };
  if (record.status === 'not-broadcast') return { ...base, status: 'not-broadcast' };
  const receipt = await provider.getTransactionReceipt(record.hash);
  if (!receipt || head - receipt.blockNumber + 1 < config.confirmations) return { ...base, status: 'pending' };
  if (receipt.status !== 1) return { ...base, status: 'reverted' };
  // Approvals are tracked for unresolved sends but never count as the liquidity task.
  if (record.action?.startsWith('approve ')) return { ...base, status: 'approval-confirmed' };
  const [tx, block] = await Promise.all([provider.getTransaction(record.hash), provider.getBlock(receipt.blockNumber)]);
  if (!tx || !block || !eq(tx.from, address) || !eq(tx.to, config.contracts.router) || BigInt(tx.chainId) !== 19480n)
    return { ...base, status: 'invalid', reason: 'Islem agi, gonderici veya router eslesmiyor.' };
  let call;
  try { call = router.parseTransaction({ data: tx.data, value: tx.value }); } catch { /* checked below */ }
  const parsed = receipt.logs.map(log => {
    try { return { address: log.address, event: events.parseLog(log) }; } catch { return null; }
  }).filter(Boolean);
  let kind;
  if (call?.name === 'swapExactETHForTokens' && tx.value > 0n && eq(call.args[2], address)
      && call.args[1].length === 2 && eq(call.args[1][0], config.contracts.wqms) && eq(call.args[1][1], config.contracts.usdc)) {
    const transfer = parsed.some(log => eq(log.address, config.contracts.usdc) && log.event?.name === 'Transfer'
      && eq(log.event.args.from, config.contracts.wqmsUsdcPair) && eq(log.event.args.to, address) && log.event.args.value > 0n);
    if (transfer) kind = 'swap';
  }
  if (call?.name === 'addLiquidityETH' && tx.value > 0n && eq(call.args[0], config.contracts.usdc) && eq(call.args[4], address)) {
    const mint = parsed.some(log => eq(log.address, config.contracts.wqmsUsdcPair) && log.event?.name === 'Mint'
      && log.event.args.amount0 > 0n && log.event.args.amount1 > 0n);
    const lp = parsed.some(log => eq(log.address, config.contracts.wqmsUsdcPair) && log.event?.name === 'Transfer'
      && eq(log.event.args.from, ZeroAddress) && eq(log.event.args.to, address) && log.event.args.value > 0n);
    if (mint && lp) kind = 'liquidity';
  }
  if (!kind || !record.operationId.endsWith(':' + kind))
    return { ...base, status: 'invalid', reason: 'Swap veya LP icin beklenen calldata/event bulunamadi.' };
  return { ...base, status: 'confirmed', kind, timestamp: block.timestamp * 1000,
    blockNumber: receipt.blockNumber, confirmations: head - receipt.blockNumber + 1,
    explorer: `${config.explorerUrl}/tx/${record.hash}` };
}

export function readStreakRecords(projectRoot, address, settings, state = {}) {
  const folder = resolve(projectRoot, 'reports');
  const prefix = `streak-${settings.id}:${address.slice(2).toLowerCase()}:`;
  const byHash = new Map();
  if (existsSync(folder)) for (const name of readdirSync(folder).filter(name => /^tx-0x[\da-f]{64}\.json$/i.test(name))) {
    let record;
    try { record = JSON.parse(readFileSync(resolve(folder, name), 'utf8')); }
    catch { throw new Error('Islem kaydi okunamadi; streak islemi gonderilmedi.'); }
    if (record.operationId?.startsWith(prefix) && record.chainId === config.chainId && eq(record.from, address))
      byHash.set(record.hash, record);
  }
  // A day-state copy also retains hashes if a single transaction report was accidentally removed.
  for (const day of Object.values(state.days ?? {})) for (const kind of ['swap', 'liquidity']) {
    const proof = day[kind];
    if (proof?.hash && !byHash.has(proof.hash)) byHash.set(proof.hash, { ...proof, status: 'confirmed' });
  }
  return [...byHash.values()];
}
export async function inspectStreakEvidence(provider, projectRoot, address, settings, state) {
  const head = await provider.getBlockNumber();
  const evidence = [];
  for (const record of readStreakRecords(projectRoot, address, settings, state))
    evidence.push(await verifyStreakTransaction(provider, record, address, head));
  return evidence;
}
