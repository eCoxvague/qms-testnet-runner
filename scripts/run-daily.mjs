import { readFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { Contract, getAddress, parseEther, formatEther } from 'ethers';
import { root, config, connect, loadWallet, save, childEnvironment, safeError } from './lib.mjs';
import { createLogger } from './logger.mjs';
import { createOutputParser, parseOutput } from './workflow.mjs';
import { dailySettings, dailyWindow, dailyFingerprint, dailyCommands } from './daily-plan.mjs';
import { inspectDailyEvidence } from './daily-evidence.mjs';
import { runDailyActivity } from './daily-workflow.mjs';

const bindingFile = resolve(root, '.cache/daily-wallet.json');
const read = file => existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : {};
const credentials = Object.fromEntries(['QMS_PRIVATE_KEY','QMS_KEYSTORE_PASSWORD'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
let provider, lock, child, stopped = false, logger = createLogger();
const lockFile = resolve(root,'.cache/run-all.lock');
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{stopped=true;child?.kill(signal);});
try {
  const {values}=parseArgs({options:{ broadcast:{type:'boolean',default:false},'dry-run':{type:'boolean',default:false},
    prepare:{type:'boolean',default:false},status:{type:'boolean',default:false},address:{type:'string'},help:{type:'boolean',default:false},'no-color':{type:'boolean',default:false} }});
  const binding=read(bindingFile),period=dailyWindow();
  const addressHint=values.address??binding.address;
  const statePath=addressHint&&period.day?`reports/daily-${dailySettings.id}/${getAddress(addressHint).toLowerCase()}/${period.day}.json`:null;
  const cached=statePath?read(resolve(root,statePath)):{};
  let currentState=cached;
  const show=state=>{
    logger.note(`GÜNLÜK · ${state.status??period.phase} · ${state.completedSteps??0}/4 ana işlem · ${state.transactionCount??0}/5 zincir işlemi`);
    logger.note(`Plan: 2 × ${dailySettings.swapAmountQms} QMS swap + ${dailySettings.liquidityAmountQms} QMS LP + sayaç etkileşimi.`);
    logger.note(`Gün sınırı: 16:00 Türkiye · Profil bitişi: ${new Date(period.profileEnd).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})}`);
    if(state.reason)logger.note(state.reason);
    if(statePath)logger.note(`Kayıt: ${resolve(root,statePath)}`);
  };
  if(values.help){console.log('npm run daily:prepare\nnpm run daily\nnpm run daily -- --dry-run\nnpm run daily:status\nnpm run daily:install\nnpm run daily:uninstall');}
  else if(values.status||period.phase!=='active'&&!values.prepare){show(cached);}
  else {
    if(addressHint)process.env.QMS_EXPECTED_ADDRESS=getAddress(addressHint);
    const address=loadWallet().address;
    mkdirSync(resolve(root,'.cache'),{recursive:true});
    try{lock=openSync(lockFile,'wx',0o600);}catch{throw new Error('Baska bir QMS akisi calisiyor veya onceki kilit kaldi.');}
    writeFileSync(lock,JSON.stringify({pid:process.pid,profileId:dailySettings.id,address}));
    const folder=`reports/daily-${dailySettings.id}/${address.toLowerCase()}`;
    mkdirSync(resolve(root,folder),{recursive:true});
    const logFile=resolve(root,folder,`run-${new Date().toISOString().replace(/[:.]/g,'-')}.log`);
    logger=createLogger({color:Boolean(process.stdout.isTTY)&&!values['no-color'],record:line=>appendFileSync(logFile,line+'\n',{encoding:'utf8',mode:0o600})});
    provider=await connect();
    async function execute(args,context){
      if(stopped)throw new Error('Gunluk akis kullanici tarafindan durduruldu.');
      const env=childEnvironment(args[0],address);
      for(const key of ['QMS_OPERATION_ID','QMS_TASK_NOT_BEFORE','QMS_TASK_NOT_AFTER','QMS_DAILY_COUNTER','QMS_PRIVATE_KEY','QMS_KEYSTORE_PASSWORD'])delete env[key];
      if(context){
        Object.assign(env,credentials,{QMS_OPERATION_ID:context.operationId,QMS_TASK_NOT_BEFORE:context.notBefore,
          QMS_TASK_NOT_AFTER:context.notAfter,QMS_DAILY_COUNTER:context.counter});
        const remaining=dailyCommands(context.counter).filter(step=>currentState.steps?.[step.kind]?.status!=='confirmed');
        const value=remaining.reduce((sum,step)=>sum+(step.kind.startsWith('swap-')?parseEther(dailySettings.swapAmountQms):step.kind==='liquidity'?parseEther(dailySettings.liquidityAmountQms):0n),0n);
        const needed=value+parseEther(config.reserveQms)+BigInt(Math.max(0,5-(currentState.transactionCount??0)))*parseEther(config.maxGasQms);
        if(await provider.getBalance(address)<needed)throw new Error(`Gunluk akis icin konservatif bakiye ${formatEther(needed)} QMS gerekiyor.`);
      }
      logger.note(`→ ${context?.operationId.split(':').at(-1)??args[0]}`);
      return new Promise((accept,reject)=>{
        let stdout='',stderr='',parseError;
        const parser=createOutputParser(result=>logger.result(result));
        child=spawn(process.execPath,[resolve(root,'scripts/qms.mjs'),...args],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
        const timer=setInterval(()=>logger.note('Zincir kontrolü / blok onayı bekleniyor…'),15000);
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
        child.stdout.on('data',text=>{stdout+=text;if(!parseError)try{parser.push(text);}catch(error){parseError=error;}});
        child.stderr.on('data',text=>{stderr+=text;});
        child.once('error',()=>{clearInterval(timer);reject(new Error('Gunluk alt komut baslatilamadi.'));});
        child.once('close',code=>{
          clearInterval(timer);child=null;
          if(code!==0||stopped)reject(new Error(safeError({message:stderr||'Gunluk alt komut durdu.'})));
          else if(parseError)reject(parseError);
          else try{accept(parseOutput(stdout));}catch(error){reject(error);}
        });
        delete env.QMS_PRIVATE_KEY;delete env.QMS_KEYSTORE_PASSWORD;
      });
    }
    await execute(['compile'],null);
    const artifact=read(resolve(root,'artifacts/QmsCounter.json'));
    const deployment=read(resolve(root,'deployments/latest.json'));
    const counter=binding.counter??(deployment.chainId===19480&&deployment.deployer?.toLowerCase()===address.toLowerCase()?deployment.address:null);
    if(!counter)throw new Error('Test sayaci yok. Bir kez npm run qms -- deploy --broadcast calistirin; sonra daily:prepare kullanin.');
    const counterAddress=getAddress(counter);
    if((await provider.getCode(counterAddress)).toLowerCase()!==artifact.deployedBytecode.toLowerCase())
      throw new Error('Kayitli sayac bytecode eslesmiyor; ag reseti/deploy kaydini kontrol edin.');
    const count=await new Contract(counterAddress,artifact.abi,provider).count();
    logger.note(`Sayaç doğrulandı: ${counterAddress} · değer ${count}`);
    const fingerprint=dailyFingerprint(address,counterAddress,config.contracts);
    if(values.prepare){
      await execute(['status'],null);await execute(['wallet','--address',address],null);
      save('.cache/daily-wallet.json',{profileId:dailySettings.id,address,counter:counterAddress,fingerprint,contracts:config.contracts,preparedAt:new Date().toISOString()});
      logger.note('Günlük hazırlık tamamlandı · en az 0.6 QMS konservatif bütçe · 30 günlük native tutar 7.5 QMS.');
      logger.note('Zamanlama ayrıca daily:install ile kurulur. Hazırlık zincire işlem göndermedi.');
    }else{
      if(binding.profileId!==dailySettings.id||binding.address?.toLowerCase()!==address.toLowerCase()||binding.fingerprint!==fingerprint)
        throw new Error('Gunluk cuzdan/kontrat/havuz ayarlari degisti; once npm run daily:prepare kullanin.');
      if(cached.fingerprint&&cached.fingerprint!==fingerprint)throw new Error('Bugunun plani degismis; kayitlar otomatik sifirlanmadi.');
      const relative=`${folder}/${period.day}.json`;
      const state={...cached,fingerprint};
      const dry=values['dry-run']||!values.broadcast;
      const result=await runDailyActivity({address,counter:counterAddress,state,broadcast:!dry,
        inspect:current=>inspectDailyEvidence(provider,root,address,counterAddress,dailySettings,period,current),execute,
        checkpoint:current=>{currentState=current;save(dry?`${folder}/preview-${period.day}.json`:relative,current);},log:text=>logger.note(text)});
      show(result.state);
      if(['waiting','limit-reached','day-changed'].includes(result.status))process.exitCode=2;
    }
  }
}catch(error){logger.failure(error);process.exitCode=1;}
finally{
  provider?.destroy();
  if(lock!==undefined){closeSync(lock);unlinkSync(lockFile);}
  for(const key of Object.keys(credentials))delete credentials[key];
  delete process.env.QMS_PRIVATE_KEY;delete process.env.QMS_KEYSTORE_PASSWORD;
}
