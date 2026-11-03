import { Decimal as D } from 'decimal.js';
import type { Dataset } from './model.ts';
import { calculateMonth, calculateYear } from './engine.ts';
import { recognitionMonthOf } from './period.ts';
export function explain(
  d: Dataset,
  year: number,
  line: string,
  period?: string,
  view: 'actual' | 'approx' | 'outlook' = 'actual',
) {
  const report = period
    ? calculateMonth(d, period, view === 'approx' ? 'Approx' : 'Actual').rows
    : calculateYear(d, year)[view === 'outlook' ? 'outlook' : 'total'];
  const cell = report[line];
  if (!cell) throw Error('Unknown P&L line');
  const rows = d.entries
    .filter((e) => cell.ids.includes(e.id))
    .map((entry) => {
      const only = { ...d, entries: [entry] };
      const contribution = period
        ? calculateMonth(only, period, view === 'approx' ? 'Approx' : 'Actual').rows[line]
        : calculateYear(only, year)[view === 'outlook' ? 'outlook' : 'total'][line];
      return {
        id: entry.id,
        kind: entry.kind,
        date: entry.date,
        recognitionMonth: recognitionMonthOf(entry),
        reference:
          entry.kind === 'bill'
            ? `${entry.hospital} · ${entry.invoice}`
            : entry.kind === 'expense'
              ? entry.head
              : entry.kind === 'receipt'
                ? entry.source
                : entry.kind === 'wallet'
                  ? entry.remarks
                  : entry.kind === 'adjustment'
                    ? entry.reason
                    : entry.hospital,
        aed: contribution.aed,
        inrLakh: contribution.inr,
      };
    });
  const allocated = rows.reduce((s, r) => s.plus(r.aed), new D(0));
  return {
    line,
    year,
    period: period ?? 'FY',
    view,
    total: cell,
    rows,
    allocated: allocated.toFixed(6),
    roundingResidual: new D(cell.aed).minus(allocated).toFixed(6),
  };
}
