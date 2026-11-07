export interface HospitalProfile {
  kind: 'hospital_profile';
  id: string;
  createdBy: string;
  createdAt: string;
  name: string;
  version: number;
  hospital: string;
  dateFormat: 'ISO' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  numberFormat: 'Plain' | 'Comma thousands';
  columns: Record<string, string>;
  defaults: Record<string, string>;
  aliases: Record<string, Record<string, string>>;
  reason: string;
}
export interface CaseRecord {
  kind: 'case_record';
  id: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  billId: string;
  status: 'Documentation pending' | 'Claim submitted' | 'Collection follow-up' | 'Settled';
  hospitalCaseReference: string;
  authorizationReference: string;
  expectedCollectionDate?: string;
  notes: string;
  reason: string;
}
export interface BankRow {
  id: string;
  transactionId: string;
  date: string;
  direction: 'In' | 'Out';
  amount: string;
  reference: string;
}
export interface BankStatement {
  kind: 'bank_statement';
  id: string;
  createdBy: string;
  createdAt: string;
  name: string;
  account: string;
  hash: string;
  currency: 'AED';
  status: 'Preview' | 'Committed' | 'Cancelled' | 'Voided';
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
  rows: { row: number; data: BankRow | null; errors: string[] }[];
  reason: string;
  committedAt?: string;
}
export interface BankMatch {
  kind: 'bank_match';
  id: string;
  createdBy: string;
  createdAt: string;
  statementId: string;
  rowId: string;
  eventId: string;
  amount: string;
  reason: string;
  eventSnapshot?: { date: string; direction: 'In' | 'Out'; amount: string };
  status: 'Active' | 'Reversed';
  reversedBy?: string;
  reversedAt?: string;
  reversalReason?: string;
}
