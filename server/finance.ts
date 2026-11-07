import { approvedFx } from './fx-provenance.ts';
export { approvedFx } from './fx-provenance.ts';
import { Decimal as D } from 'decimal.js';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type { Dataset } from './model.ts';
import type { WorkbookReview } from './workflow-model.ts';
import type { FxInput, FxProposal, FinanceException, FinanceSignoff } from './finance-model.ts';
import { calculateMonth } from './engine.ts';
import { replaceMasters } from './workflows.ts';

export function canonical(value: unknown): string {
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, val]) => [k, normalize(val)]),
          )
        : v;
  return JSON.stringify(normalize(value));
}
function roundedRate(value: D) {
  const result = value.toFixed(6);
  if (!new D(result).gt(0)) throw Error('Calculated rate rounds to zero');
  return result;
}
export function observationsFromCsv(csv: string): FxInput['observations'] {
  const rows = parse(csv, {
    columns: (header: string[]) => {
      if (header.length !== 2 || !header.includes('date') || !header.includes('rate'))
        throw Error('CSV headers must be exactly date,rate');
      return header;
    },
    bom: true,
    skip_empty_lines: true,
    trim: true,
    max_record_size: 1000,
  }) as Record<string, string>[];
  if (rows.length > 31) throw Error('Supply at most 31 daily observations');
  return rows.map((r: Record<string, string>) => {
    if (!('date' in r) || !('rate' in r) || Object.keys(r).length !== 2)
      throw Error('CSV headers must be date,rate');
    return { date: r.date, rate: r.rate };
  });
}
export function averageFx(p: FxInput) {
  if (!new D(p.aedPerUsd).gt(0)) throw Error('AED per USD must be positive');
  if (p.method === 'Provided monthly average') {
    if (p.observations.length)
      throw Error('Provided monthly averages cannot include daily observations');
    if (!p.inrPerAed || !new D(p.inrPerAed).gt(0))
      throw Error('Supply the approved-source monthly INR per AED average');
    return {
      inrPerAed: roundedRate(new D(p.inrPerAed)),
      count: 0,
      firstDate: null,
      lastDate: null,
      basis: 'Monthly average supplied by preparer; source verification required',
    };
  }
  if (p.inrPerAed) throw Error('Do not supply a manual rate with calculated daily averages');
  if (!p.observations.length || p.observations.length > 31)
    throw Error('Supply 1–31 dated daily observations');
  const dates = new Set<string>();
  for (const row of p.observations) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isFinite(Date.parse(row.date)) ||
      new Date(row.date).toISOString().slice(0, 10) !== row.date ||
      !row.date.startsWith(p.month + '-')
    )
      throw Error('Every observation must be a valid date in the selected month');
    if (dates.has(row.date)) throw Error('Duplicate observation date');
    if (!new D(row.rate).gt(0)) throw Error('Daily rates must be positive');
    dates.add(row.date);
  }
  const sorted = [...dates].sort();
  let average = p.observations
    .reduce((s, r) => s.plus(r.rate), new D(0))
    .div(p.observations.length);
  if (p.method === 'Cross-rate average') average = average.div(p.aedPerUsd);
  return {
    inrPerAed: roundedRate(average),
    count: dates.size,
    firstDate: sorted[0],
    lastDate: sorted.at(-1)!,
    basis:
      p.method === 'Cross-rate average'
        ? 'Equal-weight mean of supplied INR/USD observations divided by the supplied monthly AED/USD rate; no missing-date fill'
        : 'Equal-weight mean of supplied INR/AED observations; no missing-date fill',
  };
}
export function decideFx(d: Dataset, id: string, actor: string, approve: boolean, note: string) {
  const p = d.operations?.find((o): o is FxProposal => o.kind === 'fx_proposal' && o.id === id);
  if (!p || p.status !== 'Pending') throw Error('Pending FX proposal not found');
  if (p.createdBy === actor) throw Error('An independent Admin must review the FX proposal');
  if (approve) {
    const current = d.masters.fx.find((f) => f.month === p.input.month) ?? null;
    if (canonical(current) !== canonical(p.previous))
      throw Error('Conflict: monthly FX changed since preparation; submit a new proposal');
    if (d.closes.some((c) => c.month === p.input.month && c.locked))
      throw Error('Reopen the locked month before approving a replacement FX rate');
    const result = averageFx(p.input);
    if (!new D(result.inrPerAed).gt(0)) throw Error('Calculated rate rounds to zero');
    const next = structuredClone(d.masters);
    next.fx = next.fx.filter((f) => f.month !== p.input.month);
    next.fx.push({
      month: p.input.month,
      inrPerAed: result.inrPerAed,
      aedPerUsd: p.input.aedPerUsd,
      source: p.input.source,
      approvalId: p.id,
    });
    next.fx.sort((a, b) => a.month.localeCompare(b.month));
    replaceMasters(d, next);
  }
  p.status = approve ? 'Approved' : 'Rejected';
  p.reviewedBy = actor;
  p.reviewedAt = new Date().toISOString();
  p.reviewNote = note;
}
export function workbookOf(d: Dataset, id: string) {
  const review = d.operations?.find(
    (o): o is WorkbookReview => o.kind === 'workbook_review' && o.id === id,
  );
  if (!review) throw Error('Workbook review not found');
  return review;
}
export function exceptionItems(review: WorkbookReview) {
  return [
    ...review.issues.map((i, index) => ({
      key: `issue:${index}`,
      type: 'Statement finding',
      source: i.cells.join(', '),
      detail: `${i.code}: ${i.detail}`,
      status: i.severity,
    })),
    ...(review.sourceChecks ?? []).flatMap((c, index) =>
      c.status === 'matched'
        ? []
        : [
            {
              key: `check:${index}`,
              type: 'Source calculation',
              source: c.source,
              detail:
                c.reason ??
                `${c.kind}: expected ${c.expected ?? 'unavailable'}, computed ${c.computed ?? 'unavailable'}, delta ${c.delta ?? 'unavailable'}`,
              status: c.status,
            },
          ],
    ),
  ];
}
export function proposeException(d: Dataset, item: FinanceException) {
  const w = workbookOf(d, item.workbookId);
  if (!exceptionItems(w).some((i) => i.key === item.itemKey))
    throw Error('Workbook finding not found');
  if (
    d.operations?.some(
      (o) =>
        o.kind === 'finance_exception' &&
        o.workbookId === item.workbookId &&
        o.itemKey === item.itemKey &&
        o.status !== 'Rejected',
    )
  )
    throw Error('This finding already has a pending or approved disposition');
  if (item.disposition === 'Linked approved adjustment') {
    if (
      !d.operations?.some(
        (o) =>
          o.kind === 'adjustment_request' &&
          o.status === 'Approved' &&
          o.entry.id === item.adjustmentId &&
          d.entries.some((e) => e.id === item.adjustmentId),
      )
    )
      throw Error('Link a posted independently approved adjustment entry');
  } else if (item.adjustmentId) throw Error('Only adjustment dispositions can link an adjustment');
  (d.operations ??= []).push(item);
}
export function decideException(
  d: Dataset,
  id: string,
  actor: string,
  approve: boolean,
  note: string,
) {
  const item = d.operations?.find(
    (o): o is FinanceException => o.kind === 'finance_exception' && o.id === id,
  );
  if (!item || item.status !== 'Pending') throw Error('Pending exception disposition not found');
  if (item.createdBy === actor) throw Error('An independent Admin must review the exception');
  item.status = approve ? 'Approved' : 'Rejected';
  item.reviewedBy = actor;
  item.reviewedAt = new Date().toISOString();
  item.reviewNote = note;
}
export function financeReadiness(d: Dataset, workbookId: string, year: number) {
  const w = workbookOf(d, workbookId),
    items = exceptionItems(w);
  const dispositions = (d.operations ?? []).filter(
    (o): o is FinanceException => o.kind === 'finance_exception' && o.workbookId === w.id,
  );
  const exceptions = items.map((i) => ({
    ...i,
    review: dispositions.find((o) => o.itemKey === i.key && o.status !== 'Rejected') ?? null,
  }));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const rates = months.map((month) => ({
    month,
    rate: d.masters.fx.find((f) => f.month === month) ?? null,
    approved: approvedFx(d, month),
  }));
  const comparisons = months.map((month) => {
    const source = w.baseline.filter((b) => b.month === month);
    let actual: Record<string, string> | null = null,
      error: string | null = null;
    try {
      const a = calculateMonth(d, month, 'Actual');
      actual = {
        revenue: a.rows['Total Revenue'].aed,
        swizton: a.rows['Swizton Revenue'].aed,
        expense: a.rows['Total Expense'].aed,
        profit: a.rows['NET PROFIT / LOSS'].aed,
      };
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      month,
      error,
      lines: ['revenue', 'swizton', 'expense', 'profit'].map((line) => {
        const raw = source.length === 1 ? source[0][line as 'revenue'] : undefined;
        const baseline = raw !== undefined && /^-?\d+(\.\d+)?$/.test(raw) ? raw : null;
        const value = actual?.[line] ?? null;
        const delta =
          baseline !== null && value !== null ? new D(value).minus(baseline).toFixed(6) : null;
        return {
          line,
          baseline,
          actual: value,
          delta,
          matched: delta !== null && new D(delta).abs().lte('0.005'),
        };
      }),
    };
  });
  const unreviewed = exceptions.filter((i) => i.review?.status !== 'Approved').length;
  const retained = exceptions.filter(
    (i) => i.review?.status === 'Approved' && i.review.disposition === 'Retain original',
  ).length;
  const differences = comparisons
    .flatMap((c) => c.lines)
    .filter((l) => l.delta !== null && !l.matched).length;
  const monthsCompared = comparisons.filter((c) => c.lines.every((l) => l.delta !== null)).length;
  const missingFx = rates.filter((r) => !r.approved).length;
  const pendingAdjustments = (d.operations ?? [])
    .filter(
      (o) =>
        o.kind === 'adjustment_request' &&
        o.status === 'Pending' &&
        o.entry.date.startsWith(`${year}-`),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const pendingFx = (d.operations ?? [])
    .filter(
      (o) =>
        o.kind === 'fx_proposal' && o.status === 'Pending' && o.input.month.startsWith(`${year}-`),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const reviewBlockers = [
    ...(pendingFx.length
      ? [`${pendingFx.length} monthly FX proposals await independent review`]
      : []),
    ...(pendingAdjustments.length
      ? [`${pendingAdjustments.length} financial adjustments await independent review`]
      : []),
    ...(unreviewed ? [`${unreviewed} workbook findings need independent review`] : []),
    ...(missingFx ? [`${missingFx} monthly FX rates lack current approval`] : []),
    ...(monthsCompared === 0 ? ['No baseline months can be compared to the application'] : []),
  ];
  const reconcileBlockers = [
    ...reviewBlockers,
    ...(monthsCompared !== 12
      ? ['All 12 monthly AED baselines must be available for full-year reconciliation']
      : []),
    ...(differences ? [`${differences} AED line differences remain`] : []),
    ...(retained ? [`${retained} findings explicitly retain original exceptions`] : []),
  ];
  const fingerprint = createHash('sha256')
    .update(
      canonical({
        source: w.sourceSha256,
        pendingAdjustments,
        pendingFx,
        baseline: w.baseline,
        issues: w.issues,
        checks: w.sourceChecks,
        masters: d.masters,
        entries: d.entries
          .filter((e) => e.version === 'Actual')
          .sort((a, b) => a.id.localeCompare(b.id)),
        closes: d.closes
          .filter((c) => c.month.startsWith(`${year}-`))
          .sort((a, b) => a.month.localeCompare(b.month)),
        dispositions: dispositions
          .filter((o) => o.status === 'Approved')
          .sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest('hex');
  const signoffs = (d.operations ?? [])
    .filter(
      (o): o is FinanceSignoff =>
        o.kind === 'finance_signoff' && o.workbookId === w.id && o.year === year,
    )
    .map((s) => ({ ...s, current: s.fingerprint === fingerprint }));
  return {
    workbookId,
    year,
    sourceSha256: w.sourceSha256,
    rates,
    exceptions,
    comparisons,
    reviewBlockers,
    reconcileBlockers,
    fingerprint,
    signoffs,
    summary: {
      monthsCompared,
      differences,
      retainedExceptions: retained,
      reviewedExceptions: exceptions.length - unreviewed,
    },
  };
}
export function signoffFinance(d: Dataset, s: FinanceSignoff) {
  const w = workbookOf(d, s.workbookId);
  if (w.createdBy === s.createdBy)
    throw Error('An independent Admin must sign off the workbook review');
  const result = financeReadiness(d, s.workbookId, s.year);
  const blockers = s.mode === 'Reconciled' ? result.reconcileBlockers : result.reviewBlockers;
  if (blockers.length) throw Error(blockers.join('; '));
  if (
    d.operations?.some(
      (o) =>
        o.kind === 'finance_signoff' &&
        o.workbookId === s.workbookId &&
        o.year === s.year &&
        o.mode === s.mode &&
        o.fingerprint === result.fingerprint,
    )
  )
    throw Error('This financial state is already signed off in the selected mode');
  s.fingerprint = result.fingerprint;
  s.summary = result.summary;
  (d.operations ??= []).push(s);
}
