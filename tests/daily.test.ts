import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { demoDataset } from '../server/demo.ts';
import { entrySchema } from '../server/model.ts';
import { calculateYear, billShare } from '../server/engine.ts';
import { validateDataset } from '../server/validation.ts';
import { parseBillRows, previewBills } from '../server/imports.ts';
import { addSettlement } from '../server/workflows.ts';
import {
  mappedPreview,
  validateProfile,
  caseRegister,
  saveCase,
  bankPreview,
  commitBank,
  bankRegister,
  availableCash,
  matchBank,
  reverseMatch,
  voidStatement,
} from '../server/daily.ts';
import type {
  HospitalProfile,
  CaseRecord,
  BankStatement,
  BankMatch,
} from '../server/daily-model.ts';
const fixture = () => {
  const d = demoDataset();
  d.entries = [];
  d.operations = [];
  d.closes = [];
  return d;
};
const bill = (extra: Record<string, unknown> = {}) =>
  entrySchema.parse({
    id: randomUUID(),
    kind: 'bill',
    date: '2026-06-20',
    version: 'Actual',
    hospital: 'CSH',
    patient: 'Synthetic case',
    procedure: 'RFA',
    doctor: 'Dr. Tahsin',
    billType: 'IP',
    payment: 'Insurance',
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
const profile = (): HospitalProfile => ({
  id: randomUUID(),
  kind: 'hospital_profile',
  createdBy: 'maker',
  createdAt: 'test',
  name: 'Synthetic hospital mapping',
  version: 1,
  hospital: 'CSH',
  dateFormat: 'DD/MM/YYYY',
  numberFormat: 'Comma thousands',
  columns: {
    date: 'Service Date',
    patient: 'Patient',
    procedure: 'Code',
    doctor: 'Doctor',
    invoice: 'Invoice',
    gross: 'Gross',
    consumables: 'Materials',
    pharmacyLab: 'Lab',
    payment: 'Pay',
  },
  defaults: { billType: 'IP', regime: 'Standard', visits: '1', vat: '0', tax: '0' },
  aliases: { procedure: { RF: 'RFA' }, payment: { INS: 'Insurance' } },
  reason: 'Verify source header mapping',
});
const raw = () => ({
  'Service Date': '20/06/2026',
  Patient: 'Synthetic mapped case',
  Code: 'RF',
  Doctor: 'Dr. Tahsin',
  Invoice: 'MAPPED-1',
  Gross: '10,000.00',
  Materials: '1,000.00',
  Lab: '1,000.00',
  Pay: 'INS',
});
const receipt = (amount = '100') =>
  entrySchema.parse({
    id: randomUUID(),
    kind: 'receipt',
    date: '2026-06-20',
    version: 'Actual',
    source: 'OP Consultation',
    patient: 'Synthetic cash receipt',
    amount,
    visits: 1,
  });
const statement = (
  d: ReturnType<typeof fixture>,
  rows: Record<string, unknown>[],
  account = 'TEST-ACCOUNT',
): BankStatement => {
  const s: BankStatement = {
    id: randomUUID(),
    kind: 'bank_statement',
    createdBy: 'maker',
    createdAt: 'test',
    account,
    name: 'Synthetic bank statement',
    hash: randomUUID(),
    currency: 'AED',
    status: 'Preview',
    reason: 'Test statement evidence',
    rows: bankPreview(d, account, rows),
  };
  d.operations!.push(s);
  return s;
};
const bankRow = (extra: Record<string, unknown> = {}) => ({
  transactionId: randomUUID(),
  date: '2026-06-21',
  direction: 'In',
  amount: '100',
  reference: 'Synthetic bank receipt',
  ...extra,
});
const match = (s: BankStatement, eventId: string, amount = '100', index = 0): BankMatch => ({
  id: randomUUID(),
  kind: 'bank_match',
  createdBy: 'maker',
  createdAt: 'test',
  statementId: s.id,
  rowId: s.rows[index].data!.id,
  eventId,
  amount,
  status: 'Active',
  reason: 'Verified bank allocation evidence',
});
test('hospital mappings preserve explicit formats, aliases, defaults and master share calculations', () => {
  const d = fixture(),
    p = profile(),
    result = mappedPreview(d, p, [raw()]);
  assert.deepEqual(result[0].errors, []);
  const e = result[0].entry!;
  assert.equal(e.date, '2026-06-20');
  assert.equal(e.kind, 'bill');
  if (e.kind !== 'bill') throw Error();
  assert.equal(e.gross, '10000.00');
  assert.equal(e.payment, 'Insurance');
  assert.equal(e.procedure, 'RFA');
  assert.equal(billShare(e, d.masters).toFixed(2), '3150.00');
  assert.ok(result[0].warnings?.some((w) => w.includes('defaults')));
  assert.equal(d.entries.length, 0);
  const sameDate = { ...raw(), 'Service Date': '06/07/2026', Invoice: 'MAPPED-2' };
  assert.equal(mappedPreview(d, p, [sameDate])[0].entry!.date, '2026-07-06');
  assert.equal(
    mappedPreview(d, { ...p, dateFormat: 'MM/DD/YYYY' }, [sameDate])[0].entry!.date,
    '2026-06-07',
  );
});
test('mapped previews reject missing headers, malformed numbers, blank deductions, foreign currency and invented share fields', () => {
  const d = fixture(),
    p = profile();
  for (const row of [
    { ...raw(), Gross: '10,00' },
    { ...raw(), Materials: '' },
    { ...raw(), Gross: '-1' },
    { ...raw(), 'Service Date': '31/02/2026' },
  ])
    assert.ok(mappedPreview(d, p, [row])[0].errors.length);
  const missing = raw();
  delete (missing as any).Gross;
  assert.match(mappedPreview(d, p, [missing])[0].errors.join(), /missing/);
  assert.throws(
    () => validateProfile(d, { ...p, columns: { ...p.columns, share: 'Hospital Share' } }),
    /Unknown/,
  );
  assert.throws(
    () => validateProfile(d, { ...p, defaults: { ...p.defaults, gross: '0' } }),
    /not allowed/,
  );
  assert.ok(
    mappedPreview(d, { ...p, columns: { ...p.columns, currency: 'Currency' } }, [
      { ...raw(), Currency: 'INR' },
    ])[0].errors.length,
  );
});
test('invoice identity is case/whitespace normalized while source values remain unchanged', () => {
  const d = fixture(),
    a = bill({ invoice: ' INV-01 ' });
  d.entries.push(a);
  const b = bill({ invoice: 'inv-01' });
  assert.throws(() => validateDataset({ ...d, entries: [...d.entries, b] }), /Duplicate/);
  assert.equal(a.kind === 'bill' ? a.invoice : '', ' INV-01 ');
  const warn = previewBills([{ ...(a as any), invoice: 'INV-02' }], d);
  assert.deepEqual(warn[0].errors, []);
  assert.ok(warn[0].warnings?.length);
});
test('import headers must be unique and safe before parsing bill values', async () => {
  await assert.rejects(() => parseBillRows('csv', 'invoice,invoice\nA,B'), /unique/);
  await assert.rejects(() => parseBillRows('csv', '__proto__,invoice\na,b'), /safe/);
  assert.deepEqual(await parseBillRows('csv', ' Invoice ,Gross\n0001,100'), [
    { Invoice: '0001', Gross: '100' },
  ]);
});
test('case register separates recognition and invoice dates, shows dated collections and explicit overdue terms', () => {
  const d = fixture(),
    b = bill({ recognitionMonth: '2026-07' });
  d.entries.push(b);
  addSettlement(d, {
    id: randomUUID(),
    kind: 'settlement',
    createdBy: 'maker',
    createdAt: 'test',
    billId: b.id,
    date: '2026-06-25',
    amount: '1000',
    reference: 'CASE-PARTIAL',
    reason: 'Record synthetic partial receipt',
  });
  const record: CaseRecord = {
    id: randomUUID(),
    kind: 'case_record',
    createdBy: 'maker',
    createdAt: 'test',
    updatedAt: 'test',
    billId: b.id,
    status: 'Collection follow-up',
    hospitalCaseReference: 'CASE-1',
    authorizationReference: 'AUTH-1',
    expectedCollectionDate: '2026-06-28',
    notes: 'Synthetic billing follow-up',
    reason: 'Save case tracking evidence',
  };
  const before = calculateYear(d, 2026).total;
  saveCase(d, record, '2026-06-30');
  const early = caseRegister(d, '2026-06-20')[0],
    late = caseRegister(d, '2026-06-30')[0];
  assert.equal(early.paid, '0.00');
  assert.equal(late.paid, '1000.00');
  assert.equal(late.outstanding, '2150.00');
  assert.equal(late.overdue, true);
  assert.equal(late.recognitionMonth, '2026-07');
  assert.equal(late.date, '2026-06-20');
  assert.deepEqual(calculateYear(d, 2026).total, before);
});
test('case tracking prevents premature settlement, invalid insurance claims and duplicate hospital references', () => {
  const d = fixture(),
    b = bill({ payment: 'Cash' }),
    b2 = bill();
  d.entries.push(b, b2);
  const record: CaseRecord = {
    id: randomUUID(),
    kind: 'case_record',
    createdBy: 'maker',
    createdAt: 'test',
    updatedAt: 'test',
    billId: b.id,
    status: 'Settled',
    hospitalCaseReference: 'CASE-X',
    authorizationReference: '',
    notes: '',
    reason: 'Synthetic tracking reason',
  };
  assert.throws(() => saveCase(d, record, '2026-06-30'), /balance/);
  assert.throws(
    () => saveCase(d, { ...record, status: 'Claim submitted' }, '2026-06-30'),
    /insurance/,
  );
  saveCase(d, { ...record, status: 'Collection follow-up' }, '2026-06-30');
  assert.throws(
    () =>
      saveCase(
        d,
        { ...record, id: randomUUID(), billId: b2.id, status: 'Collection follow-up' },
        '2026-06-30',
      ),
    /already/,
  );
});
test('bank imports reject duplicates, invalid calendar dates, signed money and excess decimal places', () => {
  const d = fixture();
  const rows = bankPreview(d, 'TEST', [
    bankRow({ transactionId: ' Ref-1 ' }),
    bankRow({ transactionId: 'ref-1' }),
    bankRow({ amount: '-1' }),
    bankRow({ amount: '1.001' }),
    bankRow({ date: '2026-02-30' }),
    bankRow({ direction: 'Credit' }),
  ]);
  assert.deepEqual(rows[0].errors, []);
  assert.ok(rows.slice(1).every((r) => r.errors.length));
});
test('bank commit rechecks transaction identity across competing previews atomically', () => {
  const d = fixture(),
    raw = bankRow(),
    a = statement(d, [raw]),
    b = statement(d, [raw]);
  commitBank(d, a.id);
  assert.throws(() => commitBank(d, b.id), /after preview/);
  assert.equal(b.status, 'Preview');
  assert.equal(d.entries.length, 0);
});
test('partial and combined bank allocations preserve P&L and can be audited and reversed', () => {
  const d = fixture(),
    r1 = receipt('100'),
    r2 = receipt('50');
  d.entries.push(r1, r2);
  const before = calculateYear(d, 2026).total,
    s = statement(d, [bankRow({ amount: '150' })]);
  commitBank(d, s.id);
  const a = match(s, r1.id, '100'),
    b = match(s, r2.id, '50');
  matchBank(d, a);
  matchBank(d, b);
  assert.equal(bankRegister(d)[0].rows[0].remaining, '0.00');
  assert.equal(availableCash(d).find((e) => e.id === r1.id)!.remaining, '0.00');
  assert.deepEqual(calculateYear(d, 2026).total, before);
  reverseMatch(d, a.id, 'checker', 'Undo incorrect evidence link');
  assert.equal(bankRegister(d)[0].rows[0].remaining, '100.00');
  assert.equal(a.status, 'Reversed');
  assert.equal(a.reversedBy, 'checker');
  assert.throws(() => reverseMatch(d, a.id, 'checker', 'Repeat unmatch'), /Active/);
  assert.deepEqual(calculateYear(d, 2026).total, before);
});
test('one cash event can split over bank rows but cannot be allocated twice or in the wrong direction', () => {
  const d = fixture(),
    r = receipt();
  d.entries.push(r);
  const s = statement(d, [
    bankRow({ amount: '60' }),
    bankRow({ amount: '40' }),
    bankRow({ direction: 'Out', amount: '10' }),
  ]);
  commitBank(d, s.id);
  matchBank(d, match(s, r.id, '60', 0));
  assert.throws(() => matchBank(d, match(s, r.id, '50', 1)), /exceeds/);
  matchBank(d, match(s, r.id, '40', 1));
  assert.throws(() => matchBank(d, match(s, r.id, '1', 2)), /directions/);
  assert.equal(availableCash(d)[0].remaining, '0.00');
});
test('FX changes flag matched expense cash for review and prevent reallocation until unmatching', () => {
  const d = fixture(),
    expense = entrySchema.parse({
      id: randomUUID(),
      kind: 'expense',
      version: 'Actual',
      date: '2026-06-20',
      head: d.masters.expenseHeads[0].name,
      amount: '2500',
      currency: 'INR',
      basis: 'Actual',
      paid: true,
      remarks: 'Synthetic paid expense',
      coverageStart: null,
      coverageEnd: null,
    });
  d.entries.push(expense);
  d.masters.fx.find((f) => f.month === '2026-06')!.inrPerAed = '25';
  const s = statement(d, [bankRow({ direction: 'Out' }), bankRow({ direction: 'Out' })]);
  commitBank(d, s.id);
  const a = match(s, expense.id);
  matchBank(d, a);
  assert.equal(bankRegister(d)[0].rows[0].allocations[0].sourceChanged, false);
  d.masters.fx.find((f) => f.month === '2026-06')!.inrPerAed = '50';
  assert.equal(bankRegister(d)[0].rows[0].allocations[0].sourceChanged, true);
  assert.throws(() => matchBank(d, match(s, expense.id, '10', 1)), /changed-source/);
  reverseMatch(d, a.id, 'checker', 'Reconcile after approved FX change');
  matchBank(d, match(s, expense.id, '50'));
  assert.equal(bankRegister(d)[0].rows[0].remaining, '50.00');
});

test('statement corrections require explicit unmatching and retain original evidence after voiding', () => {
  const d = fixture(),
    r = receipt();
  d.entries.push(r);
  const raw = bankRow(),
    s = statement(d, [raw]);
  commitBank(d, s.id);
  const m = match(s, r.id);
  matchBank(d, m);
  assert.throws(
    () => voidStatement(d, s.id, 'checker', 'Correct synthetic bank evidence'),
    /Unmatch all/,
  );
  reverseMatch(d, m.id, 'checker', 'Release incorrect evidence link');
  voidStatement(d, s.id, 'checker', 'Correct synthetic bank evidence');
  assert.equal(s.status, 'Voided');
  assert.equal(s.rows[0].data!.transactionId, raw.transactionId);
  assert.equal(m.status, 'Reversed');
  assert.deepEqual(bankPreview(d, s.account, [raw])[0].errors, []);
  assert.equal(d.entries.length, 1);
});
