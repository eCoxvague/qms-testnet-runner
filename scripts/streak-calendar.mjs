import { readFileSync } from 'node:fs';
import { getAddress } from 'ethers';
import { err, formatLocalTime, streakNote } from './messages.mjs';

export const campaign = JSON.parse(readFileSync(new URL('../config/streak.json', import.meta.url), 'utf8'));
export const DAY_MS = 86400000;
export function streakWindow(now = new Date(), settings = campaign) {
  const start = Date.parse(settings.startsAt), time = new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(time) || settings.days !== 7 || settings.requiredDays !== 6
      || !/^\d{4}-\d{2}-\d{2}$/.test(settings.id) || settings.id !== settings.startsAt.slice(0, 10))
    throw new Error(err.streakDates);
  const end = start + settings.days * DAY_MS;
  const phase = time < start ? 'before-start' : time >= end ? 'ended' : 'active';
  const day = phase === 'active' ? Math.floor((time - start) / DAY_MS) + 1 : null;
  return { phase, day, campaignStart: new Date(start).toISOString(), campaignEnd: new Date(end).toISOString(),
    startsAt: day ? new Date(start + (day - 1) * DAY_MS).toISOString() : null,
    endsAt: day ? new Date(start + day * DAY_MS).toISOString() : null };
}
export function dayWindow(day, settings = campaign) {
  if (!Number.isInteger(day) || day < 1 || day > settings.days) throw new Error(err.streakDay);
  const start = Date.parse(settings.startsAt) + (day - 1) * DAY_MS;
  return { day, startsAt: new Date(start).toISOString(), endsAt: new Date(start + DAY_MS).toISOString() };
}
export function operationId(address, day, kind, settings = campaign) {
  dayWindow(day, settings);
  if (!['swap', 'liquidity'].includes(kind)) throw new Error(err.streakOpKind);
  return `streak-${settings.id}:${getAddress(address).slice(2).toLowerCase()}:${day}:${kind}`;
}
export function streakProgress(state, now = new Date(), settings = campaign) {
  const window = streakWindow(now, settings);
  const role = state?.role ?? settings.role;
  if (!['standard', 'pioneer', 'qwabbit'].includes(role)) throw new Error(err.streakRole);
  const rows = Array.from({ length: settings.days }, (_, i) => {
    const period = dayWindow(i + 1, settings), saved = state?.days?.[i + 1];
    const completed = saved?.swap?.status === 'confirmed' && saved?.liquidity?.status === 'confirmed';
    return { ...period, completed, status: completed ? 'completed' : new Date(now).getTime() >= Date.parse(period.endsAt)
      ? 'missed' : window.day === i + 1 ? 'today' : 'upcoming' };
  });
  const completedDays = rows.filter(r => r.completed).length;
  const missedDays = rows.filter(r => r.status === 'missed').length;
  const rates = role === 'standard' ? settings.points.standard : settings.points.boosted;
  const bonusEligible = completedDays >= settings.requiredDays;
  const estimatedQuanta = completedDays * rates.daily + (bonusEligible ? rates.bonus : 0);
  return { ...window, rows, role, completedDays, missedDays, bonusEligible,
    bonusStillPossible: settings.days - missedDays >= settings.requiredDays,
    estimatedQuanta, dailyQuanta: rates.daily, bonusQuanta: rates.bonus,
    officialCreditVerified: false, note: streakNote.estimatedFooter };
}
export const turkeyTime = formatLocalTime;
