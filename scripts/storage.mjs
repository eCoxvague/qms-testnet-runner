import { existsSync, lstatSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function writeAtomic(file, content, { secret = false } = {}) {
  const directory = dirname(file);
  if (secret && existsSync(directory) && lstatSync(directory).isSymbolicLink())
    throw new Error('Anahtar klasoru sembolik baglanti olamaz.');
  mkdirSync(directory, { recursive: true, mode: secret ? 0o700 : 0o755 });
  if (secret && process.platform !== 'win32') chmodSync(directory, 0o700);
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('Hedef dosya sembolik baglanti olamaz.');
  const temporary = join(directory, '.write-' + randomUUID() + '.tmp');
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
