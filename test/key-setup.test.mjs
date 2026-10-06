import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Wallet } from 'ethers';
import { root } from '../scripts/lib.mjs';
import { readSecret } from '../scripts/secret-input.mjs';
import { importPortableKey } from '../scripts/key-manager.mjs';

function terminal() {
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  let text = '';
  output.on('data', chunk => { text += chunk; });
  return { input, output, text: () => text };
}
test('interactive private key entry masks pasted input and restores the terminal', async () => {
  const t = terminal();
  const pending = readSecret('Private key', t);
  t.input.write('test-secret-value');
  t.input.write('\u007f');
  t.input.write('X\r');
  assert.equal(await pending, 'test-secret-valuX');
  assert.ok(!t.text().includes('test-secret'));
  assert.ok(t.text().includes('***'));
  assert.equal(t.input.isRaw, false);
  assert.equal(t.input.listenerCount('data'), 0);
});
test('secret entry rejects non-interactive input and Ctrl+C without echoing secrets', async () => {
  await assert.rejects(readSecret('Key', { input: { isTTY: false }, output: {} }), /interaktif/);
  const t = terminal();
  const pending = readSecret('Key', t);
  t.input.write('hidden');
  t.input.write('\u0003');
  await assert.rejects(pending, /iptal/);
  assert.ok(!t.text().includes('hidden'));
  assert.equal(t.input.isRaw, false);
});
test('portable key setup writes encrypted data and the CLI loader rejects incorrect unlock passwords', async () => {
  const cache = resolve(root, '.cache');
  mkdirSync(cache, { recursive: true });
  const fixture = mkdtempSync(join(cache, 'keystore-test-'));
  const wallet = Wallet.createRandom();
  const password = 'local-test-password-123';
  const file = join(fixture, '.secrets/qms-keystore.json');
  const messages = [];
  const previousKey = process.env.QMS_PRIVATE_KEY;
  const previousPassword = process.env.QMS_KEYSTORE_PASSWORD;
  try {
    const answers = [wallet.privateKey, password, password];
    const returned = await importPortableKey({ secret: async () => answers.shift(), file, write: line => messages.push(line) });
    assert.ok(returned === password);
    const stored = readFileSync(file, 'utf8');
    assert.ok(!stored.includes(wallet.privateKey));
    assert.ok(!stored.includes(password));
    assert.ok(!messages.join('\n').includes(wallet.privateKey));
    mkdirSync(join(fixture, 'scripts'));
    mkdirSync(join(fixture, 'config'));
    copyFileSync(join(root, 'scripts/lib.mjs'), join(fixture, 'scripts/lib.mjs'));
    copyFileSync(join(root, 'config/qms-testnet.json'), join(fixture, 'config/qms-testnet.json'));
    const { loadWallet } = await import(pathToFileURL(join(fixture, 'scripts/lib.mjs')).href);
    delete process.env.QMS_PRIVATE_KEY;
    process.env.QMS_KEYSTORE_PASSWORD = password;
    assert.equal(loadWallet().address, wallet.address);
    assert.equal(process.env.QMS_KEYSTORE_PASSWORD, undefined);
    process.env.QMS_KEYSTORE_PASSWORD = 'wrong-password';
    assert.throws(() => loadWallet(), /Keystore acilamadi/);
    assert.equal(process.env.QMS_KEYSTORE_PASSWORD, undefined);
    const refusedFile = join(fixture, '.secrets/refused.json');
    const mismatch = [wallet.privateKey, password, 'different-password'];
    await assert.rejects(importPortableKey({ secret: async () => mismatch.shift(), file: refusedFile, write: () => {} }), /do not match/);
    assert.ok(!existsSync(refusedFile));
  } finally {
    if (previousKey === undefined) delete process.env.QMS_PRIVATE_KEY; else process.env.QMS_PRIVATE_KEY = previousKey;
    if (previousPassword === undefined) delete process.env.QMS_KEYSTORE_PASSWORD; else process.env.QMS_KEYSTORE_PASSWORD = previousPassword;
    assert.equal(dirname(resolve(fixture)), cache);
    rmSync(fixture, { recursive: true, force: true });
  }
});
