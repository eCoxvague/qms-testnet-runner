import { getAddress } from 'ethers';
import { amountQms, minimum, safeError } from './lib.mjs';
import { campaign, streakWindow, dayWindow, operationId, streakProgress } from './streak-calendar.mjs';

export async function runDailyStreak({ address, state = {}, settings = campaign, now = () => new Date(),
  inspect, execute, checkpoint = () => {}, log = () => {}, broadcast = false, role = state.role ?? settings.role }) {
  const window = streakWindow(now(), settings);
  streakProgress({ role }, now(), settings); // Validate display role before any transaction.
  if (window.phase !== 'active') return { status: window.phase, progress: streakProgress(state, now(), settings), state };
  address = getAddress(address);
  if (state.address && state.address.toLowerCase() !== address.toLowerCase()) throw new Error('Streak kaydi farkli cuzdana ait.');
  if (state.campaignId && state.campaignId !== settings.id) throw new Error('Streak kaydi farkli kampanyaya ait.');
  amountQms(settings.swapAmountQms); amountQms(settings.liquidityAmountQms); minimum(1000000n, settings.slippageBps);
  state = structuredClone(state);
  Object.assign(state, { campaignId: settings.id, chainId: 19480, address, role });
  state.days ??= {};
  let blocked = [];
  const persist = async () => { state.updatedAt = new Date(now()).toISOString(); await checkpoint(state); };
  async function refresh() {
    const evidence = await inspect(state);
    blocked = evidence.filter(e => ['pending', 'invalid'].includes(e.status));
    for (let i = 1; i <= settings.days; i++) {
      const period = dayWindow(i, settings);
      const row = state.days[i] ??= { ...period };
      for (const kind of ['swap', 'liquidity']) {
        const proof = evidence.find(e => e.status === 'confirmed' && e.kind === kind
          && e.timestamp >= Date.parse(period.startsAt) && e.timestamp < Date.parse(period.endsAt));
        row[kind] = proof ?? { status: 'not-started' };
      }
      row.completed = row.swap.status === 'confirmed' && row.liquidity.status === 'confirmed';
    }
    await persist();
  }
  function result(status, reason) {
    state.status = status;
    state.reason = reason ?? null;
    return { status, reason, state, progress: streakProgress(state, now(), settings) };
  }
  try {
    await refresh();
    if (state.days[window.day].completed) {
      log('Bugunun swap ve LP islemleri dogrulandi; tekrar gonderilmeyecek.');
      const done = result('already-completed'); await persist(); return done;
    }
    if (blocked.length) {
      const waiting = result('waiting', 'Bekleyen veya dogrulanamayan streak islemi var.'); await persist(); return waiting;
    }
    if (!broadcast) {
      await execute(['quote', '--amount', settings.swapAmountQms, '--slippage-bps', String(settings.slippageBps)], null);
      const preview = result('preview', 'Swap ve LP plani; zincire islem gonderilmedi.'); await persist(); return preview;
    }
    state.status = 'running'; await persist();
    for (const kind of ['swap', 'liquidity']) {
      if (state.days[window.day][kind].status === 'confirmed') {
        log(`${kind}: tamamlanmis, atlaniyor.`); continue;
      }
      if (streakWindow(now(), settings).day !== window.day) {
        const changed = result('day-changed', 'Gorev gunu degisti; yeni gune ait komutu yeniden calistirin.'); await persist(); return changed;
      }
      const context = { operationId: operationId(address, window.day, kind, settings),
        notBefore: window.startsAt, notAfter: window.endsAt, address };
      state.days[window.day][kind] = { status: 'running', operationId: context.operationId };
      await persist();
      let error;
      try {
        await execute([kind, '--amount', kind === 'swap' ? settings.swapAmountQms : settings.liquidityAmountQms,
          '--slippage-bps', String(settings.slippageBps), '--broadcast'], context);
      } catch (caught) { error = caught; }
      // Even a failed child can have mined successfully before losing its final RPC response.
      await refresh();
      if (state.days[window.day][kind].status === 'confirmed') continue;
      if (blocked.length) {
        const waiting = result('waiting', 'Islem gonderilmis olabilir; hash kaydindan dogrulanmasi bekleniyor.'); await persist(); return waiting;
      }
      if (streakWindow(now(), settings).day !== window.day) {
        const changed = result('day-changed', 'Islem farkli gorev gununde bloklandi; kanitlar gercek blok zamanina gore saklandi.'); await persist(); return changed;
      }
      throw error ?? new Error('Islem sonrasi beklenen zincir kaniti dogrulanamadi.');
    }
    const done = state.days[window.day].completed ? result('completed')
      : result('waiting', 'Iki gorevin zincir kaniti birlikte dogrulanamadi.');
    await persist(); return done;
  } catch (error) {
    state.status = 'failed'; state.error = safeError(error); await persist(); throw error;
  }
}
