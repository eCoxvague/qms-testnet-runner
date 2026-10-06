import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Wallet } from 'ethers';
import { readSecret } from './secret-input.mjs';
import { writeAtomic } from './storage.mjs';

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
      child.once('error', () => reject(new Error('Windows anahtar girisi baslatilamadi.')));
      child.once('exit', code => code === 0 ? accept() : reject(new Error('Anahtar kaydedilemedi.')));
    });
    return null;
  }
  return importPortableKey();
}

export async function importPortableKey({ secret = readSecret, file = keystoreFile, write = console.log } = {}) {
  let key, password, confirmation;
  try {
    key = (await secret('Test wallet private key (hidden)')).trim();
    if (!/^(0x)?[a-fA-F0-9]{64}$/.test(key)) throw new Error('Private key must contain 64 hex characters.');
    let wallet;
    try { wallet = new Wallet('0x' + key.replace(/^0x/, '')); }
    catch { throw new Error('Invalid private key.'); }
    password = await secret('Local keystore password (at least 12 characters)');
    if (password.length < 12) throw new Error('Use at least 12 characters for the keystore password.');
    confirmation = await secret('Repeat keystore password');
    if (password !== confirmation) throw new Error('Passwords do not match.');
    write('Encrypting the local keystore...');
    const encrypted = await wallet.encrypt(password);
    writeAtomic(file, encrypted + '\n', { secret: true });
    write('Encrypted keystore saved locally in .secrets/.');
    return password;
  } finally { key = undefined; confirmation = undefined; password = undefined; }
}
