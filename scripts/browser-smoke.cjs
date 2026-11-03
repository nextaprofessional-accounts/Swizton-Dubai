const { chromium } = require('playwright');
const { existsSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
(async () => {
  const runId = randomUUID().slice(0, 8);
  const patientReference = `Browser synthetic ${runId}`;
  const procedureName = `Synthetic Browser Procedure ${runId}`;
  const health = await (await fetch('http://127.0.0.1:3001/api/health')).json();
  if (!health.demo) throw Error('Browser smoke test requires isolated DEMO_MODE=true');
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3001');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('admin@demo.local');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('demo-only');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await page.getByText('Your monthly financial pulse').waitFor();
  await page.screenshot({ path: '/tmp/swizton-overview.png', fullPage: true });
  for (const name of [
    'Profit & Loss',
    'Revenue & bills',
    'Expense ledger',
    'Marketing wallet',
    'Analytics',
    'Budget planner',
    'Operations',
    'Receivables',
    'Workbook review',
    'Masters',
    'Month close',
    'User access',
    'Audit trail',
  ]) {
    await page.locator('nav').getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(200);
    if (name === 'Profit & Loss') {
      await page.getByRole('button', { name: 'Yearly comparison', exact: true }).click();
      await page.getByText('Working outlook', { exact: true }).waitFor();
    }
    if (name === 'Revenue & bills') {
      await page.getByRole('button', { name: '+ Add record', exact: true }).click();
      await page.getByRole('button', { name: 'receipt', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Patient / reference', exact: true })
        .fill(patientReference);
      await page
        .getByLabel('Revenue recognition month (optional)', { exact: true })
        .fill('2026-07');
      await page.getByRole('spinbutton', { name: 'Receipt · AED', exact: true }).fill('100');
      await page
        .getByRole('textbox', { name: 'Reason / audit note', exact: true })
        .fill('Browser sample receipt validation');
      await page.getByRole('button', { name: 'Save record', exact: true }).click();
      await page.getByRole('status').getByText('Saved successfully', { exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Month', exact: true }).selectOption('6');
      await page
        .getByRole('textbox', { name: 'Search source records', exact: true })
        .fill(patientReference);
      await page.getByRole('cell', { name: patientReference, exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Month', exact: true }).selectOption('5');
    }
    if (name === 'Budget planner') {
      await page.getByRole('button', { name: 'Calculate projection', exact: true }).click();
      await page.getByText('PROJECTED SWIZTON REVENUE', { exact: true }).waitFor();
    }
    if (name === 'Masters') {
      await page.getByRole('button', { name: 'procedures', exact: true }).click();
      await page.getByRole('cell', { name: 'VenaSeal', exact: true }).waitFor();
      await page.getByRole('button', { name: '+ Add record', exact: true }).click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill(procedureName);
      await page.getByRole('button', { name: 'Stage this change', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Approval / change reason', exact: true })
        .fill('Synthetic master workflow check');
      await page.getByRole('button', { name: 'Save master changes', exact: true }).click();
      await page.getByRole('cell', { name: procedureName, exact: true }).waitFor();
    }
    if (name === 'Workbook review') {
      await page.getByText('Feeder calculation evidence', { exact: true }).waitFor();
      await page
        .getByRole('combobox', { name: 'Source check status', exact: true })
        .selectOption('matched');
      await page.getByText('Sample Bills!Q4', { exact: true }).waitFor();
    }
    console.log('PASS screen:', name);
  }
  await page.locator('nav').getByRole('button', { name: 'Overview', exact: true }).click();
  await page
    .getByRole('button', { name: /Swizton Revenue/ })
    .last()
    .click();
  await page.getByText('SOURCE TRANSACTIONS', { exact: true }).waitFor();
  await page.locator('.modal .close').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/swizton-mobile.png', fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw Error('Mobile viewport has horizontal overflow');
  if (errors.length) throw Error(errors.join('\n'));
  console.log(
    'PASS login, receipt creation, source drilldown, budget calculation, mobile layout; no browser errors',
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
