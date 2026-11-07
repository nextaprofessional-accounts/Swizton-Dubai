import type express from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { read, mutate } from './store.ts';
import {
  averageFx,
  observationsFromCsv,
  decideFx,
  proposeException,
  decideException,
  financeReadiness,
  signoffFinance,
} from './finance.ts';
import type { FxInput, FxProposal, FinanceException, FinanceSignoff } from './finance-model.ts';
const reason = z.string().trim().min(8).max(2000),
  revision = z.number().int().nonnegative();
const positive = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,8})?$/)
  .refine((v) => Number(v) > 0, 'Rate must be positive');
const observation = z.object({ date: z.string(), rate: positive });
const inputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  method: z.enum(['Provided monthly average', 'Daily average', 'Cross-rate average']),
  inrPerAed: positive.optional(),
  aedPerUsd: positive.refine(
    (v) => /^\d{1,6}(\.\d{1,6})?$/.test(v),
    'AED/USD supports at most six decimal places',
  ),
  observations: z.array(observation).max(31).default([]),
  csv: z.string().max(64000).optional(),
  source: z.string().trim().min(8).max(500),
  reason,
});
function input(body: unknown): FxInput {
  const { csv, ...p } = inputSchema.parse(body);
  if (csv && p.observations.length) throw Error('Supply CSV or observations, not both');
  if (csv) p.observations = z.array(observation).max(31).parse(observationsFromCsv(csv));
  return p;
}
const write: express.RequestHandler = (q, r, next) => {
  if (q.user.role === 'Management') {
    r.status(403).json({ error: 'Finance or Admin access required' });
    return;
  }
  next();
};
const admin: express.RequestHandler = (q, r, next) => {
  if (q.user.role !== 'Admin') {
    r.status(403).json({ error: 'Independent Admin review required' });
    return;
  }
  next();
};
const reviewSchema = z.object({ approve: z.boolean(), reason, revision });
export function registerFinanceRoutes(app: express.Express) {
  app.post('/api/finance/fx/preview', async (q, r) => {
    r.json(averageFx(input(q.body)));
  });
  app.post('/api/finance/fx', write, async (q, r) => {
    const b = z.object({ input: z.unknown(), revision }).parse(q.body),
      p = input(b.input),
      id = randomUUID();
    const calculated = averageFx(p);
    await mutate(q.user.id, 'finance.fx.prepare', id, p.reason, b.revision, (d) => {
      if (
        d.operations?.some(
          (o) => o.kind === 'fx_proposal' && o.status === 'Pending' && o.input.month === p.month,
        )
      )
        throw Error('A pending proposal already exists for this month');
      const op: FxProposal = {
        id,
        kind: 'fx_proposal',
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
        input: p,
        calculated,
        previous: structuredClone(d.masters.fx.find((f) => f.month === p.month) ?? null),
        status: 'Pending',
      };
      (d.operations ??= []).push(op);
    });
    r.status(201).json({ id });
  });
  app.post('/api/finance/fx/:id/review', admin, async (q, r) => {
    const b = reviewSchema.parse(q.body);
    await mutate(q.user.id, 'finance.fx.review', String(q.params.id), b.reason, b.revision, (d) =>
      decideFx(d, String(q.params.id), q.user.id, b.approve, b.reason),
    );
    r.json({ ok: true });
  });
  app.get('/api/finance/workbooks/:id/:year/readiness', async (q, r) => {
    const year = z.coerce.number().int().min(2023).max(2100).parse(q.params.year),
      s = await read();
    r.json({ ...financeReadiness(s.data, String(q.params.id), year), revision: s.revision });
  });
  app.post('/api/finance/exceptions', write, async (q, r) => {
    const b = z
        .object({
          workbookId: z.string().uuid(),
          itemKey: z.string().regex(/^(issue|check):\d+$/),
          disposition: z.enum([
            'Retain original',
            'Evidence verified',
            'Linked approved adjustment',
          ]),
          evidence: z.string().trim().min(12).max(3000),
          adjustmentId: z.string().uuid().optional(),
          reason,
          revision,
        })
        .parse(q.body),
      id = randomUUID();
    await mutate(q.user.id, 'finance.exception.prepare', id, b.reason, b.revision, (d) => {
      const { revision: _, ...fields } = b;
      const op: FinanceException = {
        ...fields,
        id,
        kind: 'finance_exception',
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
        status: 'Pending',
      };
      proposeException(d, op);
    });
    r.status(201).json({ id });
  });
  app.post('/api/finance/exceptions/:id/review', admin, async (q, r) => {
    const b = reviewSchema.parse(q.body);
    await mutate(
      q.user.id,
      'finance.exception.review',
      String(q.params.id),
      b.reason,
      b.revision,
      (d) => decideException(d, String(q.params.id), q.user.id, b.approve, b.reason),
    );
    r.json({ ok: true });
  });
  app.post('/api/finance/signoffs', admin, async (q, r) => {
    const b = z
        .object({
          workbookId: z.string().uuid(),
          year: z.number().int().min(2023).max(2100),
          mode: z.enum(['Reviewed with exceptions', 'Reconciled']),
          reason,
          revision,
        })
        .parse(q.body),
      id = randomUUID();
    await mutate(q.user.id, 'finance.signoff', id, b.reason, b.revision, (d) => {
      const { revision: _, ...fields } = b;
      const op: FinanceSignoff = {
        ...fields,
        id,
        kind: 'finance_signoff',
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
        fingerprint: '',
        summary: {
          monthsCompared: 0,
          differences: 0,
          retainedExceptions: 0,
          reviewedExceptions: 0,
        },
      };
      signoffFinance(d, op);
    });
    r.status(201).json({ id });
  });
  app.get('/api/finance/workbooks/:id/:year/export', async (q, r) => {
    const year = z.coerce.number().int().min(2023).max(2100).parse(q.params.year),
      s = await read(),
      v = financeReadiness(s.data, String(q.params.id), year),
      w = new ExcelJS.Workbook();
    const summary = w.addWorksheet('Review status');
    summary.addRows([
      ['Finance validation', year],
      ['Source SHA256', v.sourceSha256],
      ['Data revision', s.revision],
      ['Fingerprint', v.fingerprint],
      ['Review blockers', ...v.reviewBlockers],
      ['Reconciliation blockers', ...v.reconcileBlockers],
      ['Baseline policy', 'Original figures preserved; this export does not approve accounts'],
    ]);
    const fx = w.addWorksheet('Monthly FX');
    fx.addRow(['Month', 'INR per AED', 'AED per USD', 'Source', 'Independent approval']);
    for (const row of v.rates)
      fx.addRow([
        row.month,
        row.rate?.inrPerAed ?? 'Missing',
        row.rate?.aedPerUsd ?? '',
        row.rate?.source ?? '',
        row.approved ? 'Approved' : 'Unapproved',
      ]);
    const approvals = w.addWorksheet('FX approval evidence'),
      observations = w.addWorksheet('FX daily observations');
    approvals.addRow([
      'Proposal ID',
      'Month',
      'Status',
      'Method',
      'INR per AED',
      'Observation count',
      'First date',
      'Last date',
      'Prepared by',
      'Prepared at',
      'Reviewed by',
      'Reviewed at',
      'Review note',
      'Source',
    ]);
    observations.addRow(['Proposal ID', 'Month', 'Date', 'Rate', 'Units']);
    for (const proposal of s.data.operations ?? []) {
      if (proposal.kind !== 'fx_proposal' || !proposal.input.month.startsWith(`${year}-`)) continue;
      approvals.addRow([
        proposal.id,
        proposal.input.month,
        proposal.status,
        proposal.input.method,
        proposal.calculated.inrPerAed,
        proposal.calculated.count,
        proposal.calculated.firstDate,
        proposal.calculated.lastDate,
        proposal.createdBy,
        proposal.createdAt,
        proposal.reviewedBy,
        proposal.reviewedAt,
        proposal.reviewNote,
        proposal.input.source,
      ]);
      for (const row of proposal.input.observations)
        observations.addRow([
          proposal.id,
          proposal.input.month,
          row.date,
          row.rate,
          proposal.input.method === 'Cross-rate average' ? 'INR per USD' : 'INR per AED',
        ]);
    }
    const pnl = w.addWorksheet('AED reconciliation');
    pnl.addRow(['Month', 'Line', 'Original baseline', 'Application Actual', 'Delta', 'Status']);
    for (const month of v.comparisons)
      for (const line of month.lines)
        pnl.addRow([
          month.month,
          line.line,
          line.baseline === null ? null : Number(line.baseline),
          line.actual === null ? null : Number(line.actual),
          line.delta === null ? null : Number(line.delta),
          line.matched ? 'Matched' : line.delta === null ? 'Unavailable' : 'Difference',
        ]);
    const findings = w.addWorksheet('Exception register');
    findings.addRow([
      'Finding key',
      'Type',
      'Source',
      'Detail',
      'Disposition',
      'Status',
      'Evidence',
      'Prepared by',
      'Reviewed by',
      'Review note',
    ]);
    for (const item of v.exceptions)
      findings.addRow([
        item.key,
        item.type,
        item.source,
        item.detail,
        item.review?.disposition ?? '',
        item.review?.status ?? 'Open',
        item.review?.evidence ?? '',
        item.review?.createdBy ?? '',
        item.review?.reviewedBy ?? '',
        item.review?.reviewNote ?? '',
      ]);
    const signs = w.addWorksheet('Signoffs');
    signs.addRow([
      'ID',
      'Mode',
      'Signed at',
      'Actor',
      'Current financial state',
      'Fingerprint',
      'Reason',
    ]);
    for (const sign of v.signoffs)
      signs.addRow([
        sign.id,
        sign.mode,
        sign.createdAt,
        sign.createdBy,
        sign.current ? 'Current' : 'Stale',
        sign.fingerprint,
        sign.reason,
      ]);
    for (const sheet of w.worksheets) {
      sheet.columns.forEach((c) => (c.width = 26));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }
    r.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(
      `Swizton-finance-validation-${year}.xlsx`,
    );
    await w.xlsx.write(r);
    r.end();
  });
}
