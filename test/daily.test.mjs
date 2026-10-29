import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, parseEther, id, ZeroAddress } from 'ethers';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { dailySettings, dailyWindow, dailyOperation, dailyKinds, validateDaily } from '../scripts/daily-plan.mjs';
import { runDailyActivity } from '../scripts/daily-workflow.mjs';
import { taskContext, assertTaskWindow } from '../scripts/task-context.mjs';
import { inspectDailyEvidence } from '../scripts/daily-evidence.mjs';
import { root, config } from '../scripts/lib.mjs';
import { routerAbi } from '../scripts/abis.mjs';
const address='0x0000000000000000000000000000000000000011',counter='0x0000000000000000000000000000000000000022';

function fixture(){
  const f={now:new Date('2026-10-29T13:20:00Z'),evidence:[],commands:[],snapshots:[]};
  f.options={address,counter,now:()=>f.now,broadcast:true,inspect:async()=>f.evidence,
    checkpoint:async state=>f.snapshots.push(structuredClone(state)),
    execute:async(args,context)=>{
      f.commands.push(args);if(!context)return;
      const kind=context.operationId.split(':').at(-1);
      if(kind==='liquidity')f.evidence.push({status:'approval-confirmed',hash:'approval-fixture',timestamp:f.now.getTime()});
      f.evidence.push({status:'confirmed',kind,hash:'daily-fixture-'+kind,operationId:context.operationId,timestamp:f.now.getTime()});
    }};
  return f;
}
test('daily profile uses 13 UTC boundaries and stops after thirty days',()=>{
  assert.equal(dailyWindow('2026-10-29T12:59:59Z').phase,'before-start');
  assert.equal(dailyWindow('2026-10-29T13:00:00Z').day,'2026-10-29');
  assert.equal(dailyWindow('2026-10-30T12:59:59Z').day,'2026-10-29');
  assert.equal(dailyWindow('2026-10-30T13:00:00Z').day,'2026-10-30');
  assert.equal(dailyWindow('2026-11-28T13:00:00Z').phase,'ended');
  assert.throws(()=>validateDaily({...dailySettings,days:31}));
  assert.throws(()=>validateDaily({...dailySettings,swapAmountQms:'0.2'}));
});
test('four meaningful actions plus one approval complete a day; a repeat sends nothing',async()=>{
  const f=fixture(),result=await runDailyActivity(f.options);
  assert.equal(result.status,'completed');assert.equal(result.state.completedSteps,4);assert.equal(result.state.transactionCount,5);
  assert.deepEqual(f.commands.map(args=>args[0]),['swap','swap','liquidity','increment']);
  const repeat=await runDailyActivity({...f.options,state:result.state});
  assert.equal(repeat.status,'already-completed');assert.equal(f.commands.length,4);
});
test('a failed LP resumes after the two confirmed swaps, without repeating them',async()=>{
  const f=fixture(),execute=f.options.execute;let fail=true;
  f.options.execute=async(args,context)=>{if(args[0]==='liquidity'&&fail)throw new Error('mock LP failure');await execute(args,context);};
  await assert.rejects(runDailyActivity(f.options),/LP failure/);
  fail=false;const result=await runDailyActivity({...f.options,state:f.snapshots.at(-1)});
  assert.equal(result.status,'completed');assert.equal(f.commands.filter(args=>args[0]==='swap').length,2);
});
test('lost child output after a mined swap is recovered from independent evidence',async()=>{
  const f=fixture(),execute=f.options.execute;let failed=false;
  f.options.execute=async(args,context)=>{await execute(args,context);if(!failed){failed=true;throw new Error('response lost');}};
  assert.equal((await runDailyActivity(f.options)).status,'completed');assert.equal(f.commands.length,4);
});
test('unknown sends and the five-transaction cap block further actions',async()=>{
  const pending=fixture();pending.evidence=[{status:'pending'}];
  assert.equal((await runDailyActivity(pending.options)).status,'waiting');assert.equal(pending.commands.length,0);
  const capped=fixture();capped.evidence=Array.from({length:5},()=>({status:'reverted',timestamp:capped.now.getTime()}));
  assert.equal((await runDailyActivity(capped.options)).status,'limit-reached');assert.equal(capped.commands.length,0);
});
test('a transaction mined after the day boundary is adopted by the actual next day',async()=>{
  const f=fixture(),execute=f.options.execute;
  f.options.execute=async(args,context)=>{if(!f.commands.length)f.now=new Date('2026-10-30T13:01:00Z');await execute(args,context);};
  assert.equal((await runDailyActivity(f.options)).status,'day-changed');
  assert.equal((await runDailyActivity(f.options)).status,'completed');
  assert.equal(f.commands.filter(args=>args[0]==='swap').length,2);
});
test('preview, expired profiles and mismatched wallet state do not broadcast',async()=>{
  const f=fixture();assert.equal((await runDailyActivity({...f.options,broadcast:false})).status,'preview');
  assert.ok(f.commands.every(args=>!args.includes('--broadcast')));
  f.commands=[];f.now=new Date('2026-11-28T13:00:00Z');
  assert.equal((await runDailyActivity(f.options)).status,'ended');assert.equal(f.commands.length,0);
  f.now=new Date('2026-10-29T14:00:00Z');
  await assert.rejects(runDailyActivity({...f.options,state:{address:counter}}),/cuzdana/);
});
test('daily operation context binds step, wallet, counter and exact UTC window',()=>{
  const period=dailyWindow('2026-10-29T14:00:00Z');
  const env={QMS_OPERATION_ID:dailyOperation(address,'swap-2',period),QMS_TASK_NOT_BEFORE:period.startsAt,
    QMS_TASK_NOT_AFTER:period.endsAt,QMS_DAILY_COUNTER:counter};
  const context=taskContext(env);assert.equal(context.kind,'swap-2');assert.equal(context.type,'daily');
  assert.doesNotThrow(()=>assertTaskWindow(context,Date.parse(period.startsAt)));
  assert.throws(()=>assertTaskWindow(context,Date.parse(period.endsAt)),/gunu disinda/);
  assert.throws(()=>taskContext({...env,QMS_DAILY_COUNTER:undefined}),/baglami/);
  assert.throws(()=>taskContext({...env,QMS_OPERATION_ID:env.QMS_OPERATION_ID.replace('2026-10-29:swap','2026-11-30:swap')}));
});

test('daily receipt evidence verifies two swap slots, LP mint, approval separation and counter caller',async()=>{
  const cache=resolve(root,'.cache');mkdirSync(cache,{recursive:true});
  const folder=mkdtempSync(join(cache,'daily-evidence-'));mkdirSync(resolve(folder,'reports'));
  const period=dailyWindow('2026-10-29T14:00:00Z'),transactions=new Map(),receipts=new Map();
  const router=new Interface(routerAbi),events=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)',
    'event Mint(address indexed sender,uint256 amount0,uint256 amount1)','function increment()','event Incremented(address indexed caller,uint256 count)']);
  function add(kind,action,tx,logs){
    const hash=id('daily-evidence-'+kind+'-'+action);
    writeFileSync(resolve(folder,'reports',`tx-${hash}.json`),JSON.stringify({hash,chainId:19480,from:address,operationId:dailyOperation(address,kind,period),action,status:'confirmed'}));
    transactions.set(hash,{from:address,chainId:19480n,...tx});receipts.set(hash,{status:1,blockNumber:100,logs});return hash;
  }
  for(const kind of ['swap-1','swap-2'])add(kind,'QWAP QMS -> USDC',{to:config.contracts.router,value:parseEther('0.1'),
    data:router.encodeFunctionData('swapExactETHForTokens',[1n,[config.contracts.wqms,config.contracts.usdc],address,9999999999])},
    [{address:config.contracts.usdc,...events.encodeEventLog('Transfer',[config.contracts.wqmsUsdcPair,address,10n])}]);
  add('liquidity','approve exact USDC for QWAP liquidity',{to:config.contracts.usdc,value:0n,data:'0x'},[]);
  const lp=add('liquidity','QWAP add WQMS/USDC liquidity',{to:config.contracts.router,value:parseEther('0.05'),
    data:router.encodeFunctionData('addLiquidityETH',[config.contracts.usdc,10n,1n,1n,address,9999999999])},[
      {address:config.contracts.wqmsUsdcPair,...events.encodeEventLog('Mint',[config.contracts.router,10n,10n])},
      {address:config.contracts.wqmsUsdcPair,...events.encodeEventLog('Transfer',[ZeroAddress,address,10n])}]);
  const increment=add('increment','increment QmsCounter',{to:counter,value:0n,data:events.encodeFunctionData('increment')},
    [{address:counter,...events.encodeEventLog('Incremented',[address,2n])}]);
  const provider={getBlockNumber:async()=>101,getBlock:async()=>({timestamp:Date.parse('2026-10-29T13:30:00Z')/1000}),
    getTransactionReceipt:async hash=>receipts.get(hash),getTransaction:async hash=>transactions.get(hash)};
  try{
    const evidence=await inspectDailyEvidence(provider,folder,address,counter,dailySettings,period);
    assert.deepEqual(evidence.filter(p=>p.status==='confirmed').map(p=>p.kind).sort(),[...dailyKinds].sort());
    assert.equal(evidence.filter(p=>p.status==='approval-confirmed').length,1);
    transactions.get(lp).value=parseEther('0.1');
    receipts.get(increment).logs=[{address:counter,...events.encodeEventLog('Incremented',[counter,3n])}];
    const invalid=await inspectDailyEvidence(provider,folder,address,counter,dailySettings,period);
    assert.equal(invalid.filter(p=>p.status==='invalid').length,2);
  }finally{assert.equal(dirname(resolve(folder)),cache);rmSync(folder,{recursive:true,force:true});}
});
