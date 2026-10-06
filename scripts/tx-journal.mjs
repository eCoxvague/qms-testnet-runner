import { existsSync, readdirSync, readFileSync, writeFileSync, fsyncSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAddress, formatEther } from 'ethers';
import { writeAtomic } from './storage.mjs';

const unresolved = new Set(['prepared', 'pending', 'submitted', 'broadcast-unknown', 'receipt-timeout']);
export function createJournal(projectRoot, chainId, address) {
  const wallet = getAddress(address);
  const folder = resolve(projectRoot, 'reports');
  const cache = resolve(projectRoot, '.cache');
  const lockFile = resolve(cache, `tx-${chainId}-${wallet.toLowerCase()}.lock`);
  function write(record) {
    if (!/^0x[\da-f]{64}$/i.test(record.hash)) throw new Error('Islem hash formati gecersiz.');
    writeAtomic(resolve(folder, `tx-${record.hash}.json`), JSON.stringify(record, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
  }
  return {
    write,
    acquire() {
      mkdirSync(cache, { recursive: true });
      let descriptor;
      try { descriptor = openSync(lockFile, 'wx', 0o600); }
      catch { throw new Error('Bu cuzdan icin baska islem calisiyor veya onceki kilit kaldi. Kayitlari kontrol edin.'); }
      try {
        writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        fsyncSync(descriptor);
      } catch (error) { closeSync(descriptor); unlinkSync(lockFile); throw error; }
      return () => { closeSync(descriptor); unlinkSync(lockFile); };
    },
    async checkUnresolved(provider, confirmations) {
      if (!existsSync(folder)) return;
      for (const name of readdirSync(folder).filter(name => /^tx-0x[\da-f]{64}\.json$/i.test(name))) {
        let record;
        try { record = JSON.parse(readFileSync(resolve(folder, name), 'utf8')); }
        catch { throw new Error('Bir islem kaydi okunamiyor; yeni islem gonderilmedi.'); }
        if (record.chainId !== chainId || record.from?.toLowerCase() !== wallet.toLowerCase() || !unresolved.has(record.status)) continue;
        const receipt = await provider.getTransactionReceipt(record.hash);
        const head = receipt ? await provider.getBlockNumber() : 0;
        if (!receipt || head - receipt.blockNumber + 1 < confirmations)
          throw new Error('Bu cuzdanda sonucu belirsiz veya onaysiz bir islem var; once reports/tx-*.json kaydini explorer ile kontrol edin.');
        write({ ...record, status: receipt.status === 1 ? 'confirmed' : 'reverted',
          blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed,
          feeQms: formatEther(receipt.fee), contractAddress: receipt.contractAddress });
      }
    },
  };
}
