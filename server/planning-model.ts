export type LeadStage = 'New' | 'Qualified' | 'Approved' | 'Scheduled' | 'Won' | 'Lost';
export interface Lead {
  id: string;
  kind: 'lead';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  patientReference: string;
  contact: string;
  hospital: string;
  procedure: string;
  expectedDate: string;
  recognitionMonth?: string;
  stage: LeadStage;
  probability: string;
  approvalAmount: string;
  consumablesRate: string;
  collectionLagDays: number;
  owner: string;
  source: string;
  linkedBillId?: string;
  reason: string;
}
export interface MonthlyAssumption {
  month: string;
  fixedCost: string;
  variableCostPerCase: string;
  capacity: number;
}
export interface ForecastParams {
  name: string;
  asOfDate: string;
  months: number;
  probabilityMultiplier: string;
  revenueMultiplier: string;
  monthly: MonthlyAssumption[];
  reason: string;
}
export interface ForecastRow {
  month: string;
  basis: 'Locked Actual' | 'Actual + weighted pipeline';
  actualSwizton: string;
  pipelineSwizton: string;
  swizton: string;
  expense: string;
  profit: string;
  actualCases: number;
  weightedPipelineCases: string;
  expectedCases: string;
  capacity: number;
  capacityGap: string;
  target: number;
  achievement: string | null;
  inrLakh: string | null;
  inrPerAed: string | null;
  fxSource: string | null;
  warnings: string[];
}
export interface ForecastLeadLine {
  leadId: string;
  hospital: string;
  procedure: string;
  date: string;
  recognitionMonth: string;
  collectionDate: string;
  probabilityUsed: string;
  approvalAmount: string;
  consumablesRate: string;
  baseProbability: string;
  leadUpdatedAt: string;
  doctorShare: string;
  swiztonPerCase: string;
  weightedDoctorShare: string;
  weightedSwizton: string;
  ruleId: string;
  rates: { share: string; swizton: string; doctorPool: string; chinmay: string };
}
export interface ForecastResult {
  rows: ForecastRow[];
  leads: ForecastLeadLine[];
  warnings: string[];
  totals: { swizton: string; expense: string; profit: string; expectedCases: string };
  basis: string;
}
export interface ForecastSnapshot {
  id: string;
  kind: 'forecast_snapshot';
  createdBy: string;
  createdAt: string;
  capturedDate: string;
  sourceRevision: number;
  version: number;
  params: ForecastParams;
  result: ForecastResult;
}
export interface CashPlan {
  id: string;
  kind: 'cash_plan';
  createdBy: string;
  createdAt: string;
  date: string;
  direction: 'In' | 'Out';
  amount: string;
  target: 'bill' | 'expense' | 'doctor' | 'other';
  linkedId?: string;
  doctor?: 'Chinmay' | 'Tahsin';
  period?: string;
  description: string;
  status: 'Open' | 'Realized' | 'Cancelled';
  reason: string;
  realizedId?: string;
  realizedAmount?: string;
  realizedAt?: string;
}
export interface CashMovement {
  id: string;
  kind: 'cash_movement';
  createdBy: string;
  createdAt: string;
  date: string;
  direction: 'In' | 'Out';
  amount: string;
  category: 'Expense payment' | 'Capital / financing';
  linkedExpenseId?: string;
  reference: string;
  reason: string;
}
