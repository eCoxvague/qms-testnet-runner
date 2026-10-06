import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, unlinkSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { root, config, save, childEnvironment } from './lib.mjs';
import { runWorkflow, parseOutput, createOutputParser } from './workflow.mjs';
import { createLogger } from './logger.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
const reportPath = `reports/run-${runId}.json`;
const logFile = resolve(root, `reports/run-${runId}.log`);
const lockPath = resolve(root, '.cache/run-all.lock');
let lock;
let child;
let interrupted = false;
let verbose = false;
let lastReport;
let logReady = false;
let logger = createLogger();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  child?.kill(signal);
});

async function execute(args, name) {
  if (interrupted) throw new Error('Akis kullanici tarafindan durduruldu.');
  return new Promise((accept, reject) => {
    child = spawn(process.execPath, [resolve(root, 'scripts/qms.mjs'), ...args],
      { cwd: root, env: childEnvironment(args[0], lastReport?.address), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    let parseError;
    const parser = createOutputParser(result => logger.result(result));
    const heartbeat = setInterval(() => logger.heartbeat(), 10000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => {
      stdout += data;
      if (verbose) process.stdout.write(data);
      if (!parseError) {
        try { parser.push(data); } catch (error) { parseError = error; }
      }
    });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', () => { clearInterval(heartbeat); reject(new Error('Alt komut baslatilamadi.')); });
    child.once('close', code => {
      clearInterval(heartbeat);
      child = null;
      let results;
      try { results = parseOutput(stdout); } catch { results = []; }
      if (code !== 0 || interrupted) {
        const error = new Error(interrupted ? 'Akis durduruldu.' : (stderr.trim() || `${name} basarisiz.`));
        error.results = results;
        reject(error);
      } else if (parseError) { parseError.results = results; reject(parseError); }
      else if (!results.length) reject(new Error('Komut sonuc verisi uretmedi.'));
      else accept(results);
    });
  });
}

try {
  const { values } = parseArgs({ options: {
    broadcast: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'swap-amount': { type: 'string', default: '0.2' },
    'liquidity-amount': { type: 'string', default: '0.1' },
    'slippage-bps': { type: 'string', default: String(config.slippageBps) },
    help: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    'no-color': { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('npm run all  (tum adimlari zincire gonderir)\nnpm run all -- --dry-run  (on kontrol)\nSecenekler: --swap-amount 0.2 --liquidity-amount 0.1 --slippage-bps 100 --verbose --no-color');
  } else {
    mkdirSync(resolve(root, '.cache'), { recursive: true });
    try { lock = openSync(lockPath, 'wx'); }
    catch { throw new Error('Baska bir toplu akis calisiyor veya onceki kilit kaldi: .cache/run-all.lock'); }
    verbose = values.verbose;
    mkdirSync(resolve(root, 'reports'), { recursive: true });
    logReady = true;
    logger = createLogger({ color: Boolean(process.stdout.isTTY) && !values['no-color'] && !('NO_COLOR' in process.env),
      record: line => appendFileSync(logFile, line + '\n', 'utf8') });
    const broadcast = values.broadcast && !values['dry-run'];
    logger.start({ broadcast, swapAmount: values['swap-amount'], liquidityAmount: values['liquidity-amount'],
      slippageBps: Number(values['slippage-bps']) });
    const report = await runWorkflow({ execute, broadcast,
      swapAmount: values['swap-amount'], liquidityAmount: values['liquidity-amount'],
      slippageBps: Number(values['slippage-bps']), checkpoint: state => {
        save(reportPath, state);
        save('reports/run-latest.json', state);
        lastReport = state;
        logger.observe(state);
      } });
    logger.finish(report, resolve(root, reportPath), logFile);
  }
} catch (error) {
  if (lastReport?.status === 'failed') logger.finish(lastReport, resolve(root, reportPath), logFile);
  else logger.failure(error);
  if (logReady) logger.note('Durum: reports/run-latest.json. Gönderilen hash varsa yeniden başlatmadan receipt kontrol edin.');
  process.exitCode = 1;
} finally {
  if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
}
