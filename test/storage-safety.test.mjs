import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { root } from '../scripts/lib.mjs';
import { writeAtomic } from '../scripts/storage.mjs';

function fixture() {
  const cache = resolve(root, '.cache'); mkdirSync(cache, { recursive: true });
  const folder = mkdtempSync(join(cache, 'storage-safety-'));
  return { folder, cleanup: () => { assert.equal(dirname(resolve(folder)), cache); rmSync(folder, { recursive: true, force: true }); } };
}
test('atomic replacement produces a complete record and leaves no temporary files', () => {
  const f = fixture();
  try {
    const file = join(f.folder, 'report.json');
    writeAtomic(file, '{"status":"old"}');
    writeAtomic(file, '{"status":"new"}');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { status: 'new' });
    assert.deepEqual(readdirSync(f.folder), ['report.json']);
  } finally { f.cleanup(); }
});
test('secret files reject symbolic link targets and restrict permissions', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const secretFolder = join(f.folder, '.secrets');
    mkdirSync(secretFolder, { mode: 0o777 });
    const file = join(secretFolder, 'key.json');
    writeAtomic(file, 'encrypted fixture', { secret: true });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(secretFolder).mode & 0o777, 0o700);
    const victim = join(f.folder, 'outside.json'); writeFileSync(victim, 'unchanged');
    const link = join(secretFolder, 'linked.json'); symlinkSync(victim, link);
    assert.throws(() => writeAtomic(link, 'replacement', { secret: true }), /sembolik/);
    assert.equal(readFileSync(victim, 'utf8'), 'unchanged');
    const folderLink = join(f.folder, 'linked-folder'); symlinkSync(secretFolder, folderLink);
    assert.throws(() => writeAtomic(join(folderLink, 'another.json'), 'replacement', { secret: true }), /sembolik/);
  } finally { f.cleanup(); }
});
