import type { Dataset } from './model.ts';
import type { FxProposal } from './finance-model.ts';
export function approvedFx(d: Dataset, month: string) {
  const rate = d.masters.fx.find((f) => f.month === month);
  const p = d.operations?.find(
    (o): o is FxProposal =>
      o.kind === 'fx_proposal' && o.id === rate?.approvalId && o.status === 'Approved',
  );
  return !!(
    p &&
    rate &&
    p.input.month === month &&
    p.calculated.inrPerAed === rate.inrPerAed &&
    p.input.aedPerUsd === rate.aedPerUsd &&
    p.input.source === rate.source
  );
}
