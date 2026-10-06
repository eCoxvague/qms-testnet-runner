import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Contract, ContractFactory, formatEther, formatUnits, getAddress } from 'ethers';
import solc from 'solc';
import { config, root, save, output, connect, loadWallet, amountQms, minimum, safeError, jsonFetch, submit } from './lib.mjs';
import { tokenAbi, routerAbi, factoryAbi, pairAbi } from './abis.mjs';
import { verifyQubo } from './qubo.mjs';

const usage = `QMS Testnet (19480)
  npm run status
  npm run key:import                       Yerelde gizli anahtar girisi
  npm run qms -- wallet [--address 0x...]
  npm run compile
  npm run qms -- deploy [--broadcast]
  npm run qms -- increment [--contract 0x...] [--broadcast]
  npm run qms -- quote --amount 0.1
  npm run qms -- swap --amount 0.1 [--slippage-bps 100] [--broadcast]
  npm run qms -- liquidity --amount 0.1 [--slippage-bps 100] [--broadcast]
  npm run qms -- block [--number 57173] [--download]
Islemler --broadcast olmadan zincire gonderilmez. Varsayilan miktar: 0.1 QMS.
Liquditiy native QMS'yi router uzerinden WQMS'ye sarar; USDC bakiyesi gerekir.`;
const c = config.contracts;
const equal = (a, b) => a.toLowerCase() === b.toLowerCase();
let provider;

function compile() {
  const input = { language: 'Solidity', sources: {
    'QmsCounter.sol': { content: readFileSync(resolve(root, 'contracts/QmsCounter.sol'), 'utf8') },
  }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'prague',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } } } };
  const result = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (result.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const contract = result.contracts['QmsCounter.sol'].QmsCounter;
  const artifact = { contractName: 'QmsCounter', compiler: solc.version(), evmVersion: 'prague',
    abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object,
    deployedBytecode: '0x' + contract.evm.deployedBytecode.object, metadata: JSON.parse(contract.metadata) };
  save('artifacts/QmsCounter.json', artifact);
  save('artifacts/standard-input.json', input);
  return artifact;
}

async function dex() {
  await Promise.all(Object.entries(c).map(async ([name, address]) => {
    if (await provider.getCode(address) === '0x') throw new Error(`${name} adresinde kontrat yok.`);
  }));
  const router = new Contract(c.router, routerAbi, provider);
  const factory = new Contract(c.factory, factoryAbi, provider);
  const usdc = new Contract(c.usdc, tokenAbi, provider);
  const pair = new Contract(c.wqmsUsdcPair, pairAbi, provider);
  const [rf, rw, fp, pf, token0, token1, reserves, symbol, decimals] = await Promise.all([
    router.factory(), router.WQMS(), factory.getPair(c.wqms, c.usdc), pair.factory(),
    pair.token0(), pair.token1(), pair.getReserves(), usdc.symbol(), usdc.decimals(),
  ]);
  if (!equal(rf, c.factory) || !equal(rw, c.wqms) || !equal(fp, c.wqmsUsdcPair) || !equal(pf, c.factory)
      || ![token0, token1].some(t => equal(t, c.wqms)) || ![token0, token1].some(t => equal(t, c.usdc)))
    throw new Error('QWAP router/factory/token/pool iliskisi dogrulanamadi.');
  if (symbol !== 'USDC' || Number(decimals) > 18) throw new Error('USDC metadatasi beklenen degerde degil.');
  if (reserves[0] === 0n || reserves[1] === 0n) throw new Error('Havuzda likidite yok.');
  return { router, usdc, pair, decimals: Number(decimals), token0, reserves };
}

async function quote(amount, bps, data) {
  const path = [c.wqms, c.usdc];
  const amounts = await data.router.getAmountsOut(amount, path);
  const outMin = minimum(amounts[1], bps);
  output({ action: 'QMS -> USDC', chainId: config.chainId, router: c.router, pair: c.wqmsUsdcPair,
    inputQms: formatEther(amount), quotedUsdc: formatUnits(amounts[1], data.decimals),
    minimumUsdc: formatUnits(outMin, data.decimals), slippageBps: bps, path });
  return { path, amounts, outMin };
}

async function deadline() {
  const block = await provider.getBlock('latest');
  if (!block || Math.abs(Date.now() / 1000 - block.timestamp) > 600)
    throw new Error('Son blok zamani guncel degil. Ag durumunu kontrol edin.');
  return block.timestamp + 600;
}

async function blockReport(number, download) {
  // RPC can advance before Blockscout indexes the new height.
  const indexed = number == null ? await jsonFetch(`${config.explorerUrl}/api/v2/blocks`) : null;
  const height = number == null ? Number(indexed?.items?.[0]?.height) : Number(number);
  if (!Number.isSafeInteger(height) || height < 1) throw new Error('Blok numarasi pozitif tamsayi olmali.');
  let block;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { block = await jsonFetch(`${config.explorerUrl}/api/v2/blocks/${height}`); break; }
    catch (error) {
      if (error.status !== 404 || attempt === 4) throw error;
      await new Promise(accept => setTimeout(accept, 2500));
    }
  }
  const execution = await provider.getBlock(height);
  if (!execution || !equal(execution.hash, block.hash)) throw new Error('RPC ve explorer blok hash uyusmuyor.');
  let qubo = null;
  let quboError = null;
  try {
    qubo = await jsonFetch(`${config.explorerUrl}/v1/blocks/${height}/qubo`);
    if (Number(qubo.block_number) !== height || !equal(qubo.execution_block_hash, execution.hash))
      throw new Error('QUBO metadata farkli bloka ait.');
  } catch (e) { quboError = safeError(e); qubo = null; }
  const instanceUrl = `${config.explorerUrl}/v1/blocks/${height}/qubo/instance`;
  const report = { capturedAt: new Date().toISOString(), chainId: config.chainId,
    explorer: `${config.explorerUrl}/block/${height}`, block, qubo, quboError,
    instanceUrl: qubo ? instanceUrl : null,
    explanation: qubo ? 'Bu blokta QUBO optimizasyon problemi cozuldu. Hash, boyut, ikili cozum ve objective degeri kayitli. Metadata gercek dunya uygulamasini belirtmiyor.' : 'QUBO verisi alinamadi; cozulmus problem hakkinda sonuc cikarilmadi.' };
  if (download) {
    if (!qubo) throw new Error('QUBO metadatasi yok; instance indirilmedi.');
    const res = await fetch(instanceUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Instance HTTP ${res.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) throw new Error('Instance boyutu 32 MiB sinirini asti.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('Instance gzip formatinda degil.');
    report.objectiveVerification = verifyQubo(bytes, qubo);
    mkdirSync(resolve(root, 'reports'), { recursive: true });
    const file = resolve(root, `reports/block-${height}.mtx.gz`);
    writeFileSync(file, bytes);
    report.instanceFile = file;
  }
  const file = save(`reports/block-${height}.json`, report);
  output({ reportFile: file, number: height, hash: block.hash, transactions: block.transactions_count,
    explorer: report.explorer, qubo: qubo ? { instanceHash: qubo.instance_hash, problemSize: qubo.problem_size,
      objectiveValue: qubo.objective_value, solutionLength: qubo.solution_length } : null,
    quboError, explanation: report.explanation, instanceFile: report.instanceFile,
    objectiveVerification: report.objectiveVerification });
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    broadcast: { type: 'boolean', default: false }, amount: { type: 'string', default: '0.1' },
    'slippage-bps': { type: 'string', default: String(config.slippageBps) },
    address: { type: 'string' }, contract: { type: 'string' }, number: { type: 'string' },
    download: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  } });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') { console.log(usage); return; }
  if (positionals.length !== 1) throw new Error('Tek bir komut girin.');
  if (!['status', 'wallet', 'compile', 'deploy', 'increment', 'quote', 'swap', 'liquidity', 'block'].includes(command))
    throw new Error('Bilinmeyen komut; npm run qms -- help kullanin.');
  if (command === 'compile') {
    const artifact = compile(); output({ compiler: artifact.compiler, evmVersion: artifact.evmVersion,
      bytecodeBytes: (artifact.bytecode.length - 2) / 2 }); return;
  }
  provider = await connect();
  if (command === 'block') { await blockReport(values.number, values.download); return; }
  if (command === 'status') {
    const data = await dex();
    const [latest, safe, finalized] = await Promise.all([
      provider.getBlock('latest'), provider.getBlock('safe'), provider.getBlock('finalized'),
    ]);
    const report = { checkedAt: new Date().toISOString(), network: config.name, chainId: config.chainId,
      rpcUrl: config.rpcUrl, latestBlock: latest.number, latestBlockHash: latest.hash,
      safeBlock: safe?.number, finalizedBlock: finalized?.number,
      confirmationsUsed: config.confirmations, dexVerified: true, contracts: c,
      usdcDecimals: data.decimals, reserves: data.reserves.toArray(),
      note: 'safe/finalized mevcut surumde genesis dondurebilir; receipt + blok onayi kullanilir.' };
    save('reports/status.json', report); output(report);
    await quote(amountQms('0.1'), config.slippageBps, data); return;
  }
  if (command === 'quote') {
    await quote(amountQms(values.amount), Number(values['slippage-bps']), await dex()); return;
  }
  if (command === 'wallet') {
    const address = values.address ? getAddress(values.address) : loadWallet(provider).address;
    const data = await dex();
    const [balance, usdc, lp] = await Promise.all([provider.getBalance(address), data.usdc.balanceOf(address), data.pair.balanceOf(address)]);
    output({ address, qms: formatEther(balance), usdc: formatUnits(usdc, data.decimals), lpRaw: lp,
      faucet: config.faucetUrl, qwap: config.qwapUrl, explorer: `${config.explorerUrl}/address/${address}` }); return;
  }
  const wallet = loadWallet(provider);
  if (command === 'deploy') {
    const artifact = compile();
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const tx = await factory.getDeployTransaction();
    const receipt = await submit(provider, wallet, tx, 'deploy QmsCounter', values.broadcast);
    if (receipt) {
      // Persist the deployment before verification so it is recoverable if RPC fails later.
      const deployment = { chainId: config.chainId, address: receipt.contractAddress, deployer: wallet.address,
        transactionHash: receipt.hash, blockNumber: receipt.blockNumber, compiler: artifact.compiler,
        explorer: `${config.explorerUrl}/address/${receipt.contractAddress}`, verifiedOnExplorer: false };
      save(`deployments/${receipt.contractAddress}.json`, deployment);
      save('deployments/latest.json', deployment);
      const code = await provider.getCode(receipt.contractAddress);
      if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) throw new Error('Deploy bytecode dogrulanamadi.');
      const counter = new Contract(receipt.contractAddress, artifact.abi, provider);
      if (await counter.count() !== 0n) throw new Error('Baslangic counter degeri sifir degil.');
      output({ ...deployment, bytecodeVerified: true, count: '0' });
    } return;
  }
  if (command === 'increment') {
    const artifactPath = resolve(root, 'artifacts/QmsCounter.json');
    if (!existsSync(artifactPath)) throw new Error('Once compile ve deploy calistirin.');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    let address = values.contract;
    if (!address) {
      const deploymentFile = resolve(root, 'deployments/latest.json');
      if (!existsSync(deploymentFile)) throw new Error('Deploy kaydi yok; --contract adres verin.');
      const deployment = JSON.parse(readFileSync(deploymentFile, 'utf8'));
      if (deployment.chainId !== config.chainId) throw new Error('Deploy kaydi farkli aga ait.');
      address = deployment.address;
    }
    address = getAddress(address);
    if ((await provider.getCode(address)).toLowerCase() !== artifact.deployedBytecode.toLowerCase())
      throw new Error('Adresteki bytecode QmsCounter ile eslesmiyor.');
    const counter = new Contract(address, artifact.abi, wallet);
    const before = await counter.count();
    const receipt = await submit(provider, wallet, await counter.increment.populateTransaction(), 'increment QmsCounter', values.broadcast);
    if (receipt) {
      const after = await counter.count();
      const events = receipt.logs.filter(l => equal(l.address, address)).map(l => counter.interface.parseLog(l));
      if (after <= before || !events.some(e => e?.name === 'Incremented' && equal(e.args.caller, wallet.address)))
        throw new Error('Counter artisi veya event dogrulanamadi.');
      output({ address, before, after, eventVerified: true });
    } else output({ address, count: before, simulated: true });
    return;
  }
  const amount = amountQms(values.amount);
  const bps = Number(values['slippage-bps']);
  minimum(amount, bps); // validate limits before any state-changing action
  const data = await dex();
  if (command === 'swap') {
    const { path, outMin } = await quote(amount, bps, data);
    const before = await data.usdc.balanceOf(wallet.address);
    const tx = await data.router.swapExactETHForTokens.populateTransaction(outMin, path, wallet.address, await deadline(), { value: amount });
    const receipt = await submit(provider, wallet, tx, 'QWAP QMS -> USDC', values.broadcast);
    if (receipt) output({ usdcBefore: formatUnits(before, data.decimals),
      usdcAfter: formatUnits(await data.usdc.balanceOf(wallet.address), data.decimals) });
    return;
  }
  if (command === 'liquidity') {
    const nativeFirst = equal(data.token0, c.wqms);
    const [nativeReserve, tokenReserve] = nativeFirst ? [data.reserves[0], data.reserves[1]] : [data.reserves[1], data.reserves[0]];
    const tokenDesired = amount * tokenReserve / nativeReserve;
    const tokenMin = minimum(tokenDesired, bps);
    const nativeMin = minimum(amount, bps);
    if (await data.usdc.balanceOf(wallet.address) < tokenDesired) throw new Error('USDC bakiyesi likidite icin yetersiz; once swap yapin.');
    const allowance = await data.usdc.allowance(wallet.address, c.router);
    output({ action: 'add WQMS/USDC liquidity', qms: formatEther(amount),
      usdcDesired: formatUnits(tokenDesired, data.decimals), minimumUsdc: formatUnits(tokenMin, data.decimals),
      minimumQms: formatEther(nativeMin), slippageBps: bps, approvalNeeded: allowance < tokenDesired });
    if (allowance < tokenDesired) {
      if (!values.broadcast) {
        output({ simulated: false, planOnly: true, note: 'Once exact-amount USDC approval gerekir; bu komut zincire hicbir islem gondermedi.' });
        return;
      }
      await submit(provider, wallet, await data.usdc.approve.populateTransaction(c.router, tokenDesired), 'approve exact USDC for QWAP liquidity', true);
    }
    const lpBefore = await data.pair.balanceOf(wallet.address);
    const tx = await data.router.addLiquidityETH.populateTransaction(c.usdc, tokenDesired, tokenMin, nativeMin,
      wallet.address, await deadline(), { value: amount });
    const receipt = await submit(provider, wallet, tx, 'QWAP add WQMS/USDC liquidity', values.broadcast);
    if (receipt) {
      const lpAfter = await data.pair.balanceOf(wallet.address);
      if (lpAfter <= lpBefore) throw new Error('LP bakiyesi artmadi.');
      output({ lpBefore, lpAfter, mintedLp: lpAfter - lpBefore, pair: c.wqmsUsdcPair });
    }
  }
}

try { await main(); }
catch (error) { console.error('Hata: ' + safeError(error)); process.exitCode = 1; }
finally { provider?.destroy(); }
