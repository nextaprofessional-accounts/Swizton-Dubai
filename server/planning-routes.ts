import type express from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { read, mutate } from './store.ts';
import { addSettlement, addDoctorPayment } from './workflows.ts';
import {
  forecast,
  forecastAccuracy,
  businessDate,
  validateLead,
  cashForecast,
  validateCashPlan,
  addCashMovement,
  cashReferenceExists,
  remainingExpense,
  expenseBookValue,
} from './planning.ts';
import type { Lead, ForecastSnapshot, CashPlan } from './planning-model.ts';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid calendar date',
  );
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  reason = z.string().trim().min(8).max(1000),
  revision = z.number().int().nonnegative(),
  money = z.string().regex(/^\d{1,15}(\.\d{1,6})?$/),
  cash = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/),
  rate = z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .refine((v) => Number(v) <= 1, 'Use a probability/fraction between 0 and 1');
const write: express.RequestHandler = (q, r, next) => {
  if (q.user.role === 'Management') {
    r.status(403).json({ error: 'Finance or Admin access required' });
    return;
  }
  next();
};
const leadSchema = z.object({
  patientReference: z.string().trim().min(1).max(160),
  contact: z.string().max(100),
  hospital: z.string().min(1),
  procedure: z.string().min(1),
  expectedDate: date,
  recognitionMonth: month.optional(),
  stage: z.enum(['New', 'Qualified', 'Approved', 'Scheduled', 'Won', 'Lost']),
  probability: rate,
  approvalAmount: money,
  consumablesRate: rate,
  collectionLagDays: z.number().int().min(0).max(365),
  owner: z.string().max(100),
  source: z.string().trim().min(1).max(200),
  linkedBillId: z.string().uuid().optional(),
  reason,
});
const forecastSchema = z.object({
  name: z.string().trim().min(1).max(120),
  asOfDate: date,
  months: z.number().int().min(1).max(12),
  probabilityMultiplier: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .refine((v) => Number(v) <= 3),
  revenueMultiplier: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .refine((v) => Number(v) <= 3),
  monthly: z
    .array(
      z.object({
        month,
        fixedCost: money,
        variableCostPerCase: money,
        capacity: z.number().int().min(0).max(10000),
      }),
    )
    .min(1)
    .max(12),
  reason,
});
const cashSchema = z.object({
  asOfDate: date,
  months: z.coerce.number().int().min(1).max(12),
  opening: z.string().regex(/^-?\d{1,15}(\.\d{1,2})?$/),
  pipeline: z.boolean().default(false),
  doctorLagDays: z.coerce.number().int().min(0).max(365).default(0),
});
const cashPlanSchema = z.object({
  date,
  direction: z.enum(['In', 'Out']),
  amount: cash,
  target: z.enum(['bill', 'expense', 'doctor', 'other']),
  linkedId: z.string().uuid().optional(),
  doctor: z.enum(['Chinmay', 'Tahsin']).optional(),
  period: month.optional(),
  description: z.string().trim().min(1).max(200),
  reason,
});
function getSnapshot(d: Awaited<ReturnType<typeof read>>['data'], id: string) {
  const s = d.operations?.find(
    (o): o is ForecastSnapshot => o.kind === 'forecast_snapshot' && o.id === id,
  );
  if (!s) throw Error('Forecast snapshot not found');
  return s;
}
export function registerPlanningRoutes(app: express.Express) {
  app.post('/api/leads', write, async (q, r) => {
    const b = z.object({ lead: leadSchema, revision }).parse(q.body),
      id = randomUUID(),
      now = new Date().toISOString();
    await mutate(q.user.id, 'lead.create', id, b.lead.reason, b.revision, (d) => {
      const lead: Lead = {
        ...b.lead,
        id,
        kind: 'lead',
        createdBy: q.user.id,
        createdAt: now,
        updatedAt: now,
      };
      validateLead(d, lead);
      (d.operations ??= []).push(lead);
    });
    r.status(201).json({ id });
  });
  app.put('/api/leads/:id', write, async (q, r) => {
    const b = z
      .object({ lead: leadSchema, revision, expectedUpdatedAt: z.string().datetime() })
      .parse(q.body);
    await mutate(q.user.id, 'lead.update', String(q.params.id), b.lead.reason, b.revision, (d) => {
      const old = d.operations?.find((o): o is Lead => o.kind === 'lead' && o.id === q.params.id);
      if (!old) throw Error('Lead not found');
      if (old.updatedAt !== b.expectedUpdatedAt)
        throw Error('Conflict: lead changed; reload it before saving');
      const lead = { ...old, ...b.lead, updatedAt: new Date().toISOString() };
      validateLead(d, lead);
      Object.assign(old, lead);
    });
    r.json({ ok: true });
  });
  app.post('/api/forecasts/preview', async (q, r) => {
    const p = forecastSchema.parse(q.body);
    r.json(forecast((await read()).data, p));
  });
  app.post('/api/forecasts', write, async (q, r) => {
    const b = z.object({ params: forecastSchema, revision }).parse(q.body),
      id = randomUUID(),
      createdAt = new Date().toISOString();
    await mutate(q.user.id, 'forecast.capture', id, b.params.reason, b.revision, (d) => {
      const result = forecast(d, b.params),
        version =
          (d.operations ?? []).filter(
            (o) =>
              o.kind === 'forecast_snapshot' &&
              o.params.name === b.params.name &&
              o.params.asOfDate === b.params.asOfDate,
          ).length + 1;
      (d.operations ??= []).push({
        id,
        kind: 'forecast_snapshot',
        createdBy: q.user.id,
        createdAt,
        capturedDate: businessDate(createdAt),
        sourceRevision: b.revision,
        version,
        params: b.params,
        result,
      });
    });
    r.status(201).json({ id });
  });
  app.get('/api/forecasts/:id/accuracy', async (q, r) => {
    const state = await read();
    r.json({
      ...forecastAccuracy(state.data, getSnapshot(state.data, String(q.params.id))),
      actualRevision: state.revision,
    });
  });
  app.get('/api/forecasts/:id/export', async (q, r) => {
    const { data } = await read(),
      s = getSnapshot(data, String(q.params.id)),
      w = new ExcelJS.Workbook(),
      sheet = w.addWorksheet('Frozen forecast');
    sheet.addRow([`${s.params.name} · v${s.version} · cutoff ${s.params.asOfDate}`]);
    sheet.addRow([
      'Snapshot ID',
      s.id,
      'Captured at',
      s.createdAt,
      'Source revision',
      s.sourceRevision,
    ]);
    sheet.addRow([
      'Month',
      'Basis',
      'Actual Swizton AED',
      'Weighted pipeline AED',
      'Expected Swizton AED',
      'Expense AED',
      'Profit AED',
      'Expected cases',
      'Capacity',
      'Capacity gap',
      'INR lakh',
    ]);
    for (const row of s.result.rows)
      sheet.addRow([
        row.month,
        row.basis,
        Number(row.actualSwizton),
        Number(row.pipelineSwizton),
        Number(row.swizton),
        Number(row.expense),
        Number(row.profit),
        Number(row.expectedCases),
        row.capacity,
        Number(row.capacityGap),
        row.inrLakh === null ? null : Number(row.inrLakh),
      ]);
    sheet.columns.forEach((c, i) => (c.width = i === 1 ? 32 : 22));
    const assumptions = w.addWorksheet('Lead assumptions');
    assumptions.addRow([
      'Lead ID',
      'Hospital',
      'Procedure',
      'Expected case date',
      'Recognition month',
      'Collection date',
      'Probability used',
      'Weighted doctor share',
      'Weighted Swizton',
      'Rule ID',
      'Forecast doctor share',
      'Swizton rate',
      'Gross approval AED',
      'Deduction fraction',
      'Base probability',
      'Lead updated at',
    ]);
    for (const line of s.result.leads)
      assumptions.addRow([
        line.leadId,
        line.hospital,
        line.procedure,
        line.date,
        line.recognitionMonth,
        line.collectionDate,
        Number(line.probabilityUsed),
        Number(line.weightedDoctorShare),
        Number(line.weightedSwizton),
        line.ruleId,
        line.rates.share,
        line.rates.swizton,
        Number(line.approvalAmount),
        Number(line.consumablesRate),
        Number(line.baseProbability),
        line.leadUpdatedAt,
      ]);
    assumptions.columns.forEach((c) => (c.width = 25));
    const inputs = w.addWorksheet('Monthly assumptions');
    inputs.addRow(['Reason', s.params.reason]);
    inputs.addRow([
      'Probability sensitivity',
      s.params.probabilityMultiplier,
      'Revenue sensitivity',
      s.params.revenueMultiplier,
    ]);
    inputs.addRow([
      'Month',
      'Fixed cost AED',
      'Variable cost per case AED',
      'Capacity',
      'INR per AED',
      'FX source',
    ]);
    for (const input of s.params.monthly) {
      const row = s.result.rows.find((r) => r.month === input.month)!;
      inputs.addRow([
        input.month,
        Number(input.fixedCost),
        Number(input.variableCostPerCase),
        input.capacity,
        row.inrPerAed === null ? null : Number(row.inrPerAed),
        row.fxSource,
      ]);
    }
    inputs.columns.forEach((c) => (c.width = 28));
    r.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(
      `Swizton-forecast-v${s.version}.xlsx`,
    );
    await w.xlsx.write(r);
    r.end();
  });
  app.post('/api/cash/forecast', async (q, r) => {
    const p = cashSchema.parse(q.body);
    r.json(
      cashForecast(
        (await read()).data,
        p.asOfDate,
        p.months,
        p.opening,
        p.pipeline,
        p.doctorLagDays,
      ),
    );
  });
  app.post('/api/cash/export', async (q, r) => {
    const p = cashSchema.parse(q.body),
      result = cashForecast(
        (await read()).data,
        p.asOfDate,
        p.months,
        p.opening,
        p.pipeline,
        p.doctorLagDays,
      ),
      w = new ExcelJS.Workbook(),
      s = w.addWorksheet('Cash outlook');
    s.addRow([`Cash cutoff ${p.asOfDate} • user-supplied opening AED ${p.opening}`]);
    s.addRow(['Month', 'Opening AED', 'Inflow AED', 'Outflow AED', 'Closing AED', 'Shortfall AED']);
    for (const row of result.rows)
      s.addRow([
        row.month,
        Number(row.opening),
        Number(row.inflow),
        Number(row.outflow),
        Number(row.closing),
        Number(row.shortfall),
      ]);
    s.columns.forEach((c) => (c.width = 24));
    const evidence = w.addWorksheet('Dated cash evidence');
    evidence.addRow(['Date', 'Type', 'Source', 'Direction', 'AED', 'Reference']);
    for (const event of result.events)
      evidence.addRow([
        event.date,
        event.type,
        event.origin,
        event.direction,
        Number(event.amount),
        event.reference,
      ]);
    evidence.columns.forEach((c) => (c.width = 28));
    r.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(
      'Swizton-cash-outlook.xlsx',
    );
    await w.xlsx.write(r);
    r.end();
  });
  app.get('/api/cash/expense-balances', async (_q, r) => {
    const { data } = await read();
    r.json(
      data.entries
        .filter(
          (e): e is Extract<typeof e, { kind: 'expense' }> =>
            e.kind === 'expense' && e.version === 'Actual',
        )
        .map((e) => {
          try {
            return {
              id: e.id,
              head: e.head,
              date: e.date,
              currency: e.currency,
              bookValue: expenseBookValue(data, e.id).amount.toFixed(2),
              outstanding: remainingExpense(data, e.id).toFixed(2),
              error: null,
            };
          } catch (error) {
            return {
              id: e.id,
              head: e.head,
              date: e.date,
              currency: e.currency,
              bookValue: null,
              outstanding: null,
              error: (error as Error).message,
            };
          }
        }),
    );
  });
  app.post('/api/cash/plans', write, async (q, r) => {
    const b = z.object({ plan: cashPlanSchema, revision }).parse(q.body),
      id = randomUUID();
    await mutate(q.user.id, 'cash.plan', id, b.plan.reason, b.revision, (d) => {
      const plan: CashPlan = {
        ...b.plan,
        id,
        kind: 'cash_plan',
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
        status: 'Open',
      };
      validateCashPlan(d, plan);
      (d.operations ??= []).push(plan);
    });
    r.status(201).json({ id });
  });
  app.post('/api/cash/plans/:id/cancel', write, async (q, r) => {
    const b = z.object({ reason, revision }).parse(q.body);
    await mutate(q.user.id, 'cash.cancel', String(q.params.id), b.reason, b.revision, (d) => {
      const plan = d.operations?.find((o) => o.kind === 'cash_plan' && o.id === q.params.id);
      if (!plan || plan.kind !== 'cash_plan' || plan.status !== 'Open')
        throw Error('Open cash plan not found');
      plan.status = 'Cancelled';
    });
    r.json({ ok: true });
  });
  app.post('/api/cash/plans/:id/realize', write, async (q, r) => {
    const b = z
        .object({
          date,
          amount: cash,
          reference: z.string().trim().min(1).max(120),
          reason,
          revision,
        })
        .parse(q.body),
      id = randomUUID();
    await mutate(q.user.id, 'cash.realize', String(q.params.id), b.reason, b.revision, (d) => {
      const plan = d.operations?.find(
        (o): o is CashPlan => o.kind === 'cash_plan' && o.id === q.params.id,
      );
      if (!plan || plan.status !== 'Open') throw Error('Open cash plan not found');
      if (cashReferenceExists(d, b.reference))
        throw Error('Cash allocation reference already exists');
      const base = {
        id,
        date: b.date,
        amount: b.amount,
        reference: b.reference,
        reason: b.reason,
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
      };
      if (plan.target === 'bill')
        addSettlement(d, { ...base, kind: 'settlement', billId: plan.linkedId! });
      else if (plan.target === 'doctor')
        addDoctorPayment(d, {
          ...base,
          kind: 'doctor_payment',
          doctor: plan.doctor!,
          period: plan.period!,
        });
      else
        addCashMovement(d, {
          ...base,
          kind: 'cash_movement',
          direction: plan.direction,
          category: plan.target === 'expense' ? 'Expense payment' : 'Capital / financing',
          linkedExpenseId: plan.target === 'expense' ? plan.linkedId : undefined,
        });
      plan.status = 'Realized';
      plan.realizedId = id;
      plan.realizedAmount = b.amount;
      plan.realizedAt = new Date().toISOString();
    });
    r.status(201).json({ id });
  });
}
