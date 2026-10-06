import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Interface, parseEther, toQuantity } from 'ethers';
import { connect, config, root, output, save, safeError } from './lib.mjs';
import { routerAbi } from './abis.mjs';

// No signer, key, or sendRawTransaction: all state changes are confined to eth_call.
const from = '0x0000000000000000000000000000000000000123';
const fakeCounter = '0x0000000000000000000000000000000000000456';
let provider;
try {
  provider = await connect();
  const artifact = JSON.parse(readFileSync(resolve(root, 'artifacts/QmsCounter.json'), 'utf8'));
  const overrides = { [from]: { balance: toQuantity(parseEther('100')) } };
  const runtime = await provider.send('eth_call', [{ from, data: artifact.bytecode }, 'latest', overrides]);
  if (runtime.toLowerCase() !== artifact.deployedBytecode.toLowerCase())
    throw new Error('Deploy simülasyonunun runtime bytecode sonucu eslesmiyor.');
  const counterInterface = new Interface(artifact.abi);
  const counterOverride = { ...overrides, [fakeCounter]: { code: runtime } };
  const initial = await provider.send('eth_call', [{ from, to: fakeCounter,
    data: counterInterface.encodeFunctionData('count') }, 'latest', counterOverride]);
  if (counterInterface.decodeFunctionResult('count', initial)[0] !== 0n) throw new Error('Counter baslangic degeri gecersiz.');
  await provider.send('eth_call', [{ from, to: fakeCounter,
    data: counterInterface.encodeFunctionData('increment') }, 'latest', counterOverride]);
  const block = await provider.getBlock('latest');
  const router = new Interface(routerAbi);
  const amount = parseEther('0.1');
  const result = await provider.send('eth_call', [{ from, to: config.contracts.router,
    value: toQuantity(amount), data: router.encodeFunctionData('swapExactETHForTokens',
      [1n, [config.contracts.wqms, config.contracts.usdc], from, block.timestamp + 600]) }, 'latest', overrides]);
  const amounts = router.decodeFunctionResult('swapExactETHForTokens', result)[0];
  if (amounts[0] !== amount || amounts[1] <= 0n) throw new Error('Swap simülasyonu cikti üretmedi.');
  const report = { checkedAt: new Date().toISOString(), chainId: config.chainId, method: 'eth_call with state overrides',
    deploymentSimulation: 'passed', counterReadAndIncrementSimulation: 'passed', swapSimulation: 'passed',
    inputQmsWei: amount.toString(), outputUsdcRaw: amounts[1].toString(),
    broadcastTransactions: 0, note: 'Sanal bakiye ve kontrat kodu eth_call kapsaminda kullanildi; zincir durumu degismedi.' };
  save('reports/rpc-smoke.json', report);
  output(report);
} catch (error) {
  console.error('Hata: ' + safeError(error)); process.exitCode = 1;
} finally { provider?.destroy(); }
