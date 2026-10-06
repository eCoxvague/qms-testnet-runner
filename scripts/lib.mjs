import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JsonRpcProvider, FetchRequest, Wallet, parseEther, formatEther } from 'ethers';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const config = JSON.parse(readFileSync(resolve(root, 'config/qms-testnet.json'), 'utf8'));
export function save(relative, data) {
  const file = resolve(root, relative);
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
  return file;
}
export function output(data) {
  console.log(JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}
export function assertTestnet(chainId) {
  if (BigInt(chainId) !== 19480n) throw new Error('Chain ID 19480 degil; islem durduruldu.');
}
export async function connect() {
  const request = new FetchRequest(config.rpcUrl);
  request.timeout = 25000;
  const provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  provider.pollingInterval = 3000;
  try { assertTestnet(await provider.send('eth_chainId', [])); }
  catch (e) { provider.destroy(); throw e; }
  return provider;
}
export function loadWallet(provider) {
  let key = process.env.QMS_PRIVATE_KEY;
  delete process.env.QMS_PRIVATE_KEY;
  if (!key && process.platform === 'win32' && existsSync(resolve(root, '.secrets/qms-key.dpapi'))) {
    try {
      // stdout is captured in memory; never inherited by the terminal or logged.
      key = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        resolve(root, 'scripts/read-key.ps1')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
    } catch { throw new Error('Sifreli anahtar okunamadi. npm run key:import calistirin.'); }
  }
  if (!key && existsSync(resolve(root, '.secrets/qms-keystore.json'))) {
    let password = process.env.QMS_KEYSTORE_PASSWORD;
    delete process.env.QMS_KEYSTORE_PASSWORD;
    if (!password) throw new Error('Keystore kilitli. npm start ile gizli parola girisi yapin.');
    try {
      const wallet = Wallet.fromEncryptedJsonSync(readFileSync(resolve(root, '.secrets/qms-keystore.json'), 'utf8'), password);
      return provider ? wallet.connect(provider) : wallet;
    } catch { throw new Error('Keystore acilamadi; parola veya dosya gecersiz.'); }
    finally { password = undefined; }
  }
  if (!key) throw new Error('Anahtar yok. npm run key:import ile yerelde yukleyin.');
  key = key.trim().replace(/^0x/, '');
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('Private key formati gecersiz.');
  try { return new Wallet('0x' + key, provider); }
  catch { throw new Error('Private key gecersiz.'); }
  finally { key = undefined; }
}
export function amountQms(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error('QMS miktari pozitif ondalik olmali.');
  const amount = parseEther(value);
  if (amount <= 0n || amount > parseEther(config.maxActionQms))
    throw new Error(`Test miktari 0 ile ${config.maxActionQms} QMS arasinda olmali.`);
  return amount;
}
export function minimum(amount, bps) {
  if (!Number.isInteger(bps) || bps < 1 || bps > 500) throw new Error('Slippage 1-500 bps olmali.');
  const value = amount * BigInt(10000 - bps) / 10000n;
  if (value <= 0n) throw new Error('Minimum cikti sifir; miktar cok kucuk.');
  return value;
}
export function checkBudget(balance, value, gasLimit, gasPrice) {
  const maxFee = gasLimit * gasPrice;
  if (maxFee > parseEther(config.maxGasQms)) throw new Error('Gas ust siniri 0.05 QMS asiliyor.');
  if (balance < value + maxFee + parseEther(config.reserveQms))
    throw new Error('Bakiye yetersiz: islem + gas ve 0.1 QMS rezerv gerekiyor. Faucet kullanin.');
  return maxFee;
}
export function safeError(error) {
  // Ethers error objects can contain signed transactions or request bodies.
  // Only a short message is allowed to reach stdout/stderr.
  const message = error?.shortMessage ?? error?.message ?? 'Bilinmeyen hata';
  return String(message).replace(/(?:0x)?[a-fA-F0-9]{64,}/g, '[hex gizlendi]').slice(0, 450);
}
export async function jsonFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}: ${new URL(url).pathname}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
export async function submit(provider, wallet, tx, label, broadcast) {
  assertTestnet(await provider.send('eth_chainId', []));
  const transaction = { ...tx, from: wallet.address };
  const estimated = await provider.estimateGas(transaction);
  const gasLimit = (estimated * 120n + 99n) / 100n;
  const fees = await provider.getFeeData();
  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null)
    throw new Error('EIP-1559 gas verisi alinamadi.');
  const maxFee = checkBudget(await provider.getBalance(wallet.address), tx.value ?? 0n, gasLimit, fees.maxFeePerGas);
  output({ action: label, mode: broadcast ? 'broadcast' : 'simulation', from: wallet.address,
    to: tx.to ?? 'contract creation', valueQms: formatEther(tx.value ?? 0n), gasLimit,
    maxFeeQms: formatEther(maxFee), reserveQms: config.reserveQms });
  if (!broadcast) return null;
  const sent = await wallet.sendTransaction({ ...transaction, chainId: config.chainId, type: 2, gasLimit,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  const reportPath = `reports/tx-${sent.hash}.json`;
  const pending = { action: label, chainId: config.chainId, hash: sent.hash,
    from: wallet.address, to: sent.to, submittedAt: new Date().toISOString(), status: 'pending',
    explorer: `${config.explorerUrl}/tx/${sent.hash}` };
  save(reportPath, pending);
  output({ hash: sent.hash, explorer: pending.explorer });
  // Do not use safe/finalized: QMS currently returns genesis for those tags.
  const receipt = await sent.wait(config.confirmations, config.receiptTimeoutMs);
  if (!receipt || receipt.status !== 1) throw new Error('Islem basarisiz veya receipt bulunamadi.');
  save(reportPath, { ...pending, status: 'confirmed', blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed, feeQms: formatEther(receipt.fee), contractAddress: receipt.contractAddress });
  output({ status: 'confirmed', blockNumber: receipt.blockNumber, confirmations: config.confirmations,
    feeQms: formatEther(receipt.fee) });
  return receipt;
}
