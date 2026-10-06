import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const forbidden = /^(?:\.secrets(?:\/|$)|\.env(?:\.|$)|reports\/|deployments\/|artifacts\/|node_modules\/|\.cache\/|docs\/test-run-|docs\/discord-feedback\.md)/i;
export function inspectContent(file, content) {
  const findings = [];
  if (forbidden.test(file)) findings.push('local-only-file');
  if (/(?:^|[^\da-f])(?:0x)?[\da-f]{64}(?:$|[^\da-f])/i.test(content)) findings.push('literal-256-bit-hex-review-required');
  if (/(?:gh[pousr]_[a-z0-9]{30,}|github_pat_[a-z0-9_]{30,})/i.test(content)) findings.push('github-credential');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push('private-key-file');
  return findings;
}

export function checkRepository() {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const findings = [];
  const commits = git(['rev-list', '--all']).trim().split('\n').filter(Boolean);
  let scanned = 0;
  function scan(revision, files) {
    for (const file of files) {
      const content = git(['show', revision === 'index' ? ':' + file : revision + ':' + file]);
      scanned++;
      for (const rule of inspectContent(file, content)) findings.push({ revision, file, rule });
    }
  }
  for (const commit of commits) scan(commit, git(['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean));
  scan('index', git(['ls-files', '-z']).split('\0').filter(Boolean));
  return { commits: commits.length, fileVersions: scanned, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkRepository();
    console.log(`Security scan: ${result.commits} commits, ${result.fileVersions} file versions, ${result.findings.length} findings.`);
    // Never print matched credential content.
    for (const finding of result.findings) console.error(`${finding.rule}: ${finding.file} (${finding.revision})`);
    if (result.findings.length) process.exitCode = 1;
  } catch { console.error('Repository security scan could not complete.'); process.exitCode = 1; }
}
