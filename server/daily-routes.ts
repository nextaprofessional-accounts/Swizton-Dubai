import type express from 'express';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { read, mutate } from './store.ts';
import { parseBillRows } from './imports.ts';
import { businessDate } from './planning-calendar.ts';
import {
  validateProfile,
  mappedPreview,
  mappedFields,
  caseRegister,
  saveCase,
  bankPreview,
  commitBank,
  bankRegister,
  availableCash,
  matchBank,
  reverseMatch,
  voidStatement,
} from './daily.ts';
import type { HospitalProfile, CaseRecord, BankStatement } from './daily-model.ts';
const reason = z.string().trim().min(8).max(2000),
  revision = z.number().int().nonnegative();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Use a valid ISO date',
  );
const fields = z
  .record(z.string().max(100), z.string().trim().min(1).max(160))
  .refine((v) => Object.keys(v).length <= 60);
const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  hospital: z.string().min(1).max(100),
  dateFormat: z.enum(['ISO', 'DD/MM/YYYY', 'MM/DD/YYYY']),
  numberFormat: z.enum(['Plain', 'Comma thousands']),
  columns: fields,
  defaults: fields,
  aliases: z.record(z.string(), fields).refine((v) => Object.keys(v).length <= 8),
  reason,
});
const fileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  format: z.enum(['csv', 'xlsx']),
  content: z.string().max(7_000_000),
  reason,
  revision,
});
const write: express.RequestHandler = (q, r, next) => {
  if (q.user.role === 'Management') {
    r.status(403).json({ error: 'Finance or Admin access required' });
    return;
  }
  next();
};
export function registerDailyRoutes(app: express.Express) {
  app.get('/api/daily/import-fields', (_q, r) => r.json(mappedFields));
  app.post('/api/daily/profiles', write, async (q, r) => {
    const b = z.object({ profile: profileSchema, revision }).parse(q.body),
      id = randomUUID();
    await mutate(q.user.id, 'daily.profile.create', id, b.profile.reason, b.revision, (d) => {
      const version =
        (d.operations ?? []).filter(
          (o) =>
            o.kind === 'hospital_profile' &&
            o.name === b.profile.name &&
            o.hospital === b.profile.hospital,
        ).length + 1;
      const p: HospitalProfile = {
        ...b.profile,
        id,
        kind: 'hospital_profile',
        version,
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
      };
      validateProfile(d, p);
      (d.operations ??= []).push(p);
    });
    r.status(201).json({ id });
  });
  app.post('/api/daily/imports/preview', write, async (q, r) => {
    const b = fileSchema.extend({ profileId: z.string().uuid() }).parse(q.body),
      rows = await parseBillRows(b.format, b.content),
      id = randomUUID(),
      hash = createHash('sha256').update(b.content).digest('hex');
    await mutate(q.user.id, 'import.preview', id, b.reason, b.revision, (d) => {
      if (
        d.operations?.some(
          (o) => o.kind === 'import_batch' && o.hash === hash && o.status !== 'Cancelled',
        )
      )
        throw Error('This file already has an import batch');
      const profile = d.operations?.find(
        (o): o is HospitalProfile => o.kind === 'hospital_profile' && o.id === b.profileId,
      );
      if (!profile) throw Error('Import profile not found');
      (d.operations ??= []).push({
        id,
        kind: 'import_batch',
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
        name: b.name,
        hash,
        status: 'Preview',
        reason: b.reason,
        rows: mappedPreview(d, profile, rows),
        mapping: { profileId: profile.id, version: profile.version, hospital: profile.hospital },
      });
    });
    r.status(201).json({ id });
  });
  app.get('/api/daily/cases', async (q, r) => {
    const asOf = date.parse(q.query.asOf ?? businessDate());
    r.json({ asOf, rows: caseRegister((await read()).data, asOf) });
  });
  app.put('/api/daily/cases/:id', write, async (q, r) => {
    const billId = z.string().uuid().parse(q.params.id),
      b = z
        .object({
          status: z.enum([
            'Documentation pending',
            'Claim submitted',
            'Collection follow-up',
            'Settled',
          ]),
          hospitalCaseReference: z.string().trim().max(160),
          authorizationReference: z.string().trim().max(160),
          expectedCollectionDate: date.optional(),
          notes: z.string().max(2000),
          reason,
          revision,
          expectedUpdatedAt: z.string().datetime().optional(),
        })
        .parse(q.body);
    const id = randomUUID(),
      now = new Date().toISOString();
    await mutate(q.user.id, 'daily.case.update', billId, b.reason, b.revision, (d) => {
      const old = d.operations?.find(
        (o): o is CaseRecord => o.kind === 'case_record' && o.billId === billId,
      );
      if (old?.updatedAt !== b.expectedUpdatedAt)
        throw Error('Conflict: case record changed; reload before saving');
      const { revision: _, expectedUpdatedAt: __, ...data } = b;
      const record: CaseRecord = {
        ...data,
        id: old?.id ?? id,
        kind: 'case_record',
        billId,
        createdBy: old?.createdBy ?? q.user.id,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      };
      saveCase(d, record, businessDate());
    });
    r.json({ ok: true });
  });
  app.get('/api/daily/bank', async (_q, r) => {
    const s = await read();
    r.json({ revision: s.revision, statements: bankRegister(s.data), cash: availableCash(s.data) });
  });
  app.post('/api/daily/bank/preview', write, async (q, r) => {
    const b = fileSchema
        .extend({
          account: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .transform((v) => v.normalize('NFKC').toUpperCase()),
        })
        .parse(q.body),
      rows = await parseBillRows(b.format, b.content),
      id = randomUUID(),
      hash = createHash('sha256').update(b.content).digest('hex');
    await mutate(q.user.id, 'bank.preview', id, b.reason, b.revision, (d) => {
      if (
        d.operations?.some(
          (o) =>
            o.kind === 'bank_statement' &&
            o.account === b.account &&
            o.hash === hash &&
            !['Cancelled', 'Voided'].includes(o.status),
        )
      )
        throw Error('This statement already has a preview or committed import');
      const s: BankStatement = {
        id,
        kind: 'bank_statement',
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
        name: b.name,
        account: b.account,
        hash,
        currency: 'AED',
        reason: b.reason,
        status: 'Preview',
        rows: bankPreview(d, b.account, rows),
      };
      (d.operations ??= []).push(s);
    });
    r.status(201).json({ id });
  });
  app.post('/api/daily/bank/:id/commit', write, async (q, r) => {
    const b = z.object({ reason, revision }).parse(q.body);
    await mutate(q.user.id, 'bank.commit', String(q.params.id), b.reason, b.revision, (d) =>
      commitBank(d, String(q.params.id)),
    );
    r.json({ ok: true });
  });
  app.post('/api/daily/bank/:id/cancel', write, async (q, r) => {
    const b = z.object({ reason, revision }).parse(q.body);
    await mutate(q.user.id, 'bank.cancel', String(q.params.id), b.reason, b.revision, (d) => {
      const s = d.operations?.find((o) => o.kind === 'bank_statement' && o.id === q.params.id);
      if (!s || s.kind !== 'bank_statement' || s.status !== 'Preview')
        throw Error('Open bank preview not found');
      s.status = 'Cancelled';
    });
    r.json({ ok: true });
  });
  app.post('/api/daily/bank/:id/void', write, async (q, r) => {
    if (q.user.role !== 'Admin') {
      r.status(403).json({ error: 'Admin must review committed statement corrections' });
      return;
    }
    const b = z.object({ reason, revision }).parse(q.body);
    await mutate(q.user.id, 'bank.void', String(q.params.id), b.reason, b.revision, (d) =>
      voidStatement(d, String(q.params.id), q.user.id, b.reason),
    );
    r.json({ ok: true });
  });
  app.get('/api/daily/bank/:id/rows/:rowId/candidates', async (q, r) => {
    const query = z
        .string()
        .max(160)
        .parse(q.query.search ?? ''),
      d = (await read()).data,
      s = bankRegister(d).find((s) => s.id === q.params.id && s.status === 'Committed'),
      row = s?.rows.find((r) => r.data?.id === q.params.rowId);
    if (!row?.data) throw Error('Committed bank row not found');
    const bank = row.data,
      needle = query.toLowerCase();
    const candidates = availableCash(d)
      .filter(
        (e) =>
          e.direction === bank.direction &&
          Number(e.remaining) > 0 &&
          `${e.reference} ${e.sourceReference} ${e.origin} ${e.id}`.toLowerCase().includes(needle),
      )
      .map((e) => ({
        ...e,
        daysApart: Math.round(Math.abs(Date.parse(e.date) - Date.parse(bank.date)) / 86400000),
        exactAmount: Number(e.remaining) === Number(row.remaining),
        referenceMatch: e.reference.trim().toUpperCase() === bank.reference.trim().toUpperCase(),
      }))
      .sort(
        (a, b) =>
          Number(b.referenceMatch) - Number(a.referenceMatch) ||
          Number(b.exactAmount) - Number(a.exactAmount) ||
          a.daysApart - b.daysApart ||
          a.id.localeCompare(b.id),
      );
    r.json({
      candidates: candidates.slice(0, 200),
      total: candidates.length,
      basis:
        'Suggestions only. Finance must verify amounts, references, dates and source evidence before allocating. Different dates are not automatically corrected.',
    });
  });
  app.post('/api/daily/bank/matches', write, async (q, r) => {
    const b = z
        .object({
          statementId: z.string().uuid(),
          rowId: z.string().uuid(),
          eventId: z.string().uuid(),
          amount: z.string().regex(/^\d{1,15}(\.\d{1,2})?$/),
          reason,
          revision,
        })
        .parse(q.body),
      id = randomUUID();
    await mutate(q.user.id, 'bank.match', id, b.reason, b.revision, (d) => {
      const { revision: _, ...fields } = b;
      matchBank(d, {
        ...fields,
        id,
        kind: 'bank_match',
        createdBy: q.user.id,
        createdAt: new Date().toISOString(),
        status: 'Active',
      });
    });
    r.status(201).json({ id });
  });
  app.post('/api/daily/bank/matches/:id/reverse', write, async (q, r) => {
    const b = z.object({ reason, revision }).parse(q.body);
    await mutate(q.user.id, 'bank.unmatch', String(q.params.id), b.reason, b.revision, (d) =>
      reverseMatch(d, String(q.params.id), q.user.id, b.reason),
    );
    r.json({ ok: true });
  });
  app.get('/api/daily/bank/export', async (_q, r) => {
    const d = (await read()).data,
      w = new ExcelJS.Workbook(),
      s = w.addWorksheet('Bank matching');
    s.addRow([
      'Account',
      'Statement',
      'Status',
      'Transaction ID',
      'Date',
      'Direction',
      'Bank AED',
      'Allocated AED',
      'Unmatched AED',
      'Reference',
      'Source review',
    ]);
    for (const statement of bankRegister(d))
      for (const row of statement.rows)
        if (row.data)
          s.addRow([
            statement.account,
            statement.name,
            statement.status,
            row.data.transactionId,
            row.data.date,
            row.data.direction,
            row.data.amount,
            row.matched,
            row.remaining,
            row.data.reference,
            row.allocations.some((m) => m.sourceChanged)
              ? 'Cash source changed; review required'
              : 'No changed source detected',
          ]);
    const cash = w.addWorksheet('Recorded cash evidence');
    cash.addRow([
      'Date',
      'Direction',
      'Cash ID',
      'Origin',
      'Reference',
      'Recorded AED',
      'Allocated AED',
      'Unallocated AED',
      'Source changed',
    ]);
    for (const e of availableCash(d))
      cash.addRow([
        e.date,
        e.direction,
        e.id,
        e.origin,
        e.reference,
        e.amount,
        e.allocated,
        e.remaining,
        e.needsReview ? 'Review required' : 'No',
      ]);
    const a = w.addWorksheet('Allocation history');
    a.addRow([
      'ID',
      'Statement ID',
      'Bank row ID',
      'Cash event ID',
      'AED',
      'Status',
      'Prepared by',
      'Created at',
      'Reason',
      'Reversed by',
      'Reversed at',
      'Reversal reason',
      'Original cash date',
      'Original cash direction',
      'Original cash AED',
    ]);
    for (const m of d.operations ?? [])
      if (m.kind === 'bank_match')
        a.addRow([
          m.id,
          m.statementId,
          m.rowId,
          m.eventId,
          m.amount,
          m.status,
          m.createdBy,
          m.createdAt,
          m.reason,
          m.reversedBy,
          m.reversedAt,
          m.reversalReason,
          m.eventSnapshot?.date,
          m.eventSnapshot?.direction,
          m.eventSnapshot?.amount,
        ]);
    for (const sheet of w.worksheets) {
      sheet.columns.forEach((c) => (c.width = 24));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }
    r.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(
      'Swizton-bank-matching.xlsx',
    );
    await w.xlsx.write(r);
    r.end();
  });
}
