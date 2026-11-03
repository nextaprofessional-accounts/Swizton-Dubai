import { Decimal as D } from 'decimal.js';
import type { Dataset } from './model.ts';
import { categories } from './model.ts';
import { recognitionMonthOf } from './period.ts';
import { billShare, calculateMonth, ruleAt, affectedMonths } from './engine.ts';
export function analytics(d: Dataset, month: string) {
  const a = calculateMonth(d, month, 'Actual'),
    f = calculateMonth(d, month, 'Approx'),
    fx = d.masters.fx.find((f) => f.month === month)!;
  const matrix: Record<
    string,
    { hospital: string; procedure: string; cases: number; revenue: D; direct: D }
  > = {};
  const addRow = (hospital: string, procedure: string) =>
    (matrix[`${hospital} / ${procedure}`] ??= {
      hospital,
      procedure,
      cases: 0,
      revenue: new D(0),
      direct: new D(0),
    });
  for (const e of d.entries)
    if (
      e.kind === 'bill' &&
      e.version === 'Actual' &&
      e.billType === 'IP' &&
      recognitionMonthOf(e) === month
    ) {
      const row = addRow(e.hospital, e.procedure);
      row.cases++;
      row.revenue = row.revenue.plus(
        billShare(e, d.masters).times(ruleAt(d.masters, e.hospital, e.date).swizton),
      );
    }
  const costs = { Fixed: new D(0), Variable: new D(0), Unclassified: new D(0) };
  let unknownCount = 0,
    directTotal = new D(0);
  for (const e of d.entries.filter((e) => e.version === 'Actual')) {
    let amount = new D(0),
      behavior: 'Fixed' | 'Variable' | 'Unclassified' = 'Unclassified';
    if (e.kind === 'expense' && affectedMonths(e).includes(month)) {
      amount = new D(e.amount).div(affectedMonths(e).length);
      if (e.currency === 'INR') amount = amount.div(fx.inrPerAed);
      if (e.currency === 'USD') amount = amount.times(fx.aedPerUsd);
      behavior =
        d.masters.expenseHeads.find((h) => h.name === e.head)?.costBehavior ?? 'Unclassified';
      if (e.caseId) {
        const bill = d.entries.find((b) => b.kind === 'bill' && b.id === e.caseId);
        if (bill?.kind === 'bill' && bill.billType === 'IP') {
          const r = addRow(bill.hospital, bill.procedure);
          r.direct = r.direct.plus(amount);
          directTotal = directTotal.plus(amount);
        }
      }
    }
    if (e.kind === 'wallet' && e.action === 'spend' && e.date.startsWith(month)) {
      amount = new D(e.amount);
      behavior = e.costBehavior ?? 'Unclassified';
    }
    if (
      e.kind === 'adjustment' &&
      e.adjustmentType !== 'ChinmayEligibility' &&
      e.date.startsWith(month) &&
      categories.includes(e.line as (typeof categories)[number])
    )
      amount = new D(e.amount);
    costs[behavior] = costs[behavior].plus(amount);
    if (behavior === 'Unclassified' && !amount.isZero()) unknownCount++;
  }
  const totalCases = Object.values(matrix).reduce((s, r) => s + r.cases, 0),
    expense = new D(a.rows['Total Expense'].aed),
    swizton = Object.values(matrix).reduce((s, r) => s.plus(r.revenue), new D(0)),
    shared = expense.minus(directTotal),
    contribution = totalCases ? swizton.minus(costs.Variable).div(totalCases) : new D(0);
  return {
    month,
    variance: Object.keys(a.rows).map((line) => ({
      line,
      actual: a.rows[line].aed,
      approx: f.rows[line].aed,
      variance: new D(a.rows[line].aed).minus(f.rows[line].aed).toFixed(2),
    })),
    ranking: Object.values(matrix)
      .map((r) => {
        const allocation = totalCases ? shared.times(r.cases).div(totalCases) : new D(0);
        return {
          hospital: r.hospital,
          procedure: r.procedure,
          cases: r.cases,
          swizton: r.revenue.toFixed(2),
          perCase: r.cases ? r.revenue.div(r.cases).toFixed(2) : null,
          directExpense: r.direct.toFixed(2),
          allocatedExpense: allocation.toFixed(2),
          profitAfterAllocation: r.revenue.minus(r.direct).minus(allocation).toFixed(2),
        };
      })
      .sort((a, b) => Number(b.swizton) - Number(a.swizton)),
    breakeven:
      totalCases && swizton.gt(0) ? expense.div(swizton.div(totalCases)).ceil().toString() : null,
    costs: {
      fixed: costs.Fixed.toFixed(2),
      variable: costs.Variable.toFixed(2),
      unclassified: costs.Unclassified.toFixed(2),
      unclassifiedCount: unknownCount,
      contributionPerCase: contribution.toFixed(2),
      fixedCostBreakeven:
        unknownCount === 0 && contribution.gt(0)
          ? costs.Fixed.div(contribution).ceil().toString()
          : null,
      status: unknownCount
        ? 'Classify all expense heads and wallet spend before using fixed-cost breakeven'
        : contribution.lte(0)
          ? 'No positive per-case contribution'
          : 'Classifications complete',
    },
    allocationBasis:
      'Case-linked ledger costs are attributed directly; remaining shared monthly expenses are allocated evenly per recognised IP bill. Hospital bill consumables are already reflected in net revenue and are not deducted twice. OP/reimbursement revenue is excluded from the ranking. Recognised-bill counts can differ from occurrence-date case KPIs.',
  };
}
export function budget(
  d: Dataset,
  month: string,
  items: { hospital: string; procedure: string; cases: number; revenuePerCase: string }[],
  fixedCost: string,
) {
  const rows = items.map((i) => {
    if (!d.masters.procedures.includes(i.procedure)) throw Error('Unknown procedure');
    const r = ruleAt(d.masters, i.hospital, `${month}-01`);
    const gross = new D(i.revenuePerCase).times(i.cases);
    return { ...i, revenue: gross.toFixed(2), swizton: gross.times(r.swizton).toFixed(2) };
  });
  const revenue = rows.reduce((s, r) => s.plus(r.swizton), new D(0));
  return {
    rows,
    swizton: revenue.toFixed(2),
    expense: fixedCost,
    profit: revenue.minus(fixedCost).toFixed(2),
    basis:
      'Revenue per case is hospital doctor-fee/final-share revenue, after hospital deductions. Fixed cost is an explicit planning assumption; no inferred direct-cost model.',
  };
}
