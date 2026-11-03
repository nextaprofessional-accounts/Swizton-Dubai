import {affectedMonths,billShare,calculateYear,ruleAt,validateMasters} from './engine.ts';
import {entrySchema,masterSchema,type Dataset,type Entry} from './model.ts';
export function validateDataset(d:Dataset){
 masterSchema.parse(d.masters);validateMasters(d.masters);
 const invoices=new Set<string>();const ids=new Set<string>();
 for(const raw of d.entries){
  const e=entrySchema.parse(raw);if(ids.has(e.id))throw Error('Duplicate entry ID');ids.add(e.id);
  if(e.kind==='bill'){
   if(e.version!=='Actual')throw Error('Bills must be Actual');
   const key=`${e.hospital}:${e.invoice}`;if(invoices.has(key))throw Error(`Duplicate hospital invoice ${e.invoice}`);invoices.add(key);
   if(!d.masters.procedures.includes(e.procedure)||!d.masters.doctors.includes(e.doctor))throw Error('Unknown procedure or doctor');billShare(e,d.masters);
  }
  if(e.kind==='estimate'){
   if(e.version!=='Approx')throw Error('Estimates must be Approx');
   if(!d.masters.hospitals.some(h=>h.id===e.hospital)||!d.masters.procedures.includes(e.procedure))throw Error('Unknown hospital or procedure');ruleAt(d.masters,e.hospital,e.date);
  }
  if(e.kind==='expense'&&Boolean(e.coverageStart)!==Boolean(e.coverageEnd))throw Error('Both coverage dates are required');
  if(e.kind==='wallet'&&e.action==='opening'&&d.entries.some(x=>x.kind==='wallet'&&x.action==='opening'&&x.version===e.version&&x.id!==e.id))throw Error('Only one initial wallet balance per version is permitted');
  for(const m of affectedMonths(e))if(!d.masters.fx.some(f=>f.month===m))throw Error(`Missing FX for ${m}`);
 }
 const years=new Set(d.entries.flatMap(e=>affectedMonths(e).map(m=>Number(m.slice(0,4)))));
 for(const y of years)calculateYear(d,y);
}
export function assertUnlocked(d:Dataset,e:Entry){
 if(affectedMonths(e).some(m=>d.closes.some(c=>c.month===m&&c.locked)))throw Error('Period is locked, including covered prepaid months. Admin must reopen with a reason.');
}
