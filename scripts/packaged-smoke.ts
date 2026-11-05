import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { demoDataset } from '../server/demo.ts';

const url = process.env.SWIZTON_TEST_DATABASE_URL;
if (!url) throw Error('Set SWIZTON_TEST_DATABASE_URL to a disposable PostgreSQL database');
const schema = `packaged_${randomBytes(8).toString('hex')}`;
const owner = new pg.Pool({ connectionString: url });
const scoped = new URL(url);
scoped.searchParams.set('options', `-c search_path=${schema}`);
const db = new pg.Pool({ connectionString: scoped.toString() });
const directory = await mkdtemp(join(tmpdir(), 'swizton-packaged-'));
let child: ReturnType<typeof spawn> | undefined;
try {
  await owner.query(`CREATE SCHEMA ${schema}`);
  await db.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await db.query('INSERT INTO master_data(organisation_id,data) VALUES(1,$1)', [
    JSON.stringify(demoDataset().masters),
  ]);
  const password = randomBytes(24).toString('base64url'),
    id = randomUUID();
  await db.query('INSERT INTO app_user(id,email,role,password_hash) VALUES($1,$2,$3,$4)', [
    id,
    'packaged-admin@demo.local',
    'Admin',
    await bcrypt.hash(password, 8),
  ]);
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((r) => probe.close(() => r()));
  child = spawn(process.execPath, ['build/server/index.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      PORT: String(port),
      DATABASE_URL: scoped.toString(),
      JWT_SECRET: randomBytes(40).toString('hex'),
      PRIVATE_DATA_DIR: directory,
    },
    stdio: 'ignore',
  });
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(origin + '/api/health');
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, 'Packaged server failed to become ready');
  const login = await fetch(origin + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'packaged-admin@demo.local', password }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  const request = (path: string, body?: unknown) =>
    fetch(origin + '/api' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  const state = await (await request('/data')).json();
  const workbook = new ExcelJS.Workbook(),
    p = workbook.addWorksheet('2026');
  workbook.addWorksheet('IP Details');
  p.getCell('G6').value = 100;
  p.getCell('G7').value = 100;
  p.getCell('G14').value = 30;
  p.getCell('G15').value = 30;
  const content = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  const review = await request('/workbooks/review', {
    name: 'Synthetic packaged workbook.xlsx',
    content,
    reason: 'Packaged application verification',
    revision: state.revision,
  });
  assert.equal(review.status, 201, await review.clone().text());
  const result = await review.json();
  const baseline = await request(`/workbooks/${result.id}/baseline`);
  assert.equal(baseline.status, 200);
  assert.equal(
    Buffer.from(await baseline.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    'PK',
  );
  const next = await (await request('/data')).json();
  assert.equal(next.data.entries.length, 0);
  assert.ok(Array.isArray(next.data.operations.find((o: any) => o.id === result.id).sourceChecks));
  assert.ok(
    next.data.operations.some((o: any) => o.kind === 'workbook_review' && o.id === result.id),
  );
  async function write(path: string, body: object) {
    const current = await (await request('/data')).json();
    const response = await request(path, { ...body, revision: current.revision });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }
  await write('/leads', {
    lead: {
      patientReference: 'Synthetic packaged prospect',
      contact: '',
      hospital: 'CSH',
      procedure: 'RFA',
      expectedDate: '2026-06-20',
      stage: 'Qualified',
      probability: '0.5',
      approvalAmount: '10000',
      consumablesRate: '0.2',
      collectionLagDays: 15,
      owner: '',
      source: 'Packaged smoke',
      reason: 'Verify packaged planning persistence',
    },
  });
  const snapshot = await write('/forecasts', {
    params: {
      name: 'Packaged forecast',
      asOfDate: '2026-06-01',
      months: 1,
      probabilityMultiplier: '1',
      revenueMultiplier: '1',
      monthly: [{ month: '2026-06', fixedCost: '1000', variableCostPerCase: '50', capacity: 1 }],
      reason: 'Verify frozen forecast persistence',
    },
  });
  assert.equal((await request(`/forecasts/${snapshot.id}/export`)).status, 200);
  const plan = await write('/cash/plans', {
    plan: {
      date: '2026-06-02',
      direction: 'In',
      amount: '100',
      target: 'other',
      description: 'Synthetic capital',
      reason: 'Verify packaged cash workflow',
    },
  });
  await write(`/cash/plans/${plan.id}/realize`, {
    date: '2026-06-02',
    amount: '100',
    reference: 'PACKAGED-CAPITAL',
    reason: 'Confirm synthetic bank movement',
  });
  const final = await (await request('/data')).json();
  assert.equal(final.data.entries.length, 0, 'Planning must not post P&L entries');
  for (const kind of ['lead', 'forecast_snapshot', 'cash_plan', 'cash_movement'])
    assert.ok(
      final.data.operations.some((o: any) => o.kind === kind),
      kind,
    );
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /type="module"/);
  console.log(
    'PASS packaged server, PostgreSQL, private workbook baseline, persistent lead/forecast/cash workflows, protected exports and unchanged ledger',
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  await db.end();
  await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await owner.end();
  await rm(directory, { recursive: true, force: true });
}
