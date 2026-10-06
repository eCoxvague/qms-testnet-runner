import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutputParser } from '../scripts/workflow.mjs';
import { createLogger, cleanAnsi } from '../scripts/logger.mjs';

test('streamed objects render only when complete, even when escapes and braces cross chunks', () => {
  const first = { hash: '0x123', explorer: 'https://example.test/{block}', note: 'escaped " and \\ end' };
  const second = { status: 'confirmed', blockNumber: 12 };
  const values = [];
  const parser = createOutputParser(value => values.push(value));
  const text = JSON.stringify(first);
  for (const character of text.slice(0, -1)) parser.push(character);
  assert.equal(values.length, 0, 'Partial objects must never be presented as complete');
  parser.push('}\n');
  assert.deepEqual(values, [first], 'Submitted hash must be available before later receipt output');
  for (const character of JSON.stringify(second)) parser.push(character);
  parser.finish();
  assert.deepEqual(values, [first, second]);
});

test('human logs contain Istanbul timestamps and public tx links, but ignore unknown secret fields', () => {
  const terminal = [], file = [];
  const logger = createLogger({ color: true, write: line => terminal.push(line), record: line => file.push(line),
    now: () => new Date('2026-10-06T10:00:00Z') });
  const secret = 'a1'.repeat(32);
  const hash = '0x' + 'bc'.repeat(32);
  logger.result({ hash, explorer: `https://testnet.qmsscan.io/tx/${hash}`, privateKey: secret });
  logger.result({ status: 'confirmed', blockNumber: 123, confirmations: 2, feeQms: '0.0001' });
  assert.ok(file.some(line => line.startsWith('[13:00:00]')));
  assert.ok(file.some(line => line.includes(`/tx/${hash}`)));
  assert.ok(file.some(line => line.includes('Onaylandı')));
  assert.ok(file.every(line => !line.includes('\x1b')));
  assert.ok(terminal.some(line => line.includes('\x1b')));
  assert.ok(!file.join('\n').includes(secret));
  assert.equal(cleanAnsi(terminal.join('\n')), file.join('\n'));
});

test('failure output redacts error payloads and does not display a success banner', () => {
  const lines = [];
  const logger = createLogger({ color: false, write: line => lines.push(line) });
  const secret = 'de'.repeat(32);
  logger.failure(new Error('invalid key 0x' + secret));
  logger.finish({ status: 'failed', startedAt: '2026-10-06T10:00:00Z', finishedAt: '2026-10-06T10:00:03Z',
    steps: [{ status: 'failed', results: [{ status: 'confirmed', feeQms: '0.0001' }] }] }, 'report.json', 'run.log');
  const text = lines.join('\n');
  assert.ok(!text.includes(secret));
  assert.ok(text.includes('AKIŞ DURDU'));
  assert.ok(text.includes('1 onaylı'));
  assert.ok(text.includes('1 başarısız'));
  assert.ok(!text.includes('TÜM TESTLER TAMAMLANDI'));
});

test('block hashes are never mislabeled as submitted transactions during preflight', () => {
  const lines = [];
  const logger = createLogger({ color: false, write: line => lines.push(line) });
  logger.result({ hash: '0x' + 'ab'.repeat(32), number: 12, explorer: 'https://testnet.qmsscan.io/block/12',
    qubo: { problemSize: 1024 }, objectiveVerification: { verified: true, computedObjective: '-100' } });
  assert.ok(lines.some(line => line.includes('Blok #12')));
  assert.ok(!lines.some(line => line.includes('Gönderildi')));
});
