export interface FxInput {
  month: string;
  method: 'Provided monthly average' | 'Daily average' | 'Cross-rate average';
  inrPerAed?: string;
  aedPerUsd: string;
  observations: { date: string; rate: string }[];
  source: string;
  reason: string;
}
export interface FxProposal {
  kind: 'fx_proposal';
  id: string;
  createdBy: string;
  createdAt: string;
  input: FxInput;
  calculated: {
    inrPerAed: string;
    count: number;
    firstDate: string | null;
    lastDate: string | null;
    basis: string;
  };
  previous: {
    month: string;
    inrPerAed: string;
    aedPerUsd: string;
    source: string;
    approvalId?: string;
  } | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}
export interface FinanceException {
  kind: 'finance_exception';
  id: string;
  createdBy: string;
  createdAt: string;
  workbookId: string;
  itemKey: string;
  disposition: 'Retain original' | 'Evidence verified' | 'Linked approved adjustment';
  evidence: string;
  reason: string;
  adjustmentId?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}
export interface FinanceSignoff {
  kind: 'finance_signoff';
  id: string;
  createdBy: string;
  createdAt: string;
  workbookId: string;
  year: number;
  mode: 'Reviewed with exceptions' | 'Reconciled';
  reason: string;
  fingerprint: string;
  summary: {
    monthsCompared: number;
    differences: number;
    retainedExceptions: number;
    reviewedExceptions: number;
  };
}
