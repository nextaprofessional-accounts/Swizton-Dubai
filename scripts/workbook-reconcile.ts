/** Read-only workbook inspection. Never evaluates workbook text/formulas or writes the source. */
import ExcelJS from 'exceljs';
import { projectRoot } from '../server/paths.ts';
import { validateXlsxArchive } from '../server/imports.ts';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, chmod, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { Decimal as D } from 'decimal.js';
import { billShare, entryFacts } from '../server/engine.ts';
import { type Entry, type Masters } from '../server/model.ts';
const args = process.argv.slice(2),
  input = args[0],
  outIndex = args.indexOf('--out');
if (!input || outIndex < 0 || !args[outIndex + 1])
  throw Error(
    'Usage: npm run workbook:reconcile -- <source.xlsx> --out <private directory OUTSIDE checkout>',
  );
const sourcePath = await realpath(input),
  out = resolve(args[outIndex + 1]),
  repo = await realpath(projectRoot);
await mkdir(out, { recursive: true, mode: 0o700 });
const realOut = await realpath(out);
const rel = relative(repo, realOut);
if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..'))
  throw Error(
    'Refusing to write confidential workbook data inside the Git checkout. Choose a private directory outside it.',
  );
if (
  relative(realOut, sourcePath) === '' ||
  relative(realOut, sourcePath) === 'statement-baseline.xlsx'
)
  throw Error('Source and output paths must be separate');
await chmod(realOut, 0o700);
let migrationDecisions: unknown = null;
try {
  migrationDecisions = JSON.parse(
    await readFile(resolve(realOut, 'migration-decisions.json'), 'utf8'),
  );
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
const bytes = await readFile(sourcePath),
  hash = createHash('sha256').update(bytes).digest('hex');
validateXlsxArchive(bytes);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(bytes as never);
const sh = (name: string) => {
  const s = wb.getWorksheet(name);
  if (!s) throw Error(`Missing required sheet ${name}`);
  return s;
};
const pnl = sh('2026');
function cached(c: ExcelJS.Cell): unknown {
  const v = c.value;
  if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v))
    return c.result ?? null;
  return v;
}
function numeric(c: ExcelJS.Cell): D | null {
  const v = cached(c);
  return typeof v === 'number' && Number.isFinite(v) ? new D(String(v)) : null;
}
const scalar = (c: ExcelJS.Cell) => {
  const v = cached(c);
  return v instanceof Date
    ? v.toISOString().slice(0, 10)
    : v && typeof v === 'object' && 'error' in v
      ? { error: v.error }
      : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        ? v
        : null;
};
function serialise(c: ExcelJS.Cell) {
  return {
    address: c.address,
    value: scalar(c),
    formula: c.formula ?? null,
    numberFormat: c.numFmt ?? null,
  };
}
const val = (s: ExcelJS.Worksheet, address: string) => numeric(s.getCell(address));
const zero = (s: ExcelJS.Worksheet, address: string) => val(s, address) ?? new D(0);
const amount = (s: ExcelJS.Worksheet, address: string) => zero(s, address).toFixed(6);
const text = (s: ExcelJS.Worksheet, address: string) => {
  const v = cached(s.getCell(address));
  return typeof v === 'string' ? v.trim() : '';
};
const date = (s: ExcelJS.Worksheet, address: string) => {
  const v = cached(s.getCell(address));
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const inventory = wb.worksheets.map((s) => {
  let formulas = 0,
    missingCaches = 0;
  const errors: { address: string; error: string }[] = [];
  s.eachRow((row) =>
    row.eachCell((c) => {
      if (c.formula) {
        formulas++;
        if (cached(c) === null) missingCaches++;
      }
      const v = cached(c);
      if (v && typeof v === 'object' && 'error' in v)
        errors.push({ address: c.address, error: String(v.error) });
    }),
  );
  return {
    name: s.name,
    rows: s.rowCount,
    columns: s.columnCount,
    state: s.state,
    formulas,
    missingCaches,
    errors,
  };
});
const actuals = [
  { month: '2026-01', col: 'G' },
  { month: '2026-02', col: 'M' },
  { month: '2026-03', col: 'P' },
  { month: '2026-04', col: 'V' },
  { month: '2026-05', col: 'AB' },
  { month: '2026-06', col: 'AH' },
  { month: '2026-07', col: 'AN' },
  { month: '2026-08', col: 'AT' },
  { month: '2026-09', col: 'AZ' },
];
const approx = [
  { month: '2026-01', col: 'D' },
  { month: '2026-02', col: 'J' },
  { month: '2026-04', col: 'S' },
  { month: '2026-05', col: 'Y' },
  { month: '2026-06', col: 'AE' },
  { month: '2026-07', col: 'AK' },
  { month: '2026-08', col: 'AQ' },
  { month: '2026-09', col: 'AW' },
];
const rowMap: Record<number, string> = {
  6: 'Total Revenue',
  7: 'CSH',
  8: 'Al Garhoud',
  9: 'IMH',
  10: 'Admin Cost Reimbursement',
  11: 'OP Consultation',
  12: 'Dr. Chinmay – Professional Fee',
  13: 'Dr. Tahsin – Professional Fee',
  14: 'Swizton Revenue',
  15: 'Swizton • CSH',
  16: 'Swizton • Al Garhoud',
  17: 'Swizton • IMH',
  18: 'Swizton • Admin Cost Reimbursement',
  19: 'Swizton • OP Consultation',
  21: 'HR Cost',
  26: 'Marketing Expense',
  27: 'Administration Expense',
  28: 'Finance & Other Expense',
  29: 'Total Expense',
  30: 'NET PROFIT / LOSS',
};
const snapshot = {
  sourceSha256: hash,
  readOnly: true,
  cachedValuesOnly: true,
  notRecalculated: true,
  year: 2026,
  blocks: [
    ...actuals.map((b) => ({ ...b, version: 'Actual' })),
    ...approx.map((b) => ({ ...b, version: 'Approx' })),
  ],
  cells: [] as unknown[],
};
for (let r = 3; r <= 45; r++)
  for (let c = 2; c <= 77; c++) {
    const cell = pnl.getCell(r, c);
    if (cell.value !== null) snapshot.cells.push(serialise(cell));
  }
interface Issue {
  code: string;
  severity: 'blocker' | 'review';
  cells: string[];
  detail: string;
  actual?: string;
  expected?: string;
  delta?: string;
}
const issues: Issue[] = [];
const issue = (i: Issue) => issues.push(i);
for (const e of inventory.find((s) => s.name === '2026')!.errors)
  issue({
    code: 'SOURCE_ERROR',
    severity: 'blocker',
    cells: [`2026!${e.address}`],
    detail: `Workbook cached error ${e.error}; not converted to zero.`,
  });
const differs = (a: D, b: D) => a.minus(b).abs().gt('.005');
function check(
  code: string,
  cells: string[],
  actual: D | null,
  expected: D | null,
  detail: string,
) {
  if (actual && expected && differs(actual, expected))
    issue({
      code,
      severity: 'blocker',
      cells,
      detail,
      actual: actual.toFixed(6),
      expected: expected.toFixed(6),
      delta: actual.minus(expected).toFixed(6),
    });
}
for (const b of actuals) {
  const s = (r: number) => val(pnl, `${b.col}${r}`),
    sum = (rs: number[]) => rs.reduce((a, r) => a.plus(s(r) ?? 0), new D(0));
  check(
    'REVENUE_ROLLUP',
    [`2026!${b.col}6`],
    s(6),
    sum([7, 8, 9, 10, 11]),
    'Total revenue must equal source revenue lines.',
  );
  check(
    'SWIZTON_BREAKDOWN',
    [`2026!${b.col}14`, `2026!${b.col}15:${b.col}19`],
    s(14),
    sum([15, 16, 17, 18, 19]),
    'Swizton total disagrees with its hospital/source breakdown.',
  );
  check(
    'HR_ROLLUP',
    [`2026!${b.col}21`, `2026!${b.col}22:${b.col}25`],
    s(21),
    sum([22, 23, 24, 25]),
    'HR total disagrees with its own staff lines.',
  );
  check(
    'EXPENSE_ROLLUP',
    [`2026!${b.col}29`],
    s(29),
    sum([21, 26, 27, 28]),
    'Total expense disagrees with category lines.',
  );
  check(
    'NET_PROFIT',
    [`2026!${b.col}30`],
    s(30),
    s(14)?.minus(s(29) ?? 0) ?? null,
    'Net profit must equal Swizton revenue less expenses.',
  );
  const approxCol = approx.find((a) => a.month === b.month)?.col;
  for (let row = 6; row <= 45; row++) {
    const cell = pnl.getCell(`${b.col}${row}`),
      f = cell.formula ?? '';
    if (approxCol && new RegExp(`(?:^|[^A-Z0-9_])\\$?${approxCol}\\$?\\d+`, 'i').test(f))
      issue({
        code: 'ACTUAL_USES_APPROX',
        severity: 'blocker',
        cells: [`2026!${cell.address}`],
        detail: `Actual formula references its Approx column: ${f}`,
      });
  }
}
for (const [r, line] of Object.entries(rowMap)) {
  const row = Number(r),
    actualSum = actuals.reduce((a, b) => a.plus(val(pnl, `${b.col}${row}`) ?? 0), new D(0));
  check(
    'FY_VS_ACTUAL_MONTHS',
    [`2026!BL${row}`],
    val(pnl, `BL${row}`),
    actualSum,
    `FY ${line} disagrees with the sum of Jan–Sep Actual cells. Oct–Dec have no separately labelled Actual blocks.`,
  );
}
// A monthly central FX proposal is observed, never approved or written to live masters.
const fxObservations = [...actuals, ...approx].map((b) => {
  const c = pnl.getColumn(b.col).number;
  const rates = [6, 14, 21, 26, 27, 29, 30]
    .map((r) => {
      const a = numeric(pnl.getCell(r, c)),
        i = numeric(pnl.getCell(r, c + 1));
      return a && !a.isZero() && i
        ? { cell: pnl.getCell(r, c + 1).address, rate: i.div(a).toFixed(6) }
        : null;
    })
    .filter(Boolean);
  return { ...b, rates };
});
for (const month of [...new Set(fxObservations.map((b) => b.month))]) {
  const rates = [
    ...new Set(
      fxObservations.filter((b) => b.month === month).flatMap((b) => b.rates.map((r) => r!.rate)),
    ),
  ];
  if (rates.length > 1)
    issue({
      code: 'INCONSISTENT_MONTH_FX',
      severity: 'blocker',
      cells: fxObservations
        .filter((b) => b.month === month)
        .flatMap((b) => b.rates.map((r) => `2026!${r!.cell}`)),
      detail: `Observed INR/AED ratios for ${month}: ${rates.join(', ')}. One centrally approved monthly rate is required.`,
    });
}
const fyInr = val(pnl, 'BM14'),
  monthlyInr = actuals.reduce(
    (a, b) => a.plus(numeric(pnl.getCell(14, pnl.getColumn(b.col).number + 1)) ?? 0),
    new D(0),
  );
check(
  'ANNUAL_FX_RETRANSLATION',
  ['2026!BM14'],
  fyInr,
  monthlyInr,
  'FY INR Swizton revenue is retranslated at 26 rather than summing monthly INR amounts. These source values are raw INR, not API INR lakh.',
);
for (const b of [...actuals, ...approx])
  for (const r of [7, 8, 9, 10, 11, 12, 13]) {
    const cell = pnl.getCell(`${b.col}${r}`),
      f = cell.formula ?? '';
    if (f && /[+-]\s*\d{2,}(?:\.\d+)?(?:\b|$)/.test(f))
      issue({
        code: 'EMBEDDED_ADJUSTMENT',
        severity: 'review',
        cells: [`2026!${cell.address}`],
        detail: `Embedded numeric term needs an approved business reason: ${f}`,
      });
  }
// Preserve a formatted, non-executable P&L snapshot, not a silently repaired workbook.
const baseline = new ExcelJS.Workbook(),
  bs = baseline.addWorksheet('2026 source baseline');
for (let c = 1; c <= 77; c++) {
  bs.getColumn(c).width = pnl.getColumn(c).width;
  bs.getColumn(c).hidden = pnl.getColumn(c).hidden;
}
for (let r = 1; r <= 45; r++) {
  bs.getRow(r).height = pnl.getRow(r).height;
  for (let c = 1; c <= 77; c++) {
    const from = pnl.getCell(r, c),
      to = bs.getCell(r, c);
    const value = cached(from);
    to.value =
      value && typeof value === 'object' && 'hyperlink' in value
        ? ((value as { text?: string }).text ?? null)
        : (value as ExcelJS.CellValue);
    to.style = structuredClone(from.style);
  }
}
for (const merge of pnl.model.merges ?? []) {
  const ends = merge.split(':').map((a) => pnl.getCell(a));
  if (ends.every((c) => Number(c.col) <= 77 && Number(c.row) <= 45)) bs.mergeCells(merge);
}
bs.views = [{ state: 'frozen', xSplit: 3, ySplit: 5 }];
bs.pageSetup = {
  orientation: 'landscape',
  paperSize: 8 as ExcelJS.PaperSize,
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  printArea: 'B3:BY45',
  printTitlesRow: '3:5',
};
const baselinePath = resolve(realOut, 'statement-baseline.xlsx');
if (baselinePath === sourcePath) throw Error('Cannot overwrite source workbook');
await baseline.xlsx.writeFile(baselinePath);
await chmod(baselinePath, 0o600);
// Standalone source-row engine checks: identities/contacts are deliberately omitted.
const rule = (
  hospital: string,
  share: string,
  swizton: string,
  admin = '0',
  refundable = '0',
): Masters['rules'][number] => ({
  id: 'observed-source-fixture',
  hospital,
  effectiveFrom: '1900-01-01',
  effectiveTo: null,
  share,
  swizton,
  admin,
  refundable,
  chinmayEligible: false,
  doctorPool: '0',
  chinmay: '0',
  components: {},
});
const masters: Masters = {
  hospitals: [
    { id: 'CSH', name: 'CSH', method: 'net-share' },
    { id: 'IMH', name: 'IMH', method: 'net-share' },
    { id: 'Al Garhoud', name: 'Al Garhoud', method: 'components' },
  ],
  doctors: ['Redacted'],
  staff: [],
  procedures: [],
  expenseHeads: [],
  rules: [],
  fx: [],
  targets: [],
  comparatives: [],
};
const checks: {
  kind: string;
  source: string;
  status: 'matched' | 'mismatch' | 'blocked';
  expected?: string;
  computed?: string;
  delta?: string;
  reason?: string;
}[] = [];
const golden: {
  kind: string;
  source: string;
  entry: Entry;
  masters: Masters;
  expected: Record<string, string>;
}[] = [];
const ip = sh('IP Details');
for (let row = 4; row <= ip.rowCount; row++) {
  const hospitalName = text(ip, `C${row}`),
    hospital =
      hospitalName === 'Canadian Specialist Hospital'
        ? 'CSH'
        : hospitalName === 'International Modern Hospital'
          ? 'IMH'
          : null;
  if (!hospital) continue;
  const ref = `IP Details!Q${row}`,
    billDate = date(ip, `D${row}`),
    expected = val(ip, `Q${row}`),
    gross = val(ip, `J${row}`),
    share = val(ip, `P${row}`);
  if (!billDate || !expected || !gross || !share) {
    checks.push({
      kind: 'bill',
      source: ref,
      status: 'blocked',
      reason:
        'Missing dated gross, final share or share rate; no fabrication of absent bill inputs.',
    });
    continue;
  }
  const entry: Extract<Entry, { kind: 'bill' }> = {
    id: randomUUID(),
    kind: 'bill',
    version: 'Actual',
    date: billDate,
    hospital,
    patient: 'REDACTED',
    doctor: 'Redacted',
    procedure: text(ip, `G${row}`) || 'Unclassified',
    billType: 'IP',
    payment: 'Insurance',
    invoice: `WORKBOOK-IP-${row}`,
    gross: gross.toFixed(6),
    consumables: amount(ip, `K${row}`),
    pharmacyLab: amount(ip, `L${row}`),
    adminAmount: amount(ip, `M${row}`),
    refundableAmount: amount(ip, `N${row}`),
    deductionReason: 'Source-row verification only; not approved for posting',
    regime: 'Standard',
    components: {},
    visits: 0,
    vat: '0',
    tax: '0',
  };
  const m = structuredClone(masters);
  m.rules = [rule(hospital, share.toString(), '0')];
  try {
    const result = billShare(entry, m);
    checks.push({
      kind: 'bill',
      source: ref,
      status: differs(result, expected) ? 'mismatch' : 'matched',
      expected: expected.toFixed(6),
      computed: result.toFixed(6),
      delta: result.minus(expected).toFixed(6),
    });
    golden.push({
      kind: 'bill',
      source: ref,
      entry,
      masters: m,
      expected: { finalShare: expected.toFixed(6) },
    });
  } catch (e) {
    checks.push({ kind: 'bill', source: ref, status: 'blocked', reason: (e as Error).message });
  }
}
// September's named assumption cells explicitly distinguish fee-for-service forecast payout.
if (wb.getWorksheet('Sept Proc Analysis')) {
  const sept = sh('Sept Proc Analysis'),
    share = val(sept, 'Q4'),
    swizton = val(sept, 'Q5'),
    garhoud = val(sept, 'Q6');
  for (let row = 3; row <= sept.rowCount; row++) {
    if (!val(sept, `A${row}`)) continue; // Exclude hospital subtotals and benchmark tables.
    const gross = val(sept, `H${row}`),
      net = val(sept, `L${row}`),
      payout = val(sept, `M${row}`),
      swiz = val(sept, `N${row}`);
    if (!gross || gross.lte(0) || !net || !payout || !swiz) continue;
    const source = `Sept Proc Analysis!N${row}`,
      h = text(sept, `I${row}`) || text(sept, `E${row}`),
      hospital = h.toLowerCase().includes('garhoud')
        ? 'Al Garhoud'
        : h.toUpperCase() === 'CSH'
          ? 'CSH'
          : h.toUpperCase() === 'IMH'
            ? 'IMH'
            : null;
    if (!hospital || !share || !swizton || !garhoud || net.lt(0) || net.gt(gross)) {
      checks.push({
        kind: 'estimate',
        source,
        status: 'blocked',
        reason: 'Unmapped source hospital or unsupported net/approval assumption',
      });
      continue;
    }
    const m = structuredClone(masters),
      r = rule(hospital, share.toString(), swizton.toString());
    r.forecastShare = hospital === 'Al Garhoud' ? garhoud.toString() : share.toString();
    m.rules = [r];
    const entry: Extract<Entry, { kind: 'estimate' }> = {
      id: randomUUID(),
      kind: 'estimate',
      version: 'Approx',
      date: '2026-09-01',
      hospital,
      patient: 'REDACTED',
      contact: '',
      procedure: text(sept, `D${row}`) || 'Unclassified',
      leadSource: 'REDACTED',
      payment: 'Insurance',
      approval: gross.toFixed(6),
      consumablesRate: new D(1).minus(net.div(gross)).toFixed(20),
      visits: 0,
    };
    const facts = entryFacts(entry, m),
      computed = new D(facts.swizton),
      doctor = new D(facts.doctorPayoutDisclosure);
    checks.push({
      kind: 'estimate',
      source,
      status: differs(computed, swiz) || differs(doctor, payout) ? 'mismatch' : 'matched',
      expected: swiz.toFixed(6),
      computed: computed.toFixed(6),
      delta: computed.minus(swiz).toFixed(6),
    });
    golden.push({
      kind: 'estimate',
      source,
      entry,
      masters: m,
      expected: { swizton: swiz.toFixed(6), doctorPayoutDisclosure: payout.toFixed(6) },
    });
  }
}
// Observed normalised Al Garhoud sheet, not assumed complete or authoritative.
if (wb.getWorksheet('Al Garhoud Bills') && wb.getWorksheet('Al Garhoud')) {
  const ag = sh('Al Garhoud Bills'),
    original = sh('Al Garhoud');
  const componentCols: Record<string, string> = {
    Consultation: 'H',
    Lab: 'I',
    Radiology: 'J',
    Procedures: 'K',
    Room: 'L',
    'Surgeon Fee': 'M',
    'OT/Anaesthesia': 'N',
    Nursing: 'O',
    Pharmacy: 'P',
    Consumables: 'Q',
    Reports: 'R',
  };
  const rateCells: Record<string, string> = {
    Consultation: 'F6',
    Lab: 'H6',
    Radiology: 'J6',
    Procedures: 'L6',
    'Surgeon Fee': 'O6',
  };
  const rates = Object.fromEntries(
    Object.keys(componentCols).map((k) => [k, rateCells[k] ? amount(original, rateCells[k]) : '0']),
  );
  for (let row = 5; row <= ag.rowCount; row++) {
    const expected = val(ag, `S${row}`),
      gross = val(ag, `G${row}`),
      billDate = date(ag, `C${row}`);
    if (!billDate || !expected || !gross) continue;
    const r = rule('Al Garhoud', '0', '0');
    r.components.Standard = rates;
    const m = structuredClone(masters);
    m.rules = [r];
    const entry: Extract<Entry, { kind: 'bill' }> = {
      id: randomUUID(),
      kind: 'bill',
      version: 'Actual',
      date: billDate,
      hospital: 'Al Garhoud',
      patient: 'REDACTED',
      doctor: 'Redacted',
      procedure: 'Unclassified',
      billType: 'IP',
      payment: 'Insurance',
      invoice: `WORKBOOK-AG-${row}`,
      gross: gross.toFixed(6),
      consumables: '0',
      pharmacyLab: '0',
      regime: 'Standard',
      components: Object.fromEntries(
        Object.entries(componentCols).map(([k, c]) => [k, amount(ag, `${c}${row}`)]),
      ),
      visits: 0,
      vat: '0',
      tax: '0',
    };
    const computed = billShare(entry, m);
    checks.push({
      kind: 'components',
      source: `Al Garhoud Bills!S${row}`,
      status: differs(computed, expected) ? 'mismatch' : 'matched',
      expected: expected.toFixed(6),
      computed: computed.toFixed(6),
      delta: computed.minus(expected).toFixed(6),
    });
    golden.push({
      kind: 'bill',
      source: `Al Garhoud Bills!S${row}`,
      entry,
      masters: m,
      expected: { finalShare: expected.toFixed(6) },
    });
  }
}
// Compare the statement's source lines with invoice-date source aggregation without auto-posting adjustments.
const dateBased = actuals.flatMap((b) =>
  ['CSH', 'IMH'].map((h) => {
    const eligible = golden.filter(
      (g) =>
        g.kind === 'bill' &&
        g.entry.kind === 'bill' &&
        g.entry.hospital === h &&
        g.entry.date.startsWith(b.month),
    );
    const amount = eligible.reduce((a, g) => a.plus(g.expected.finalShare), new D(0)),
      sourceAmount = zero(pnl, `${b.col}${h === 'CSH' ? 7 : 9}`);
    return {
      month: b.month,
      hospital: h,
      sourceCell: `2026!${b.col}${h === 'CSH' ? 7 : 9}`,
      invoiceDateAmount: amount.toFixed(6),
      statementAmount: sourceAmount.toFixed(6),
      difference: amount.minus(sourceAmount).toFixed(6),
      matched: !differs(amount, sourceAmount),
      verifiedInputRows: eligible.length,
      limitation:
        'Subset of calculable source bills only; missing-gross bills, settlement timing, and typed adjustments need separate reconciliation.',
    };
  }),
);
// Date-selected references reveal collections of prior-year bills inside FY26 P&L.
const timingReferences: {
  statementCell: string;
  sourceCell: string;
  billDate: string;
  statementMonth: string;
}[] = [];
for (const b of actuals)
  for (const row of [7, 9]) {
    const f = pnl.getCell(`${b.col}${row}`).formula ?? '';
    for (const match of f.matchAll(/'IP Details'!\$?([QT])\$?(\d+)(?::\$?([QT])\$?(\d+))?/g)) {
      const start = Number(match[2]),
        end = Number(match[4] ?? match[2]);
      if (end - start > 1000) continue;
      for (let r = start; r <= end; r++) {
        const billDate = date(ip, `D${r}`);
        if (billDate && !billDate.startsWith(b.month))
          timingReferences.push({
            statementCell: `2026!${b.col}${row}`,
            sourceCell: `IP Details!${match[1]}${r}`,
            billDate,
            statementMonth: b.month,
          });
      }
    }
  }
for (const t of timingReferences)
  issue({
    code: 'RECOGNITION_TIMING',
    severity: 'review',
    cells: [t.statementCell, t.sourceCell],
    detail: `Invoice date ${t.billDate} is recognised in ${t.statementMonth}. Confirm settlement/recognition policy; bill-date-only migration will not reproduce this.`,
  });
// A current-year, source-level posting proposal; these are not ledger inputs or approved balances.
const proposedBridge = actuals.map((b) => {
  const i = pnl.getColumn(b.col).number;
  const revenue = zero(pnl, `${b.col}6`),
    swizton = zero(pnl, `${b.col}14`),
    expense = zero(pnl, `${b.col}29`),
    profit = zero(pnl, `${b.col}30`);
  return {
    month: b.month,
    revenue: revenue.toFixed(6),
    swizton: swizton.toFixed(6),
    expense: expense.toFixed(6),
    profit: profit.toFixed(6),
    rawInr: zero(pnl, pnl.getCell(14, i + 1).address).toFixed(6),
    status: 'cached source values, NOT approved postings',
  };
});
const report = {
  sourceSha256: hash,
  createdAt: new Date().toISOString(),
  scope: 'Read-only observed-source reconciliation; no live data or masters changed',
  migrationDecisions,
  inventory,
  snapshotBlocks: snapshot.blocks,
  issues,
  fxObservations,
  sourceChecks: checks,
  invoiceDateComparison: dateBased,
  recognitionTiming: timingReferences,
  monthlyBaseline: proposedBridge,
  readiness: {
    exactStatementReconciled: false,
    liveImportPerformed: false,
    approvedRules: false,
    blockedChecks: checks.filter((c) => c.status === 'blocked').length,
    mismatchedChecks: checks.filter((c) => c.status === 'mismatch').length,
    matchedChecks: checks.filter((c) => c.status === 'matched').length,
  },
  unresolved: [
    'Approve one central FX rate per month; workbook mixes 25 and 26 and annually retranslates.',
    'Explain embedded adjustments and doctor eligible-revenue exclusions; do not infer approvals from formulas.',
    'Confirm invoice date vs recognition/settlement month and partial prior-year receipts.',
    'Resolve Actual cells referencing Approx columns, inconsistent total breakdowns and cached Excel errors.',
    'Confirm recorded IMH deduction bases and missing-gross/manual-share source bills.',
    'Confirm which Al Garhoud source/version is authoritative and complete.',
    'March has no separately labelled Approx block; Oct-Dec are not separately labelled Actual/Approx.',
    'Forecast material percentages are derived from cached historical benchmarks; effective approval dates are not provided.',
  ],
};
const save = async (name: string, value: unknown) => {
  const path = resolve(realOut, name);
  if (path === sourcePath) throw Error('Refusing to overwrite source');
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await chmod(path, 0o600);
};
const sumMonthly = (row: number) =>
  actuals.reduce((a, b) => a.plus(zero(pnl, `${b.col}${row}`)), new D(0));
const correctionProposal = {
  approved: false,
  reviewDisposition: migrationDecisions
    ? 'User decisions exist; original figures are retained unless Finance explicitly approves a correction.'
    : 'Awaiting Finance review',
  scope:
    'Proposed FY aggregation repair only, using existing cached monthly Actual values. No source or app ledger changes.',
  changes: [
    {
      line: 'Swizton Revenue',
      sourceCell: '2026!BL14',
      source: zero(pnl, 'BL14').toFixed(6),
      proposed: sumMonthly(14).toFixed(6),
      delta: sumMonthly(14).minus(zero(pnl, 'BL14')).toFixed(6),
    },
    {
      line: 'NET PROFIT / LOSS',
      sourceCell: '2026!BL30',
      source: zero(pnl, 'BL30').toFixed(6),
      proposed: sumMonthly(14).minus(sumMonthly(29)).toFixed(6),
      delta: sumMonthly(14).minus(sumMonthly(29)).minus(zero(pnl, 'BL30')).toFixed(6),
    },
  ],
  fxApprovalRequired: true,
  recognitionApprovalRequired: true,
};
await save('correction-proposal.json', correctionProposal);
await save('adjustment-review.json', {
  approved: false,
  rows: issues
    .filter((i) => i.code === 'EMBEDDED_ADJUSTMENT')
    .map((i) => ({
      sourceCells: i.cells,
      observedFormula: i.detail,
      businessReason: null,
      approvedBy: null,
      status: 'Awaiting Finance explanation; not imported',
    })),
});
await save('source-inventory.json', inventory);
await save('statement-baseline.json', snapshot);
await save('reconciliation.json', report);
await save('golden-source-rows.json', {
  sourceSha256: hash,
  notApprovedForMigration: true,
  toleranceAed: '0.005',
  cases: golden,
});
const counts = Object.fromEntries(
  [...new Set(issues.map((i) => i.code))].map((code) => [
    code,
    issues.filter((i) => i.code === code).length,
  ]),
);
const md = [
  '# Private workbook reconciliation',
  '',
  `Source SHA-256: \`${hash}\``,
  '',
  'This report contains confidential financial values. Keep it outside the public repository. The source workbook is read-only. Cached values were inspected, not recalculated. No source text or instructions were executed.',
  '',
  `Sheets: ${inventory.length}. Source-row checks matched: ${report.readiness.matchedChecks}; mismatched: ${report.readiness.mismatchedChecks}; blocked: ${report.readiness.blockedChecks}.`,
  '',
  '## Recorded migration decisions',
  '',
  migrationDecisions
    ? 'See migration-decisions.json. These decisions are retained across read-only reruns; no corrections or FX rates are auto-approved.'
    : 'No migration decisions recorded.',
  '',
  '## Findings',
  '',
  ...Object.entries(counts).map(([c, n]) => `- ${c}: ${n}`),
  '',
  '## Decisions before migration',
  '',
  ...report.unresolved.map((x) => `- ${x}`),
  '',
  '## Formula / value differences',
  '',
  '| Code | Cells | Cached actual | Expected arithmetic | Difference |',
  '|---|---|---:|---:|---:|',
  ...issues
    .filter((i) => i.actual)
    .map((i) => `| ${i.code} | ${i.cells.join(', ')} | ${i.actual} | ${i.expected} | ${i.delta} |`),
  '',
  '## Proposed FY aggregation repair (NOT approved)',
  '',
  '| Line | Cached FY AED | Proposed sum of monthly Actuals AED | Difference AED |',
  '|---|---:|---:|---:|',
  ...correctionProposal.changes.map(
    (c) => `| ${c.line} | ${c.source} | ${c.proposed} | ${c.delta} |`,
  ),
  '',
  'This proposal only fixes the FY aggregation/breakdown discrepancy. It does not approve source adjustments, resolve the component exceptions or supply approved FX/recognition policies.',
  '',
  '## Interpretation',
  '',
  'statement-baseline.xlsx preserves the source statement layout and cached values, including errors. It is not a corrected or recalculated P&L. statement-baseline.json retains the source formulas and cell formats. golden-source-rows.json contains only pseudonymous source-row fixtures and observed rates, not approved master data. reconciliation.json lists all findings and the source-invoice-date comparison. Prior-year settlements and manual adjustments are not fabricated to force a tie.',
  '',
];
await writeFile(resolve(realOut, 'REPORT.md'), md.join('\n'), { mode: 0o600 });
await chmod(resolve(realOut, 'REPORT.md'), 0o600);
console.log(
  JSON.stringify(
    {
      outputDirectory: realOut,
      sheets: inventory.length,
      sourceChecks: report.readiness,
      issueCounts: counts,
      liveImportPerformed: false,
    },
    null,
    2,
  ),
);
