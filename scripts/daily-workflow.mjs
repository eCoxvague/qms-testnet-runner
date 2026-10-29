import { getAddress } from 'ethers';
import { dailySettings, dailyWindow, dailyCommands, dailyKinds, dailyOperation, validateDaily } from './daily-plan.mjs';
import { safeError } from './lib.mjs';

export async function runDailyActivity({address,counter,state={},settings=dailySettings,now=()=>new Date(),inspect,execute,
  checkpoint=()=>{},log=()=>{},broadcast=false}) {
  validateDaily(settings);
  const period=dailyWindow(now(),settings);
  if(period.phase!=='active')return {status:period.phase,state,period};
  address=getAddress(address);counter=getAddress(counter);
  if(state.address && state.address.toLowerCase()!==address.toLowerCase())throw new Error('Gunluk kayit farkli cuzdana ait.');
  if(state.profileId && state.profileId!==settings.id)throw new Error('Gunluk profil eslesmiyor.');
  if(state.day && state.day!==period.day)throw new Error('Gunluk kayit farkli gorev gunune ait.');
  state=structuredClone(state);
  Object.assign(state,{address,counter,profileId:settings.id,day:period.day,startsAt:period.startsAt,endsAt:period.endsAt});
  let blocked=[];
  const persist=async()=>{state.updatedAt=new Date(now()).toISOString();await checkpoint(state);};
  const done=(status,reason)=>{state.status=status;state.reason=reason??null;return {status,reason,state,period};};
  async function refresh(){
    const evidence=await inspect(state);
    blocked=evidence.filter(proof=>['pending','invalid'].includes(proof.status));
    state.transactionCount=evidence.filter(proof=>proof.timestamp>=Date.parse(period.startsAt)&&proof.timestamp<Date.parse(period.endsAt)).length;
    state.steps=Object.fromEntries(dailyKinds.map(kind=>[kind,evidence.find(proof=>proof.status==='confirmed'&&proof.kind===kind
      &&proof.timestamp>=Date.parse(period.startsAt)&&proof.timestamp<Date.parse(period.endsAt))??{status:'not-started'}]));
    state.completedSteps=dailyKinds.filter(kind=>state.steps[kind].status==='confirmed').length;
    await persist();
  }
  try{
    await refresh();
    if(state.completedSteps===4){log('Bugunun 4 ana islemi dogrulandi; yeniden gonderilmeyecek.');const result=done('already-completed');await persist();return result;}
    if(blocked.length){const result=done('waiting','Belirsiz veya dogrulanamayan gunluk islem var.');await persist();return result;}
    if(!broadcast){await execute(['quote','--amount',settings.swapAmountQms],null);const result=done('preview','Zincire islem gonderilmedi.');await persist();return result;}
    for(const step of dailyCommands(counter,settings)){
      if(state.steps[step.kind].status==='confirmed'){log(`${step.kind}: tamamlandi, atlaniyor.`);continue;}
      if(dailyWindow(now(),settings).day!==period.day){const result=done('day-changed','Gun siniri degisti; sonraki kontrolde devam edilecek.');await persist();return result;}
      if(state.transactionCount>=5){const result=done('limit-reached','Gunluk 5 zincir islemi siniri doldu.');await persist();return result;}
      const context={operationId:dailyOperation(address,step.kind,period,settings),notBefore:period.startsAt,notAfter:period.endsAt,counter};
      state.steps[step.kind]={status:'running',operationId:context.operationId};await persist();
      let error;try{await execute([...step.args,'--broadcast'],context);}catch(caught){error=caught;}
      await refresh();
      if(state.steps[step.kind].status==='confirmed')continue;
      if(blocked.length){const result=done('waiting','Islem gonderilmis olabilir; kayitli hash dogrulanmadan tekrarlanmayacak.');await persist();return result;}
      if(dailyWindow(now(),settings).day!==period.day){const result=done('day-changed','Islem sonraki gunde bloklandi; yeni gunde yeniden kontrol edilecek.');await persist();return result;}
      throw error??new Error('Gunluk adimin zincir kaniti dogrulanamadi.');
    }
    const result=done(state.completedSteps===4?'completed':'waiting');await persist();return result;
  }catch(error){state.status='failed';state.error=safeError(error);await persist();throw error;}
}
