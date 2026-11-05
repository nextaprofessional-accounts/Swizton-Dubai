import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { demoDataset } from '../server/demo.ts';
process.env.NODE_ENV = 'test';
process.env.PRIVATE_DATA_DIR = `/tmp/swizton-api-${randomUUID()}`;
const dbUrl = process.env.SWIZTON_TEST_DATABASE_URL;
let adminPool: pg.Pool | null = null;
const schema = `test_${randomBytes(8).toString('hex')}`;
if (dbUrl) {
  adminPool = new pg.Pool({ connectionString: dbUrl });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const u = new URL(dbUrl);
  u.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = u.toString();
  process.env.DEMO_MODE = 'false';
  process.env.JWT_SECRET = randomBytes(40).toString('hex');
} else process.env.DEMO_MODE = 'true';
const { app } = await import('../server/index.ts');
const { pool } = await import('../server/store.ts');
let server: ReturnType<typeof app.listen>;
let origin = '';
let admin = '',
  finance = '',
  management = '';
const password = 'Synthetic-test-password-2026';
async function request(path: string, token = '', body?: unknown, method?: string) {
  return fetch(origin + '/api' + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function state() {
  return (await request('/data', admin)).json();
}
before(async () => {
  if (pool) {
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    await pool.query('INSERT INTO master_data(organisation_id,data) VALUES(1,$1)', [
      JSON.stringify(demoDataset().masters),
    ]);
    for (const role of ['Admin', 'Finance', 'Management'])
      await pool.query('INSERT INTO app_user(id,email,role,password_hash) VALUES($1,$2,$3,$4)', [
        randomUUID(),
        `${role.toLowerCase()}@demo.local`,
        role,
        await bcrypt.hash(password, 4),
      ]);
  }
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
  const login = async (role: string) => {
    const r = await request('/auth/login', '', {
      email: `${role}@demo.local`,
      password: dbUrl ? password : 'demo-only',
    });
    assert.equal(r.status, 200);
    return (await r.json()).token;
  };
  admin = await login('admin');
  finance = await login('finance');
  management = await login('management');
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  }
  await rm(process.env.PRIVATE_DATA_DIR!, { recursive: true, force: true });
});
test('API enforces authentication and Management read-only', async () => {
  assert.equal((await request('/data')).status, 401);
  const s = await state();
  assert.equal(
    (
      await request('/entries', management, {
        entry: {},
        reason: 'Test permissions',
        revision: s.revision,
      })
    ).status,
    403,
  );
  assert.equal((await request('/audit', management)).status, 403);
  assert.equal((await request('/pnl/2026', management)).status, 200);
});
test('entry creation has revision checks, audit snapshots and drilldown IDs', async () => {
  const s = await state();
  const id = randomUUID();
  const entry = {
    id,
    kind: 'receipt',
    date: '2026-07-01',
    version: 'Actual',
    source: 'OP Consultation',
    amount: '100',
    patient: 'Synthetic fixture',
    visits: 1,
  };
  assert.equal(
    (
      await request('/entries', finance, {
        entry,
        reason: 'Add fixture receipt',
        revision: s.revision,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await request('/entries', finance, {
        entry: { ...entry, id: randomUUID() },
        reason: 'Stale write fixture',
        revision: s.revision,
      })
    ).status,
    409,
  );
  const pnl = await (await request('/pnl/2026', admin)).json();
  assert.ok(pnl.actual[6].rows['Swizton Revenue'].ids.includes(id));
  const events = await (await request('/audit', finance)).json();
  assert.ok(
    events.some(
      (e: any) => e.action === 'entry.create' && e.after_data.entries.some((x: any) => x.id === id),
    ),
  );
});
test('close rejects Actual and Approx changes and annual prepaids; reopening is Admin only', async () => {
  let s = await state();
  assert.equal(
    (
      await request('/months/2026-07/close', finance, {
        locked: true,
        reason: 'Reconcile fixture month',
        revision: s.revision,
      })
    ).status,
    200,
  );
  s = await state();
  const entry = {
    id: randomUUID(),
    kind: 'expense',
    date: '2026-01-01',
    version: 'Actual',
    head: 'Trade License',
    amount: '1200',
    currency: 'AED',
    basis: 'Accrual',
    paid: true,
    remarks: 'Test',
    coverageStart: '2026-01-01',
    coverageEnd: '2026-12-31',
  };
  const blocked = await request('/entries', finance, {
    entry,
    reason: 'Attempt covered prepaid',
    revision: s.revision,
  });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /locked/);
  assert.equal(
    (
      await request(
        '/masters',
        admin,
        {
          masters: {
            ...s.data.masters,
            rules: s.data.masters.rules.map((r: any) =>
              r.hospital === 'OP Consultation' ? { ...r, swizton: '0.4' } : r,
            ),
          },
          reason: 'Attempt master change',
          revision: s.revision,
        },
        'PUT',
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/months/2026-07/close', finance, {
        locked: false,
        reason: 'Attempt finance reopen',
        revision: s.revision,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/months/2026-07/close', admin, {
        locked: false,
        reason: 'Admin fixture reopen',
        revision: s.revision,
      })
    ).status,
    200,
  );
});
const header =
  'date,hospital,patient,procedure,doctor,billType,payment,invoice,gross,consumables,pharmacyLab,regime,components,visits,vat,tax\n';
const csv = (invoice: string) =>
  `2026-07-12,CSH,Synthetic patient,RFA,Dr. Tahsin,IP,Cash,${invoice},10000,1000,1000,Standard,{},1,0,0\n`;
test('CSV import is atomic and duplicate invoices fail without partial writes', async () => {
  let s = await state();
  const count = s.data.entries.length;
  let r = await request('/import/bills', finance, {
    format: 'csv',
    content: header + csv('ATOMIC-DUP') + csv('ATOMIC-DUP'),
    reason: 'Test duplicate batch',
    revision: s.revision,
  });
  assert.equal(r.status, 400);
  s = await state();
  assert.equal(s.data.entries.length, count);
  r = await request('/import/bills', finance, {
    format: 'csv',
    content: header + csv('VALID-IMPORT'),
    reason: 'Test valid CSV import',
    revision: s.revision,
  });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).imported, 1);
});
test('XLSX import and exports preserve period blocks, amounts and formats', async () => {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet('Bills');
  s.addRow(header.trim().split(','));
  s.addRow(csv('XLSX-IMPORT').trim().split(','));
  const content = Buffer.from(await w.xlsx.writeBuffer()).toString('base64');
  let st = await state();
  assert.equal(
    (
      await request('/import/bills', finance, {
        format: 'xlsx',
        content,
        reason: 'Test XLSX bill import',
        revision: st.revision,
      })
    ).status,
    201,
  );
  const x = await request('/export/2026/xlsx', management);
  assert.equal(x.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await x.arrayBuffer()) as never);
  const sheet = book.worksheets[0];
  assert.equal(sheet.getCell('B3').value, '2026-01 Approx');
  assert.equal(sheet.getCell('E3').value, '2026-01 Actual');
  assert.equal(sheet.getCell('B4').value, 'AED');
  assert.ok(sheet.rowCount > 30);
  let annualCases: unknown;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === 'cases') annualCases = row.getCell(74).value;
  });
  assert.equal(annualCases, dbUrl ? 2 : 92);
  const p = await request('/export/2026/pdf', management);
  assert.equal(p.status, 200);
  assert.equal(
    Buffer.from(await p.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    '%PDF-',
  );
});
test('database audit rejects mutation', { skip: !dbUrl }, async () => {
  await assert.rejects(pool!.query("UPDATE audit_event SET reason='tampered'"), /append-only/);
});
test('import previews expose errors, require explicit commit, and reject duplicate commits', async () => {
  let s = await state(),
    count = s.data.entries.length;
  let r = await request('/imports/preview', finance, {
    name: 'invalid.csv',
    format: 'csv',
    content: header + csv('PREVIEW-1') + csv('PREVIEW-1'),
    reason: 'Preview duplicate source',
    revision: s.revision,
  });
  assert.equal(r.status, 201);
  const bad = await r.json();
  assert.equal(bad.rows.length, 2);
  assert.ok(bad.rows[1].errors.length);
  s = await state();
  assert.equal(s.data.entries.length, count);
  assert.equal(
    (
      await request(`/imports/${bad.id}/commit`, finance, {
        reason: 'Attempt invalid commit',
        revision: s.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/imports/${bad.id}/cancel`, finance, {
        reason: 'Cancel invalid preview',
        revision: s.revision,
      })
    ).status,
    200,
  );
  s = await state();
  r = await request('/imports/preview', finance, {
    name: 'valid.csv',
    format: 'csv',
    content: header + csv('PREVIEW-GOOD'),
    reason: 'Preview clean source',
    revision: s.revision,
  });
  assert.equal(r.status, 201);
  const good = await r.json();
  s = await state();
  assert.equal(
    (
      await request(`/imports/${good.id}/commit`, finance, {
        reason: 'Commit reviewed source',
        revision: s.revision,
      })
    ).status,
    200,
  );
  s = await state();
  assert.equal(s.data.entries.length, count + 1);
  assert.equal(
    (
      await request(`/imports/${good.id}/commit`, finance, {
        reason: 'Attempt double commit',
        revision: s.revision,
      })
    ).status,
    400,
  );
});
test('adjustments need independent approval and cannot bypass review through entries API', async () => {
  let s = await state();
  const entry = {
    id: randomUUID(),
    kind: 'adjustment',
    date: '2026-08-01',
    version: 'Actual',
    line: 'Marketing Expense',
    amount: '100',
    reason: 'Test supported correction',
  };
  assert.equal(
    (
      await request('/entries', finance, {
        entry,
        reason: 'Attempt direct posting',
        revision: s.revision,
      })
    ).status,
    400,
  );
  const r = await request('/adjustments', finance, {
    entry,
    reason: 'Submit supported correction',
    revision: s.revision,
  });
  assert.equal(r.status, 201);
  const op = await r.json();
  s = await state();
  assert.ok(!s.data.entries.some((e: any) => e.id === entry.id));
  assert.equal(
    (
      await request(`/adjustments/${op.id}/review`, finance, {
        approve: true,
        reason: 'Attempt self approval',
        revision: s.revision,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/months/2026-08/close', admin, {
        locked: true,
        reason: 'Attempt close with pending',
        revision: s.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/adjustments/${op.id}/review`, admin, {
        approve: true,
        reason: 'Independent source review',
        revision: s.revision,
      })
    ).status,
    200,
  );
  s = await state();
  assert.ok(s.data.entries.some((e: any) => e.id === entry.id));
  assert.equal(
    (
      await request(`/adjustments/${op.id}/review`, admin, {
        approve: true,
        reason: 'Attempt approval twice',
        revision: s.revision,
      })
    ).status,
    400,
  );
});
test('collections have no P&L effect and enforce remaining balance', async () => {
  let s = await state();
  const bill = s.data.entries.find((e: any) => e.kind === 'bill');
  const before = await (await request('/pnl/2026', admin)).json();
  const r = await request('/settlements', finance, {
    billId: bill.id,
    date: '2026-12-01',
    amount: '100',
    reference: 'API-SAMPLE-COLLECTION',
    reason: 'Record bank receipt',
    revision: s.revision,
  });
  assert.equal(r.status, 201);
  const after = await (await request('/pnl/2026', admin)).json();
  assert.deepEqual(after.total, before.total);
  const rows = await (await request('/receivables?asOf=2026-12-31', admin)).json();
  assert.equal(rows.find((r: any) => r.id === bill.id).paid, '100.00');
  s = await state();
  assert.equal(
    (
      await request('/settlements', finance, {
        billId: bill.id,
        date: '2026-12-01',
        amount: '99999999',
        reference: 'API-OVERPAY',
        reason: 'Attempt overpayment',
        revision: s.revision,
      })
    ).status,
    400,
  );
});
test('budget scenarios persist and Management cannot create them', async () => {
  let s = await state();
  const body = {
    name: 'Synthetic FY26 scenario',
    month: '2026-10',
    fixedCost: '2000',
    items: [{ hospital: 'CSH', procedure: 'RFA', cases: 10, revenuePerCase: '1000' }],
    reason: 'Save approved assumptions',
    revision: s.revision,
  };
  assert.equal((await request('/budgets', management, body)).status, 403);
  assert.equal((await request('/budgets', finance, body)).status, 201);
  s = await state();
  assert.ok(s.data.operations.some((o: any) => o.kind === 'budget' && o.name === body.name));
});
test('Admin manages named accounts; deactivation revokes already issued tokens', async () => {
  let s = await state();
  const body = {
    email: 'new-user@demo.local',
    role: 'Finance',
    active: true,
    password: 'Synthetic-new-password-2026',
    reason: 'Create named test account',
    revision: s.revision,
  };
  assert.equal((await request('/accounts', finance, body)).status, 403);
  const r = await request('/accounts', admin, body);
  assert.equal(r.status, 201);
  const { id } = await r.json();
  const login = await request('/auth/login', '', { email: body.email, password: body.password });
  assert.equal(login.status, 200);
  const t = (await login.json()).token;
  assert.equal((await request('/me', t)).status, 200);
  s = await state();
  assert.equal(
    (
      await request('/accounts', admin, {
        id,
        email: body.email,
        role: 'Finance',
        active: false,
        reason: 'Disable named test account',
        revision: s.revision,
      })
    ).status,
    201,
  );
  assert.equal((await request('/me', t)).status, 401);
  s = await state();
  assert.equal(
    (
      await request('/accounts', admin, {
        id,
        email: body.email,
        role: 'Finance',
        active: true,
        reason: 'Reactivate test account',
        revision: s.revision,
      })
    ).status,
    201,
  );
  assert.equal((await request('/me', t)).status, 401, 'Reactivation must not revive old sessions');
  const fresh = await request('/auth/login', '', { email: body.email, password: body.password });
  assert.equal(fresh.status, 200);

  const events = JSON.stringify(await (await request('/audit', admin)).json());
  assert.ok(!events.includes(body.password));
  assert.ok(!events.includes('password_hash'));
});
test('workbook review preserves a private baseline without posting any ledger data', async () => {
  const w = new ExcelJS.Workbook(),
    p = w.addWorksheet('2026');
  w.addWorksheet('IP Details');
  p.getCell('G6').value = 100;
  p.getCell('G7').value = 100;
  p.getCell('G14').value = 30;
  p.getCell('G15').value = 30;
  const content = Buffer.from(await w.xlsx.writeBuffer()).toString('base64');
  const s = await state(),
    count = s.data.entries.length;
  const response = await request('/workbooks/review', finance, {
    name: 'Synthetic-workbook.xlsx',
    content,
    reason: 'Review source without posting',
    revision: s.revision,
  });
  assert.equal(response.status, 201, await response.clone().text());
  const result = await response.json();
  const next = await state();
  assert.equal(next.data.entries.length, count);
  const op = next.data.operations.find((o: any) => o.id === result.id);
  assert.equal(op.decisions.preserveOriginal, true);
  assert.equal(op.decisions.fxStatus, 'Awaiting approved RBI rates');
  const download = await request(`/workbooks/${result.id}/baseline`, management);
  assert.equal(download.status, 200);
  assert.equal(
    Buffer.from(await download.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    'PK',
  );
});
test('doctor payout links to its fee period and does not reduce Swizton profit a second time', async () => {
  const s = await state(),
    before = await (await request('/pnl/2026', admin)).json();
  const due = await (await request('/doctor-payables/2026-07', finance)).json();
  assert.ok(Number(due.find((d: any) => d.doctor === 'Tahsin').outstanding) > 100);
  assert.equal(
    (
      await request('/doctor-payments', finance, {
        doctor: 'Tahsin',
        period: '2026-07',
        date: '2026-12-02',
        amount: '100',
        reference: 'API-DOCTOR-TEST',
        reason: 'Pay accrued doctor fee',
        revision: s.revision,
      })
    ).status,
    201,
  );
  const after = await (await request('/pnl/2026', admin)).json();
  assert.deepEqual(after.total, before.total);
  const paid = await (await request('/doctor-payables/2026-07', finance)).json();
  assert.equal(paid.find((d: any) => d.doctor === 'Tahsin').paid, '100.00');
});
test('budget comparison uses the saved projection snapshot', async () => {
  const s = await state(),
    scenario = s.data.operations.find((o: any) => o.kind === 'budget');
  assert.ok(scenario.projection);
  const result = await (await request(`/budgets/${scenario.id}/variance`, management)).json();
  assert.deepEqual(result.budget, scenario.projection);
  assert.equal(result.version, 1);
});

test('planning API preserves snapshots, rejects stale lead edits and enforces read-only roles', async () => {
  const initial = await state(),
    entryCount = initial.data.entries.length;
  const lead = {
    patientReference: 'Synthetic API prospect',
    contact: '',
    hospital: 'CSH',
    procedure: 'RFA',
    expectedDate: '2026-08-20',
    stage: 'Qualified',
    probability: '0.5',
    approvalAmount: '10000',
    consumablesRate: '0.2',
    collectionLagDays: 15,
    owner: '',
    source: 'Synthetic API referral',
    reason: 'Verify audited lead lifecycle',
  };
  assert.equal(
    (await request('/leads', management, { lead, revision: initial.revision })).status,
    403,
  );
  const created = await request('/leads', finance, { lead, revision: initial.revision });
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await created.json();
  let s = await state();
  assert.equal(
    (
      await request(
        `/leads/${id}`,
        finance,
        {
          lead,
          revision: s.revision,
          expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
        },
        'PUT',
      )
    ).status,
    409,
  );
  const stored = s.data.operations.find((o: any) => o.id === id);
  const updated = await request(
    `/leads/${id}`,
    finance,
    {
      lead: { ...lead, probability: '0.6' },
      revision: s.revision,
      expectedUpdatedAt: stored.updatedAt,
    },
    'PUT',
  );
  assert.equal(updated.status, 200, await updated.clone().text());
  const params = {
    name: 'API frozen forecast',
    asOfDate: '2026-08-01',
    months: 1,
    probabilityMultiplier: '1',
    revenueMultiplier: '1',
    monthly: [{ month: '2026-08', fixedCost: '1000', variableCostPerCase: '50', capacity: 1 }],
    reason: 'Verify immutable forecast snapshot',
  };
  assert.equal((await request('/forecasts/preview', management, params)).status, 200);
  s = await state();
  assert.equal(
    (await request('/forecasts', management, { params, revision: s.revision })).status,
    403,
  );
  const capture = await request('/forecasts', finance, { params, revision: s.revision });
  assert.equal(capture.status, 201, await capture.clone().text());
  const snapshotId = (await capture.json()).id;
  s = await state();
  const frozen = s.data.operations.find((o: any) => o.id === snapshotId);
  assert.equal(frozen.result.leads.find((o: any) => o.leadId === id).probabilityUsed, '0.600000');
  const newer = s.data.operations.find((o: any) => o.id === id);
  assert.equal(
    (
      await request(
        `/leads/${id}`,
        finance,
        {
          lead: { ...lead, probability: '0.1' },
          revision: s.revision,
          expectedUpdatedAt: newer.updatedAt,
        },
        'PUT',
      )
    ).status,
    200,
  );
  s = await state();
  assert.deepEqual(
    s.data.operations.find((o: any) => o.id === snapshotId),
    frozen,
  );
  assert.equal(s.data.entries.length, entryCount);
  assert.equal((await request(`/forecasts/${snapshotId}/accuracy`, management)).status, 200);
  const download = await request(`/forecasts/${snapshotId}/export`, management);
  assert.equal(download.status, 200);
  assert.equal(
    Buffer.from(await download.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    'PK',
  );
});

test('cash realization is atomic, audited and does not post a second expense or revenue', async () => {
  let s = await state();
  const entries = s.data.entries;
  const plan = {
    date: '2026-12-10',
    direction: 'In',
    amount: '250',
    target: 'other',
    description: 'Synthetic capital contribution',
    reason: 'Test traceable capital plan',
  };
  assert.equal(
    (await request('/cash/plans', management, { plan, revision: s.revision })).status,
    403,
  );
  const created = await request('/cash/plans', finance, { plan, revision: s.revision });
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await created.json();
  s = await state();
  const realize = {
    date: '2026-12-10',
    amount: '250',
    reference: 'API-CASH-CAPITAL',
    reason: 'Confirm synthetic capital deposit',
    revision: s.revision,
  };
  const response = await request(`/cash/plans/${id}/realize`, finance, realize);
  assert.equal(response.status, 201, await response.clone().text());
  s = await state();
  assert.deepEqual(s.data.entries, entries);
  assert.equal(s.data.operations.find((o: any) => o.id === id).status, 'Realized');
  assert.equal(
    (await request(`/cash/plans/${id}/realize`, finance, { ...realize, revision: s.revision }))
      .status,
    400,
  );
  const cash = await request('/cash/forecast', management, {
    asOfDate: '2026-12-01',
    months: 1,
    opening: '100',
    pipeline: false,
    doctorLagDays: 0,
  });
  assert.equal(cash.status, 200);
  assert.ok((await cash.json()).events.some((e: any) => e.reference === 'API-CASH-CAPITAL'));
  const audit = JSON.stringify(await (await request('/audit', admin)).json());
  assert.match(audit, /relatedOperations/);
  assert.match(audit, /API-CASH-CAPITAL/);
});
