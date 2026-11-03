import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { demoDataset } from '../server/demo.ts';
import { calculateYear, billShare } from '../server/engine.ts';
import {
  replaceMasters,
  reviewAdjustment,
  addSettlement,
  receivables,
  closeReadiness,
} from '../server/workflows.ts';
import { previewBills, validateXlsxArchive } from '../server/imports.ts';
import { entrySchema } from '../server/model.ts';
test('independent review posts an adjustment exactly once and month close blocks pending requests', () => {
  const d = demoDataset(),
    id = randomUUID(),
    entry = entrySchema.parse({
      id: randomUUID(),
      kind: 'adjustment',
      date: '2026-06-01',
      version: 'Actual',
      line: 'Marketing Expense',
      amount: '10',
      reason: 'Documented correction',
    }) as any;
  d.operations = [
    {
      id,
      kind: 'adjustment_request',
      entry,
      reason: 'Documented correction',
      status: 'Pending',
      createdBy: 'maker',
      createdAt: 'test',
    },
  ];
  assert.ok(!closeReadiness(d, '2026-06').canClose);
  const before = d.entries.length;
  assert.throws(() => reviewAdjustment(d, id, 'maker', true, 'Self review'), /different Admin/);
  reviewAdjustment(d, id, 'checker', true, 'Reviewed evidence');
  assert.equal(d.entries.length, before + 1);
  assert.ok(closeReadiness(d, '2026-06').canClose);
  assert.throws(() => reviewAdjustment(d, id, 'checker', true, 'Retry approval'), /Pending/);
});
test('a lock added after submission prevents posting without mutating review state', () => {
  const d = demoDataset(),
    id = randomUUID();
  d.operations = [
    {
      id,
      kind: 'adjustment_request',
      entry: {
        id: randomUUID(),
        kind: 'adjustment',
        date: '2026-06-01',
        version: 'Actual',
        line: 'Marketing Expense',
        amount: '10',
        reason: 'Test request',
      },
      reason: 'Test request',
      status: 'Pending',
      createdBy: 'maker',
      createdAt: 'test',
    },
  ];
  d.closes = [{ month: '2026-06', locked: true, by: 'checker', at: 'test', reason: 'Test lock' }];
  assert.throws(() => reviewAdjustment(d, id, 'checker', true, 'Review after close'), /locked/);
  assert.ok(d.operations[0].kind === 'adjustment_request');
  assert.equal(d.operations[0].status, 'Pending');
});
test('future masters can be added without altering locked financial values', () => {
  const d = demoDataset();
  d.closes = [{ month: '2026-06', locked: true, by: 'checker', at: 'test', reason: 'Test lock' }];
  const next = structuredClone(d.masters);
  next.procedures.push('Future Procedure');
  next.fx.push({
    month: '2027-01',
    inrPerAed: '27',
    aedPerUsd: '3.6725',
    source: 'Synthetic source',
  });
  replaceMasters(d, next);
  assert.ok(d.masters.procedures.includes('Future Procedure'));
  const bad = structuredClone(next);
  bad.fx.find((f) => f.month === '2026-06')!.inrPerAed = '99';
  assert.throws(() => replaceMasters(d, bad), /locked month/);
});
test('collections clear receivables without duplicating revenue, protect references and reject overpayment', () => {
  const d = demoDataset(),
    bill = d.entries.find((e) => e.kind === 'bill')!;
  const before = calculateYear(d, 2026).total;
  const payment = {
    id: randomUUID(),
    kind: 'settlement' as const,
    billId: bill.id,
    date: '2026-07-10',
    amount: '100',
    reference: 'SAMPLE-PAY-1',
    reason: 'Test collection',
    createdBy: 'maker',
    createdAt: 'test',
  };
  addSettlement(d, payment);
  const row = receivables(d, '2026-12-31').find((r) => r.id === bill.id)!;
  assert.equal(row.paid, '100.00');
  assert.deepEqual(calculateYear(d, 2026).total, before);
  assert.throws(
    () =>
      addSettlement(d, { ...payment, id: randomUUID(), reference: 'other', amount: '99999999' }),
    /remaining/,
  );
  assert.throws(() => addSettlement(d, { ...payment, id: randomUUID() }), /reference/);
  assert.equal(receivables(d, '2026-06-30').find((r) => r.id === bill.id)!.paid, '0.00');
});
test('preview checks all rows without posting valid or invalid rows', () => {
  const d = demoDataset(),
    before = d.entries.length;
  const rows = previewBills(
    [
      {
        date: '2026-07-10',
        hospital: 'Missing hospital',
        patient: 'Synthetic',
        procedure: 'RFA',
        doctor: 'Dr. Tahsin',
        billType: 'IP',
        payment: 'Cash',
        invoice: 'TEST',
        gross: '1000',
        consumables: '0',
        pharmacyLab: '0',
        regime: 'Standard',
      },
    ],
    d,
  );
  assert.equal(rows.length, 1);
  assert.ok(rows[0].errors.length);
  assert.equal(d.entries.length, before);
});
test('archive validation rejects non-XLSX input before decompressing', () => {
  assert.throws(() => validateXlsxArchive(Buffer.from('not a spreadsheet')), /XLSX ZIP/);
});
test('cost classification supports true fixed-cost breakeven and avoids hiding unclassified spend', async () => {
  const { analytics } = await import('../server/analytics.ts');
  const d = demoDataset();
  const result = analytics(d, '2026-06');
  assert.ok(result.costs.fixedCostBreakeven);
  assert.equal(result.costs.unclassifiedCount, 0);
  d.masters.expenseHeads = d.masters.expenseHeads.map((h) => ({ ...h, costBehavior: undefined }));
  const unclassified = analytics(d, '2026-06');
  assert.equal(unclassified.costs.fixedCostBreakeven, null);
  assert.ok(unclassified.costs.unclassifiedCount > 0);
});
test('case-linked costs are attributed directly without changing the P&L expense total', async () => {
  const { analytics } = await import('../server/analytics.ts');
  const d = demoDataset();
  const bill = d.entries.find((e) => e.kind === 'bill' && e.date.startsWith('2026-06'))!;
  d.entries.push(
    entrySchema.parse({
      id: randomUUID(),
      kind: 'expense',
      caseId: bill.id,
      date: '2026-06-15',
      version: 'Actual',
      head: 'Referral Marketing',
      amount: '100',
      currency: 'AED',
      basis: 'Actual',
      paid: true,
      remarks: 'Synthetic case-linked expense',
      coverageStart: null,
      coverageEnd: null,
    }),
  );
  const result = analytics(d, '2026-06');
  assert.equal(
    result.ranking.find(
      (r) => bill.kind === 'bill' && r.hospital === bill.hospital && r.procedure === bill.procedure,
    )!.directExpense,
    '100.00',
  );
});
test('prepaid drilldown displays the recognised contribution instead of its full annual cost', async () => {
  const { explain } = await import('../server/explain.ts');
  const d = demoDataset();
  const detail = explain(d, 2026, 'Administration Expense', '2026-06');
  assert.equal(detail.rows.length, 1);
  assert.equal(Number(detail.rows[0].aed).toFixed(2), '1758.33');
  assert.equal(Number(detail.total.aed).toFixed(2), '1758.33');
  assert.equal(Number(detail.roundingResidual), 0);
});
test('professional fee payments reduce payables without double-counting expense', async () => {
  const { doctorPayables, addDoctorPayment } = await import('../server/workflows.ts');
  const d = demoDataset(),
    before = calculateYear(d, 2026).total,
    dues = doctorPayables(d, '2026-06'),
    tahsin = dues.find((p) => p.doctor === 'Tahsin')!;
  const payment = {
    id: randomUUID(),
    kind: 'doctor_payment' as const,
    doctor: 'Tahsin' as const,
    period: '2026-06',
    date: '2026-07-10',
    amount: '100',
    reference: 'DOCTOR-SAMPLE-1',
    reason: 'Synthetic bank payout',
    createdBy: 'maker',
    createdAt: 'test',
  };
  addDoctorPayment(d, payment);
  const after = doctorPayables(d, '2026-06').find((p) => p.doctor === 'Tahsin')!;
  assert.equal(after.paid, '100.00');
  assert.equal(Number(after.outstanding), Number(tahsin.outstanding) - 100);
  assert.deepEqual(calculateYear(d, 2026).total, before);
  assert.throws(
    () =>
      addDoctorPayment(d, {
        ...payment,
        id: randomUUID(),
        amount: '99999999',
        reference: 'overpay',
      }),
    /remaining accrued/,
  );
  assert.throws(() => addDoctorPayment(d, { ...payment, id: randomUUID() }), /reference/);
});
test('share changes cannot reduce an already collected bill below its settlements', () => {
  const d = demoDataset(),
    bill = d.entries.find((e) => e.kind === 'bill')!;
  addSettlement(d, {
    id: randomUUID(),
    kind: 'settlement',
    billId: bill.id,
    date: '2026-07-10',
    amount: '100',
    reference: 'RATE-GUARD-1',
    reason: 'Synthetic settlement',
    createdBy: 'maker',
    createdAt: 'test',
  });
  const next = structuredClone(d.masters);
  next.rules.forEach((r) => (r.share = '0'));
  assert.throws(() => replaceMasters(d, next), /over-settle/);
});
test('approval cannot reduce accrued doctor fees below payments already made', async () => {
  const { addDoctorPayment } = await import('../server/workflows.ts');
  const d = demoDataset();
  addDoctorPayment(d, {
    id: randomUUID(),
    kind: 'doctor_payment',
    doctor: 'Chinmay',
    period: '2026-06',
    date: '2026-07-10',
    amount: '100',
    reference: 'PROTECT-PAID-FEE',
    reason: 'Synthetic accrued fee payment',
    createdBy: 'maker',
    createdAt: 'test',
  });
  const id = randomUUID(),
    entry = entrySchema.parse({
      id: randomUUID(),
      kind: 'adjustment',
      adjustmentType: 'ChinmayEligibility',
      date: '2026-06-15',
      version: 'Actual',
      line: 'CSH',
      amount: '-999999',
      reason: 'Synthetic exclusion test',
    }) as Extract<import('../server/model.ts').Entry, { kind: 'adjustment' }>;
  d.operations!.push({
    id,
    kind: 'adjustment_request',
    entry,
    reason: 'Synthetic exclusion request',
    status: 'Pending',
    createdBy: 'maker',
    createdAt: 'test',
  });
  const count = d.entries.length;
  assert.throws(
    () => reviewAdjustment(d, id, 'checker', true, 'Review exclusion proposal'),
    /overpay/,
  );
  assert.equal(d.entries.length, count);
});
