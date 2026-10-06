import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config, root, loadWallet, safeError } from './lib.mjs';
import { hasStoredKey, importPrivateKey, keystoreFile, dpapiFile } from './key-manager.mjs';
import { readSecret } from './secret-input.mjs';

let password;
try {
  const args = process.argv.slice(2);
  if (!args.includes('--help')) {
    console.log('\nQMS Testnet Runner · local wallet setup\n');
    if (!hasStoredKey()) {
      console.log('Use a separate TESTNET wallet. Private key input is hidden.');
      password = await importPrivateKey();
    }
    if (!process.env.QMS_PRIVATE_KEY && !(process.platform === 'win32' && existsSync(dpapiFile)) && existsSync(keystoreFile))
      password ??= await readSecret('Unlock local keystore (password hidden)');
  }
  const childEnv = { ...process.env };
  if (password !== undefined) childEnv.QMS_KEYSTORE_PASSWORD = password;
  if (!args.includes('--help')) {
    if (password !== undefined) process.env.QMS_KEYSTORE_PASSWORD = password;
    const suppliedKey = process.env.QMS_PRIVATE_KEY;
    try {
      const wallet = loadWallet();
      console.log('Wallet: ' + wallet.address);
      console.log('Free test QMS faucet: ' + config.faucetUrl);
      console.log('Workflow requires 0.65 QMS with default amounts and gas reserves.\n');
    } finally {
      delete process.env.QMS_KEYSTORE_PASSWORD;
      if (suppliedKey !== undefined) process.env.QMS_PRIVATE_KEY = suppliedKey;
    }
  }
  const code = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/run-all.mjs'), '--broadcast', ...args],
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
  console.error('Startup failed: ' + safeError(error)); process.exitCode = 1;
} finally { password = undefined; delete process.env.QMS_KEYSTORE_PASSWORD; delete process.env.QMS_PRIVATE_KEY; }
