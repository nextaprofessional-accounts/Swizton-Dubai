import { closeReadiness } from '../server/workflows.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { demoDataset } from '../server/demo.ts';
import {
  averageFx,
  observationsFromCsv,
  decideFx,
  approvedFx,
  proposeException,
  decideException,
  financeReadiness,
  signoffFinance,
  canonical,
} from '../server/finance.ts';
import type {
  FxInput,
  FxProposal,
  FinanceException,
  FinanceSignoff,
} from '../server/finance-model.ts';
import type { WorkbookReview } from '../server/workflow-model.ts';
const input = (extra: Partial<FxInput> = {}): FxInput => ({
  month: '2026-01',
  method: 'Daily average',
  aedPerUsd: '3.6725',
  observations: [
    { date: '2026-01-02', rate: '25.4' },
    { date: '2026-01-05', rate: '25.6' },
  ],
  source: 'Synthetic publication reference',
  reason: 'Synthetic Finance verification',
  ...extra,
});
function fixture() {
  const d = demoDataset();
  d.entries = [];
  d.operations = [];
  d.closes = [];
  return d;
}
function proposal(d: ReturnType<typeof fixture>, extra: Partial<FxInput> = {}): FxProposal {
  const p = input(extra),
    op: FxProposal = {
      id: randomUUID(),
      kind: 'fx_proposal',
      createdBy: 'maker',
      createdAt: new Date().toISOString(),
      input: p,
      calculated: averageFx(p),
      previous: structuredClone(d.masters.fx.find((f) => f.month === p.month) ?? null),
      status: 'Pending',
    };
  d.operations!.push(op);
  return op;
}
function workbook(d: ReturnType<typeof fixture>): WorkbookReview {
  const w: WorkbookReview = {
    id: randomUUID(),
    kind: 'workbook_review',
    createdBy: 'maker',
    createdAt: new Date().toISOString(),
    name: 'Synthetic controls',
    sourceSha256: 'synthetic-only',
    storageId: 'sample',
    inventory: [],
    issues: [],
    sourceChecks: [],
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
  d.operations!.push(w);
  return w;
}
function approveYear(d: ReturnType<typeof fixture>) {
  for (let i = 1; i <= 12; i++) {
    const p = proposal(d, {
      month: `2026-${String(i).padStart(2, '0')}`,
      method: 'Provided monthly average',
      inrPerAed: '25.5',
      observations: [],
    });
    decideFx(d, p.id, 'reviewer', true, 'Independent source verification');
  }
}
const sign = (w: WorkbookReview, extra: Partial<FinanceSignoff> = {}): FinanceSignoff => ({
  id: randomUUID(),
  kind: 'finance_signoff',
  createdBy: 'reviewer',
  createdAt: new Date().toISOString(),
  workbookId: w.id,
  year: 2026,
  mode: 'Reconciled',
  reason: 'Signed synthetic control reconciliation',
  fingerprint: '',
  summary: { monthsCompared: 0, differences: 0, retainedExceptions: 0, reviewedExceptions: 0 },
  ...extra,
});
test('monthly FX uses exact equal-weight observations, explicit cross units and six-decimal rounding', () => {
  const a = averageFx(input());
  assert.equal(a.inrPerAed, '25.500000');
  assert.equal(a.count, 2);
  assert.equal(a.firstDate, '2026-01-02');
  assert.equal(a.lastDate, '2026-01-05');
  const cross = averageFx(
    input({
      method: 'Cross-rate average',
      observations: [
        { date: '2026-01-02', rate: '91.8125' },
        { date: '2026-01-05', rate: '95.485' },
      ],
    }),
  );
  assert.equal(cross.inrPerAed, '25.500000');
  assert.equal(
    averageFx(
      input({ method: 'Provided monthly average', inrPerAed: '25.1234567', observations: [] }),
    ).inrPerAed,
    '25.123457',
  );
});
test('FX preparation rejects invalid dates, duplicates, empty samples, mixed methods and rounded-zero rates', () => {
  for (const observations of [
    [],
    [{ date: '2026-02-01', rate: '25' }],
    [{ date: '2026-01-32', rate: '25' }],
    [
      { date: '2026-01-02', rate: '25' },
      { date: '2026-01-02', rate: '26' },
    ],
  ])
    assert.throws(() => averageFx(input({ observations })));
  assert.throws(() => averageFx(input({ inrPerAed: '25' })), /manual/);
  assert.throws(
    () => averageFx(input({ method: 'Provided monthly average', inrPerAed: '25' })),
    /cannot include/,
  );
  assert.throws(
    () =>
      averageFx(
        input({ method: 'Provided monthly average', observations: [], inrPerAed: '0.00000001' }),
      ),
    /rounds to zero/,
  );
  assert.throws(
    () => averageFx(input({ observations: [{ date: '2026-01-01', rate: '0' }] })),
    /positive/,
  );
});
test('CSV evidence requires exact headers, bounded daily rows and never executes formulas', () => {
  assert.deepEqual(observationsFromCsv('date,rate\n2026-01-02,25.4'), [
    { date: '2026-01-02', rate: '25.4' },
  ]);
  assert.throws(() => observationsFromCsv('date,rate,rate\n2026-01-02,25,26'), /headers/);
  assert.throws(() => observationsFromCsv('date,value\n2026-01-02,25'), /headers/);
  assert.throws(() =>
    averageFx(input({ observations: observationsFromCsv('date,rate\n2026-01-02,=SUM(A1)') })),
  );
});
test('only independent approval applies a central FX rate; approval provenance is verifiable', () => {
  const d = fixture(),
    p = proposal(d),
    before = structuredClone(d.masters.fx);
  assert.deepEqual(d.masters.fx, before);
  assert.equal(approvedFx(d, '2026-01'), false);
  assert.throws(() => decideFx(d, p.id, 'maker', true, 'Self approval'), /independent/);
  decideFx(d, p.id, 'reviewer', true, 'Verified publication and sample coverage');
  assert.equal(d.masters.fx.find((f) => f.month === '2026-01')!.inrPerAed, '25.500000');
  assert.equal(approvedFx(d, '2026-01'), true);
  assert.throws(() => decideFx(d, p.id, 'reviewer', true, 'Repeat approval'), /Pending/);
  d.masters.fx.find((f) => f.month === '2026-01')!.inrPerAed = '26';
  assert.equal(approvedFx(d, '2026-01'), false);
});
test('stale or locked FX approval cannot restate rates and rejection does not change masters', () => {
  const d = fixture(),
    p = proposal(d);
  d.closes.push({
    month: '2026-01',
    locked: true,
    by: 'closer',
    at: 'now',
    reason: 'Closed test month',
  });
  assert.throws(() => decideFx(d, p.id, 'reviewer', true, 'Source verified'), /locked/);
  assert.equal(p.status, 'Pending');
  d.closes = [];
  d.masters.fx.find((f) => f.month === '2026-01')!.source = 'Changed external reference';
  assert.throws(() => decideFx(d, p.id, 'reviewer', true, 'Source verified'), /Conflict/);
  const before = structuredClone(d.masters.fx);
  decideFx(d, p.id, 'reviewer', false, 'Reject outdated proposal');
  assert.deepEqual(d.masters.fx, before);
});
test('fresh organisations can approve one rate at a time without invented missing-month rates', () => {
  const d = fixture();
  d.masters.fx = [];
  const p = proposal(d);
  decideFx(d, p.id, 'reviewer', true, 'Source publication verified');
  assert.equal(d.masters.fx.length, 1);
  assert.equal(approvedFx(d, '2026-02'), false);
});
test('exception review preserves baseline and cannot approve itself, duplicate findings or fake adjustment links', () => {
  const d = fixture(),
    w = workbook(d);
  w.issues.push({
    code: 'FORECAST_LINK',
    severity: 'warning',
    cells: ['2026!AZ15'],
    detail: 'Synthetic source finding',
  });
  const before = structuredClone(w),
    e: FinanceException = {
      id: randomUUID(),
      kind: 'finance_exception',
      createdBy: 'maker',
      createdAt: new Date().toISOString(),
      workbookId: w.id,
      itemKey: 'issue:0',
      disposition: 'Retain original',
      evidence: 'Synthetic source evidence reference',
      reason: 'Preserve pending restatement',
      status: 'Pending',
    };
  proposeException(d, e);
  assert.throws(() => proposeException(d, { ...e, id: randomUUID() }), /already/);
  assert.throws(() => decideException(d, e.id, 'maker', true, 'Own approval'), /independent/);
  decideException(d, e.id, 'reviewer', true, 'Original preservation verified');
  assert.deepEqual(w, before);
  assert.equal(d.entries.length, 0);
  w.issues.push({ ...w.issues[0] });
  assert.throws(
    () =>
      proposeException(d, {
        ...e,
        id: randomUUID(),
        itemKey: 'issue:1',
        disposition: 'Linked approved adjustment',
        adjustmentId: randomUUID(),
      }),
    /posted/,
  );
});
test('legacy FX, unmatched values, unavailable baselines and unreviewed evidence block reconciliation', () => {
  const d = fixture(),
    w = workbook(d);
  w.baseline[0].profit = '5';
  w.baseline.pop();
  w.sourceChecks!.push({
    kind: 'bill',
    source: 'Synthetic!Q3',
    status: 'blocked',
    reason: 'Missing original input',
  });
  const r = financeReadiness(d, w.id, 2026);
  assert.equal(r.summary.monthsCompared, 11);
  assert.equal(r.summary.differences, 1);
  assert.ok(r.reviewBlockers.some((b) => b.includes('12 monthly FX')));
  assert.equal(r.exceptions.length, 1);
  assert.throws(() => signoffFinance(d, sign(w)), /findings/);
  assert.equal(r.comparisons.at(-1)!.lines[0].baseline, null);
});
test('signoffs freeze evidence, reject duplicates and self-signing, survive ordering changes and become stale on financial change', () => {
  const d = fixture(),
    w = workbook(d);
  approveYear(d);
  assert.deepEqual(financeReadiness(d, w.id, 2026).reconcileBlockers, []);
  assert.throws(() => signoffFinance(d, sign(w, { createdBy: 'maker' })), /independent/);
  const s = sign(w);
  signoffFinance(d, s);
  assert.equal(financeReadiness(d, w.id, 2026).signoffs[0].current, true);
  assert.throws(() => signoffFinance(d, sign(w)), /already/);
  const reordered = JSON.parse(canonical(d));
  assert.equal(financeReadiness(reordered, w.id, 2026).signoffs[0].current, true);
  d.masters.targets[0].cases += 1;
  assert.equal(financeReadiness(d, w.id, 2026).signoffs[0].current, false);
});
test('review-with-exceptions is distinct from reconciliation and never erases retained discrepancies', () => {
  const d = fixture(),
    w = workbook(d);
  approveYear(d);
  w.baseline[0].profit = '5';
  w.issues.push({
    code: 'ORIGINAL_EXCEPTION',
    severity: 'warning',
    cells: ['2026!G14'],
    detail: 'Synthetic retained finding',
  });
  const e: FinanceException = {
    id: randomUUID(),
    kind: 'finance_exception',
    createdBy: 'maker',
    createdAt: new Date().toISOString(),
    workbookId: w.id,
    itemKey: 'issue:0',
    disposition: 'Retain original',
    evidence: 'Original baseline verified and retained',
    reason: 'Preserve pending Finance restatement',
    status: 'Pending',
  };
  proposeException(d, e);
  decideException(d, e.id, 'reviewer', true, 'Independent exception acceptance');
  assert.throws(() => signoffFinance(d, sign(w)), /differences/);
  const s = sign(w, { mode: 'Reviewed with exceptions' });
  signoffFinance(d, s);
  assert.equal(s.summary.differences, 1);
  assert.equal(s.summary.retainedExceptions, 1);
  assert.equal(w.baseline[0].profit, '5');
  assert.equal(d.entries.length, 0);
});

test('a pending financial adjustment blocks new sign-off and invalidates an earlier review state', () => {
  const d = fixture(),
    w = workbook(d);
  approveYear(d);
  const s = sign(w);
  signoffFinance(d, s);
  d.operations!.push({
    id: randomUUID(),
    kind: 'adjustment_request',
    createdBy: 'maker',
    createdAt: new Date().toISOString(),
    status: 'Pending',
    reason: 'Pending synthetic financial correction',
    entry: {
      id: randomUUID(),
      kind: 'adjustment',
      version: 'Actual',
      date: '2026-01-20',
      line: 'Administration Expense',
      amount: '10',
      reason: 'Pending synthetic financial correction',
    },
  });
  const r = financeReadiness(d, w.id, 2026);
  assert.ok(r.reviewBlockers.some((b) => b.includes('adjustments')));
  assert.equal(r.signoffs[0].current, false);
  assert.throws(() => signoffFinance(d, sign(w)), /adjustments/);
});

test('pending replacement FX blocks close and sign-off even when the prior rate is approved', () => {
  const d = fixture(),
    w = workbook(d);
  approveYear(d);
  signoffFinance(d, sign(w));
  assert.equal(closeReadiness(d, '2026-01').canClose, true);
  proposal(d, { method: 'Provided monthly average', inrPerAed: '26', observations: [] });
  assert.equal(approvedFx(d, '2026-01'), true);
  assert.equal(closeReadiness(d, '2026-01').canClose, false);
  const r = financeReadiness(d, w.id, 2026);
  assert.equal(r.signoffs[0].current, false);
  assert.ok(r.reviewBlockers.some((b) => b.includes('FX proposals')));
  assert.throws(() => signoffFinance(d, sign(w)), /FX proposals/);
});
