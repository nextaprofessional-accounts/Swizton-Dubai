import type { WorkflowItem } from './workflow-model.ts';
import { z } from 'zod';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid calendar date',
  );
const money = z.string().regex(/^\d{1,15}(\.\d{1,6})?$/);
const rate = z
  .string()
  .refine((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 1, 'Rate must be between 0 and 1');
export const components = [
  'Consultation',
  'Lab',
  'Radiology',
  'Procedures',
  'Room',
  'Surgeon Fee',
  'OT/Anaesthesia',
  'Nursing',
  'Pharmacy',
  'Consumables',
  'Reports',
] as const;
export const categories = [
  'HR Cost',
  'Marketing Expense',
  'Administration Expense',
  'Finance & Other Expense',
] as const;
const base = { id: z.string().uuid(), date, version: z.enum(['Actual', 'Approx']) };
export const entrySchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('bill'),
    recognitionMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    hospital: z.string().min(1),
    patient: z.string().min(1),
    procedure: z.string().min(1),
    doctor: z.string().min(1),
    billType: z.enum(['IP', 'OP']),
    payment: z.enum(['Cash', 'Insurance']),
    invoice: z.string().min(1),
    gross: money,
    consumables: money,
    pharmacyLab: money,
    adminAmount: money.optional(),
    refundableAmount: money.optional(),
    deductionReason: z.string().min(8).optional(),
    regime: z.enum(['Standard', 'HMS', 'Insurance-OP']),
    components: z.record(z.string(), money),
    visits: z.number().int().nonnegative(),
    vat: money,
    tax: money,
  }),
  z.object({
    ...base,
    kind: z.literal('receipt'),
    recognitionMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    source: z.enum(['Admin Cost Reimbursement', 'OP Consultation']),
    amount: money,
    patient: z.string().default(''),
    visits: z.number().int().nonnegative().default(0),
  }),
  z.object({
    ...base,
    kind: z.literal('estimate'),
    hospital: z.string(),
    patient: z.string(),
    contact: z.string(),
    procedure: z.string(),
    leadSource: z.string(),
    payment: z.enum(['Cash', 'Insurance']),
    approval: money,
    consumablesRate: rate,
    visits: z.number().int().nonnegative(),
  }),
  z.object({
    ...base,
    kind: z.literal('expense'),
    caseId: z.string().uuid().optional(),
    head: z.string(),
    amount: money,
    currency: z.enum(['AED', 'INR', 'USD']),
    basis: z.enum(['Actual', 'Accrual']),
    paid: z.boolean(),
    remarks: z.string(),
    coverageStart: date.nullable(),
    coverageEnd: date.nullable(),
  }),
  z.object({
    ...base,
    kind: z.literal('wallet'),
    costBehavior: z.enum(['Fixed', 'Variable', 'Unclassified']).optional(),
    action: z.enum(['opening', 'topup', 'spend']),
    amount: money,
    remarks: z.string(),
  }),
  z.object({
    ...base,
    kind: z.literal('adjustment'),
    adjustmentType: z.enum(['Amount', 'ChinmayEligibility']).optional(),
    line: z.string(),
    amount: z.string().regex(/^-?\d+(\.\d{1,6})?$/),
    reason: z.string().min(8),
  }),
]);
export type Entry = z.infer<typeof entrySchema>;
export const masterSchema = z.object({
  hospitals: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      method: z.enum(['net-share', 'components']),
    }),
  ),
  doctors: z.array(z.string().min(1)),
  procedures: z.array(z.string().min(1)),
  staff: z.array(z.string()),
  expenseHeads: z.array(
    z.object({
      name: z.string().min(1),
      category: z.enum(categories),
      costBehavior: z.enum(['Fixed', 'Variable', 'Unclassified']).optional(),
    }),
  ),
  rules: z.array(
    z.object({
      id: z.string().min(1),
      hospital: z.string(),
      effectiveFrom: date,
      effectiveTo: date.nullable(),
      share: rate,
      forecastShare: rate.optional(),
      swizton: rate,
      doctorPool: rate,
      chinmay: rate,
      chinmayEligible: z.boolean(),
      admin: rate,
      refundable: rate,
      components: z.record(z.string(), z.record(z.string(), rate)),
    }),
  ),
  fx: z.array(
    z.object({
      approvalId: z.string().uuid().optional(),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      inrPerAed: money.refine((v) => Number(v) > 0),
      aedPerUsd: money.refine((v) => Number(v) > 0),
      source: z.string().min(1),
    }),
  ),
  targets: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      cases: z.number().int().nonnegative(),
    }),
  ),
  comparatives: z.array(
    z.object({
      year: z.number().int(),
      line: z.string(),
      aed: z.string().regex(/^-?\d+(\.\d+)?$/),
      inrLakh: z.string().regex(/^-?\d+(\.\d+)?$/),
    }),
  ),
});
export type Masters = z.infer<typeof masterSchema>;
export interface Close {
  month: string;
  locked: boolean;
  by: string;
  at: string;
  reason: string;
}
export interface Dataset {
  entries: Entry[];
  masters: Masters;
  closes: Close[];
  operations?: WorkflowItem[];
}
export const revenueLines = [
  'CSH',
  'Al Garhoud',
  'IMH',
  'Admin Cost Reimbursement',
  'OP Consultation',
];
export const pnlLines = [
  'Total Revenue',
  'CSH',
  'Al Garhoud',
  'IMH',
  'Admin Cost Reimbursement',
  'OP Consultation',
  'Dr. Chinmay – Professional Fee',
  'Dr. Tahsin – Professional Fee',
  'Swizton Revenue',
  'Swizton • CSH',
  'Swizton • Al Garhoud',
  'Swizton • IMH',
  'Swizton • Admin Cost Reimbursement',
  'Swizton • OP Consultation',
  ...categories,
  'Total Expense',
  'NET PROFIT / LOSS',
];
