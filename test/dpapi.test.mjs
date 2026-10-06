import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from '../scripts/lib.mjs';

const quotePs = value => "'" + value.replaceAll("'", "''") + "'";
function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
}

test('Windows key import and read work without Security module autoload; legacy files remain readable',
  { skip: process.platform !== 'win32' }, () => {
    // Isolate the whole script pair so no real user's encrypted key is read or overwritten.
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'qms-key-regression-'));
    const scriptsDir = join(fixtureRoot, 'scripts');
    mkdirSync(scriptsDir);
    for (const name of ['import-key.ps1', 'read-key.ps1', 'dpapi.ps1'])
      copyFileSync(join(root, 'scripts', name), join(scriptsDir, name));
    const keyFile = join(fixtureRoot, '.secrets', 'qms-key.dpapi');
    const dummyKey = '0x' + '01'.repeat(32);
    try {
      const imported = powershell(`
$ErrorActionPreference = 'Stop'
$PSModuleAutoloadingPreference = 'None'
function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    $secure = [Security.SecureString]::new()
    $sample = '0x' + ('01' * 32)
    foreach ($character in $sample.ToCharArray()) { $secure.AppendChar($character) }
    $secure.MakeReadOnly()
    return $secure
}
. ${quotePs(join(scriptsDir, 'import-key.ps1'))}
`);
      assert.ok(imported.includes('DPAPI ile sifrelendi'));
      assert.ok(!imported.includes(dummyKey), 'Importer must not print its input');
      const encrypted = readFileSync(keyFile, 'utf8');
      assert.ok(encrypted.startsWith('QMS-DPAPI-V1:'));
      assert.ok(!encrypted.includes(dummyKey), 'Stored file must not contain plaintext');
      const read = () => powershell(`
$ErrorActionPreference = 'Stop'
$PSModuleAutoloadingPreference = 'None'
. ${quotePs(join(scriptsDir, 'read-key.ps1'))}
`);
      assert.ok(read() === dummyKey, 'New format must decrypt to its original input');
      // Generate a genuine legacy Windows PowerShell DPAPI blob, rather than imitating its encoding.
      const legacy = powershell(`
$ErrorActionPreference = 'Stop'
Import-Module -Name ([System.IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Security.psd1')) -ErrorAction Stop
$secure = [Security.SecureString]::new()
foreach ($character in ('0x' + ('01' * 32)).ToCharArray()) { $secure.AppendChar($character) }
[Console]::Out.Write((ConvertFrom-SecureString -SecureString $secure))
$secure.Dispose()
`);
      writeFileSync(keyFile, legacy + '\r\n');
      assert.ok(read() === dummyKey, 'Legacy format with a trailing newline must still decrypt');
      writeFileSync(keyFile, 'QMS-DPAPI-V1:invalid!');
      let failed = false;
      try { read(); } catch (error) {
        failed = true;
        assert.ok(!String(error.stdout).includes(dummyKey));
        assert.ok(!String(error.stderr).includes(dummyKey));
      }
      assert.ok(failed, 'Corrupt encrypted files must fail');
    } finally {
      // Verify the exact disposable target before recursive removal on Windows.
      assert.equal(dirname(resolve(fixtureRoot)), resolve(tmpdir()));
      assert.ok(basename(fixtureRoot).startsWith('qms-key-regression-'));
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
