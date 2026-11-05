import type { Lead, ForecastSnapshot, CashPlan, CashMovement } from './planning-model.ts';
import type { Entry } from './model.ts';
interface Base {
  id: string;
  createdBy: string;
  createdAt: string;
}
export type AdjustmentRequest = Base & {
  kind: 'adjustment_request';
  entry: Extract<Entry, { kind: 'adjustment' }>;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
};
export type ImportBatch = Base & {
  kind: 'import_batch';
  name: string;
  hash: string;
  status: 'Preview' | 'Committed' | 'Cancelled';
  rows: { row: number; entry: Entry | null; errors: string[] }[];
  reason: string;
  committedAt?: string;
};
export type Settlement = Base & {
  kind: 'settlement';
  billId: string;
  date: string;
  amount: string;
  reference: string;
  reason: string;
};
export type BudgetScenario = Base & {
  kind: 'budget';
  name: string;
  month: string;
  version: number;
  projection: { swizton: string; expense: string; profit: string };
  fixedCost: string;
  items: { hospital: string; procedure: string; cases: number; revenuePerCase: string }[];
  reason: string;
};
export type WorkbookReview = Base & {
  kind: 'workbook_review';
  name: string;
  sourceSha256: string;
  inventory: unknown[];
  sourceChecks?: {
    kind: string;
    source: string;
    status: 'matched' | 'mismatch' | 'blocked';
    expected?: string;
    computed?: string;
    delta?: string;
    reason?: string;
  }[];
  issues: {
    code: string;
    severity: string;
    cells: string[];
    detail: string;
    actual?: string;
    expected?: string;
    delta?: string;
  }[];
  readiness: { matchedChecks: number; mismatchedChecks: number; blockedChecks: number };
  baseline: {
    month: string;
    revenue: string;
    swizton: string;
    expense: string;
    profit: string;
    rawInr: string;
  }[];
  decisions: {
    preserveOriginal: true;
    fxStatus: 'Awaiting approved RBI rates';
    recognition: 'Separate invoice date and recognition month';
  };
  storageId: string;
};
export type DoctorPayment = Base & {
  kind: 'doctor_payment';
  doctor: 'Chinmay' | 'Tahsin';
  period: string;
  date: string;
  amount: string;
  reference: string;
  reason: string;
};
export type WorkflowItem =
  | Lead
  | ForecastSnapshot
  | CashPlan
  | CashMovement
  | DoctorPayment
  | AdjustmentRequest
  | ImportBatch
  | Settlement
  | BudgetScenario
  | WorkbookReview;
