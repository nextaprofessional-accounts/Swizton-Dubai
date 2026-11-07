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
  const financeId = randomUUID(),
    controlsId = randomUUID();
  await db.query('INSERT INTO app_user(id,email,role,password_hash) VALUES($1,$2,$3,$4)', [
    financeId,
    'packaged-finance@demo.local',
    'Finance',
    await bcrypt.hash(password, 8),
  ]);
  const controls = {
    id: controlsId,
    kind: 'workbook_review',
    createdBy: financeId,
    createdAt: new Date().toISOString(),
    name: 'Synthetic packaged control fixture',
    sourceSha256: 'synthetic-test-controls-only',
    storageId: 'sample',
    inventory: [],
    sourceChecks: [],
    issues: [
      {
        code: 'SYNTHETIC_FINDING',
        severity: 'warning',
        cells: ['Synthetic!G14'],
        detail: 'Synthetic retained exception for persistence testing',
      },
    ],
    readiness: { matchedChecks: 0, mismatchedChecks: 0, blockedChecks: 0 },
    baseline: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      revenue: '0',
      swizton: '0',
      expense: '0',
      profit: '0',
      rawInr: '0',
    })),
    decisions: {
      preserveOriginal: true,
      fxStatus: 'Awaiting approved RBI rates',
      recognition: 'Separate invoice date and recognition month',
    },
  };
  await db.query(
    'INSERT INTO workflow_item(id,organisation_id,kind,payload,created_by) VALUES($1,1,$2,$3,$4)',
    [controlsId, 'workbook_review', JSON.stringify(controls), financeId],
  );
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
  const request = (path: string, body?: unknown, actor = token) =>
    fetch(origin + '/api' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' },
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
  async function write(path: string, body: object, actor = token) {
    const current = await (await request('/data')).json();
    const response = await request(path, { ...body, revision: current.revision }, actor);
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
  const financeLogin = await fetch(origin + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'packaged-finance@demo.local', password }),
  });
  assert.equal(financeLogin.status, 200);
  const financeToken = (await financeLogin.json()).token;
  async function approve(path: string) {
    const current = await (await request('/data')).json();
    const response = await request(path, {
      approve: true,
      reason: 'Independent synthetic evidence verification',
      revision: current.revision,
    });
    assert.equal(response.status, 200, await response.clone().text());
  }
  for (let i = 1; i <= 12; i++) {
    const proposal = await write(
      '/finance/fx',
      {
        input: {
          month: `2026-${String(i).padStart(2, '0')}`,
          method: 'Provided monthly average',
          inrPerAed: '25.5',
          aedPerUsd: '3.6725',
          observations: [],
          source: 'Synthetic packaged publication',
          reason: 'Verify persistent monthly FX approval',
        },
      },
      financeToken,
    );
    await approve(`/finance/fx/${proposal.id}/review`);
  }
  const exception = await write(
    '/finance/exceptions',
    {
      workbookId: controlsId,
      itemKey: 'issue:0',
      disposition: 'Retain original',
      evidence: 'Synthetic retained source evidence for packaged validation',
      reason: 'Verify independent exception approval',
    },
    financeToken,
  );
  await approve(`/finance/exceptions/${exception.id}/review`);
  await write('/finance/signoffs', {
    workbookId: controlsId,
    year: 2026,
    mode: 'Reviewed with exceptions',
    reason: 'Acknowledge synthetic controls with retained finding',
  });
  const readiness = await (await request(`/finance/workbooks/${controlsId}/2026/readiness`)).json();
  assert.equal(
    readiness.signoffs.at(-1).current,
    true,
    'PostgreSQL JSON ordering must not invalidate a new sign-off',
  );
  assert.equal(readiness.summary.retainedExceptions, 1);
  const reviewExport = await request(`/finance/workbooks/${controlsId}/2026/export`);
  assert.equal(reviewExport.status, 200);
  const exportBook = new ExcelJS.Workbook();
  await exportBook.xlsx.load(Buffer.from(await reviewExport.arrayBuffer()) as any);
  assert.ok(exportBook.getWorksheet('Exception register'));
  const completed = await (await request('/data')).json();
  assert.equal(completed.data.entries.length, 0);
  for (const kind of ['fx_proposal', 'finance_exception', 'finance_signoff'])
    assert.ok(
      completed.data.operations.some((o: any) => o.kind === kind),
      kind,
    );
  const profile = await write(
    '/daily/profiles',
    {
      profile: {
        name: 'Synthetic packaged hospital mapping',
        hospital: 'CSH',
        dateFormat: 'ISO',
        numberFormat: 'Plain',
        columns: {
          date: 'date',
          patient: 'patient',
          procedure: 'procedure',
          doctor: 'doctor',
          invoice: 'invoice',
          gross: 'gross',
          consumables: 'consumables',
          pharmacyLab: 'pharmacyLab',
        },
        defaults: {
          billType: 'IP',
          payment: 'Insurance',
          regime: 'Standard',
          visits: '1',
          vat: '0',
          tax: '0',
        },
        aliases: {},
        reason: 'Verify persistent hospital mapping',
      },
    },
    financeToken,
  );
  const billPreview = await write(
    '/daily/imports/preview',
    {
      profileId: profile.id,
      name: 'Packaged mapped bill.csv',
      format: 'csv',
      content:
        'date,patient,procedure,doctor,invoice,gross,consumables,pharmacyLab\n2026-10-20,Synthetic packaged case,RFA,Dr. Tahsin,PACKAGED-V5,10000,1000,1000',
      reason: 'Validate mapped bill in compiled server',
    },
    financeToken,
  );
  async function action(path: string, body: object, actor = financeToken) {
    const state = await (await request('/data')).json();
    const response = await request(path, { ...body, revision: state.revision }, actor);
    assert.equal(response.status, 200, await response.clone().text());
    return response;
  }
  await action(`/imports/${billPreview.id}/commit`, {
    reason: 'Commit validated mapped hospital bill',
  });
  let daily = await (await request('/data')).json();
  const bill = daily.data.entries.find(
    (e: any) => e.kind === 'bill' && e.invoice === 'PACKAGED-V5',
  );
  assert.ok(bill);
  const caseResponse = await fetch(origin + `/api/daily/cases/${bill.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${financeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'Collection follow-up',
      hospitalCaseReference: 'PACKAGED-CASE-V5',
      authorizationReference: '',
      notes: 'Synthetic follow-up',
      reason: 'Verify case tracking persistence',
      revision: daily.revision,
    }),
  });
  assert.equal(caseResponse.status, 200, await caseResponse.clone().text());
  const bank = await write(
    '/daily/bank/preview',
    {
      account: 'PACKAGED-AED',
      name: 'Packaged bank.csv',
      format: 'csv',
      content:
        'transactionId,date,direction,amount,reference\nPACKAGED-BANK-V5,2026-06-02,In,100,PACKAGED-CAPITAL',
      reason: 'Verify bank statement persistence',
    },
    financeToken,
  );
  await action(`/daily/bank/${bank.id}/commit`, { reason: 'Commit synthetic bank evidence' });
  const bankData = await (await request('/daily/bank')).json(),
    bankStatement = bankData.statements.find((s: any) => s.id === bank.id),
    cash = bankData.cash.find((e: any) => e.reference === 'PACKAGED-CAPITAL');
  assert.ok(cash);
  const allocated = await write(
    '/daily/bank/matches',
    {
      statementId: bank.id,
      rowId: bankStatement.rows[0].data.id,
      eventId: cash.id,
      amount: '100',
      reason: 'Match recorded capital without reposting',
    },
    financeToken,
  );
  await action(`/daily/bank/matches/${allocated.id}/reverse`, {
    reason: 'Verify reversible evidence link',
  });
  await action(
    `/daily/bank/${bank.id}/void`,
    { reason: 'Admin reviews synthetic bank statement correction' },
    token,
  );
  daily = await (await request('/data')).json();
  assert.equal(daily.data.entries.length, 1, 'Only explicit bill commit creates a P&L entry');
  for (const kind of ['hospital_profile', 'case_record', 'bank_statement', 'bank_match'])
    assert.ok(
      daily.data.operations.some((o: any) => o.kind === kind),
      kind,
    );
  assert.equal((await request('/daily/bank/export')).status, 200);
  const afterBill = await (await request(`/finance/workbooks/${controlsId}/2026/readiness`)).json();
  assert.equal(
    afterBill.signoffs.at(-1).current,
    false,
    'Posting a new bill invalidates the old control sign-off',
  );
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /type="module"/);
  console.log(
    'PASS compiled PostgreSQL app: financial approvals, mapping/commit, case tracking, bank matching/unmatching, evidence exports and sign-off invalidation',
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
