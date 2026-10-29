import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Interface, parseEther } from 'ethers';
import { config } from './lib.mjs';
import { verifyStreakTransaction } from './streak-evidence.mjs';
import { dailyKinds } from './daily-plan.mjs';

const counterAbi = new Interface(['function increment()', 'event Incremented(address indexed caller,uint256 count)']);
const eq = (a,b) => a?.toLowerCase() === b?.toLowerCase();
export async function inspectDailyEvidence(provider, projectRoot, address, counter, settings, period, state = {}) {
  const prefix = `daily-${settings.id}:${address.slice(2).toLowerCase()}:`, records = new Map();
  const folder = resolve(projectRoot, 'reports');
  if (existsSync(folder)) for (const name of readdirSync(folder).filter(name => /^tx-0x[\da-f]{64}\.json$/i.test(name))) {
    const record = JSON.parse(readFileSync(resolve(folder,name),'utf8'));
    if (record.operationId?.startsWith(prefix) && record.chainId === 19480 && eq(record.from,address)) records.set(record.hash,record);
  }
  for (const proof of Object.values(state.steps ?? {})) if (proof.hash && !records.has(proof.hash)) records.set(proof.hash,proof);
  const head = await provider.getBlockNumber(), evidence = [];
  for (const record of records.values()) {
    if (record.status === 'not-broadcast') continue;
    const base = { hash:record.hash, operationId:record.operationId };
    const receipt = await provider.getTransactionReceipt(record.hash);
    if (!receipt || head - receipt.blockNumber + 1 < config.confirmations) { evidence.push({...base,status:'pending'});continue; }
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block) { evidence.push({...base,status:'invalid'});continue; }
    const timestamp = block.timestamp * 1000;
    if (timestamp < Date.parse(period.startsAt) || timestamp >= Date.parse(period.endsAt)) continue;
    const mined = {...base,timestamp,blockNumber:receipt.blockNumber,explorer:`${config.explorerUrl}/tx/${record.hash}`};
    if (receipt.status !== 1) { evidence.push({...mined,status:'reverted'});continue; }
    if (record.action?.startsWith('approve ')) { evidence.push({...mined,status:'approval-confirmed'});continue; }
    const kind = record.operationId?.split(':').at(-1), tx = await provider.getTransaction(record.hash);
    if (!dailyKinds.includes(kind) || !tx || !eq(tx.from,address) || BigInt(tx.chainId) !== 19480n) {
      evidence.push({...mined,status:'invalid'});continue;
    }
    let valid = false;
    if (kind === 'increment') {
      let call;try { call = counterAbi.parseTransaction({data:tx.data,value:tx.value}); } catch {}
      valid = eq(tx.to,counter) && tx.value === 0n && call?.name === 'increment' && receipt.logs.some(log => {
        try { const event = counterAbi.parseLog(log);return eq(log.address,counter) && event?.name === 'Incremented' && eq(event.args.caller,address) && event.args.count > 0n; }
        catch { return false; }
      });
    } else {
      const expected = parseEther(kind.startsWith('swap-') ? settings.swapAmountQms : settings.liquidityAmountQms);
      const checked = await verifyStreakTransaction({getTransactionReceipt:async()=>receipt,getBlock:async()=>block,getTransaction:async()=>tx},
        {...record,operationId:record.operationId.replace(/:swap-[12]$/,':swap')},address,head);
      valid = checked.status === 'confirmed' && tx.value === expected;
    }
    evidence.push({...mined,kind,status:valid?'confirmed':'invalid'});
  }
  return evidence;
}
