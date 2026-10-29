import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getAddress, parseEther } from 'ethers';

export const dailySettings = JSON.parse(readFileSync(new URL('../config/daily.json', import.meta.url), 'utf8'));
export const dailyKinds = ['swap-1', 'swap-2', 'liquidity', 'increment'];
export const DAY = 86400000;
export function validateDaily(settings = dailySettings) {
  const start = Date.parse(settings.startsAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.id) || settings.startsAt !== settings.id + 'T13:00:00.000Z'
      || !Number.isFinite(start) || new Date(start).toISOString() !== settings.startsAt
      || !Number.isInteger(settings.days) || settings.days < 1 || settings.days > 30
      || settings.maxTransactions !== 5 || settings.maxNativeQms !== '0.25' || settings.maxGasQms !== '0.25'
      || !Number.isInteger(settings.slippageBps) || settings.slippageBps < 1 || settings.slippageBps > 500)
    throw new Error('Gunluk aktivite ayarlari gecersiz.');
  const swap = parseEther(settings.swapAmountQms), lp = parseEther(settings.liquidityAmountQms);
  if (swap <= 0n || swap > parseEther('0.1') || lp <= 0n || lp > parseEther('0.05') || 2n * swap + lp > parseEther('0.25'))
    throw new Error('Gunluk aktivite tutarlari guvenli siniri asiyor.');
  return settings;
}
export function dailyWindow(now = new Date(), settings = dailySettings) {
  validateDaily(settings);
  const time = new Date(now).getTime(), first = Date.parse(settings.startsAt), end = first + settings.days * DAY;
  if (!Number.isFinite(time)) throw new Error('Gunluk tarih gecersiz.');
  if (time < first || time >= end) return { phase: time < first ? 'before-start' : 'ended', profileEnd: new Date(end).toISOString() };
  const start = first + Math.floor((time - first) / DAY) * DAY;
  return { phase: 'active', day: new Date(start).toISOString().slice(0, 10), startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + DAY).toISOString(), profileEnd: new Date(end).toISOString() };
}
export function dailyOperation(address, kind, period, settings = dailySettings) {
  if (period.phase !== 'active' || !dailyKinds.includes(kind)) throw new Error('Gunluk adim veya zaman gecersiz.');
  return `daily-${settings.id}:${getAddress(address).slice(2).toLowerCase()}:${period.day}:${kind}`;
}
export function dailyFingerprint(address, counter, contracts, settings = dailySettings) {
  validateDaily(settings);
  return createHash('sha256').update(JSON.stringify({ address: getAddress(address), counter: getAddress(counter), contracts, settings })).digest('hex');
}
export function dailyCommands(counter, settings = dailySettings) {
  validateDaily(settings);
  return dailyKinds.map(kind => ({ kind, args: kind === 'increment' ? ['increment', '--contract', getAddress(counter)]
    : [kind.startsWith('swap-') ? 'swap' : 'liquidity', '--amount', kind.startsWith('swap-') ? settings.swapAmountQms : settings.liquidityAmountQms,
      '--slippage-bps', String(settings.slippageBps)] }));
}
