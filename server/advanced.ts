import ExcelJS from 'exceljs';
import type express from 'express';
import { existsSync } from 'node:fs';
import { projectRoot } from './paths.ts';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { read, mutate, demo } from './store.ts';
import { entrySchema } from './model.ts';
import { calculateMonth } from './engine.ts';
import { parseBillRows, previewBills, validateXlsxArchive } from './imports.ts';
import { assertUnlocked, validateDataset } from './validation.ts';
import {
  reviewAdjustment,
  addSettlement,
  receivables,
  closeReadiness,
  doctorPayables,
  addDoctorPayment,
} from './workflows.ts';
import { budget } from './analytics.ts';
import { explain } from './explain.ts';
import type { ImportBatch, WorkbookReview } from './workflow-model.ts';
const reason = z.string().trim().min(8).max(1000),
  revision = z.number().int().nonnegative(),
  month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v),
  money = z.string().regex(/^\d{1,15}(\.\d{1,6})?$/);
const write: express.RequestHandler = (q, r, next) => {
  if (q.user.role === 'Management') {
    r.status(403).json({ error: 'Finance or Admin access required' });
    return;
  }
  next();
};
const admin: express.RequestHandler = (q, r, next) => {
  if (q.user.role !== 'Admin') {
    r.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};
const root = resolve(
  process.env.PRIVATE_DATA_DIR ??
    (demo ? resolve(tmpdir(), 'swizton-workbooks') : '/workspace/private/swizton-workbooks'),
);
const outsideProject = (path: string) => {
  const rel = relative(projectRoot, path);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..'))
    throw Error('Private workbook storage must be outside the project checkout');
};
outsideProject(root);
export function registerAdvancedRoutes(app: express.Express) {
  app.get('/api/reports/drilldown', async (q, r) => {
    const b = z
      .object({
        year: z.coerce.number().int().min(2023).max(2100),
        line: z.string().min(1),
        period: month.optional(),
        view: z.enum(['actual', 'approx', 'outlook']).default('actual'),
      })
      .parse(q.query);
    r.json(explain((await read()).data, b.year, b.line, b.period, b.view));
  });
  app.get('/api/workflows', async (q, r) => {
    const s = await read();
    r.json({
      revision: s.revision,
      items: (s.data.operations ?? []).filter(
        (o) =>
          q.user.role !== 'Management' || !['import_batch', 'adjustment_request'].includes(o.kind),
      ),
    });
  });
  app.post('/api/adjustments', write, async (q, r) => {
    const b = z.object({ entry: entrySchema, reason, revision }).parse(q.body);
    if (b.entry.kind !== 'adjustment') throw Error('Adjustment entry required');
    const entry = b.entry,
      id = randomUUID();
    await mutate(q.user.id, 'adjustment.submit', id, b.reason, b.revision, (d) => {
      assertUnlocked(d, entry);
      validateDataset({ ...d, entries: [...d.entries, entry] });
      (d.operations ??= []).push({
        id,
        kind: 'adjustment_request',
        entry,
        reason: b.reason,
        status: 'Pending',
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
      });
    });
    r.status(201).json({ id, status: 'Pending' });
  });
  app.post('/api/adjustments/:id/review', admin, async (q, r) => {
    const b = z.object({ approve: z.boolean(), reason, revision }).parse(q.body);
    await mutate(q.user.id, 'adjustment.review', String(q.params.id), b.reason, b.revision, (d) =>
      reviewAdjustment(d, String(q.params.id), q.user.id, b.approve, b.reason),
    );
    r.json({ ok: true });
  });
  app.post('/api/imports/preview', write, async (q, r) => {
    const b = z
      .object({
        name: z.string().min(1).max(120),
        format: z.enum(['csv', 'xlsx']),
        content: z.string().max(7_000_000),
        reason,
        revision,
      })
      .parse(q.body);
    const rows = await parseBillRows(b.format, b.content),
      id = randomUUID(),
      hash = createHash('sha256').update(b.content).digest('hex');
    let result: ImportBatch | undefined;
    await mutate(q.user.id, 'import.preview', id, b.reason, b.revision, (d) => {
      if (
        d.operations?.some(
          (o) => o.kind === 'import_batch' && o.hash === hash && o.status !== 'Cancelled',
        )
      )
        throw Error('This file already has an import batch');
      result = {
        id,
        kind: 'import_batch',
        name: b.name,
        hash,
        status: 'Preview',
        reason: b.reason,
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
        rows: previewBills(rows, d),
      };
      (d.operations ??= []).push(result);
    });
    r.status(201).json(result);
  });
  app.post('/api/imports/:id/commit', write, async (q, r) => {
    const b = z.object({ reason, revision }).parse(q.body);
    await mutate(q.user.id, 'import.commit', String(q.params.id), b.reason, b.revision, (d) => {
      const batch = d.operations?.find(
        (o): o is ImportBatch => o.kind === 'import_batch' && o.id === q.params.id,
      );
      if (!batch || batch.status !== 'Preview') throw Error('Open import preview not found');
      if (batch.rows.some((row) => row.errors.length || !row.entry))
        throw Error('Resolve all row errors and upload a corrected batch before committing');
      for (const row of batch.rows) {
        assertUnlocked(d, row.entry!);
        d.entries.push(row.entry!);
      }
      validateDataset(d);
      batch.status = 'Committed';
      batch.committedAt = new Date().toISOString();
    });
    r.json({ ok: true });
  });
  app.post('/api/imports/:id/cancel', write, async (q, r) => {
    const b = z.object({ reason, revision }).parse(q.body);
    await mutate(q.user.id, 'import.cancel', String(q.params.id), b.reason, b.revision, (d) => {
      const op = d.operations?.find((o) => o.kind === 'import_batch' && o.id === q.params.id);
      if (!op || op.kind !== 'import_batch' || op.status !== 'Preview')
        throw Error('Open import preview not found');
      op.status = 'Cancelled';
    });
    r.json({ ok: true });
  });
  app.get('/api/doctor-payables/:month', async (q, r) =>
    r.json(doctorPayables((await read()).data, month.parse(q.params.month))),
  );
  app.post('/api/doctor-payments', write, async (q, r) => {
    const b = z
        .object({
          doctor: z.enum(['Chinmay', 'Tahsin']),
          period: month,
          date,
          amount: money,
          reference: z.string().trim().min(1).max(120),
          reason,
          revision,
        })
        .parse(q.body),
      id = randomUUID();
    await mutate(q.user.id, 'doctor.payment', id, b.reason, b.revision, (d) =>
      addDoctorPayment(d, {
        id,
        kind: 'doctor_payment',
        doctor: b.doctor,
        period: b.period,
        date: b.date,
        amount: b.amount,
        reference: b.reference,
        reason: b.reason,
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
      }),
    );
    r.status(201).json({ id });
  });
  app.get('/api/receivables', async (q, r) => {
    const asOf = date.parse(q.query.asOf ?? new Date().toISOString().slice(0, 10));
    r.json(receivables((await read()).data, asOf));
  });
  app.post('/api/settlements', write, async (q, r) => {
    const b = z
        .object({
          billId: z.string().uuid(),
          date,
          amount: money,
          reference: z.string().trim().min(1).max(120),
          reason,
          revision,
        })
        .parse(q.body),
      id = randomUUID();
    await mutate(q.user.id, 'settlement.create', id, b.reason, b.revision, (d) =>
      addSettlement(d, {
        id,
        kind: 'settlement',
        billId: b.billId,
        date: b.date,
        amount: b.amount,
        reference: b.reference,
        reason: b.reason,
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
      }),
    );
    r.status(201).json({ id });
  });
  app.get('/api/months/:month/readiness', async (q, r) =>
    r.json(closeReadiness((await read()).data, month.parse(q.params.month))),
  );
  app.post('/api/budgets', write, async (q, r) => {
    const b = z
        .object({
          name: z.string().trim().min(1).max(120),
          month,
          fixedCost: money,
          items: z
            .array(
              z.object({
                hospital: z.string(),
                procedure: z.string(),
                cases: z.number().int().nonnegative(),
                revenuePerCase: money,
              }),
            )
            .min(1)
            .max(100),
          reason,
          revision,
        })
        .parse(q.body),
      id = randomUUID();
    await mutate(q.user.id, 'budget.save', id, b.reason, b.revision, (d) => {
      const projection = budget(d, b.month, b.items, b.fixedCost);
      const version =
        (d.operations ?? []).filter(
          (o) => o.kind === 'budget' && o.name === b.name && o.month === b.month,
        ).length + 1;
      (d.operations ??= []).push({
        id,
        kind: 'budget',
        version,
        projection: {
          swizton: projection.swizton,
          expense: projection.expense,
          profit: projection.profit,
        },
        name: b.name,
        month: b.month,
        fixedCost: b.fixedCost,
        items: b.items,
        reason: b.reason,
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
      });
    });
    r.status(201).json({ id });
  });
  app.get('/api/budgets/:id/variance', async (q, r) => {
    const d = (await read()).data,
      op = d.operations?.find((o) => o.kind === 'budget' && o.id === q.params.id);
    if (!op || op.kind !== 'budget') {
      r.status(404).json({ error: 'Budget not found' });
      return;
    }
    const p = calculateMonth(d, op.month, 'Actual');
    r.json({
      name: op.name,
      version: op.version,
      month: op.month,
      budget: op.projection,
      actual: {
        swizton: p.rows['Swizton Revenue'].aed,
        expense: p.rows['Total Expense'].aed,
        profit: p.rows['NET PROFIT / LOSS'].aed,
      },
    });
  });
  app.post('/api/workbooks/review', write, async (q, r) => {
    if (demo && process.env.NODE_ENV !== 'test') {
      r.status(403).json({
        error:
          'Use PostgreSQL mode for real financial workbooks. Demo mode is for sample data only.',
      });
      return;
    }
    const b = z
        .object({
          name: z.string().min(1).max(120),
          content: z.string().max(7_000_000),
          reason,
          revision,
        })
        .parse(q.body),
      bytes = Buffer.from(b.content, 'base64');
    validateXlsxArchive(bytes);
    const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    if (
      (await read()).data.operations?.some(
        (o) => o.kind === 'workbook_review' && o.sourceSha256 === sourceSha256,
      )
    )
      throw Error('This workbook version has already been reviewed');
    const id = randomUUID(),
      directory = resolve(root, id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      outsideProject(await realpath(directory));
      await writeFile(resolve(directory, 'source.xlsx'), bytes, { mode: 0o600 });
      const compiled = resolve(import.meta.dirname, '../scripts/workbook-reconcile.js'),
        helper = existsSync(compiled)
          ? compiled
          : resolve(import.meta.dirname, '../scripts/workbook-reconcile.ts');
      await promisify(execFile)(
        process.execPath,
        [
          '--max-old-space-size=256',
          ...(helper.endsWith('.ts') ? ['--import', 'tsx'] : []),
          helper,
          resolve(directory, 'source.xlsx'),
          '--out',
          directory,
        ],
        { cwd: projectRoot, timeout: 30000, maxBuffer: 200000 },
      );
      const report = JSON.parse(await readFile(resolve(directory, 'reconciliation.json'), 'utf8'));
      const op: WorkbookReview = {
        id,
        kind: 'workbook_review',
        name: b.name,
        sourceSha256,
        inventory: report.inventory,
        sourceChecks: report.sourceChecks ?? [],
        issues: report.issues,
        readiness: report.readiness,
        baseline: report.monthlyBaseline,
        decisions: {
          preserveOriginal: true,
          fxStatus: 'Awaiting approved RBI rates',
          recognition: 'Separate invoice date and recognition month',
        },
        storageId: id,
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
      };
      await mutate(q.user.id, 'workbook.review', id, b.reason, b.revision, (d) => {
        if (
          d.operations?.some((o) => o.kind === 'workbook_review' && o.sourceSha256 === sourceSha256)
        )
          throw Error('Workbook already reviewed');
        (d.operations ??= []).push(op);
      });
      r.status(201).json({ id, readiness: op.readiness });
    } catch (e) {
      await rm(directory, { recursive: true, force: true });
      throw e;
    }
  });
  app.get('/api/workbooks/:id/baseline', async (q, r) => {
    const op = (await read()).data.operations?.find(
      (o) => o.kind === 'workbook_review' && o.id === q.params.id,
    );
    if (!op || op.kind !== 'workbook_review') {
      r.status(404).json({ error: 'Review not found' });
      return;
    }
    if (demo && op.storageId === 'sample') {
      const sample = new ExcelJS.Workbook(),
        sheet = sample.addWorksheet('Illustrative baseline');
      sheet.addRow(['SAMPLE ONLY — not the company workbook']);
      sheet.addRow(['Month', 'Revenue AED', 'Swizton AED', 'Expense AED', 'Profit AED']);
      for (const b of op.baseline)
        sheet.addRow([
          b.month,
          Number(b.revenue),
          Number(b.swizton),
          Number(b.expense),
          Number(b.profit),
        ]);
      r.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(
        'Swizton-illustrative-baseline.xlsx',
      );
      await sample.xlsx.write(r);
      r.end();
      return;
    }
    r.download(
      resolve(root, op.storageId, 'statement-baseline.xlsx'),
      'Swizton-source-baseline.xlsx',
    );
  });
}
