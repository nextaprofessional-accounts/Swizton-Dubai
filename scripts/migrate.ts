import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { demoDataset } from '../server/demo.ts';
if (!process.env.DATABASE_URL) throw Error('Set DATABASE_URL');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  // Seed configuration only: no patients, transactions, forecasts, FX or approved rates are fabricated in production.
  const masters = demoDataset().masters;
  masters.expenseHeads = masters.expenseHeads.map((h) => ({ ...h, costBehavior: 'Unclassified' }));
  masters.fx = [];
  masters.targets = [];
  masters.rules = [];
  await pool.query(
    'INSERT INTO master_data(organisation_id,data) VALUES(1,$1) ON CONFLICT DO NOTHING',
    [JSON.stringify(masters)],
  );
  console.log(
    'Schema ready. Admin must configure approved rules, FX and targets before entering transactions.',
  );
} finally {
  await pool.end();
}
