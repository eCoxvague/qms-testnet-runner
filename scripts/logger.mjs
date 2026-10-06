import { formatEther, parseEther, parseUnits, formatUnits } from 'ethers';
import { safeError } from './lib.mjs';

const names = {
  'Ag ve QWAP kontrolu': 'Ağ ve QWAP kontrolü',
  'Cuzdan ve toplam butce': 'Cüzdan ve bütçe kontrolü',
  'Kontrat deploy': 'Kontrat deploy',
  'Sayac artirma ve event kontrolu': 'Sayaç ve event kontrolü',
  'Sayac artirma': 'Sayaç artırma',
  'QMS -> USDC swap': 'QMS → USDC swap',
  'Approval ve WQMS/USDC likidite': 'WQMS/USDC likidite',
  'Approval ve likidite': 'WQMS/USDC likidite',
  'Son bakiye kontrolu': 'Son bakiye kontrolü',
  'Blok ve QUBO cozumu kontrolu': 'Blok ve QUBO kontrolü',
};
const ansi = { dim: 90, cyan: 36, green: 32, yellow: 33, red: 31, bold: 1 };
export const cleanAnsi = text => text.replace(/\x1b\[[0-9;]*m/g, '');
export const shortHash = value => value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
export function amount(value, decimals = 6) {
  const [whole, fraction] = String(value).split('.');
  const trimmed = fraction?.slice(0, decimals).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
const seconds = ms => `${(ms / 1000).toFixed(1)} sn`;

export function createLogger({ write = line => console.log(line), record = () => {},
  color = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env), now = () => new Date() } = {}) {
  const states = new Map();
  let active;
  let pending = false;
  let walletShown = false;
  const tint = (value, style) => color ? `\x1b[${ansi[style]}m${value}\x1b[0m` : value;
  const clock = () => new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul',
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
      line('QMS TESTNET  •  Otomatik test akışı', 'bold');
      line(`Mod: ${broadcast ? 'ZİNCİRE GÖNDER' : 'ÖN KONTROL — işlem gönderilmez'}  |  Chain: 19480`, 'cyan');
      line(`Swap: ${swapAmount} QMS  |  Likidite: ${liquidityAmount} QMS  |  Slippage: ${slippageBps / 100}%`);
      line('Saat dilimi: Europe/Istanbul', 'dim');
    },
    observe(report) {
      report.steps.forEach((step, index) => {
        if (states.get(index) === step.status) return;
        states.set(index, step.status);
        const name = names[step.name] ?? step.name;
        if (step.status === 'running') {
          active = { name, started: Date.now() };
          pending = false;
          line();
          line(`[${index + 1}/8] ${name}`, 'cyan');
        } else if (step.status === 'passed') {
          const result = report.mode === 'preflight' && ['deploy', 'swap'].includes(step.command?.[0])
            ? 'simülasyonu tamamlandı' : 'tamamlandı';
          line(`  ✓ ${name} ${result} · ${seconds(step.durationMs ?? 0)}`, 'green');
          active = null;
        } else if (step.status === 'skipped') {
          line();
          line(`[${index + 1}/8] ${name} · ATLANDI (ön kontrol)`, 'yellow');
          detail(step.reason, 'dim');
        } else if (step.status === 'failed') {
          line(`  ✗ ${name} başarısız · ${seconds(step.durationMs ?? 0)}`, 'red');
          detail(safeError({ message: step.error }), 'red');
          active = null;
        }
      });
    },
    heartbeat() {
      if (active) detail(`${pending ? 'Blok onayı bekleniyor' : 'Kontrol sürüyor'} · ${seconds(Date.now() - active.started)}`, 'dim');
    },
    result(result) {
      if (result.network) {
        detail(`${result.network} · chain ${result.chainId} · son blok #${result.latestBlock}`);
        if (result.dexVerified) detail('QWAP router, token ve havuz ilişkileri doğrulandı.', 'green');
      }
      if (result.qms !== undefined) {
        if (!walletShown) { detail(`Cüzdan: ${result.address}`); walletShown = true; }
        detail(`Bakiye: ${amount(result.qms)} QMS · ${amount(result.usdc)} USDC · LP ${result.lpRaw} raw`);
      }
      if (result.quotedUsdc !== undefined)
        detail(`Teklif: ${result.inputQms} QMS → ${result.quotedUsdc} USDC · minimum ${result.minimumUsdc} USDC`);
      if (result.mode === 'simulation' || result.mode === 'broadcast') {
        const label = result.action?.startsWith('approve') ? 'USDC harcama izni' : 'Gas kontrolü';
        detail(`${label}: üst sınır ${amount(result.maxFeeQms, 8)} QMS · gas ${result.gasLimit}`);
        if (result.mode === 'simulation') detail('Simülasyon başarılı; işlem gönderilmedi.', 'green');
      }
      if (result.hash && result.explorer?.includes('/tx/')) {
        pending = true;
        detail(`${result.status === 'broadcast-unknown' ? 'Gönderim belirsiz; hash kaydedildi' : 'Gönderildi'}: ${shortHash(result.hash)}`, 'yellow');
        detail(result.explorer, 'dim');
      }
      if (result.status === 'confirmed') {
        pending = false;
        detail(`Onaylandı: blok #${result.blockNumber} · ${result.confirmations} onay · gas ${amount(result.feeQms, 8)} QMS`, 'green');
      }
      if (result.bytecodeVerified) {
        detail(`Kontrat: ${result.address}`);
        detail(`Bytecode eşleşti · başlangıç sayacı ${result.count}`, 'green');
      }
      if (result.eventVerified && result.after !== undefined)
        detail(`Sayaç: ${result.before} → ${result.after} · event doğrulandı`, 'green');
      if (result.usdcAfter !== undefined) {
        const received = formatUnits(parseUnits(result.usdcAfter, 18) - parseUnits(result.usdcBefore, 18), 18);
        detail(`Alınan: ${received} USDC · bakiye ${result.usdcAfter} USDC`, 'green');
      }
      if (result.usdcDesired !== undefined) {
        detail(`Havuz: WQMS/USDC · ${result.qms} QMS + ${result.usdcDesired} USDC`);
        detail(result.approvalNeeded ? 'USDC harcama izni gerekli; önce approval beklenecek.' : 'USDC harcama izni yeterli.');
      }
      if (result.mintedLp !== undefined) detail(`LP artışı: +${result.mintedLp} raw · yeni bakiye ${result.lpAfter} raw`, 'green');
      if (result.objectiveVerification?.verified) {
        detail(`Blok #${result.number} · ${result.qubo.problemSize} değişkenli QUBO`, 'green');
        detail(`Çözüm değeri doğrulandı: ${result.objectiveVerification.computedObjective}`, 'green');
      }
    },
    finish(report, reportFile, logFile) {
      line();
      line(report.status === 'completed' ? '✓ TÜM TESTLER TAMAMLANDI' :
        report.status === 'preflight-passed' ? '✓ ÖN KONTROL TAMAMLANDI' : '✗ AKIŞ DURDU',
      report.status === 'failed' ? 'red' : 'green');
      const receipts = report.steps.flatMap(step => step.results ?? []).filter(result => result.status === 'confirmed');
      const fee = receipts.reduce((total, receipt) => total + parseEther(receipt.feeQms ?? '0'), 0n);
      const counts = report.steps.reduce((total, step) => {
        total[step.status] = (total[step.status] ?? 0) + 1; return total;
      }, {});
      line(`Adımlar: ${counts.passed ?? 0} başarılı · ${counts.skipped ?? 0} atlandı · ${counts.failed ?? 0} başarısız`);
      line(`İşlemler: ${receipts.length} onaylı · toplam gas ${amount(formatEther(fee), 8)} QMS`);
      line(`Toplam süre: ${seconds(new Date(report.finishedAt) - new Date(report.startedAt))}`);
      if (report.after) {
        line(`QMS : ${amount(report.before.qms)} → ${amount(report.after.qms)}`);
        line(`USDC: ${amount(report.before.usdc)} → ${amount(report.after.usdc)}`);
        line(`LP  : ${report.before.lpRaw} → ${report.after.lpRaw} raw`);
      }
      if (report.contract) line(`Kontrat: ${report.contract}`);
      line(`JSON rapor: ${reportFile}`, 'dim');
      line(`Metin log : ${logFile}`, 'dim');
    },
    failure(error) { line('Akış durdu: ' + safeError(error), 'red'); },
    note(text) { line(text, 'yellow'); },
  };
}
