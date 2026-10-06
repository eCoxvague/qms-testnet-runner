import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectContent } from '../scripts/security-check.mjs';

test('repository scan catches secret-file paths, literal keys and tokens without returning secret values', () => {
  const key = '0x' + 'ab'.repeat(32);
  const token = 'ghp_' + 'A'.repeat(36);
  assert.ok(inspectContent('.secrets/qms-key.dpapi', '').includes('local-only-file'));
  assert.ok(inspectContent('.ENV', '').includes('local-only-file'));
  assert.ok(inspectContent('reports/run.json', '').includes('local-only-file'));
  const keyFindings = inspectContent('scripts/example.mjs', key);
  const tokenFindings = inspectContent('README.md', token);
  assert.ok(keyFindings.includes('literal-256-bit-hex-review-required'));
  assert.ok(tokenFindings.includes('github-credential'));
  assert.ok(!JSON.stringify(keyFindings).includes(key));
  assert.ok(!JSON.stringify(tokenFindings).includes(token));
  assert.deepEqual(inspectContent('config/network.json', '0x' + 'ab'.repeat(20)), []);
});
