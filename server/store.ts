import pg from 'pg';
import type {Dataset} from './model.ts';
import {demoDataset} from './demo.ts';
export const demo=process.env.DEMO_MODE==='true';
export const pool=demo?null:new pg.Pool({connectionString:process.env.DATABASE_URL});
let memory=demoDataset();let revision=0;
export interface Audit {sequence:number;actor:string;action:string;entity_id:string;reason:string;before_data:unknown;after_data:unknown;occurred_at:string}
const events:Audit[]=[];
export async function read():Promise<{data:Dataset;revision:number}>{
 if(demo)return {data:structuredClone(memory),revision};
 const c=await pool!.connect();try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const m=await c.query('SELECT data FROM master_data WHERE organisation_id=1');
  const e=await c.query('SELECT payload FROM financial_entry ORDER BY entry_date,id');
  const l=await c.query('SELECT month,locked,closed_by AS by,closed_at AS at,reason FROM month_close');
  const r=await c.query('SELECT revision FROM organisation WHERE id=1');
  if(!m.rows.length)throw Error('Master data is not configured. Initialise using Admin master editor or migration script.');
  await c.query('COMMIT');return {data:{masters:m.rows[0].data,entries:e.rows.map(x=>x.payload),closes:l.rows},revision:Number(r.rows[0].revision)};
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function mutate(actor:string,action:string,entity:string,reason:string,expected:number,fn:(d:Dataset)=>void){
 if(demo){
  if(expected!==revision)throw Error('Conflict: reload data before saving');
  const draft=structuredClone(memory),before=structuredClone(memory);fn(draft);memory=draft;revision++;
  events.push({sequence:events.length+1,actor,action,entity_id:entity,reason,before_data:before,after_data:structuredClone(memory),occurred_at:new Date().toISOString()});return;
 }
 const c=await pool!.connect();try{
  await c.query('BEGIN');const r=await c.query('SELECT revision FROM organisation WHERE id=1 FOR UPDATE');
  if(Number(r.rows[0].revision)!==expected)throw Error('Conflict: reload data before saving');
  const m=await c.query('SELECT data FROM master_data WHERE organisation_id=1'),e=await c.query('SELECT payload FROM financial_entry'),l=await c.query('SELECT month,locked,closed_by AS by,closed_at AS at,reason FROM month_close');
  const d:Dataset={masters:m.rows[0].data,entries:e.rows.map(x=>x.payload),closes:l.rows};const before=structuredClone(d);fn(d);
  await c.query('UPDATE master_data SET data=$1,updated_at=now() WHERE organisation_id=1',[JSON.stringify(d.masters)]);
  // Append-only input workflow: corrections are reasoned adjustments; deletion is unavailable.
  const existing=new Set(before.entries.map(e=>e.id));
  for(const e of d.entries)if(!existing.has(e.id))await c.query('INSERT INTO financial_entry(id,organisation_id,kind,entry_date,version,payload,created_by) VALUES($1,1,$2,$3,$4,$5,$6)',[e.id,e.kind,e.date,e.version,JSON.stringify(e),actor]);
  for(const l of d.closes)await c.query('INSERT INTO month_close(organisation_id,month,locked,closed_by,reason) VALUES(1,$1,$2,$3,$4) ON CONFLICT(organisation_id,month) DO UPDATE SET locked=excluded.locked,closed_by=excluded.closed_by,closed_at=now(),reason=excluded.reason',[l.month,l.locked,l.by,l.reason]);
  await c.query('INSERT INTO audit_event(actor,action,entity_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',[actor,action,entity,reason,JSON.stringify(before),JSON.stringify(d)]);
  await c.query('UPDATE organisation SET revision=revision+1 WHERE id=1');await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function audit(){return demo?events:(await pool!.query('SELECT * FROM audit_event ORDER BY sequence DESC LIMIT 200')).rows}
