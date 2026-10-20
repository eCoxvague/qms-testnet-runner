import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config, root, loadWallet, safeError } from './lib.mjs';
import { log } from './messages.mjs';
import { hasStoredKey, importPrivateKey, keystoreFile, dpapiFile } from './key-manager.mjs';
import { readSecret } from './secret-input.mjs';
import { streakWindow } from './streak-calendar.mjs';

let password;
try {
  const originalArgs = process.argv.slice(2);
  const streak = originalArgs.includes('--streak');
  const args = originalArgs.filter(arg => arg !== '--streak');
  const keyless = streak && (args.includes('--status') || (!args.includes('--prepare') && streakWindow().phase !== 'active'));
  const needsWallet = !args.includes('--help') && !keyless;
  if (needsWallet) {
    console.log(log.startBanner);
    if (!hasStoredKey()) {
      console.log(log.testnetWalletHint);
      password = await importPrivateKey();
    }
    if (!process.env.QMS_PRIVATE_KEY && !(process.platform === 'win32' && existsSync(dpapiFile)) && existsSync(keystoreFile))
      password ??= await readSecret('Unlock local keystore (password hidden)');
  }
  const childEnv = { ...process.env };
  if (password !== undefined) childEnv.QMS_KEYSTORE_PASSWORD = password;
  if (needsWallet) {
    if (password !== undefined) process.env.QMS_KEYSTORE_PASSWORD = password;
    const suppliedKey = process.env.QMS_PRIVATE_KEY;
    try {
      const wallet = loadWallet();
      console.log(log.walletLine(wallet.address));
      console.log(log.faucetLine(config.faucetUrl));
      console.log(log.workflowNeed(streak ? '0.55' : '0.65'));
    } finally {
      delete process.env.QMS_KEYSTORE_PASSWORD;
      if (suppliedKey !== undefined) process.env.QMS_PRIVATE_KEY = suppliedKey;
    }
  }
  const code = await new Promise((accept, reject) => {
    if (keyless) { delete childEnv.QMS_PRIVATE_KEY; delete childEnv.QMS_KEYSTORE_PASSWORD; }
    const child = spawn(process.execPath, [resolve(root, streak ? 'scripts/run-streak.mjs' : 'scripts/run-all.mjs'), '--broadcast', ...args],
      { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true });
    const interrupt = () => child.kill('SIGINT');
    process.once('SIGINT', interrupt);
    child.once('error', () => { process.off('SIGINT', interrupt); reject(new Error('Workflow could not start.')); });
    child.once('exit', code => { process.off('SIGINT', interrupt); accept(code ?? 1); });
    // Copies already went to the child; remove transient credentials from this process.
    delete childEnv.QMS_KEYSTORE_PASSWORD;
    delete childEnv.QMS_PRIVATE_KEY;
  });
  process.exitCode = code;
} catch (error) {
  console.error(log.startupFailed + safeError(error)); process.exitCode = 1;
} finally { password = undefined; delete process.env.QMS_KEYSTORE_PASSWORD; delete process.env.QMS_PRIVATE_KEY; }
