export function taskContext(env = process.env) {
  const id = env.QMS_OPERATION_ID;
  const from = env.QMS_TASK_NOT_BEFORE, until = env.QMS_TASK_NOT_AFTER;
  if (!id && !from && !until) return null;
  const daily = /^daily-(\d{4}-\d{2}-\d{2}):([\da-f]{40}):(\d{4}-\d{2}-\d{2}):(swap-1|swap-2|liquidity|increment)$/.exec(id ?? '');
  if (daily) {
    const start = Date.parse(from), end = Date.parse(until), first = Date.parse(daily[1] + 'T13:00:00.000Z');
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(first)
        || end - start !== 86400000 || start !== Date.parse(daily[3] + 'T13:00:00.000Z')
        || new Date(start).toISOString().slice(0, 10) !== daily[3]
        || new Date(first).toISOString().slice(0, 10) !== daily[1]
        || start < first || start >= first + 30 * 86400000
        || !/^0x[\da-f]{40}$/i.test(env.QMS_DAILY_COUNTER ?? '') || /^0x0{40}$/i.test(env.QMS_DAILY_COUNTER))
      throw new Error('Gunluk aktivite baglami gecersiz.');
    return { type: 'daily', id, group: `daily-${daily[1]}:${daily[2]}:`, address: '0x' + daily[2],
      day: daily[3], kind: daily[4], counter: env.QMS_DAILY_COUNTER, start, end };
  }
  const match = /^streak-(\d{4}-\d{2}-\d{2}):([\da-f]{40}):([1-7]):(swap|liquidity)$/.exec(id ?? '');
  const start = Date.parse(from), end = Date.parse(until);
  if (!match || !Number.isFinite(start) || !Number.isFinite(end) || end - start !== 86400000)
    throw new Error('Gunluk islem baglami gecersiz.');
  const campaignStart = Date.parse(match[1] + 'T13:00:00.000Z');
  if (start !== campaignStart + (Number(match[3]) - 1) * 86400000)
    throw new Error('Gunluk islem tarihi kampanya gunuyle eslesmiyor.');
  return { id, group: `streak-${match[1]}:${match[2]}:`, address: '0x' + match[2],
    day: Number(match[3]), kind: match[4], start, end };
}
export function assertTaskWindow(context, now = Date.now()) {
  if (context && (now < context.start || now >= context.end))
    throw new Error('Streak gorev gunu disinda islem gonderilmez.');
}
