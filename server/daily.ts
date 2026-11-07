import { canonicalReference } from './references.ts';
import { Decimal as D } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import type { Dataset } from './model.ts';
import type {
  HospitalProfile,
  CaseRecord,
  BankStatement,
  BankMatch,
  BankRow,
} from './daily-model.ts';
import { components } from './model.ts';
import { billShare, ruleAt } from './engine.ts';
import { recognitionMonthOf } from './period.ts';
import { cashEvents } from './planning.ts';
import { previewBills } from './imports.ts';
export const mappedFields = [
  'date',
  'recognitionMonth',
  'hospital',
  'currency',
  'patient',
  'procedure',
  'doctor',
  'billType',
  'payment',
  'invoice',
  'gross',
  'consumables',
  'pharmacyLab',
  'adminAmount',
  'refundableAmount',
  'deductionReason',
  'regime',
  'visits',
  'vat',
  'tax',
  ...components.map((c) => `component:${c}`),
];
const numeric = new Set([
  'gross',
  'consumables',
  'pharmacyLab',
  'adminAmount',
  'refundableAmount',
  'vat',
  'tax',
  ...components.map((c) => `component:${c}`),
]);
export function validateProfile(d: Dataset, p: HospitalProfile) {
  if (!d.masters.hospitals.some((h) => h.id === p.hospital))
    throw Error('Choose a configured hospital');
  for (const key of Object.keys(p.columns))
    if (!mappedFields.includes(key)) throw Error(`Unknown mapped field ${key}`);
  for (const key of Object.keys(p.defaults))
    if (
      ![
        'hospital',
        'currency',
        'billType',
        'payment',
        'regime',
        'visits',
        'consumables',
        'pharmacyLab',
        'vat',
        'tax',
      ].includes(key)
    )
      throw Error(`Default is not allowed for ${key}`);
  for (const key of Object.keys(p.aliases))
    if (!['hospital', 'procedure', 'doctor', 'payment', 'billType', 'regime'].includes(key))
      throw Error(`Value aliases are not allowed for ${key}`);
  for (const key of ['date', 'patient', 'procedure', 'doctor', 'invoice', 'gross'])
    if (!p.columns[key]) throw Error(`Map the required ${key} column`);
}
function parseNumber(raw: string, format: HospitalProfile['numberFormat']) {
  if (format === 'Comma thousands') {
    if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,6})?$/.test(raw)) throw Error(`Invalid AED number ${raw}`);
    return raw.replaceAll(',', '');
  }
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw Error(`Invalid AED number ${raw}`);
  return raw;
}
function mappedDate(raw: string, format: HospitalProfile['dateFormat']) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (format === 'ISO' || !m) throw Error('Date must match the configured format');
  return format === 'DD/MM/YYYY' ? `${m[3]}-${m[2]}-${m[1]}` : `${m[3]}-${m[1]}-${m[2]}`;
}
export function mappedPreview(d: Dataset, p: HospitalProfile, rows: Record<string, unknown>[]) {
  validateProfile(d, p);
  const draft = structuredClone(d);
  return rows.map((raw, index) => {
    try {
      if (
        Object.keys(raw).some(
          (k) =>
            k.trim().toLowerCase() === 'currency' && String(raw[k]).trim().toUpperCase() !== 'AED',
        )
      )
        throw Error('Hospital bill amounts must be AED; foreign currency is not converted');
      const value: Record<string, unknown> = { ...p.defaults };
      const usedDefaults: string[] = [];
      for (const [key, header] of Object.entries(p.columns)) {
        if (!(header in raw)) throw Error(`Source column '${header}' is missing`);
        const original = String(raw[header] ?? '').trim();
        let v = p.aliases[key]?.[original] ?? original;
        if (numeric.has(key)) {
          if (!v && ['adminAmount', 'refundableAmount'].includes(key)) {
            delete value[key];
            continue;
          }
          v = parseNumber(v, p.numberFormat);
        }
        if (key === 'visits' && !/^\d+$/.test(v))
          throw Error('Visits must be an explicit whole number');
        if (key === 'date') v = mappedDate(v, p.dateFormat);
        value[key] = v;
      }
      for (const key of Object.keys(p.defaults)) if (!p.columns[key]) usedDefaults.push(key);
      if (value.hospital && value.hospital !== p.hospital)
        throw Error('Source hospital differs from the selected profile');
      if (value.currency && value.currency !== 'AED')
        throw Error('Hospital import accepts AED amounts only; no automatic FX conversion');
      value.hospital = p.hospital;
      const c: Record<string, string> = {};
      for (const key of Object.keys(value))
        if (key.startsWith('component:')) {
          c[key.slice(10)] = String(value[key]);
          delete value[key];
        }
      value.components = c;
      const result = previewBills([value], draft)[0];
      result.row = index + 2;
      result.warnings = [
        ...(result.warnings ?? []),
        ...(usedDefaults.length
          ? [`Explicit profile defaults used: ${usedDefaults.join(', ')}`]
          : []),
      ];
      if (result.entry) draft.entries.push(result.entry);
      return result;
    } catch (e) {
      return { row: index + 2, entry: null, errors: [(e as Error).message], warnings: [] };
    }
  });
}
export function caseRegister(d: Dataset, asOf: string) {
  return d.entries
    .filter((e) => e.kind === 'bill' && e.version === 'Actual' && e.date <= asOf)
    .map((b) => {
      if (b.kind !== 'bill') throw Error('Bill required');
      const total = billShare(b, d.masters).toDecimalPlaces(2),
        payments = (d.operations ?? []).filter(
          (o) => o.kind === 'settlement' && o.billId === b.id && o.date <= asOf,
        );
      const paid = payments.reduce(
          (s, p) => s.plus(p.kind === 'settlement' ? p.amount : 0),
          new D(0),
        ),
        outstanding = total.minus(paid);
      const record =
        d.operations?.find((o): o is CaseRecord => o.kind === 'case_record' && o.billId === b.id) ??
        null;
      const age = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(b.date)) / 86400000));
      const lead = d.operations?.find(
        (o) => o.kind === 'lead' && o.stage === 'Won' && o.linkedBillId === b.id,
      );
      return {
        status:
          record?.status === 'Settled' && outstanding.gt(0)
            ? 'Collection follow-up'
            : (record?.status ?? 'Untracked'),
        statusWarning:
          record?.status === 'Settled' && outstanding.gt(0)
            ? 'Latest workflow says settled; a balance remains at the selected cash cutoff'
            : null,
        id: b.id,
        invoice: b.invoice,
        patient: b.patient,
        hospital: b.hospital,
        procedure: b.procedure,
        doctor: b.doctor,
        date: b.date,
        recognitionMonth: recognitionMonthOf(b),
        payment: b.payment,
        billType: b.billType,
        total: total.toFixed(2),
        swizton: billShare(b, d.masters)
          .times(ruleAt(d.masters, b.hospital, b.date).swizton)
          .toFixed(2),
        paid: paid.toFixed(2),
        outstanding: outstanding.toFixed(2),
        age,
        ageBucket: age <= 30 ? '0–30' : age <= 60 ? '31–60' : age <= 90 ? '61–90' : '90+',
        overdue:
          outstanding.gt(0) &&
          !!record?.expectedCollectionDate &&
          record.expectedCollectionDate < asOf,
        record,
        leadId: lead?.id ?? null,
        payments,
        expenses: d.entries.filter(
          (e) =>
            e.kind === 'expense' && e.caseId === b.id && e.version === 'Actual' && e.date <= asOf,
        ),
      };
    });
}
export function saveCase(d: Dataset, r: CaseRecord, asOf: string) {
  const b = d.entries.find((e) => e.kind === 'bill' && e.id === r.billId && e.version === 'Actual');
  if (!b || b.kind !== 'bill') throw Error('Case must link to an Actual bill');
  if (r.expectedCollectionDate && r.expectedCollectionDate < b.date)
    throw Error('Expected collection cannot precede invoice date');
  if (r.status === 'Claim submitted' && b.payment !== 'Insurance')
    throw Error('Claims apply to insurance bills');
  if (r.status === 'Settled') {
    const c = caseRegister(d, asOf).find((c) => c.id === b.id);
    if (!c || new D(c.outstanding).gt(0))
      throw Error('Case cannot be marked settled while a balance remains');
  }
  const duplicate = d.operations?.some(
    (o) =>
      o.kind === 'case_record' &&
      o.billId !== r.billId &&
      r.hospitalCaseReference &&
      o.hospitalCaseReference.trim().toUpperCase() ===
        r.hospitalCaseReference.trim().toUpperCase() &&
      d.entries.some((e) => e.kind === 'bill' && e.id === o.billId && e.hospital === b.hospital),
  );
  if (duplicate)
    throw Error('Hospital case reference already belongs to another bill at this hospital');
  const old = d.operations?.find((o) => o.kind === 'case_record' && o.billId === r.billId);
  if (old) {
    if (old.id !== r.id) throw Error('Conflict: case record changed; reload');
    Object.assign(old, r);
  } else (d.operations ??= []).push(r);
}
export function bankPreview(d: Dataset, account: string, rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  const used = new Set(
    (d.operations ?? [])
      .filter(
        (o): o is BankStatement =>
          o.kind === 'bank_statement' && o.status === 'Committed' && o.account === account,
      )
      .flatMap((s) =>
        s.rows.flatMap((r) => (r.data ? [canonicalReference(r.data.transactionId)] : [])),
      ),
  );
  return rows.map((raw, index) => {
    try {
      const transactionId = String(raw.transactionId ?? '').trim();
      if (!transactionId || transactionId.length > 160)
        throw Error('A unique bank transactionId is required');
      if (
        seen.has(canonicalReference(transactionId)) ||
        used.has(canonicalReference(transactionId))
      )
        throw Error('Duplicate bank transaction ID for this account');
      seen.add(canonicalReference(transactionId));
      if (
        Object.keys(raw).some(
          (k) =>
            k.trim().toLowerCase() === 'currency' && String(raw[k]).trim().toUpperCase() !== 'AED',
        )
      )
        throw Error('Bank statement amounts must be AED; foreign currency is not converted');
      const date = String(raw.date ?? '').trim();
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date
      )
        throw Error('Bank dates must be ISO calendar dates');
      const direction = String(raw.direction ?? '').trim();
      if (direction !== 'In' && direction !== 'Out') throw Error('Direction must be In or Out');
      const amount = String(raw.amount ?? '').trim();
      if (!/^\d{1,15}(\.\d{1,2})?$/.test(amount) || !new D(amount).gt(0))
        throw Error('Bank amounts must be positive AED with at most two decimals');
      const reference = String(raw.reference ?? '').trim();
      if (!reference || reference.length > 500)
        throw Error('A bank reference of 1–500 characters is required');
      return {
        row: index + 2,
        data: {
          id: randomUUID(),
          transactionId,
          date,
          direction,
          amount: new D(amount).toFixed(2),
          reference,
        } as BankRow,
        errors: [],
      };
    } catch (e) {
      return { row: index + 2, data: null, errors: [(e as Error).message] };
    }
  });
}
export function commitBank(d: Dataset, id: string) {
  const statement = d.operations?.find(
    (o): o is BankStatement => o.kind === 'bank_statement' && o.id === id,
  );
  if (!statement || statement.status !== 'Preview') throw Error('Bank preview not found');
  if (statement.rows.some((r) => r.errors.length || !r.data))
    throw Error('Resolve every bank row error before committing');
  const recheck = bankPreview(
    d,
    statement.account,
    statement.rows.map((r) => ({ ...r.data! })),
  );
  if (recheck.some((r) => r.errors.length))
    throw Error('A bank transaction was imported after preview; cancel and prepare again');
  statement.status = 'Committed';
  statement.committedAt = new Date().toISOString();
}
function activeMatches(d: Dataset) {
  return (d.operations ?? []).filter(
    (o): o is BankMatch => o.kind === 'bank_match' && o.status === 'Active',
  );
}
export function bankRegister(d: Dataset) {
  const matches = activeMatches(d),
    events = new Map(availableCash(d).map((e) => [e.id, e]));
  return (d.operations ?? [])
    .filter((o): o is BankStatement => o.kind === 'bank_statement')
    .map((s) => ({
      ...s,
      rows: s.rows.map((r) => {
        const allocations = matches
            .filter((m) => m.statementId === s.id && m.rowId === r.data?.id)
            .map((m) => ({
              ...m,
              sourceChanged:
                !events.has(m.eventId) ||
                canonicalCash(m.eventSnapshot) !== canonicalCash(events.get(m.eventId)),
            })),
          matched = allocations.reduce((a, m) => a.plus(m.amount), new D(0));
        return {
          ...r,
          allocations,
          matched: matched.toFixed(2),
          remaining: r.data ? new D(r.data.amount).minus(matched).toFixed(2) : null,
        };
      }),
    }));
}
export function availableCash(d: Dataset) {
  const matches = activeMatches(d);
  return cashEvents(d, '0001-01-01', '9999-12-31').map((e) => {
    const entry = d.entries.find((entry) => entry.id === e.id),
      op = d.operations?.find((op) => op.id === e.id);
    const sourceBill =
      op?.kind === 'settlement'
        ? d.entries.find((b) => b.kind === 'bill' && b.id === op.billId)
        : undefined;
    const sourceReference =
      entry?.kind === 'receipt'
        ? entry.patient
        : entry?.kind === 'expense'
          ? `${entry.head} · ${entry.remarks}`
          : sourceBill?.kind === 'bill'
            ? `${sourceBill.invoice} · ${sourceBill.patient}`
            : op?.kind === 'doctor_payment'
              ? `Dr. ${op.doctor} · ${op.period}`
              : e.reference;
    const allocated = matches
      .filter((m) => m.eventId === e.id)
      .reduce((s, m) => s.plus(m.amount), new D(0));
    return {
      ...e,
      sourceReference,
      amount: new D(e.amount).toFixed(2),
      allocated: allocated.toFixed(2),
      needsReview: matches.some(
        (m) => m.eventId === e.id && canonicalCash(m.eventSnapshot) !== canonicalCash(e),
      ),
      remaining: new D(e.amount).toDecimalPlaces(2).minus(allocated).toFixed(2),
    };
  });
}
function canonicalCash(e: { date: string; direction: string; amount: string } | undefined) {
  return e ? `${e.date}|${e.direction}|${new D(e.amount).toFixed(2)}` : '';
}
export function matchBank(d: Dataset, m: BankMatch) {
  const s = bankRegister(d).find((s) => s.id === m.statementId && s.status === 'Committed'),
    row = s?.rows.find((r) => r.data?.id === m.rowId);
  if (!row?.data) throw Error('Committed bank row not found');
  const event = availableCash(d).find((e) => e.id === m.eventId);
  if (!event) throw Error('Recorded cash event not found');
  if (
    row.allocations.some((m) => m.sourceChanged) ||
    activeMatches(d).some(
      (m) => m.eventId === event.id && canonicalCash(m.eventSnapshot) !== canonicalCash(event),
    )
  )
    throw Error('Unmatch changed-source allocations before allocating again');
  if (event.direction !== row.data.direction) throw Error('Bank and cash directions must agree');
  if (
    new D(m.amount).lte(0) ||
    new D(m.amount).gt(row.remaining!) ||
    new D(m.amount).gt(event.remaining)
  )
    throw Error('Match exceeds the unallocated bank row or recorded cash event');
  m.eventSnapshot = { date: event.date, direction: event.direction, amount: event.amount };
  (d.operations ??= []).push(m);
}
export function reverseMatch(d: Dataset, id: string, actor: string, reason: string) {
  const m = d.operations?.find((o): o is BankMatch => o.kind === 'bank_match' && o.id === id);
  if (!m || m.status !== 'Active') throw Error('Active bank match not found');
  m.status = 'Reversed';
  m.reversedAt = new Date().toISOString();
  m.reversedBy = actor;
  m.reversalReason = reason;
}

export function voidStatement(d: Dataset, id: string, actor: string, reason: string) {
  const s = d.operations?.find(
    (o): o is BankStatement => o.kind === 'bank_statement' && o.id === id,
  );
  if (!s || s.status !== 'Committed') throw Error('Committed bank statement not found');
  if (activeMatches(d).some((m) => m.statementId === id))
    throw Error('Unmatch all allocations before voiding a statement');
  s.status = 'Voided';
  s.voidedBy = actor;
  s.voidedAt = new Date().toISOString();
  s.voidReason = reason;
}
