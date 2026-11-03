import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { billShare, entryFacts } from '../server/engine.ts';
import type { Entry, Masters } from '../server/model.ts';
import { Decimal as D } from 'decimal.js';
test('workbook audit preserves source bytes, caches and layout; flags errors, timing and forecast links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'swizton-workbook-'));
  try {
    const source = join(dir, 'synthetic.xlsx'),
      out = join(dir, 'private');
    const w = new ExcelJS.Workbook(),
      p = w.addWorksheet('2026'),
      ip = w.addWorksheet('IP Details');
    p.mergeCells('B3:C3');
    p.getCell('B3').value = 'Synthetic fixture';
    p.getColumn('C').width = 33;
    p.getCell('G4').value = 'Jan Actual';
    p.getCell('G24').value = { formula: '0', result: 0 };
    p.getCell('G25').value = { formula: 'FALSE()', result: false };
    p.getCell('G6').value = { formula: 'SUM(G7:G11)', result: 100 };
    p.getCell('G7').value = { formula: "'IP Details'!Q4", result: 100 };
    p.getCell('G14').value = { formula: 'G6*0.3', result: 30 };
    p.getCell('G15').value = { formula: 'G7*0.3', result: 30 };
    p.getCell('H14').value = { formula: 'G14*25', result: 750 };
    p.getCell('AZ15').value = { formula: 'AW7*0.3', result: 20 };
    p.getCell('BE14').value = { formula: 'BC14/BC14', result: { error: '#DIV/0!' } };
    ip.getCell('C4').value = 'Canadian Specialist Hospital';
    ip.getCell('D4').value = new Date('2025-12-15T00:00:00Z');
    ip.getCell('D4').numFmt = 'yyyy-mm-dd';
    ip.getCell('F4').value = 'Private synthetic identity MUST NOT APPEAR';
    ip.getCell('G4').value = 'RFA';
    ip.getCell('J4').value = 1000;
    ip.getCell('P4').value = 0.45;
    ip.getCell('Q4').value = { formula: 'J4*P4', result: 450 };
    await mkdir(out);
    const decisions = {
      septemberFigures: { policy: 'preserve_original_pending_finance_review' },
      fx: { ratesApproved: false },
      recognition: { policy: 'preserve_separate_dates' },
    };
    await writeFile(join(out, 'migration-decisions.json'), JSON.stringify(decisions));
    await w.xlsx.writeFile(source);
    const before = await readFile(source);
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/workbook-reconcile.ts', source, '--out', out],
      { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readFile(source), before);
    const report = JSON.parse(await readFile(join(out, 'reconciliation.json'), 'utf8'));
    assert.ok(report.issues.some((x: any) => x.code === 'SOURCE_ERROR'));
    assert.ok(report.issues.some((x: any) => x.code === 'ACTUAL_USES_APPROX'));
    assert.ok(report.issues.some((x: any) => x.code === 'RECOGNITION_TIMING'));
    assert.equal(report.readiness.liveImportPerformed, false);
    assert.deepEqual(report.migrationDecisions, decisions);
    assert.deepEqual(
      JSON.parse(await readFile(join(out, 'migration-decisions.json'), 'utf8')),
      decisions,
    );
    const snapshot = new ExcelJS.Workbook();
    await snapshot.xlsx.readFile(join(out, 'statement-baseline.xlsx'));
    const s = snapshot.worksheets[0];
    assert.equal(s.getCell('G14').value, 30);
    assert.equal(s.getCell('G14').formula, undefined);
    assert.equal(s.getCell('G24').value, 0);
    assert.equal(s.getCell('G25').value, false);
    assert.deepEqual(s.getCell('BE14').value, { error: '#DIV/0!' });
    assert.equal(s.getColumn('C').width, 33);
    assert.ok(s.getCell('C3').isMerged);
    const golden = await readFile(join(out, 'golden-source-rows.json'), 'utf8');
    assert.ok(!golden.includes('Private synthetic identity'));
    assert.equal(JSON.parse(golden).cases[0].entry.patient, 'REDACTED');
    const bad = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/workbook-reconcile.ts', source, '--out', resolve('docs')],
      { encoding: 'utf8' },
    );
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /outside|inside/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
// Optional golden verification: contains real source financial amounts and must stay outside Git.
const privateFixture = process.env.SWIZTON_GOLDEN_FIXTURE;
test(
  'private workbook source rows reproduce cached values, with unresolved exceptions explicit',
  { skip: !privateFixture },
  async () => {
    const parsed = JSON.parse(await readFile(privateFixture!, 'utf8')) as {
      cases: {
        source: string;
        kind: string;
        entry: Entry;
        masters: Masters;
        expected: Record<string, string>;
      }[];
    };
    assert.ok(parsed.cases.length > 0, 'No golden source rows executed');
    let matched = 0,
      exceptions = 0;
    const reportPath = join(resolve(privateFixture!, '..'), 'reconciliation.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    for (const fixture of parsed.cases) {
      const actual =
        fixture.entry.kind === 'bill'
          ? { finalShare: billShare(fixture.entry, fixture.masters).toFixed(6) }
          : entryFacts(fixture.entry, fixture.masters);
      const mismatched = Object.entries(fixture.expected).some(([key, expected]) =>
        new D(actual[key]).minus(expected).abs().gt('.005'),
      );
      if (mismatched) {
        exceptions++;
        assert.ok(
          report.sourceChecks.some(
            (c: any) => c.source === fixture.source && c.status === 'mismatch',
          ),
          `Unreported source exception ${fixture.source}`,
        );
      } else matched++;
    }
    assert.equal(matched, report.readiness.matchedChecks);
    assert.equal(exceptions, report.readiness.mismatchedChecks);
    assert.ok(matched > 0);
  },
);
