import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { demoDataset } from '../server/demo.ts';
import { entrySchema, type Dataset } from '../server/model.ts';
import type {
  Lead,
  ForecastParams,
  ForecastSnapshot,
  CashPlan,
  CashMovement,
} from '../server/planning-model.ts';
import {
  forecast,
  forecastAccuracy,
  validateLead,
  validateCashPlan,
  cashForecast,
  addCashMovement,
  remainingExpense,
  monthRange,
  businessDate,
} from '../server/planning.ts';
import { calculateYear } from '../server/engine.ts';
import { addSettlement, addDoctorPayment, replaceMasters } from '../server/workflows.ts';
const fixture = () => {
  const d = demoDataset();
  d.entries = [];
  d.operations = [];
  d.closes = [];
  return d;
};
const lead = (extra: Partial<Lead> = {}): Lead => ({
  id: randomUUID(),
  kind: 'lead',
  createdBy: 'maker',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  patientReference: 'Synthetic prospect',
  contact: '',
  hospital: 'CSH',
  procedure: 'RFA',
  expectedDate: '2026-06-20',
  stage: 'Qualified',
  probability: '0.5',
  approvalAmount: '10000',
  consumablesRate: '0.2',
  collectionLagDays: 0,
  owner: 'Synthetic Finance',
  source: 'Synthetic referral',
  reason: 'Test planning record',
  ...extra,
});
const params = (extra: Partial<ForecastParams> = {}): ForecastParams => ({
  name: 'Synthetic plan',
  asOfDate: '2026-06-01',
  months: 1,
  probabilityMultiplier: '1',
  revenueMultiplier: '1',
  monthly: [{ month: '2026-06', fixedCost: '1000', variableCostPerCase: '50', capacity: 0 }],
  reason: 'Synthetic planning assumptions',
  ...extra,
});
const bill = (extra: Record<string, unknown> = {}) =>
  entrySchema.parse({
    id: randomUUID(),
    kind: 'bill',
    date: '2026-06-20',
    version: 'Actual',
    hospital: 'CSH',
    patient: 'Synthetic prospect',
    procedure: 'RFA',
    doctor: 'Dr. Tahsin',
    billType: 'IP',
    payment: 'Cash',
    invoice: randomUUID(),
    gross: '10000',
    consumables: '1000',
    pharmacyLab: '1000',
    regime: 'Standard',
    components: {},
    visits: 1,
    vat: '0',
    tax: '0',
    ...extra,
  });
const cashPlan = (extra: Partial<CashPlan> = {}): CashPlan => ({
  id: randomUUID(),
  kind: 'cash_plan',
  createdBy: 'maker',
  createdAt: '2026-06-01T00:00:00Z',
  date: '2026-06-25',
  direction: 'In',
  amount: '100',
  target: 'other',
  description: 'Synthetic capital plan',
  status: 'Open',
  reason: 'Synthetic cash assumption',
  ...extra,
});
test('weighted forecast uses effective doctor and Swizton shares, explicit costs and capacity', () => {
  const d = fixture(),
    l = lead();
  d.operations = [l];
  const r = forecast(d, params()),
    m = r.rows[0];
  assert.equal(m.swizton, '540.000000');
  assert.equal(m.pipelineSwizton, '540.000000');
  assert.equal(m.weightedPipelineCases, '0.5000');
  assert.equal(m.expense, '1025.000000');
  assert.equal(m.profit, '-485.000000');
  assert.equal(m.capacityGap, '0.5000');
  assert.equal(m.inrLakh, '0.13500000');
  assert.equal(r.leads[0].approvalAmount, '10000');
  assert.equal(r.leads[0].rates.share, '0.45');
});
test('probability sensitivity caps at one and revenue sensitivity is separate', () => {
  const d = fixture();
  d.operations = [lead()];
  const r = forecast(d, params({ probabilityMultiplier: '3', revenueMultiplier: '2' }));
  assert.equal(r.rows[0].weightedPipelineCases, '1.0000');
  assert.equal(r.rows[0].swizton, '2160.000000');
  assert.equal(r.leads[0].baseProbability, '0.5');
});
test('Won and Lost leads are excluded and completed leads must link uniquely to Actual', () => {
  const d = fixture(),
    b = bill();
  d.entries = [b];
  const won = lead({ stage: 'Won', probability: '1', linkedBillId: b.id }),
    lost = lead({ stage: 'Lost', probability: '0' });
  d.operations = [won, lost];
  validateLead(d, won);
  const r = forecast(d, params({ asOfDate: '2026-06-30' }));
  assert.equal(r.rows[0].pipelineSwizton, '0.000000');
  assert.equal(r.rows[0].actualSwizton, '945.000000');
  assert.equal(r.rows[0].expectedCases, '1.0000');
  assert.throws(() => validateLead(d, { ...won, id: randomUUID() }), /another won/);
  assert.throws(
    () => validateLead(d, { ...won, stage: 'Qualified', linkedBillId: undefined }),
    /stay linked/,
  );
  assert.throws(() => validateLead(d, lead({ stage: 'Won' })), /existing Actual/);
});
test('overdue open leads are not silently rolled into forecast procedures', () => {
  const d = fixture();
  d.operations = [lead({ expectedDate: '2026-06-01' })];
  const r = forecast(d, params({ asOfDate: '2026-06-02' }));
  assert.equal(r.rows[0].pipelineSwizton, '0.000000');
  assert.ok(r.warnings.some((w) => w.includes('overdue')));
});
test('recognition timing and case-capacity timing remain separate', () => {
  const d = fixture();
  d.operations = [lead({ recognitionMonth: '2026-07' })];
  const r = forecast(
    d,
    params({
      months: 2,
      monthly: [
        { month: '2026-06', fixedCost: '0', variableCostPerCase: '0', capacity: 10 },
        { month: '2026-07', fixedCost: '0', variableCostPerCase: '0', capacity: 10 },
      ],
    }),
  );
  assert.equal(r.rows[0].expectedCases, '0.5000');
  assert.equal(r.rows[0].swizton, '0.000000');
  assert.equal(r.rows[1].expectedCases, '0.0000');
  assert.equal(r.rows[1].swizton, '540.000000');
});
test('closed months retain Actual, future Actual dates are not leaked into open forecasts', () => {
  const d = fixture();
  d.entries = [bill()];
  d.operations = [lead()];
  const open = forecast(d, params());
  assert.equal(open.rows[0].actualSwizton, '0.000000');
  d.closes = [
    { month: '2026-06', locked: true, by: 'maker', at: 'test', reason: 'Synthetic close' },
  ];
  const locked = forecast(d, params());
  assert.equal(locked.rows[0].basis, 'Locked Actual');
  assert.equal(locked.rows[0].swizton, '945.000000');
  assert.equal(locked.rows[0].pipelineSwizton, '0.000000');
  assert.equal(locked.rows[0].expense, '0.000000');
});
test('missing FX is explicit in an AED-only future forecast; missing contracts are never fabricated', () => {
  const d = fixture();
  d.masters.fx = [];
  d.operations = [lead()];
  const r = forecast(d, params());
  assert.equal(r.rows[0].inrLakh, null);
  assert.equal(r.rows[0].inrPerAed, null);
  assert.ok(r.rows[0].warnings.some((w) => w.includes('FX')));
  d.masters.rules = [];
  assert.throws(() => forecast(d, params()), /effective share rule/);
});
test('forecast month assumptions must cover horizon exactly and month ranges cross year boundaries', () => {
  assert.deepEqual(monthRange('2026-12', 3), ['2026-12', '2027-01', '2027-02']);
  assert.throws(() => forecast(fixture(), params({ monthly: [] })), /exactly one/);
  assert.equal(businessDate('2026-06-01T20:00:00Z'), '2026-06-02');
});
test('forecast accuracy excludes open, hypothetical and already closed rows and handles zero denominators', () => {
  const d = fixture();
  d.operations = [lead()];
  const p = params(),
    result = forecast(d, p),
    s: ForecastSnapshot = {
      id: randomUUID(),
      kind: 'forecast_snapshot',
      createdBy: 'maker',
      createdAt: '2026-06-01T00:00:00Z',
      capturedDate: '2026-06-01',
      sourceRevision: 0,
      version: 1,
      params: p,
      result,
    };
  const frozen = JSON.stringify(s);
  assert.equal(forecastAccuracy(d, s).summary.scoredMonths, 0);
  d.closes = [
    { month: '2026-06', locked: true, by: 'checker', at: 'test', reason: 'Synthetic close' },
  ];
  const zero = forecastAccuracy(d, s);
  assert.equal(zero.summary.scoredMonths, 1);
  assert.equal(zero.summary.wape, null);
  assert.equal(zero.rows[0].percentageError, null);
  d.entries = [bill()];
  const scored = forecastAccuracy(d, s);
  assert.equal(scored.rows[0].error, '-405.000000');
  assert.equal(scored.summary.mae, '405.00');
  assert.equal(scored.summary.bias, '-405.00');
  assert.equal(JSON.stringify(s), frozen);
  assert.equal(forecastAccuracy(d, { ...s, capturedDate: '2026-07-01' }).summary.scoredMonths, 0);
  assert.equal(
    forecastAccuracy(d, {
      ...s,
      result: { ...s.result, rows: s.result.rows.map((r) => ({ ...r, basis: 'Locked Actual' })) },
    }).summary.scoredMonths,
    0,
  );
});
test('cash forecast counts gross paid prepaids and wallet topups once, excludes amortisation and ad spend', () => {
  const d = fixture();
  d.entries = [
    entrySchema.parse({
      id: randomUUID(),
      kind: 'expense',
      date: '2026-01-01',
      version: 'Actual',
      head: 'Trade License',
      amount: '1200',
      currency: 'AED',
      basis: 'Accrual',
      paid: true,
      remarks: 'Synthetic annual cost',
      coverageStart: '2026-01-01',
      coverageEnd: '2026-12-31',
    }),
    entrySchema.parse({
      id: randomUUID(),
      kind: 'wallet',
      date: '2026-01-02',
      version: 'Actual',
      action: 'topup',
      amount: '500',
      remarks: 'Synthetic topup',
    }),
    entrySchema.parse({
      id: randomUUID(),
      kind: 'wallet',
      date: '2026-01-03',
      version: 'Actual',
      action: 'spend',
      amount: '200',
      remarks: 'Synthetic spend',
    }),
    entrySchema.parse({
      id: randomUUID(),
      kind: 'receipt',
      date: '2026-01-04',
      version: 'Actual',
      source: 'OP Consultation',
      amount: '100',
      patient: 'Synthetic',
      visits: 1,
    }),
  ];
  addDoctorPayment(d, {
    id: randomUUID(),
    kind: 'doctor_payment',
    createdBy: 'maker',
    createdAt: 'test',
    doctor: 'Tahsin',
    period: '2026-01',
    date: '2026-01-06',
    amount: '20',
    reference: 'SAMPLE-DOC-PAY',
    reason: 'Synthetic fee payment',
  });
  const r = cashForecast(d, '2026-01-01', 3, '0', false, 0);
  assert.equal(r.rows[0].inflow, '100.00');
  assert.equal(r.rows[0].outflow, '1720.00');
  assert.equal(r.rows[0].closing, '-1620.00');
  assert.equal(r.rows[1].outflow, '0.00');
  assert.equal(cashForecast(d, '2026-01-06', 1, '100', false, 0).rows[0].closing, '80.00');
});
test('weighted pipeline cash uses full collections and separately delayed doctor payouts', () => {
  const d = fixture();
  d.operations = [lead()];
  const before = JSON.stringify(d.entries);
  const r = cashForecast(d, '2026-06-01', 2, '0', true, 40);
  assert.equal(r.rows[0].inflow, '1800.00');
  assert.equal(r.rows[0].outflow, '0.00');
  assert.equal(r.rows[1].outflow, '1260.00');
  assert.equal(r.rows[1].closing, '540.00');
  assert.equal(JSON.stringify(d.entries), before);
});
test('cash plans reserve source balances and are capped after external collections without duplicating cash', () => {
  const d = fixture(),
    b = bill({ date: '2026-06-01' });
  d.entries = [b];
  const p = cashPlan({ target: 'bill', linkedId: b.id, amount: '3150' });
  validateCashPlan(d, p);
  d.operations = [p];
  assert.throws(
    () => validateCashPlan(d, cashPlan({ target: 'bill', linkedId: b.id, amount: '1' })),
    /exceed/,
  );
  addSettlement(d, {
    id: randomUUID(),
    kind: 'settlement',
    billId: b.id,
    date: '2026-06-10',
    amount: '100',
    reference: 'SAMPLE-COLLECT',
    reason: 'Synthetic external collection',
    createdBy: 'maker',
    createdAt: 'test',
  });
  const r = cashForecast(d, '2026-06-01', 1, '0', false, 0);
  assert.equal(r.rows[0].inflow, '3150.00');
  assert.ok(r.warnings.some((w) => w.includes('capped')));
  assert.equal(p.amount, '3150');
  assert.equal(p.status, 'Open');
});
test('unpaid expense cash payments reduce book balances and never create a second P&L expense', () => {
  const d = fixture(),
    e = entrySchema.parse({
      id: randomUUID(),
      kind: 'expense',
      date: '2026-06-01',
      version: 'Actual',
      head: 'Bank Charges',
      amount: '2500',
      currency: 'INR',
      basis: 'Accrual',
      paid: false,
      remarks: 'Synthetic payable',
      coverageStart: null,
      coverageEnd: null,
    });
  d.entries = [e];
  const before = calculateYear(d, 2026).total,
    move: CashMovement = {
      id: randomUUID(),
      kind: 'cash_movement',
      date: '2026-06-10',
      direction: 'Out',
      amount: '60',
      category: 'Expense payment',
      linkedExpenseId: e.id,
      reference: 'SAMPLE-EXP-PAY',
      reason: 'Synthetic partial payment',
      createdBy: 'maker',
      createdAt: 'test',
    };
  assert.equal(remainingExpense(d, e.id).toFixed(2), '100.00');
  addCashMovement(d, move);
  assert.equal(remainingExpense(d, e.id).toFixed(2), '40.00');
  assert.deepEqual(calculateYear(d, 2026).total, before);
  assert.throws(
    () => addCashMovement(d, { ...move, id: randomUUID(), reference: 'overpay', amount: '41' }),
    /exceeds/,
  );
  assert.throws(() => addCashMovement(d, { ...move, id: randomUUID() }), /reference/);
  const next = structuredClone(d.masters);
  next.fx.find((f) => f.month === '2026-06')!.inrPerAed = '50';
  assert.throws(() => replaceMasters(d, next), /overpay an expense/);
});
test('closed cash months reject cash movements and overdue plans remain dated in their source', () => {
  const d = fixture();
  d.closes = [
    { month: '2026-06', locked: true, by: 'checker', at: 'test', reason: 'Synthetic close' },
  ];
  assert.throws(
    () =>
      addCashMovement(d, {
        id: randomUUID(),
        kind: 'cash_movement',
        date: '2026-06-10',
        direction: 'In',
        amount: '100',
        category: 'Capital / financing',
        reference: 'SAMPLE-CAPITAL',
        reason: 'Synthetic bank item',
        createdBy: 'maker',
        createdAt: 'test',
      }),
    /locked/,
  );
  d.operations = [cashPlan({ date: '2026-05-01' })];
  const r = cashForecast(d, '2026-06-01', 1, '0', false, 0);
  assert.equal(r.rows[0].inflow, '100.00');
  assert.ok(r.warnings.some((w) => w.includes('overdue')));
  assert.equal(d.operations[0].kind === 'cash_plan' && d.operations[0].date, '2026-05-01');
});
test('active pipeline master references cannot silently disappear', () => {
  const d = fixture();
  d.operations = [lead()];
  const next = structuredClone(d.masters);
  next.procedures = next.procedures.filter((p) => p !== 'RFA');
  assert.throws(() => replaceMasters(d, next), /configured procedure/);
});

test('linked cash plans cannot forecast payments before the source transaction or fee period', () => {
  const d = fixture(),
    b = bill();
  d.entries.push(b);
  const p: CashPlan = {
    id: randomUUID(),
    kind: 'cash_plan',
    createdBy: 'maker',
    createdAt: '2026-06-01T00:00:00Z',
    date: '2026-06-01',
    direction: 'In',
    amount: '100',
    target: 'bill',
    linkedId: b.id,
    description: 'Synthetic collection',
    status: 'Open',
    reason: 'Test source date validation',
  };
  assert.throws(() => validateCashPlan(d, p), /precede/);
  assert.throws(
    () =>
      validateCashPlan(d, {
        ...p,
        target: 'doctor',
        linkedId: undefined,
        direction: 'Out',
        doctor: 'Tahsin',
        period: '2026-07',
      }),
    /Future-period/,
  );
});
