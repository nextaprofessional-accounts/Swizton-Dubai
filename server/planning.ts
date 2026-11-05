import { Decimal as D } from 'decimal.js';
import type { Dataset, Entry } from './model.ts';
import { affectedMonths, billShare, calculateMonth, ruleAt } from './engine.ts';
import { recognitionMonthOf } from './period.ts';
import type {
  Lead,
  ForecastParams,
  ForecastResult,
  ForecastSnapshot,
  CashMovement,
  CashPlan,
} from './planning-model.ts';

import { businessDate, monthRange, addDays } from './planning-calendar.ts';
export { businessDate, monthRange, addDays } from './planning-calendar.ts';
export const activeLead = (l: Lead) => !['Won', 'Lost'].includes(l.stage);
export function validateLead(d: Dataset, l: Lead) {
  if (!d.masters.hospitals.some((h) => h.id === l.hospital))
    throw Error('Choose a configured hospital');
  if (!d.masters.procedures.includes(l.procedure)) throw Error('Choose a configured procedure');
  const previous = d.operations?.find((o) => o.kind === 'lead' && o.id === l.id);
  if (previous?.kind === 'lead' && previous.stage === 'Won' && l.stage !== 'Won')
    throw Error('Won leads stay linked to Actual; create a new lead for a repeat procedure');
  if (l.stage === 'Won') {
    const bill = d.entries.find(
      (e) => e.kind === 'bill' && e.id === l.linkedBillId && e.version === 'Actual',
    );
    if (
      !bill ||
      bill.kind !== 'bill' ||
      bill.billType !== 'IP' ||
      bill.hospital !== l.hospital ||
      bill.procedure !== l.procedure
    )
      throw Error(
        'Won leads must link to an existing Actual IP bill for the same hospital and procedure',
      );
    if (
      d.operations?.some(
        (o) =>
          o.kind === 'lead' &&
          o.id !== l.id &&
          o.stage === 'Won' &&
          o.linkedBillId === l.linkedBillId,
      )
    )
      throw Error('This bill already belongs to another won lead');
  } else if (l.linkedBillId) throw Error('Link a bill only when marking the lead Won');
}
export function validatePlanningReferences(d: Dataset) {
  for (const op of d.operations ?? [])
    if (op.kind === 'lead' && activeLead(op)) validateLead(d, op);
}
function actualFor(d: Dataset, month: string, asOf?: string) {
  const known = { ...d, entries: d.entries.filter((e) => !asOf || e.date <= asOf) };
  const hasActual = known.entries.some(
    (e) => e.version === 'Actual' && affectedMonths(e).includes(month),
  );
  if (!d.masters.fx.some((f) => f.month === month) && !hasActual)
    return {
      swizton: new D(0),
      expense: new D(0),
      profit: new D(0),
      cases: 0,
      target: d.masters.targets.find((t) => t.month === month)?.cases ?? 0,
    };
  const a = calculateMonth(known, month, 'Actual');
  return {
    swizton: new D(a.rows['Swizton Revenue'].aed),
    expense: new D(a.rows['Total Expense'].aed),
    profit: new D(a.rows['NET PROFIT / LOSS'].aed),
    cases: a.kpis.cases,
    target: a.kpis.target,
  };
}
export function forecast(d: Dataset, p: ForecastParams): ForecastResult {
  const months = monthRange(p.asOfDate.slice(0, 7), p.months);
  if (
    new Set(p.monthly.map((m) => m.month)).size !== p.months ||
    p.monthly.length !== p.months ||
    months.some((m) => !p.monthly.some((a) => a.month === m))
  )
    throw Error('Supply exactly one cost/capacity assumption for every horizon month');
  const warnings: string[] = [],
    lines: ForecastResult['leads'] = [];
  for (const l of (d.operations ?? []).filter(
    (o): o is Lead => o.kind === 'lead' && activeLead(o),
  )) {
    const revenueMonth = l.recognitionMonth ?? l.expectedDate.slice(0, 7),
      caseMonth = l.expectedDate.slice(0, 7);
    if (!months.includes(revenueMonth) && !months.includes(caseMonth)) continue;
    if (l.expectedDate < p.asOfDate) {
      warnings.push(`Lead ${l.id} is overdue; reschedule it before including it in the forecast`);
      continue;
    }
    validateLead(d, l);
    const r = ruleAt(d.masters, l.hospital, l.expectedDate),
      probability = D.min(1, new D(l.probability).times(p.probabilityMultiplier));
    const doctor = new D(l.approvalAmount)
        .times(new D(1).minus(l.consumablesRate))
        .times(r.forecastShare ?? r.share)
        .times(p.revenueMultiplier),
      swizton = doctor.times(r.swizton);
    lines.push({
      leadId: l.id,
      hospital: l.hospital,
      procedure: l.procedure,
      date: l.expectedDate,
      recognitionMonth: revenueMonth,
      collectionDate: addDays(l.expectedDate, l.collectionLagDays),
      probabilityUsed: probability.toFixed(6),
      approvalAmount: l.approvalAmount,
      consumablesRate: l.consumablesRate,
      baseProbability: l.probability,
      leadUpdatedAt: l.updatedAt,
      doctorShare: doctor.toFixed(6),
      swiztonPerCase: swizton.toFixed(6),
      weightedDoctorShare: doctor.times(probability).toFixed(6),
      weightedSwizton: swizton.times(probability).toFixed(6),
      ruleId: r.id,
      rates: {
        share: r.forecastShare ?? r.share,
        swizton: r.swizton,
        doctorPool: r.doctorPool,
        chinmay: r.chinmay,
      },
    });
  }
  const rows = months.map((month) => {
    const locked = d.closes.some((c) => c.month === month && c.locked),
      actual = actualFor(d, month, locked ? undefined : p.asOfDate),
      assumption = p.monthly.find((m) => m.month === month)!;
    const weightedCases = locked
      ? new D(0)
      : lines
          .filter((l) => l.date.startsWith(month))
          .reduce((s, l) => s.plus(l.probabilityUsed), new D(0));
    const pipeline = locked
      ? new D(0)
      : lines
          .filter((l) => l.recognitionMonth === month)
          .reduce((s, l) => s.plus(l.weightedSwizton), new D(0));
    const expectedCases = new D(actual.cases).plus(weightedCases),
      expense = locked
        ? actual.expense
        : D.max(
            actual.expense,
            new D(assumption.fixedCost).plus(expectedCases.times(assumption.variableCostPerCase)),
          ),
      swizton = actual.swizton.plus(pipeline),
      fx = d.masters.fx.find((f) => f.month === month),
      gap = D.max(0, expectedCases.minus(assumption.capacity));
    const rowWarnings: string[] = [];
    if (gap.gt(0))
      rowWarnings.push('Expected cases exceed capacity; revenue has not been silently capped');
    if (!fx) rowWarnings.push('INR unavailable: approved monthly FX is missing');
    return {
      month,
      basis: locked ? ('Locked Actual' as const) : ('Actual + weighted pipeline' as const),
      actualSwizton: actual.swizton.toFixed(6),
      pipelineSwizton: pipeline.toFixed(6),
      swizton: swizton.toFixed(6),
      expense: expense.toFixed(6),
      profit: swizton.minus(expense).toFixed(6),
      actualCases: actual.cases,
      weightedPipelineCases: weightedCases.toFixed(4),
      expectedCases: expectedCases.toFixed(4),
      capacity: assumption.capacity,
      capacityGap: gap.toFixed(4),
      target: actual.target,
      achievement: actual.target ? expectedCases.div(actual.target).times(100).toFixed(2) : null,
      inrLakh: fx ? swizton.times(fx.inrPerAed).div(100000).toFixed(8) : null,
      inrPerAed: fx?.inrPerAed ?? null,
      fxSource: fx?.source ?? null,
      warnings: rowWarnings,
    };
  });
  return {
    rows,
    leads: lines,
    warnings,
    totals: {
      swizton: rows.reduce((s, r) => s.plus(r.swizton), new D(0)).toFixed(6),
      expense: rows.reduce((s, r) => s.plus(r.expense), new D(0)).toFixed(6),
      profit: rows.reduce((s, r) => s.plus(r.profit), new D(0)).toFixed(6),
      expectedCases: rows.reduce((s, r) => s.plus(r.expectedCases), new D(0)).toFixed(4),
    },
    basis:
      'Open months combine recorded Actual known by cutoff with probability-weighted active leads. Won/Lost and overdue leads are excluded. Expense is the higher of known Actual and fixed + per-case plan. Locked months retain Actual. Older Approx estimates are not added. Capacity gaps are warnings, not automatic cancellations.',
  };
}
export function forecastAccuracy(d: Dataset, s: ForecastSnapshot) {
  const rows = s.result.rows.map((row) => {
    let status = 'Scored';
    if (row.basis === 'Locked Actual') status = 'Already closed at capture';
    else if (s.params.asOfDate !== s.capturedDate) status = 'Hypothetical cutoff — not scored';
    else if (s.capturedDate.slice(0, 7) > row.month) status = 'Retrospective — not scored';
    else if (!d.closes.some((c) => c.month === row.month && c.locked))
      status = 'Open month — not scored';
    const actual = actualFor(d, row.month);
    return {
      month: row.month,
      status,
      forecast: row.swizton,
      actual: actual.swizton.toFixed(6),
      error: new D(row.swizton).minus(actual.swizton).toFixed(6),
      absoluteError: new D(row.swizton).minus(actual.swizton).abs().toFixed(6),
      percentageError: actual.swizton.isZero()
        ? null
        : new D(row.swizton).minus(actual.swizton).div(actual.swizton.abs()).times(100).toFixed(2),
      forecastCases: row.expectedCases,
      actualCases: actual.cases,
      forecastProfit: row.profit,
      actualProfit: actual.profit.toFixed(6),
    };
  });
  const scored = rows.filter((r) => r.status === 'Scored'),
    abs = scored.reduce((s, r) => s.plus(r.absoluteError), new D(0)),
    denominator = scored.reduce((s, r) => s.plus(new D(r.actual).abs()), new D(0));
  return {
    rows,
    summary: {
      scoredMonths: scored.length,
      mae: scored.length ? abs.div(scored.length).toFixed(2) : null,
      wape: denominator.isZero() ? null : abs.div(denominator).times(100).toFixed(2),
      bias: scored.length
        ? scored
            .reduce((s, r) => s.plus(r.error), new D(0))
            .div(scored.length)
            .toFixed(2)
        : null,
    },
    basis:
      'Accuracy uses immutable captured forecasts and currently locked Actual only. Positive bias means overforecast. Zero Actual has no percentage error. Hypothetical, retrospective and already-closed months are not scored.',
  };
}
export function expenseBookValue(d: Dataset, id: string) {
  const e = d.entries.find((e) => e.kind === 'expense' && e.id === id);
  if (!e || e.kind !== 'expense' || e.version !== 'Actual') throw Error('Actual expense not found');
  let a = new D(e.amount);
  if (e.currency !== 'AED') {
    const fx = d.masters.fx.find((f) => f.month === e.date.slice(0, 7));
    if (!fx) throw Error(`Missing original transaction-month FX for ${e.date.slice(0, 7)}`);
    a = e.currency === 'INR' ? a.div(fx.inrPerAed) : a.times(fx.aedPerUsd);
  }
  return { entry: e, amount: a.toDecimalPlaces(2) };
}
export function remainingExpense(d: Dataset, id: string) {
  const { entry, amount } = expenseBookValue(d, id);
  return entry.paid
    ? new D(0)
    : amount.minus(
        (d.operations ?? [])
          .filter((o): o is CashMovement => o.kind === 'cash_movement' && o.linkedExpenseId === id)
          .reduce((s, o) => s.plus(o.amount), new D(0)),
      );
}
export function cashReferenceExists(d: Dataset, ref: string) {
  return d.operations?.some(
    (o) =>
      (o.kind === 'cash_movement' || o.kind === 'settlement' || o.kind === 'doctor_payment') &&
      o.reference === ref,
  );
}
export function addCashMovement(d: Dataset, m: CashMovement) {
  if (new D(m.amount).lte(0)) throw Error('Cash amount must be positive');
  if (cashReferenceExists(d, m.reference)) throw Error('Cash allocation reference already exists');
  if (d.closes.some((c) => c.locked && c.month === m.date.slice(0, 7)))
    throw Error('Cash date is in a locked month');
  if (m.category === 'Expense payment') {
    if (m.direction !== 'Out' || !m.linkedExpenseId)
      throw Error('Expense payments must be outgoing and linked');
    const expense = expenseBookValue(d, m.linkedExpenseId);
    if (m.date < expense.entry.date) throw Error('Payment cannot precede the expense transaction');
    if (new D(m.amount).gt(remainingExpense(d, m.linkedExpenseId)))
      throw Error('Payment exceeds the unpaid expense book value');
  } else if (m.linkedExpenseId) throw Error('Link an expense only for an expense payment');
  (d.operations ??= []).push(m);
}
export function planRemaining(d: Dataset, p: CashPlan) {
  if (p.target === 'bill') {
    const b = d.entries.find(
      (e) => e.kind === 'bill' && e.id === p.linkedId && e.version === 'Actual',
    );
    if (!b || b.kind !== 'bill') throw Error('Linked Actual bill not found');
    return billShare(b, d.masters)
      .toDecimalPlaces(2)
      .minus(
        (d.operations ?? [])
          .filter((o) => o.kind === 'settlement' && o.billId === b.id)
          .reduce((s, o) => s.plus(o.kind === 'settlement' ? o.amount : 0), new D(0)),
      );
  }
  if (p.target === 'expense') return remainingExpense(d, p.linkedId!);
  if (p.target === 'doctor') {
    if (!p.period || !p.doctor) throw Error('Doctor and accrual month are required');
    const a = calculateMonth(d, p.period, 'Actual').rows[`Dr. ${p.doctor} – Professional Fee`];
    return new D(a.aed)
      .toDecimalPlaces(2)
      .minus(
        (d.operations ?? [])
          .filter(
            (o) => o.kind === 'doctor_payment' && o.doctor === p.doctor && o.period === p.period,
          )
          .reduce((s, o) => s.plus(o.kind === 'doctor_payment' ? o.amount : 0), new D(0)),
      );
  }
  return new D(p.amount);
}
const targetKey = (p: CashPlan) =>
  p.target === 'other' ? p.id : `${p.target}:${p.linkedId ?? `${p.doctor}:${p.period}`}`;
export function validateCashPlan(d: Dataset, p: CashPlan) {
  if (['bill', 'expense'].includes(p.target) && (p.doctor || p.period))
    throw Error('Use doctor/period fields only for doctor plans');
  if (p.target === 'doctor' && p.linkedId)
    throw Error('Doctor plans use the fee period, not a bill link');
  if (p.target === 'bill' && p.direction !== 'In')
    throw Error('Hospital collection plans must be incoming');
  if (['expense', 'doctor'].includes(p.target) && p.direction !== 'Out')
    throw Error('Payment plans must be outgoing');
  if (['bill', 'expense'].includes(p.target) && !p.linkedId)
    throw Error('A source record is required');
  if (p.target === 'other' && (p.linkedId || p.doctor || p.period))
    throw Error('Capital/financing plans have no source link');
  if (p.target === 'bill' || p.target === 'expense') {
    const source = d.entries.find((e) => e.id === p.linkedId);
    if (source && p.date < source.date)
      throw Error('Cash plans cannot precede their source transaction');
  }
  if (p.target === 'doctor' && p.period && p.date.slice(0, 7) < p.period)
    throw Error('Future-period advances require a separate prepayment workflow');
  if (new D(p.amount).lte(0)) throw Error('Plan amount must be positive');
  const reserved = (d.operations ?? [])
    .filter(
      (o): o is CashPlan =>
        o.kind === 'cash_plan' &&
        o.status === 'Open' &&
        o.id !== p.id &&
        targetKey(o) === targetKey(p),
    )
    .reduce((s, o) => s.plus(o.amount), new D(0));
  if (p.target !== 'other' && new D(p.amount).plus(reserved).gt(planRemaining(d, p)))
    throw Error('Open cash plans exceed the remaining source obligation');
}
export interface CashEvent {
  id: string;
  date: string;
  direction: 'In' | 'Out';
  amount: string;
  origin: string;
  reference: string;
}
export function cashEvents(d: Dataset, from: string, to: string): CashEvent[] {
  const events: CashEvent[] = [];
  const push = (e: CashEvent) => {
    if (e.date >= from && e.date <= to) events.push(e);
  };
  for (const e of d.entries) {
    if (e.version !== 'Actual' || e.date < from || e.date > to) continue;
    if (e.kind === 'receipt')
      push({
        id: e.id,
        date: e.date,
        direction: 'In',
        amount: e.amount,
        origin: e.source,
        reference: 'Recorded receipt',
      });
    if (e.kind === 'expense' && e.paid)
      push({
        id: e.id,
        date: e.date,
        direction: 'Out',
        amount: expenseBookValue(d, e.id).amount.toFixed(2),
        origin: e.head,
        reference: 'Expense marked paid',
      });
    if (e.kind === 'wallet' && e.action === 'topup')
      push({
        id: e.id,
        date: e.date,
        direction: 'Out',
        amount: e.amount,
        origin: 'Marketing wallet funding',
        reference: e.remarks,
      });
  }
  for (const o of d.operations ?? []) {
    if (o.kind === 'settlement')
      push({
        id: o.id,
        date: o.date,
        direction: 'In',
        amount: o.amount,
        origin: 'Hospital collection',
        reference: o.reference,
      });
    if (o.kind === 'doctor_payment')
      push({
        id: o.id,
        date: o.date,
        direction: 'Out',
        amount: o.amount,
        origin: `Dr. ${o.doctor} fee payment`,
        reference: o.reference,
      });
    if (o.kind === 'cash_movement')
      push({
        id: o.id,
        date: o.date,
        direction: o.direction,
        amount: o.amount,
        origin: o.category,
        reference: o.reference,
      });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function cashForecast(
  d: Dataset,
  asOfDate: string,
  months: number,
  opening: string,
  includePipeline: boolean,
  doctorLagDays: number,
) {
  const horizon = monthRange(asOfDate.slice(0, 7), months),
    end = addDays(`${monthRange(horizon.at(-1)!, 2)[1]}-01`, -1),
    events = cashEvents(d, asOfDate, end).map((e) => ({ ...e, type: 'Recorded' })),
    warnings: string[] = [],
    available = new Map<string, D>();
  for (const p of (d.operations ?? [])
    .filter((o): o is CashPlan => o.kind === 'cash_plan' && o.status === 'Open')
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const date = p.date < asOfDate ? asOfDate : p.date;
    if (date > end) continue;
    if (p.date < asOfDate)
      warnings.push(`Plan ${p.id} is overdue; projected at cutoff without changing its saved date`);
    const key = targetKey(p);
    if (!available.has(key)) available.set(key, D.max(0, planRemaining(d, p)));
    const amount = D.min(p.amount, available.get(key)!);
    available.set(key, available.get(key)!.minus(amount));
    if (amount.lt(p.amount))
      warnings.push(`Plan ${p.id} was capped to the remaining obligation after recorded payments`);
    if (amount.gt(0))
      events.push({
        id: p.id,
        date,
        direction: p.direction,
        amount: amount.toFixed(2),
        origin: p.description,
        reference: p.target,
        type: 'Planned',
      });
  }
  if (includePipeline) {
    for (const l of (d.operations ?? []).filter(
      (o): o is Lead => o.kind === 'lead' && activeLead(o) && o.expectedDate >= asOfDate,
    )) {
      const collection = addDays(l.expectedDate, l.collectionLagDays),
        payment = addDays(collection, doctorLagDays);
      if (collection > end && payment > end) continue;
      validateLead(d, l);
      const r = ruleAt(d.masters, l.hospital, l.expectedDate),
        full = new D(l.approvalAmount)
          .times(new D(1).minus(l.consumablesRate))
          .times(r.forecastShare ?? r.share)
          .times(l.probability),
        fees = full.times(new D(1).minus(r.swizton));
      if (collection >= asOfDate && collection <= end)
        events.push({
          id: `lead-in:${l.id}`,
          date: collection,
          direction: 'In',
          amount: full.toFixed(2),
          origin: 'Weighted procedure collection',
          reference: l.id,
          type: 'Pipeline',
        });
      if (payment >= asOfDate && payment <= end)
        events.push({
          id: `lead-out:${l.id}`,
          date: payment,
          direction: 'Out',
          amount: fees.toFixed(2),
          origin: 'Weighted professional fee payout',
          reference: l.id,
          type: 'Pipeline',
        });
    }
  }
  let balance = new D(opening);
  const rows = horizon.map((month) => {
    const current = events.filter((e) => e.date.startsWith(month)),
      inflow = current
        .filter((e) => e.direction === 'In')
        .reduce((s, e) => s.plus(e.amount), new D(0)),
      outflow = current
        .filter((e) => e.direction === 'Out')
        .reduce((s, e) => s.plus(e.amount), new D(0)),
      start = balance;
    balance = balance.plus(inflow).minus(outflow);
    return {
      month,
      opening: start.toFixed(2),
      inflow: inflow.toFixed(2),
      outflow: outflow.toFixed(2),
      closing: balance.toFixed(2),
      shortfall: D.max(0, balance.negated()).toFixed(2),
    };
  });
  const unplannedBills = d.entries
    .filter((e) => e.kind === 'bill' && e.version === 'Actual' && e.date <= asOfDate)
    .filter(
      (e) =>
        !(d.operations ?? []).some(
          (o) =>
            o.kind === 'cash_plan' &&
            o.status === 'Open' &&
            o.target === 'bill' &&
            o.linkedId === e.id,
        ),
    )
    .filter((e) => {
      const total = e.kind === 'bill' ? billShare(e, d.masters) : new D(0);
      const paid = (d.operations ?? [])
        .filter((o) => o.kind === 'settlement' && o.billId === e.id)
        .reduce((s, o) => s.plus(o.kind === 'settlement' ? o.amount : 0), new D(0));
      return total.minus(paid).gt('.005');
    }).length;
  if (unplannedBills)
    warnings.push(
      `${unplannedBills} outstanding invoice(s) have no open collection plan; their unplanned receipts are not included`,
    );
  return {
    asOfDate,
    openingBalance: opening,
    rows,
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
    warnings,
    basis:
      'Opening cash is the bank balance at the beginning of cutoff day. Recorded dated cash, explicit plans and optional weighted pipeline are separate. Billings, amortisation, wallet spend and opening wallet balances are not cash movements. P&L cost assumptions are not automatically a payment schedule. Capital/financing movements do not post to P&L.',
  };
}
