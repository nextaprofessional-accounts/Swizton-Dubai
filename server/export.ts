import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import type { calculateYear } from './engine.ts';
type Report = ReturnType<typeof calculateYear>;
export async function excelReport(r: Report, res: Response) {
  const w = new ExcelJS.Workbook();
  w.creator = 'Swizton Finance';
  const s = w.addWorksheet(`FY ${r.year}`, { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] });
  const blocks = [
    ...r.actual.flatMap((a, i) => [
      { label: `${a.month} Approx`, rows: r.approx[i].rows },
      { label: `${a.month} Actual`, rows: a.rows },
    ]),
    { label: `FY ${r.year} Actual`, rows: r.total },
    ...Object.entries(r.comparatives)
      .reverse()
      .map(([y, rows]) => ({ label: `FY ${y}`, rows })),
    { label: 'Combined', rows: r.combined },
  ];
  s.addRow(['NINETY EIGHT FAHRENHEIT MEDICAL SERVICES FZCO — Swizton Dubai']);
  s.addRow([`FY ${r.year} Profit & Loss • INR in lakh • Monthly FX translation`]);
  s.addRow(['Line', ...blocks.flatMap((b) => [b.label, '', ''])]);
  s.addRow(['', ...blocks.flatMap(() => ['AED', 'INR (Lakh)', '% of Swizton Revenue'])]);
  blocks.forEach((_, i) => s.mergeCells(3, 2 + i * 3, 3, 4 + i * 3));
  for (const line of Object.keys(r.total))
    s.addRow([
      line,
      ...blocks.flatMap((b) => {
        const c = b.rows[line];
        return c
          ? [Number(c.aed), Number(c.inr), c.pct === null ? null : Number(c.pct) / 100]
          : [null, null, null];
      }),
    ]);
  for (const k of ['cases', 'visits', 'target', 'achievement'] as const)
    s.addRow([
      k,
      ...r.actual.flatMap((a, i) => [r.approx[i].kpis[k], null, null, a.kpis[k], null, null]),
      r.kpis[k],
    ]);
  for (const p of Object.keys(r.actual[0].kpis.mix))
    s.addRow([
      `Mix • ${p}`,
      ...r.actual.flatMap((a, i) => [
        r.approx[i].kpis.mix[p],
        null,
        null,
        a.kpis.mix[p],
        null,
        null,
      ]),
      r.kpis.mix[p],
    ]);
  s.getColumn(1).width = 39;
  for (let i = 2; i <= s.columnCount; i++) {
    s.getColumn(i).width = 19;
    s.getColumn(i).numFmt = (i - 1) % 3 === 0 ? '0.00%' : '#,##0.00;[Red](#,##0.00)';
  }
  for (const i of [1, 2, 3, 4]) s.getRow(i).font = { bold: true, color: { argb: 'FF12564C' } };
  s.autoFilter = { from: 'A4', to: { row: 4, column: s.columnCount } };
  res
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .attachment(`Swizton-FY${r.year}.xlsx`);
  await w.xlsx.write(res);
  res.end();
}
export function pdfReport(r: Report, res: Response) {
  res.type('application/pdf').attachment(`Swizton-FY${r.year}.pdf`);
  const pdf = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 28 });
  pdf.pipe(res);
  const pages = [
    ...r.actual.map((a, i) => ({
      title: a.month,
      blocks: [
        { label: 'Approx', rows: r.approx[i].rows },
        { label: 'Actual', rows: a.rows },
      ],
    })),
    {
      title: `FY ${r.year} & comparatives`,
      blocks: [
        { label: `FY ${r.year} Actual`, rows: r.total },
        ...Object.entries(r.comparatives).map(([year, rows]) => ({ label: year, rows })),
        { label: 'Combined', rows: r.combined },
      ],
    },
  ];
  pages.forEach((page, idx) => {
    if (idx) pdf.addPage();
    pdf.fontSize(15).text('Swizton Dubai | Profit & Loss');
    pdf.fontSize(9).text('NINETY EIGHT FAHRENHEIT MEDICAL SERVICES FZCO');
    pdf.text(`${page.title} • AED / INR lakh / % of Swizton Revenue`);
    const labelWidth = 230,
      colWidth = (pdf.page.width - 56 - labelWidth) / page.blocks.length;
    let y = 95;
    pdf.font('Helvetica-Bold').fontSize(9);
    page.blocks.forEach((b, i) =>
      pdf.text(`${b.label}: AED | INR lakh | %`, 28 + labelWidth + i * colWidth, y, {
        width: colWidth,
      }),
    );
    y += 24;
    pdf.font('Helvetica').fontSize(8);
    for (const line of Object.keys(r.total)) {
      pdf.text(line.replace('–', '-').replace('•', '-'), 28, y, { width: labelWidth - 8 });
      page.blocks.forEach((b, i) => {
        const c = b.rows[line];
        pdf.text(
          c
            ? `${Number(c.aed).toFixed(2)} | ${Number(c.inr).toFixed(2)} | ${c.pct === null ? '—' : Number(c.pct).toFixed(1) + '%'}`
            : 'Not supplied',
          28 + labelWidth + i * colWidth,
          y,
          { width: colWidth },
        );
      });
      y += 17;
    }
    if (idx < 12) {
      const a = r.actual[idx];
      pdf.text(
        `Cases ${a.kpis.cases} / Target ${a.kpis.target} • Visits ${a.kpis.visits} • Achievement ${a.kpis.achievement ?? '—'}%`,
        28,
        y + 10,
      );
      pdf.text(
        Object.entries(a.kpis.mix)
          .map(([p, n]) => `${p}: ${n}`)
          .join(' | '),
        28,
        y + 30,
        { width: pdf.page.width - 56 },
      );
    }
  });
  pdf.end();
}
