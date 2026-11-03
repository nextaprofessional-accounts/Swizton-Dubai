import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import { entrySchema, type Dataset } from './model.ts';
import { assertUnlocked, validateDataset } from './validation.ts';
import type { ImportBatch } from './workflow-model.ts';
export function validateXlsxArchive(b: Buffer) {
  if (b.length > 5_000_000 || b.length < 22 || b.readUInt32LE(0) !== 0x04034b50)
    throw Error('Supply an XLSX ZIP archive up to 5 MB');
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw Error('Invalid ZIP directory');
  const count = b.readUInt16LE(eocd + 10),
    offset = b.readUInt32LE(eocd + 16);
  if (!count || count > 2000 || offset === 0xffffffff)
    throw Error('Unsupported or oversized workbook archive');
  let pos = offset,
    total = 0,
    hasWorkbook = false;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > b.length || b.readUInt32LE(pos) !== 0x02014b50) throw Error('Invalid ZIP entry');
    const compressed = b.readUInt32LE(pos + 20),
      size = b.readUInt32LE(pos + 24),
      nameLen = b.readUInt16LE(pos + 28),
      extra = b.readUInt16LE(pos + 30),
      comment = b.readUInt16LE(pos + 32);
    const name = b.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    if (name.includes('..') || name.startsWith('/') || /vbaproject|externallinks/i.test(name))
      throw Error('Macros, external links and unsafe archive paths are not accepted');
    if (name === 'xl/workbook.xml') hasWorkbook = true;
    total += size;
    if (
      size > 20_000_000 ||
      total > 50_000_000 ||
      (size > 1_000_000 && size / Math.max(compressed, 1) > 300)
    )
      throw Error('Workbook expands beyond processing limits');
    pos += 46 + nameLen + extra + comment;
  }
  if (!hasWorkbook) throw Error('Workbook metadata missing');
}
export async function parseBillRows(format: 'csv' | 'xlsx', content: string) {
  if (Buffer.byteLength(content) > 7_000_000) throw Error('File content exceeds limit');
  if (format === 'csv') {
    const rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      max_record_size: 100000,
      to: 1001,
    }) as Record<string, unknown>[];
    if (!rows.length || rows.length > 1000) throw Error('Provide 1–1000 rows');
    return rows;
  }
  const bytes = Buffer.from(content, 'base64');
  validateXlsxArchive(bytes);
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(bytes as never);
  const sheet = w.worksheets[0];
  if (!sheet || sheet.rowCount < 2 || sheet.rowCount > 1001)
    throw Error('Provide 1–1000 rows on the first worksheet');
  const headers = sheet.getRow(1).values as string[],
    rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const obj: Record<string, unknown> = Object.create(null);
    headers.forEach((h, i) => {
      if (h) {
        if (['__proto__', 'constructor', 'prototype'].includes(h)) throw Error('Invalid header');
        const c = row.getCell(i);
        if (c.formula) throw Error(`Row ${n}: imports require values, not formulas`);
        obj[h] = c.value instanceof Date ? c.value.toISOString().slice(0, 10) : c.text;
      }
    });
    rows.push(obj);
  });
  return rows;
}
export function previewBills(rows: Record<string, unknown>[], ds: Dataset): ImportBatch['rows'] {
  const draft = structuredClone(ds);
  return rows.map((row, index) => {
    try {
      const entry = entrySchema.parse({
        ...row,
        id: randomUUID(),
        kind: 'bill',
        version: 'Actual',
        recognitionMonth: row.recognitionMonth || undefined,
        adminAmount: row.adminAmount || undefined,
        refundableAmount: row.refundableAmount || undefined,
        deductionReason: row.deductionReason || undefined,
        components:
          typeof row.components === 'string' ? JSON.parse(row.components) : (row.components ?? {}),
        visits: Number(row.visits ?? 1),
        vat: String(row.vat ?? '0'),
        tax: String(row.tax ?? '0'),
      });
      assertUnlocked(draft, entry);
      const next = { ...draft, entries: [...draft.entries, entry] };
      validateDataset(next);
      draft.entries.push(entry);
      return { row: index + 2, entry, errors: [] };
    } catch (e) {
      return {
        row: index + 2,
        entry: null,
        errors: [e instanceof Error ? e.message : 'Invalid row'],
      };
    }
  });
}
