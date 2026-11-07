import { approvedFx } from './fx-provenance.ts';
import { validatePlanningReferences, cashReferenceExists, remainingExpense } from './planning.ts';
import { Decimal as D } from 'decimal.js';
import { calculateMonth, entryFacts, billShare, affectedMonths } from './engine.ts';
import type { Dataset, Masters } from './model.ts';
import { recognitionMonthOf } from './period.ts';
import { assertUnlocked, validateDataset } from './validation.ts';
import type { AdjustmentRequest, Settlement, DoctorPayment } from './workflow-model.ts';
const signature = (p: ReturnType<typeof calculateMonth>) =>
  JSON.stringify({
    ...p,
    rows: Object.fromEntries(
      Object.entries(p.rows)
        .filter(([, c]) => !new D(c.aed).isZero() || c.ids.length)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    kpis: {
      ...p.kpis,
      mix: Object.fromEntries(
        Object.entries(p.kpis.mix)
          .filter(([, n]) => n !== 0)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  });
export function replaceMasters(d: Dataset, next: Masters) {
  const previous = d.masters;
  const candidate = { ...d, masters: next };
  validateDataset(candidate);
  validatePlanningReferences(candidate);
  for (const close of d.closes.filter((c) => c.locked)) {
    for (const version of ['Actual', 'Approx'] as const)
      if (
        signature(calculateMonth(d, close.month, version)) !==
        signature(calculateMonth(candidate, close.month, version))
      )
        throw Error(`Master change would alter locked month ${close.month}`);
    for (const e of d.entries)
      if (
        (e.kind === 'bill' || e.kind === 'estimate') &&
        (recognitionMonthOf(e) === close.month || e.date.startsWith(close.month))
      )
        if (JSON.stringify(entryFacts(e, previous)) !== JSON.stringify(entryFacts(e, next)))
          throw Error(`Share-rule change would alter locked source ${e.id}`);
  }
  for (const row of receivables(candidate, '9999-12-31'))
    if (new D(row.outstanding).lt(0))
      throw Error(`Master change would over-settle invoice ${row.invoice}`);
  for (const period of new Set(
    (d.operations ?? [])
      .filter((o) => o.kind === 'doctor_payment')
      .map((o) => (o.kind === 'doctor_payment' ? o.period : '')),
  ))
    for (const row of doctorPayables(candidate, period))
      if (new D(row.outstanding).lt(0))
        throw Error(`Master change would overpay Dr. ${row.doctor}`);
  for (const e of candidate.entries)
    if (
      e.kind === 'expense' &&
      e.version === 'Actual' &&
      candidate.operations?.some((o) => o.kind === 'cash_movement' && o.linkedExpenseId === e.id)
    )
      if (remainingExpense(candidate, e.id).lt(0))
        throw Error('Master change would overpay an expense');
  d.masters = next;
}
function protectPaidFees(d: Dataset) {
  const periods = new Set(
    (d.operations ?? [])
      .filter((o) => o.kind === 'doctor_payment')
      .map((o) => (o.kind === 'doctor_payment' ? o.period : '')),
  );
  for (const period of periods)
    for (const row of doctorPayables(d, period))
      if (new D(row.outstanding).lt(0))
        throw Error(
          `Adjustment would overpay Dr. ${row.doctor}; review the settlement before changing accrued fees`,
        );
}
export function reviewAdjustment(
  d: Dataset,
  id: string,
  actor: string,
  approve: boolean,
  note: string,
) {
  const op = d.operations?.find(
    (o): o is AdjustmentRequest => o.id === id && o.kind === 'adjustment_request',
  );
  if (!op || op.status !== 'Pending') throw Error('Pending adjustment not found');
  if (op.createdBy === actor) throw Error('A different Admin must review this request');
  if (approve) {
    assertUnlocked(d, op.entry);
    const proposed = { ...d, entries: [...d.entries, op.entry] };
    validateDataset(proposed);
    protectPaidFees(proposed);
    d.entries.push(op.entry);
  }
  op.status = approve ? 'Approved' : 'Rejected';
  op.reviewedBy = actor;
  op.reviewedAt = new Date().toISOString();
  op.reviewNote = note;
}
export function receivables(d: Dataset, asOf: string) {
  return d.entries
    .filter(
      (e): e is Extract<typeof e, { kind: 'bill' }> =>
        e.kind === 'bill' && e.version === 'Actual' && e.date <= asOf,
    )
    .map((e) => {
      const total = billShare(e, d.masters).toDecimalPlaces(2),
        payments = (d.operations ?? []).filter(
          (o): o is Settlement => o.kind === 'settlement' && o.billId === e.id && o.date <= asOf,
        ),
        paid = payments.reduce((s, p) => s.plus(p.amount), new D(0));
      const days = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(e.date)) / 86400000));
      return {
        id: e.id,
        hospital: e.hospital,
        invoice: e.invoice,
        patient: e.patient,
        date: e.date,
        recognitionMonth: recognitionMonthOf(e),
        total: total.toFixed(2),
        paid: paid.toFixed(2),
        outstanding: total.minus(paid).toFixed(2),
        days,
        bucket: days <= 30 ? '0–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+',
        payments,
      };
    });
}
export function addSettlement(d: Dataset, s: Settlement) {
  const bill = d.entries.find((e) => e.id === s.billId && e.kind === 'bill');
  if (!bill || bill.kind !== 'bill') throw Error('Bill not found');
  if (s.date < bill.date) throw Error('Collection cannot precede invoice date');
  if (d.closes.some((c) => c.locked && c.month === s.date.slice(0, 7)))
    throw Error('Collection month is locked');
  const total = billShare(bill, d.masters).toDecimalPlaces(2),
    paid = (d.operations ?? [])
      .filter((o): o is Settlement => o.kind === 'settlement' && o.billId === s.billId)
      .reduce((a, p) => a.plus(p.amount), new D(0));
  if (new D(s.amount).lte(0) || paid.plus(s.amount).gt(total))
    throw Error('Collection must be positive and cannot exceed the remaining bill share');
  if (cashReferenceExists(d, s.reference)) throw Error('Collection reference already recorded');
  (d.operations ??= []).push(s);
}
export function closeReadiness(d: Dataset, month: string) {
  const blockers: string[] = [],
    warnings: string[] = [];
  if (!d.masters.fx.some((f) => f.month === month)) blockers.push('Monthly FX is missing');
  else if (!approvedFx(d, month))
    blockers.push('Monthly FX requires independent approval in Finance validation');
  if (
    d.operations?.some(
      (o) => o.kind === 'fx_proposal' && o.status === 'Pending' && o.input.month === month,
    )
  )
    blockers.push('A replacement monthly FX proposal awaits independent review');
  if (!d.masters.targets.some((t) => t.month === month)) blockers.push('Monthly target is missing');
  const pending = (d.operations ?? []).filter(
    (o) =>
      o.kind === 'adjustment_request' && o.status === 'Pending' && o.entry.date.startsWith(month),
  );
  if (pending.length) blockers.push(`${pending.length} adjustment(s) await independent review`);
  const relevant = d.entries.filter(
    (e) => affectedMonths(e).includes(month) && e.version === 'Actual',
  );
  if (!relevant.length) warnings.push('No Actual source records entered');
  if ((d.operations ?? []).some((o) => o.kind === 'import_batch' && o.status === 'Preview'))
    warnings.push('An import preview has not been committed or cancelled');
  const wallet = calculateMonth(d, month, 'Actual').wallet;
  if (new D(wallet.closing).lt(0)) warnings.push('Marketing wallet has a negative balance');
  return {
    month,
    blockers,
    warnings,
    canClose: blockers.length === 0,
    actualRecords: relevant.length,
  };
}

export function doctorPayables(d: Dataset, period: string) {
  const p = calculateMonth(d, period, 'Actual');
  return (['Chinmay', 'Tahsin'] as const).map((doctor) => {
    const fee = new D(p.rows[`Dr. ${doctor} – Professional Fee`].aed).toDecimalPlaces(2),
      payments = (d.operations ?? []).filter(
        (o): o is DoctorPayment =>
          o.kind === 'doctor_payment' && o.doctor === doctor && o.period === period,
      ),
      paid = payments.reduce((s, p) => s.plus(p.amount), new D(0));
    return {
      doctor,
      period,
      accrued: fee.toFixed(2),
      paid: paid.toFixed(2),
      outstanding: fee.minus(paid).toFixed(2),
      payments,
    };
  });
}
export function addDoctorPayment(d: Dataset, p: DoctorPayment) {
  if (p.date.slice(0, 7) < p.period)
    throw Error('Future-period advances require a separate prepayment workflow');
  if (d.closes.some((c) => c.locked && c.month === p.date.slice(0, 7)))
    throw Error('Payment date is in a locked month');
  const due = doctorPayables(d, p.period).find((r) => r.doctor === p.doctor)!;
  if (new D(p.amount).lte(0) || new D(p.amount).gt(due.outstanding))
    throw Error('Payment exceeds the remaining accrued professional fee');
  if (cashReferenceExists(d, p.reference)) throw Error('Payment reference already recorded');
  (d.operations ??= []).push(p);
}
