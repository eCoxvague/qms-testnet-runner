import { err } from './messages.mjs';

export function taskContext(env = process.env) {
  const id = env.QMS_OPERATION_ID;
  const from = env.QMS_TASK_NOT_BEFORE, until = env.QMS_TASK_NOT_AFTER;
  if (!id && !from && !until) return null;
  const match = /^streak-(\d{4}-\d{2}-\d{2}):([\da-f]{40}):([1-7]):(swap|liquidity)$/.exec(id ?? '');
  const start = Date.parse(from), end = Date.parse(until);
  if (!match || !Number.isFinite(start) || !Number.isFinite(end) || end - start !== 86400000)
    throw new Error(err.taskCtx);
  const campaignStart = Date.parse(match[1] + 'T13:00:00.000Z');
  if (start !== campaignStart + (Number(match[3]) - 1) * 86400000)
    throw new Error(err.taskDate);
  return { id, group: `streak-${match[1]}:${match[2]}:`, address: '0x' + match[2],
    day: Number(match[3]), kind: match[4], start, end };
}
export function assertTaskWindow(context, now = Date.now()) {
  if (context && (now < context.start || now >= context.end))
    throw new Error(err.taskOutside);
}
