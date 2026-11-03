import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {z} from 'zod';
import ExcelJS from 'exceljs';
import {parse} from 'csv-parse/sync';
import {demo,pool,read,mutate,audit} from './store.ts';
import {entrySchema,masterSchema,type Entry} from './model.ts';
import {affectedMonths,calculateMonth,calculateYear,entryFacts} from './engine.ts';
import {assertUnlocked,validateDataset} from './validation.ts';
import {excelReport,pdfReport} from './export.ts';
import {analytics,budget} from './analytics.ts';
export const app=express();app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'"],'style-src':["'self'","'unsafe-inline'"]}}}));app.use(express.json({limit:'12mb'}));
if(!demo&&(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32||!process.env.DATABASE_URL))throw Error('Production requires DATABASE_URL and JWT_SECRET (32+ characters)');
const secret=process.env.JWT_SECRET||randomBytes(32).toString('hex');
type User={id:string;email:string;role:'Admin'|'Finance'|'Management'};
declare global {namespace Express {interface Request {user:User}}}
const attempts=new Map<string,{n:number;until:number}>();
app.get('/api/health',async(_q,r)=>{try{if(pool)await pool.query('SELECT 1');r.json({ok:true,demo})}catch{r.status(503).json({error:'Database unavailable'})}});
app.post('/api/auth/login',async(q,r)=>{
 const {email,password}=z.object({email:z.string().email(),password:z.string().min(1)}).parse(q.body);const key=q.ip??'unknown';const a=attempts.get(key);if(a&&a.until>Date.now()&&a.n>=10){r.status(429).json({error:'Too many attempts; try in 15 minutes'});return}
 let u:User|undefined;
 if(demo&&password==='demo-only'){
  const role=({'admin@demo.local':'Admin','finance@demo.local':'Finance','management@demo.local':'Management'} as const)[email as 'admin@demo.local'];if(role)u={id:role==='Admin'?'00000000-0000-4000-8000-000000000001':role==='Finance'?'00000000-0000-4000-8000-000000000002':'00000000-0000-4000-8000-000000000003',email,role};
 }else if(pool){const result=await pool.query('SELECT id,email,role,password_hash FROM app_user WHERE email=$1 AND active=true',[email]);const row=result.rows[0];if(row&&await bcrypt.compare(password,row.password_hash))u={id:row.id,email:row.email,role:row.role}}
 if(!u){attempts.set(key,{n:a&&a.until>Date.now()?a.n+1:1,until:Date.now()+900000});r.status(401).json({error:'Invalid credentials'});return}
 attempts.delete(key);r.json({token:jwt.sign({sub:u.id,email:u.email,role:u.role},secret,{expiresIn:'1h',algorithm:'HS256',issuer:'swizton',audience:'swizton-web'}),user:u,demo});
});
app.use('/api',async(q,r,next)=>{try{const t=q.headers.authorization?.replace(/^Bearer /,'');if(!t)throw Error();const p=jwt.verify(t,secret,{algorithms:['HS256'],issuer:'swizton',audience:'swizton-web'}) as jwt.JwtPayload;q.user={id:p.sub!,email:p.email,role:p.role};if(pool){const result=await pool.query('SELECT id,email,role FROM app_user WHERE id=$1 AND active=true',[q.user.id]);if(!result.rows.length)throw Error();q.user=result.rows[0]}next()}catch{r.status(401).json({error:'Please sign in again'})}});
const roles=(...allowed:string[]):express.RequestHandler=>(q,r,next)=>{if(!allowed.includes(q.user.role)){r.status(403).json({error:'Insufficient role'});return}next()};
const reasonSchema=z.string().min(8).max(1000);const revisionSchema=z.number().int().nonnegative();
app.get('/api/me',(q,r)=>r.json(q.user));
app.get('/api/data',async(_q,r)=>{const s=await read();r.json({...s,demo,facts:Object.fromEntries(s.data.entries.filter(e=>e.kind==='bill'||e.kind==='estimate').map(e=>[e.id,entryFacts(e,s.data.masters)]))})});
app.get('/api/audit',roles('Admin','Finance'),async(_q,r)=>r.json(await audit()));
app.get('/api/pnl/:year',async(q,r)=>{const year=z.coerce.number().int().min(2023).max(2100).parse(q.params.year);r.json(calculateYear((await read()).data,year))});
app.get('/api/export/:year/:format',async(q,r)=>{const report=calculateYear((await read()).data,z.coerce.number().int().min(2023).max(2100).parse(q.params.year));if(q.params.format==='xlsx')await excelReport(report,r);else if(q.params.format==='pdf')pdfReport(report,r);else r.status(400).json({error:'Use xlsx or pdf'})});
app.get('/api/analytics/:month',async(q,r)=>{const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(q.params.month);r.json(analytics((await read()).data,month))});
app.post('/api/budget',async(q,r)=>{const b=z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),fixedCost:z.string().regex(/^\d+(\.\d+)?$/),items:z.array(z.object({hospital:z.string(),procedure:z.string(),cases:z.number().int().nonnegative(),revenuePerCase:z.string().regex(/^\d+(\.\d+)?$/)})).max(100)}).parse(q.body);r.json(budget((await read()).data,b.month,b.items,b.fixedCost))});
app.post('/api/entries',roles('Admin','Finance'),async(q,r)=>{
 const b=z.object({entry:entrySchema,reason:reasonSchema,revision:revisionSchema}).parse(q.body);
 await mutate(q.user.id,'entry.create',b.entry.id,b.reason,b.revision,d=>{assertUnlocked(d,b.entry);d.entries.push(b.entry);validateDataset(d)});r.status(201).json({id:b.entry.id});
});
app.put('/api/masters',roles('Admin'),async(q,r)=>{
 const b=z.object({masters:masterSchema,reason:reasonSchema,revision:revisionSchema}).parse(q.body);
 await mutate(q.user.id,'masters.replace','masters',b.reason,b.revision,d=>{if(d.closes.some(c=>c.locked))throw Error('Reopen all locked months before changing masters');d.masters=b.masters;validateDataset(d)});r.json({ok:true});
});
app.post('/api/months/:month/close',roles('Admin','Finance'),async(q,r)=>{
 const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(q.params.month);const b=z.object({locked:z.boolean(),reason:reasonSchema,revision:revisionSchema}).parse(q.body);
 if(!b.locked&&q.user.role!=='Admin'){r.status(403).json({error:'Only Admin may reopen'});return}
 await mutate(q.user.id,b.locked?'month.close':'month.reopen',month,b.reason,b.revision,d=>{
  validateDataset(d);calculateMonth(d,month,'Actual');if(b.locked&&!d.masters.targets.some(t=>t.month===month))throw Error('Set a monthly target before closing');
  d.closes=d.closes.filter(c=>c.month!==month);d.closes.push({month,locked:b.locked,reason:b.reason,by:q.user.id,at:new Date().toISOString()});
 });r.json({ok:true});
});
app.post('/api/import/bills',roles('Admin','Finance'),async(q,r)=>{
 const b=z.object({format:z.enum(['csv','xlsx']),content:z.string().min(1).max(11000000),reason:reasonSchema,revision:revisionSchema}).parse(q.body);
 let rows:Record<string,unknown>[]=[];
 if(b.format==='csv')rows=parse(b.content,{columns:true,skip_empty_lines:true,bom:true,max_record_size:100000});
 else {const bytes=Buffer.from(b.content,'base64');if(bytes.length>5000000)throw Error('Workbook too large (5 MB max)');const w=new ExcelJS.Workbook();await w.xlsx.load(bytes as never);const sheet=w.worksheets[0];if(!sheet)throw Error('Empty workbook');if(sheet.rowCount>1001)throw Error('At most 1000 rows per batch');const headers=sheet.getRow(1).values as string[];sheet.eachRow((row,n)=>{if(n===1)return;const obj:Record<string,unknown>={};headers.forEach((h,i)=>{if(h)obj[h]=row.getCell(i).text});rows.push(obj)})}
 if(!rows.length||rows.length>1000)throw Error('Provide 1–1000 bill rows');
 const entries=rows.map((row,i)=>{try{return entrySchema.parse({...row,recognitionMonth:row.recognitionMonth||undefined,id:randomUUID(),kind:'bill',version:'Actual',components:typeof row.components==='string'?JSON.parse(row.components):row.components??{},visits:Number(row.visits??1),vat:String(row.vat??'0'),tax:String(row.tax??'0')})}catch(e){throw Error(`Row ${i+2}: ${e instanceof Error?e.message:'Invalid data'}`)}});
 await mutate(q.user.id,'bills.import',randomUUID(),b.reason,b.revision,d=>{for(const e of entries){assertUnlocked(d,e);d.entries.push(e)}validateDataset(d)});r.status(201).json({imported:entries.length});
});
app.use(express.static(resolve('dist')));
app.get('/{*path}',(q,r)=>{if(q.path.startsWith('/api/')){r.status(404).json({error:'Unknown API route'});return}r.sendFile(resolve('dist/index.html'))});
app.use((err:unknown,_q:express.Request,r:express.Response,_n:express.NextFunction)=>{const message=err instanceof Error?err.message:'Request failed';const conflict=message.startsWith('Conflict:');r.status(conflict?409:400).json({error:message})});
if(process.env.NODE_ENV!=='test')app.listen(Number(process.env.PORT??3001),'0.0.0.0',()=>console.log(`Swizton API listening on ${process.env.PORT??3001}; demo=${demo}`));
