import {Decimal as D} from 'decimal.js';
import type {Dataset} from './model.ts';
import {recognitionMonthOf} from './period.ts';
import {billShare,calculateMonth,ruleAt} from './engine.ts';
export function analytics(d:Dataset,month:string){
 const a=calculateMonth(d,month,'Actual'),f=calculateMonth(d,month,'Approx');
 const matrix:Record<string,{hospital:string;procedure:string;cases:number;revenue:D}>={};
 for(const e of d.entries)if(e.kind==='bill'&&e.version==='Actual'&&e.billType==='IP'&&recognitionMonthOf(e)===month){
  const key=`${e.hospital} / ${e.procedure}`,row=matrix[key]??{hospital:e.hospital,procedure:e.procedure,cases:0,revenue:new D(0)};
  row.cases++;row.revenue=row.revenue.plus(billShare(e,d.masters).times(ruleAt(d.masters,e.hospital,e.date).swizton));matrix[key]=row;
 }
 const totalCases=Object.values(matrix).reduce((s,r)=>s+r.cases,0),expense=new D(a.rows['Total Expense'].aed),swizton=Object.values(matrix).reduce((s,r)=>s.plus(r.revenue),new D(0));
 return {month,variance:Object.keys(a.rows).map(line=>({line,actual:a.rows[line].aed,approx:f.rows[line].aed,variance:new D(a.rows[line].aed).minus(f.rows[line].aed).toFixed(2)})),ranking:Object.values(matrix).map(r=>({hospital:r.hospital,procedure:r.procedure,cases:r.cases,swizton:r.revenue.toFixed(2),perCase:r.revenue.div(r.cases).toFixed(2),allocatedExpense:totalCases?expense.times(r.cases).div(totalCases).toFixed(2):'0',profitAfterAllocation:totalCases?r.revenue.minus(expense.times(r.cases).div(totalCases)).toFixed(2):'0'})).sort((a,b)=>Number(b.swizton)-Number(a.swizton)),breakeven:totalCases&&swizton.gt(0)?expense.div(swizton.div(totalCases)).ceil().toString():null,allocationBasis:'All monthly expenses allocated evenly per IP case. Indicative contribution, not patient-level cost accounting; OP and reimbursement revenue excluded from ranking. Ranking counts recognised IP bill records; occurrence-date case KPIs can differ when prior-period bills are recognised later.'};
}
export function budget(d:Dataset,month:string,items:{hospital:string;procedure:string;cases:number;revenuePerCase:string}[],fixedCost:string){
 const rows=items.map(i=>{if(!d.masters.procedures.includes(i.procedure))throw Error('Unknown procedure');const r=ruleAt(d.masters,i.hospital,`${month}-01`);const gross=new D(i.revenuePerCase).times(i.cases);return {...i,revenue:gross.toFixed(2),swizton:gross.times(r.swizton).toFixed(2)}});
 const revenue=rows.reduce((s,r)=>s.plus(r.swizton),new D(0));return {rows,swizton:revenue.toFixed(2),expense:fixedCost,profit:revenue.minus(fixedCost).toFixed(2),basis:'Revenue per case is hospital doctor-fee/final-share revenue, after hospital deductions. Fixed cost is an explicit planning assumption; no inferred direct-cost model.'};
}
