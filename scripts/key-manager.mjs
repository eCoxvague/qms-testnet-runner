import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Wallet } from 'ethers';
import { readSecret } from './secret-input.mjs';
import { writeAtomic } from './storage.mjs';
import { err, log, prompts } from './messages.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const keystoreFile = resolve(projectRoot, '.secrets/qms-keystore.json');
export const dpapiFile = resolve(projectRoot, '.secrets/qms-key.dpapi');
export function hasStoredKey() {
  return Boolean(process.env.QMS_PRIVATE_KEY) || existsSync(keystoreFile)
    || (process.platform === 'win32' && existsSync(dpapiFile));
}
export async function importPrivateKey() {
  if (process.platform === 'win32') {
    await new Promise((accept, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        resolve(projectRoot, 'scripts/import-key.ps1')], { stdio: 'inherit', windowsHide: true });
      child.once('error', () => reject(new Error(err.winKeyImport)));
      child.once('exit', code => code === 0 ? accept() : reject(new Error(err.winKeySave)));
    });
    return null;
  }
  return importPortableKey();
}

export async function importPortableKey({ secret = readSecret, file = keystoreFile, write = console.log } = {}) {
  let key, password, confirmation;
  try {
    key = (await secret(prompts.privateKey)).trim();
    if (!/^(0x)?[a-fA-F0-9]{64}$/.test(key)) throw new Error(err.keyHexLen);
    let wallet;
    try { wallet = new Wallet('0x' + key.replace(/^0x/, '')); }
    catch { throw new Error(err.keyInvalidPortable); }
    password = await secret(prompts.keystorePassword);
    if (password.length < 12) throw new Error(err.keystorePassLen);
    confirmation = await secret(prompts.keystorePasswordRepeat);
    if (password !== confirmation) throw new Error(err.keystorePassMatch);
    write(log.encryptingKeystore);
    const encrypted = await wallet.encrypt(password);
    writeAtomic(file, encrypted + '\n', { secret: true });
    write(log.keystoreSaved);
    return password;
  } finally { key = undefined; confirmation = undefined; password = undefined; }
}
