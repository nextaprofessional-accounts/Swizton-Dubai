import {Decimal as D} from 'decimal.js';
import {categories,pnlLines,type Dataset,type Entry,type Masters} from './model.ts';
D.set({precision:32,rounding:D.ROUND_HALF_UP});
export const monthOf=(date:string)=>date.slice(0,7);
const monthIndex=(m:string)=>Number(m.slice(0,4))*12+Number(m.slice(5,7))-1;
export function affectedMonths(e:Entry):string[]{
 if(e.kind!=='expense'||!e.coverageStart||!e.coverageEnd)return [monthOf(e.date)];
 const start=monthIndex(monthOf(e.coverageStart)),end=monthIndex(monthOf(e.coverageEnd));
 if(end<start||end-start>120)throw Error('Coverage must be ordered and no longer than 121 months');
 return Array.from({length:end-start+1},(_,i)=>`${Math.floor((start+i)/12)}-${String((start+i)%12+1).padStart(2,'0')}`);
}
export function ruleAt(m:Masters,hospital:string,date:string){
 const rs=m.rules.filter(r=>r.hospital===hospital&&r.effectiveFrom<=date&&(!r.effectiveTo||r.effectiveTo>=date));
 if(rs.length!==1)throw Error(`Expected one effective share rule for ${hospital} on ${date}; found ${rs.length}`);
 return rs[0];
}
export function validateMasters(m:Masters){
 const unique=(xs:string[],label:string)=>{if(new Set(xs).size!==xs.length)throw Error(`Duplicate ${label}`)};
 unique(m.hospitals.map(x=>x.id),'hospital');
 for(const h of m.hospitals)if((pnlLines.includes(h.id)&&!['CSH','Al Garhoud','IMH'].includes(h.id))||h.id.startsWith('Swizton • '))throw Error('Hospital identifier conflicts with a reserved P&L line');unique(m.procedures,'procedure');unique(m.doctors,'doctor');unique(m.expenseHeads.map(x=>x.name),'expense head');unique(m.fx.map(x=>x.month),'FX month');unique(m.targets.map(x=>x.month),'target');unique(m.rules.map(x=>x.id),'rule');unique(m.comparatives.map(x=>`${x.year}:${x.line}`),'comparative');
 for(const r of m.rules){
  if(![...m.hospitals.map(h=>h.id),'Admin Cost Reimbursement','OP Consultation'].includes(r.hospital))throw Error('Unknown rule hospital');
  if(r.effectiveTo&&r.effectiveTo<r.effectiveFrom)throw Error('Invalid rule dates');
  if(new D(r.admin).plus(r.refundable).gt(1))throw Error('Deductions exceed gross');
  if(new D(r.swizton).plus(new D(r.doctorPool).times(r.chinmay)).gt(1))throw Error('Revenue allocations exceed revenue');
  if(m.rules.some(s=>s!==r&&s.hospital===r.hospital&&s.effectiveFrom<=(r.effectiveTo??'9999-12-31')&&(s.effectiveTo??'9999-12-31')>=r.effectiveFrom))throw Error('Overlapping effective share rules');
 }
 for(const c of m.comparatives)if(!pnlLines.includes(c.line))throw Error('Unknown comparative line');
}
export function billShare(e:Extract<Entry,{kind:'bill'}>,m:Masters){
 const r=ruleAt(m,e.hospital,e.date),hospital=m.hospitals.find(h=>h.id===e.hospital);
 if(!hospital)throw Error('Unknown hospital');
 if(hospital.method==='components'){
  const rates=r.components[e.regime];if(!rates)throw Error(`Missing ${e.regime} component rates`);
  return Object.entries(e.components).reduce((a,[c,v])=>{if(rates[c]===undefined)throw Error(`Missing rate for ${c}`);return a.plus(new D(v).times(rates[c]));},new D(0));
 }
 const net=new D(e.gross).minus(e.consumables).minus(e.pharmacyLab).minus(new D(e.gross).times(r.admin)).minus(new D(e.gross).times(r.refundable));
 if(net.lt(0))throw Error(`Negative bill net amount: ${e.invoice}`);
 return net.times(r.share);
}
export interface Cell {aed:string;inr:string;pct:string|null;ids:string[]}
export interface Period {month:string;version:string;locked:boolean;rows:Record<string,Cell>;kpis:{cases:number;visits:number;target:number;achievement:string|null;mix:Record<string,number>};wallet:{opening:string;addition:string;spend:string;closing:string};prepaids:{id:string;monthlyNative:string;outstandingNative:string;currency:string}[]}
export function calculateMonth(ds:Dataset,month:string,version:'Actual'|'Approx'):Period{
 const fx=ds.masters.fx.find(f=>f.month===month);if(!fx)throw Error(`Missing central FX rate for ${month}`);
 const sums:Record<string,D>={},ids:Record<string,string[]>={};
 for(const l of [...pnlLines,...ds.masters.hospitals.flatMap(h=>[h.id,`Swizton • ${h.id}`])]){sums[l]=new D(0);ids[l]=[]}
 const add=(l:string,a:D,id:string)=>{if(!(l in sums))throw Error(`Unknown P&L line ${l}`);sums[l]=sums[l].plus(a);if(!ids[l].includes(id))ids[l].push(id)};
 const mix=Object.fromEntries(ds.masters.procedures.map(p=>[p,0]));let cases=0,visits=0;
 const prepaids:Period['prepaids']=[];
 const allocate=(h:string,date:string,a:D,id:string)=>{
  const r=ruleAt(ds.masters,h,date);add(h,a,id);add(`Swizton • ${h}`,a.times(r.swizton),id);
  if(r.chinmayEligible)add('Dr. Chinmay – Professional Fee',a.times(r.doctorPool).times(r.chinmay),id);
 };
 for(const e of ds.entries.filter(e=>e.version===version)){
  const inMonth=monthOf(e.date)===month;
  if(e.kind==='expense'){
   const months=affectedMonths(e);if(!months.includes(month))continue;
   const head=ds.masters.expenseHeads.find(h=>h.name===e.head);if(!head)throw Error(`Unknown expense head ${e.head}`);
   let a=new D(e.amount).div(months.length);
   if(e.coverageStart&&e.coverageEnd)prepaids.push({id:e.id,monthlyNative:a.toFixed(6),outstandingNative:new D(e.amount).minus(a.times(monthIndex(month)-monthIndex(months[0])+1)).toFixed(6),currency:e.currency});
   if(e.currency==='INR')a=a.div(fx.inrPerAed);if(e.currency==='USD')a=a.times(fx.aedPerUsd);
   add(head.category,a,e.id);continue;
  }
  if(!inMonth)continue;
  if(e.kind==='bill'){
   if(version!=='Actual')throw Error('Bills must be Actual; use estimates for Approx');
   allocate(e.hospital,e.date,billShare(e,ds.masters),e.id);visits+=e.visits;
   if(e.billType==='IP'){cases++;mix[e.procedure]=(mix[e.procedure]??0)+1}
  }
  if(e.kind==='estimate'){
   if(version!=='Approx')throw Error('Estimates must be Approx');
   const net=new D(e.approval).times(new D(1).minus(e.consumablesRate));
   // Approval less consumables is the estimated share base; doctor's payout is a disclosure.
   allocate(e.hospital,e.date,net,e.id);cases++;visits+=e.visits;mix[e.procedure]=(mix[e.procedure]??0)+1;
  }
  if(e.kind==='receipt'){allocate(e.source,e.date,new D(e.amount),e.id);visits+=e.visits}
  if(e.kind==='wallet'&&e.action==='spend')add('Marketing Expense',new D(e.amount),e.id);
  if(e.kind==='adjustment'){
   if(![...ds.masters.hospitals.map(h=>h.id),'Admin Cost Reimbursement','OP Consultation',...categories].includes(e.line))throw Error('Adjust a source revenue or expense category, never a derived total');
   if(categories.includes(e.line as typeof categories[number]))add(e.line,new D(e.amount),e.id);else allocate(e.line,e.date,new D(e.amount),e.id);
  }
 }
 const aggregate=(target:string,lines:string[])=>{sums[target]=lines.reduce((a,l)=>a.plus(sums[l]),new D(0));ids[target]=[...new Set(lines.flatMap(l=>ids[l]))]};
 const rev=[...ds.masters.hospitals.map(h=>h.id),'Admin Cost Reimbursement','OP Consultation'];
 // Masters may add hospitals: initialise their rows before using a new hospital.
 aggregate('Total Revenue',rev);aggregate('Swizton Revenue',rev.map(h=>`Swizton • ${h}`));
 sums['Dr. Tahsin – Professional Fee']=sums['Total Revenue'].minus(sums['Dr. Chinmay – Professional Fee']).minus(sums['Swizton Revenue']);ids['Dr. Tahsin – Professional Fee']=ids['Total Revenue'];
 aggregate('Total Expense',[...categories]);sums['NET PROFIT / LOSS']=sums['Swizton Revenue'].minus(sums['Total Expense']);ids['NET PROFIT / LOSS']=[...new Set([...ids['Swizton Revenue'],...ids['Total Expense']])];
 const base=sums['Swizton Revenue'];
 const rows=Object.fromEntries(Object.entries(sums).map(([l,a])=>[l,{aed:a.toFixed(6),inr:a.times(fx.inrPerAed).div(100000).toFixed(8),pct:base.isZero()?null:a.div(base).times(100).toFixed(4),ids:ids[l]}]));
 const wallet=ds.entries.filter((e):e is Extract<Entry,{kind:'wallet'}>=>e.kind==='wallet'&&e.version===version&&monthOf(e.date)<=month);
 const opening=wallet.filter(e=>monthOf(e.date)<month).reduce((a,e)=>e.action==='spend'?a.minus(e.amount):a.plus(e.amount),new D(0)).plus(wallet.filter(e=>monthOf(e.date)===month&&e.action==='opening').reduce((a,e)=>a.plus(e.amount),new D(0)));
 const addition=wallet.filter(e=>monthOf(e.date)===month&&e.action==='topup').reduce((a,e)=>a.plus(e.amount),new D(0));
 const spend=wallet.filter(e=>monthOf(e.date)===month&&e.action==='spend').reduce((a,e)=>a.plus(e.amount),new D(0));
 const target=ds.masters.targets.find(t=>t.month===month)?.cases??0;
 return {month,version,locked:ds.closes.some(c=>c.month===month&&c.locked),rows,kpis:{cases,visits,target,achievement:target?new D(cases).div(target).times(100).toFixed(2):null,mix},wallet:{opening:opening.toFixed(2),addition:addition.toFixed(2),spend:spend.toFixed(2),closing:opening.plus(addition).minus(spend).toFixed(2)},prepaids};
}
export function calculateYear(ds:Dataset,year:number){
 const months=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
 const actual=months.map(m=>calculateMonth(ds,m,'Actual')),approx=months.map(m=>calculateMonth(ds,m,'Approx'));
 const sum=(ps:Period[])=>{
  const base=ps.reduce((s,p)=>s.plus(p.rows['Swizton Revenue'].aed),new D(0));
  return Object.fromEntries(Object.keys(actual[0].rows).map(l=>{const a=ps.reduce((s,p)=>s.plus(p.rows[l].aed),new D(0)),i=ps.reduce((s,p)=>s.plus(p.rows[l].inr),new D(0));return [l,{aed:a.toFixed(6),inr:i.toFixed(8),pct:base.isZero()?null:a.div(base).times(100).toFixed(4),ids:[...new Set(ps.flatMap(p=>p.rows[l].ids))]}]}));
 };
 const comparatives=Object.fromEntries([year-1,year-2,year-3].map(y=>{
  const data=ds.masters.comparatives.filter(c=>c.year===y);const base=data.find(c=>c.line==='Swizton Revenue');
  return [y,Object.fromEntries(Object.keys(actual[0].rows).map(l=>{const c=data.find(c=>c.line===l);return [l,c?{aed:c.aed,inr:c.inrLakh,pct:base&&new D(base.aed).gt(0)?new D(c.aed).div(base.aed).times(100).toFixed(4):null,ids:[]}:null]}))];
 }));
 const total=sum(actual),outlook=sum(actual.map((p,i)=>p.locked?p:approx[i]));
 const combined=Object.fromEntries(Object.keys(total).map(l=>{
  const cells=[total[l],...Object.values(comparatives).map(c=>c[l])];if(cells.some(c=>!c))return [l,null];
  return [l,{aed:cells.reduce((s,c)=>s.plus(c!.aed),new D(0)).toFixed(6),inr:cells.reduce((s,c)=>s.plus(c!.inr),new D(0)).toFixed(8),pct:null as string|null,ids:[]}];
 }));
 const combinedBase=combined['Swizton Revenue'];if(combinedBase&&new D(combinedBase.aed).gt(0))for(const c of Object.values(combined))if(c)c.pct=new D(c.aed).div(combinedBase.aed).times(100).toFixed(4);
 const kpis={cases:actual.reduce((s,p)=>s+p.kpis.cases,0),visits:actual.reduce((s,p)=>s+p.kpis.visits,0),target:actual.reduce((s,p)=>s+p.kpis.target,0),achievement:null as string|null,mix:Object.fromEntries(ds.masters.procedures.map(p=>[p,actual.reduce((s,a)=>s+(a.kpis.mix[p]??0),0)]))};
 if(kpis.target)kpis.achievement=new D(kpis.cases).div(kpis.target).times(100).toFixed(2);
 return {year,actual,approx,total,outlook,comparatives,combined,kpis};
}
export function entryFacts(e:Entry,m:Masters):Record<string,string>{
 if(e.kind==='bill'){
  const r=ruleAt(m,e.hospital,e.date),final=billShare(e,m),component=m.hospitals.find(h=>h.id===e.hospital)?.method==='components';
  return {method:component?'Component shares':'Net share',gross:e.gross,admin:component?'0':new D(e.gross).times(r.admin).toFixed(6),refundable:component?'0':new D(e.gross).times(r.refundable).toFixed(6),net:component?Object.values(e.components).reduce((s,v)=>s.plus(v),new D(0)).toFixed(6):new D(e.gross).minus(e.consumables).minus(e.pharmacyLab).minus(new D(e.gross).times(r.admin)).minus(new D(e.gross).times(r.refundable)).toFixed(6),shareRate:component?'Component-specific':r.share,finalShare:final.toFixed(6),swizton:final.times(r.swizton).toFixed(6),ruleId:r.id};
 }
 if(e.kind==='estimate'){
  const r=ruleAt(m,e.hospital,e.date),net=new D(e.approval).times(new D(1).minus(e.consumablesRate));
  return {net:net.toFixed(6),doctorPayoutDisclosure:net.times(r.share).toFixed(6),swizton:net.times(r.swizton).toFixed(6),ruleId:r.id};
 }
 return {};
}
