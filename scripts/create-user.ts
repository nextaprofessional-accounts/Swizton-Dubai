import pg from 'pg';import bcrypt from 'bcryptjs';import {randomUUID} from 'node:crypto';
const [email,role]=process.argv.slice(2);const password=process.env.NEW_USER_PASSWORD;
if(!email?.includes('@')||!['Admin','Finance','Management'].includes(role)||!password||password.length<12||!process.env.DATABASE_URL)throw Error('Usage: NEW_USER_PASSWORD=<12+ chars, set securely> npm run user:create -- email Role; DATABASE_URL required');
const p=new pg.Pool({connectionString:process.env.DATABASE_URL});try{await p.query('INSERT INTO app_user(id,email,role,password_hash) VALUES($1,$2,$3,$4)',[randomUUID(),email,role,await bcrypt.hash(password,12)]);console.log('User created')}finally{await p.end()}
