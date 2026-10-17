import { readFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { getAddress, parseEther, formatEther } from 'ethers';
import { config, root, save, connect, loadWallet, childEnvironment, safeError } from './lib.mjs';
import { createOutputParser, parseOutput } from './workflow.mjs';
import { createLogger } from './logger.mjs';
import { campaign, streakWindow, streakProgress, turkeyTime } from './streak-calendar.mjs';
import { inspectStreakEvidence } from './streak-evidence.mjs';
import { runDailyStreak } from './streak-workflow.mjs';

const bindingPath = resolve(root, '.cache/streak-wallet.json');
const binding = existsSync(bindingPath) ? JSON.parse(readFileSync(bindingPath, 'utf8')) : {};
const credentials = Object.fromEntries(['QMS_PRIVATE_KEY', 'QMS_KEYSTORE_PASSWORD'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
let provider, descriptor, lockPath, child;
let interrupted = false;
let logger = createLogger();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; child?.kill(signal); });
function show(progress, status) {
  logger.note(`STREAK · ${status} · ${progress.completedDays}/7 gün tamamlandı · ${progress.missedDays} gün kaçırıldı`);
  logger.note(`Başlangıç: ${turkeyTime(progress.campaignStart)} · Bitiş: ${turkeyTime(progress.campaignEnd)} (Türkiye)`);
  if (progress.day) logger.note(`Görev günü ${progress.day}/7 · Gün sınırı: ${turkeyTime(progress.endsAt)}`);
  logger.note(`Yerel Quanta tahmini: ${progress.estimatedQuanta} · 6 gün bonusu: ${progress.bonusEligible ? 'uygun' : progress.bonusStillPossible ? 'henüz tamamlanmadı' : 'artık mümkün değil'}`);
  logger.note('Resmî Quanta puanı ve Discord rolü bu araç tarafından doğrulanmaz.');
}
try {
  const { values } = parseArgs({ options: {
    broadcast: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
    prepare: { type: 'boolean', default: false }, status: { type: 'boolean', default: false },
    address: { type: 'string' }, role: { type: 'string' }, help: { type: 'boolean', default: false },
    'no-color': { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('npm run streak:prepare\nnpm run streak\nnpm run streak:status\nnpm run streak -- --dry-run\nRol tahmini: --role standard|pioneer|qwabbit');
  } else {
    const window = streakWindow();
    const addressHint = values.address ?? binding.address;
    const hintedStateFile = addressHint ? resolve(root, `reports/streak-${campaign.id}/${getAddress(addressHint).toLowerCase()}.json`) : null;
    const cachedState = hintedStateFile && existsSync(hintedStateFile) ? JSON.parse(readFileSync(hintedStateFile, 'utf8')) : {};
    if (values.status || (window.phase !== 'active' && !values.prepare)) {
      const progress = streakProgress({ ...cachedState, role: values.role ?? cachedState.role ?? binding.role ?? campaign.role });
      show(progress, values.status ? 'yerel durum' : window.phase);
      if (window.phase === 'before-start') logger.note('Başlangıçtan önce zincire işlem gönderilmez. Hazırlık: npm run streak:prepare');
    } else {
      const expected = values.address ?? binding.address;
      if (expected) process.env.QMS_EXPECTED_ADDRESS = getAddress(expected);
      const address = loadWallet().address;
      const role = values.role ?? cachedState.role ?? binding.role ?? campaign.role;
      streakProgress({ role });
      const stateRelative = `reports/streak-${campaign.id}/${address.toLowerCase()}.json`;
      const stateFile = resolve(root, stateRelative);
      let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { address, campaignId: campaign.id, chainId: config.chainId, days: {}, role };
      if (state.address?.toLowerCase() !== address.toLowerCase()) throw new Error('Streak kaydi farkli cuzdana ait.');
      const cache = resolve(root, '.cache'); mkdirSync(cache, { recursive: true });
      // Shares the all-workflow lock so the two runners cannot overlap in the same checkout.
      lockPath = resolve(cache, 'run-all.lock');
      try { descriptor = openSync(lockPath, 'wx', 0o600); }
      catch { throw new Error('Baska bir test/streak akisi calisiyor veya onceki kilit kaldi.'); }
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, campaignId: campaign.id, address }));
      const logFile = resolve(root, `reports/streak-${campaign.id}/run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
      mkdirSync(resolve(logFile, '..'), { recursive: true });
      logger = createLogger({ color: Boolean(process.stdout.isTTY) && !values['no-color'] && !('NO_COLOR' in process.env),
        record: line => appendFileSync(logFile, line + '\n', { encoding: 'utf8', mode: 0o600 }) });
      logger.note(`STREAK · cüzdan ${address} · ${window.phase}`);
      provider = await connect();
      async function execute(args, context) {
        if (interrupted) throw new Error('Streak kullanici tarafindan durduruldu.');
        const env = childEnvironment(args[0], address);
        for (const key of ['QMS_OPERATION_ID', 'QMS_TASK_NOT_BEFORE', 'QMS_TASK_NOT_AFTER']) delete env[key];
        if (context) {
          Object.assign(env, credentials, { QMS_OPERATION_ID: context.operationId,
            QMS_TASK_NOT_BEFORE: context.notBefore, QMS_TASK_NOT_AFTER: context.notAfter });
          const amount = parseEther(context.operationId.endsWith(':swap') ? campaign.swapAmountQms : campaign.liquidityAmountQms);
          const remaining = args[0] === 'swap' ? amount + parseEther(campaign.liquidityAmountQms) : amount;
          const needed = remaining + parseEther(config.reserveQms) + BigInt(args[0] === 'swap' ? 3 : 2) * parseEther(config.maxGasQms);
          if (await provider.getBalance(address) < needed) throw new Error(`Kalan gunluk akis icin ${formatEther(needed)} QMS gerekiyor.`);
        }
        logger.note(`→ ${args[0]} ${context ? '· zincir işlemi ve kanıt kontrolü' : '· salt okunur kontrol'}`);
        return new Promise((accept, reject) => {
          let stdout = '', stderr = '', parseError;
          const parser = createOutputParser(result => logger.result(result));
          child = spawn(process.execPath, [resolve(root, 'scripts/qms.mjs'), ...args],
            { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
          const timer = setInterval(() => logger.note('İşlem/kontrol sonucu bekleniyor…'), 15000);
          child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
          child.stdout.on('data', text => { stdout += text; if (!parseError) try { parser.push(text); } catch (e) { parseError = e; } });
          child.stderr.on('data', text => { stderr += text; });
          child.once('error', () => { clearInterval(timer); reject(new Error('Streak alt komutu baslatilamadi.')); });
          child.once('close', code => {
            clearInterval(timer); child = null;
            if (code !== 0 || interrupted) reject(new Error(safeError({ message: stderr || 'Streak alt komutu durdu.' })));
            else if (parseError) reject(parseError);
            else { try { accept(parseOutput(stdout)); } catch (error) { reject(error); } }
          });
          delete env.QMS_PRIVATE_KEY; delete env.QMS_KEYSTORE_PASSWORD;
        });
      }
      if (values.prepare) {
        await execute(['status'], null);
        await execute(['wallet', '--address', address], null);
        const perDay = parseEther(campaign.swapAmountQms) + parseEther(campaign.liquidityAmountQms) + 3n * parseEther(config.maxGasQms);
        state = { ...state, role, preparedAt: new Date().toISOString() };
        save(stateRelative, state);
        save('.cache/streak-wallet.json', { campaignId: campaign.id, address, role });
        show(streakProgress(state), 'hazır');
        logger.note(`Günlük konservatif bütçe: ${formatEther(perDay + parseEther(config.reserveQms))} QMS; 7 gün + rezerv: ${formatEther(7n * perDay + parseEther(config.reserveQms))} QMS.`);
        logger.note('Hazırlık tamamlandı; zamanlanmış görev etkinleştirilmedi.');
      } else {
        const dry = values['dry-run'] || !values.broadcast;
        const result = await runDailyStreak({ address, state, role, broadcast: !dry,
          inspect: current => inspectStreakEvidence(provider, root, address, campaign, current), execute,
          log: text => logger.note(text), checkpoint: current => save(dry ? `reports/streak-${campaign.id}/preview-latest.json` : stateRelative, current) });
        if (!dry) save('.cache/streak-wallet.json', { campaignId: campaign.id, address, role });
        show(result.progress, result.status);
        if (result.reason) logger.note(result.reason);
        logger.note(`Durum dosyası: ${stateFile}`);
        if (['waiting', 'day-changed'].includes(result.status)) process.exitCode = 2;
      }
    }
  }
} catch (error) { logger.failure(error); process.exitCode = 1; }
finally {
  provider?.destroy();
  if (descriptor !== undefined) { closeSync(descriptor); unlinkSync(lockPath); }
  for (const key of Object.keys(credentials)) delete credentials[key];
  delete process.env.QMS_KEYSTORE_PASSWORD; delete process.env.QMS_PRIVATE_KEY;
}
