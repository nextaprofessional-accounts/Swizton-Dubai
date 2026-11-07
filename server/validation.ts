import { invoiceKey } from './references.ts';
import { recognitionMonthOf } from './period.ts';
import { affectedMonths, billShare, calculateYear, ruleAt, validateMasters } from './engine.ts';
import { entrySchema, masterSchema, type Dataset, type Entry } from './model.ts';
const financialMonths = (e: Entry) =>
  e.kind === 'bill' || e.kind === 'receipt' ? [recognitionMonthOf(e)] : affectedMonths(e);
export function validateDataset(d: Dataset) {
  masterSchema.parse(d.masters);
  validateMasters(d.masters);
  const invoices = new Set<string>();
  const ids = new Set<string>();
  for (const raw of d.entries) {
    const e = entrySchema.parse(raw);
    if (ids.has(e.id)) throw Error('Duplicate entry ID');
    ids.add(e.id);
    if (e.kind === 'bill') {
      if (e.version !== 'Actual') throw Error('Bills must be Actual');
      const key = invoiceKey(e.hospital, e.invoice);
      if (invoices.has(key)) throw Error(`Duplicate hospital invoice ${e.invoice}`);
      invoices.add(key);
      if (!d.masters.procedures.includes(e.procedure) || !d.masters.doctors.includes(e.doctor))
        throw Error('Unknown procedure or doctor');
      billShare(e, d.masters);
    }
    if (e.kind === 'estimate') {
      if (e.version !== 'Approx') throw Error('Estimates must be Approx');
      if (
        !d.masters.hospitals.some((h) => h.id === e.hospital) ||
        !d.masters.procedures.includes(e.procedure)
      )
        throw Error('Unknown hospital or procedure');
      ruleAt(d.masters, e.hospital, e.date);
    }
    if (
      e.kind === 'expense' &&
      e.caseId &&
      !d.entries.some((b) => b.kind === 'bill' && b.id === e.caseId && b.version === e.version)
    )
      throw Error('Linked expense case must reference an existing bill in the same version');
    if (e.kind === 'expense' && Boolean(e.coverageStart) !== Boolean(e.coverageEnd))
      throw Error('Both coverage dates are required');
    if (
      e.kind === 'wallet' &&
      e.action === 'opening' &&
      d.entries.some(
        (x) =>
          x.kind === 'wallet' && x.action === 'opening' && x.version === e.version && x.id !== e.id,
      )
    )
      throw Error('Only one initial wallet balance per version is permitted');
    for (const m of financialMonths(e))
      if (!d.masters.fx.some((f) => f.month === m)) throw Error(`Missing FX for ${m}`);
  }
  const years = new Set(
    d.entries.flatMap((e) => financialMonths(e).map((m) => Number(m.slice(0, 4)))),
  );
  for (const y of years) calculateYear(d, y);
}
export function assertUnlocked(d: Dataset, e: Entry) {
  if (affectedMonths(e).some((m) => d.closes.some((c) => c.month === m && c.locked)))
    throw Error(
      'Period is locked, including covered prepaid months. Admin must reopen with a reason.',
    );
}
