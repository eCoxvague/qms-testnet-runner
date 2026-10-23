import { formatEther, parseEther, parseUnits, formatUnits } from 'ethers';
import { safeError } from './lib.mjs';
import { legacyStepLabels } from './messages.mjs';

const ansi = { dim: 90, cyan: 36, green: 32, yellow: 33, red: 31, bold: 1 };
export const cleanAnsi = text => text.replace(/\x1b\[[0-9;]*m/g, '');
export const shortHash = value => value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
export function amount(value, decimals = 6) {
  const [whole, fraction] = String(value).split('.');
  const trimmed = fraction?.slice(0, decimals).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
const seconds = ms => `${(ms / 1000).toFixed(1)} 秒`;

function displayStepName(name) {
  return legacyStepLabels[name] ?? name;
}

export function createLogger({ write = line => console.log(line), record = () => {},
  color = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env), now = () => new Date() } = {}) {
  const states = new Map();
  let active;
  let pending = false;
  let walletShown = false;
  const tint = (value, style) => color ? `\x1b[${ansi[style]}m${value}\x1b[0m` : value;
  const clock = () => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now());
  function line(text = '', style) {
    const plain = text ? `[${clock()}] ${text}` : '';
    record(plain);
    write(style ? tint(plain, style) : plain);
  }
  function detail(text, style) { line(`   ${text}`, style); }

  return {
    start({ broadcast, swapAmount, liquidityAmount, slippageBps }) {
      line();
      line('QMS TESTNET  •  自动化测试流程', 'bold');
      line(`模式：${broadcast ? '上链发送' : '预检 — 不会发送交易'}  |  Chain: 19480`, 'cyan');
      line(`Swap：${swapAmount} QMS  |  流动性：${liquidityAmount} QMS  |  滑点：${slippageBps / 100}%`);
      line('时区：Asia/Shanghai', 'dim');
    },
    observe(report) {
      report.steps.forEach((step, index) => {
        if (states.get(index) === step.status) return;
        states.set(index, step.status);
        const name = displayStepName(step.name);
        if (step.status === 'running') {
          active = { name, started: Date.now() };
          pending = false;
          line();
          line(`[${index + 1}/8] ${name}`, 'cyan');
        } else if (step.status === 'passed') {
          const result = report.mode === 'preflight' && ['deploy', 'swap'].includes(step.command?.[0])
            ? '模拟完成' : '完成';
          line(`  ✓ ${name} ${result} · ${seconds(step.durationMs ?? 0)}`, 'green');
          active = null;
        } else if (step.status === 'skipped') {
          line();
          line(`[${index + 1}/8] ${name} · 已跳过（预检）`, 'yellow');
          detail(step.reason, 'dim');
        } else if (step.status === 'failed') {
          line(`  ✗ ${name} 失败 · ${seconds(step.durationMs ?? 0)}`, 'red');
          detail(safeError({ message: step.error }), 'red');
          active = null;
        }
      });
    },
    heartbeat() {
      if (active) detail(`${pending ? '等待区块确认' : '检查进行中'} · ${seconds(Date.now() - active.started)}`, 'dim');
    },
    result(result) {
      if (result.network) {
        detail(`${result.network} · chain ${result.chainId} · 最新区块 #${result.latestBlock}`);
        if (result.dexVerified) detail('QWAP router、代币与池关系已验证。', 'green');
      }
      if (result.qms !== undefined) {
        if (!walletShown) { detail(`钱包：${result.address}`); walletShown = true; }
        detail(`余额：${amount(result.qms)} QMS · ${amount(result.usdc)} USDC · LP ${result.lpRaw} raw`);
      }
      if (result.quotedUsdc !== undefined)
        detail(`报价：${result.inputQms} QMS → ${result.quotedUsdc} USDC · 最低 ${result.minimumUsdc} USDC`);
      if (result.mode === 'simulation' || result.mode === 'broadcast') {
        const label = result.action?.startsWith('approve') ? 'USDC 授权' : 'Gas 检查';
        detail(`${label}：上限 ${amount(result.maxFeeQms, 8)} QMS · gas ${result.gasLimit}`);
        if (result.mode === 'simulation') detail('模拟成功；未发送交易。', 'green');
      }
      if (result.hash && result.explorer?.includes('/tx/')) {
        pending = true;
        detail(`${result.status === 'broadcast-unknown' ? '发送结果不确定；hash 已记录' : '已发送'}：${shortHash(result.hash)}`, 'yellow');
        detail(result.explorer, 'dim');
      }
      if (result.status === 'confirmed') {
        pending = false;
        detail(`已确认：区块 #${result.blockNumber} · ${result.confirmations} 次确认 · gas ${amount(result.feeQms, 8)} QMS`, 'green');
      }
      if (result.bytecodeVerified) {
        detail(`合约：${result.address}`);
        detail(`Bytecode 匹配 · 初始计数 ${result.count}`, 'green');
      }
      if (result.eventVerified && result.after !== undefined)
        detail(`计数：${result.before} → ${result.after} · 事件已验证`, 'green');
      if (result.usdcAfter !== undefined) {
        const received = formatUnits(parseUnits(result.usdcAfter, 18) - parseUnits(result.usdcBefore, 18), 18);
        detail(`收到：${received} USDC · 余额 ${result.usdcAfter} USDC`, 'green');
      }
      if (result.usdcDesired !== undefined) {
        detail(`池：WQMS/USDC · ${result.qms} QMS + ${result.usdcDesired} USDC`);
        detail(result.approvalNeeded ? '需要 USDC 授权；将先等待 approval。' : 'USDC 授权已足够。');
      }
      if (result.mintedLp !== undefined) detail(`LP 增加：+${result.mintedLp} raw · 新余额 ${result.lpAfter} raw`, 'green');
      if (result.objectiveVerification?.verified) {
        detail(`区块 #${result.number} · ${result.qubo.problemSize} 变量 QUBO`, 'green');
        detail(`解的目标值已验证：${result.objectiveVerification.computedObjective}`, 'green');
      }
    },
    finish(report, reportFile, logFile) {
      line();
      line(report.status === 'completed' ? '✓ 全部测试已完成' :
        report.status === 'preflight-passed' ? '✓ 预检已完成' : '✗ 流程已停止',
      report.status === 'failed' ? 'red' : 'green');
      const receipts = report.steps.flatMap(step => step.results ?? []).filter(result => result.status === 'confirmed');
      const fee = receipts.reduce((total, receipt) => total + parseEther(receipt.feeQms ?? '0'), 0n);
      const counts = report.steps.reduce((total, step) => {
        total[step.status] = (total[step.status] ?? 0) + 1; return total;
      }, {});
      line(`步骤：${counts.passed ?? 0} 成功 · ${counts.skipped ?? 0} 跳过 · ${counts.failed ?? 0} 失败`);
      line(`交易：${receipts.length} 笔已确认 · 总 gas ${amount(formatEther(fee), 8)} QMS`);
      line(`总耗时：${seconds(new Date(report.finishedAt) - new Date(report.startedAt))}`);
      if (report.after) {
        line(`QMS ：${amount(report.before.qms)} → ${amount(report.after.qms)}`);
        line(`USDC：${amount(report.before.usdc)} → ${amount(report.after.usdc)}`);
        line(`LP  ：${report.before.lpRaw} → ${report.after.lpRaw} raw`);
      }
      if (report.contract) line(`合约：${report.contract}`);
      line(`JSON 报告：${reportFile}`, 'dim');
      line(`文本日志：${logFile}`, 'dim');
    },
    failure(error) { line('流程停止：' + safeError(error), 'red'); },
    note(text) { line(text, 'yellow'); },
  };
}
