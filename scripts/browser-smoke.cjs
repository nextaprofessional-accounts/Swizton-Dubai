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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3001');
  await page.screenshot({ path: '/tmp/swizton-login.png', fullPage: true });
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
    'Planning',
    'Daily operations',
    'Finance validation',
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
    if (name === 'Daily operations') {
      await page.getByRole('button', { name: 'Open case', exact: true }).first().click();
      await page
        .getByLabel('Hospital case reference', { exact: true })
        .fill(`BROWSER-CASE-${runId}`);
      await page.getByLabel('Expected collection date', { exact: true }).fill('2026-12-01');
      await page
        .getByRole('textbox', { name: /^Case notes/ })
        .fill('Synthetic source-linked case tracking');
      await page
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .fill('Browser verifies case tracking without financial changes');
      await page.getByRole('button', { name: 'Save case tracking', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Case tracking saved without changing the bill', { exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Hospital imports', exact: true }).click();
      await page.getByRole('button', { name: 'New hospital mapping', exact: true }).click();
      await page.getByLabel('Mapping name', { exact: true }).fill(`Browser mapping ${runId}`);
      await page
        .locator('.master-form')
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .fill('Synthetic source header mapping verification');
      await page.getByRole('button', { name: 'Save mapping version', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Hospital mapping version saved', { exact: true })
        .waitFor();
      const hospitalFile = `Browser-mapped-${runId}.csv`;
      await page.getByLabel('Hospital bill file', { exact: true }).setInputFiles({
        name: hospitalFile,
        mimeType: 'text/csv',
        buffer: Buffer.from(
          `date,patient,procedure,doctor,invoice,gross,consumables,pharmacyLab\n2026-10-20,${patientReference},RFA,Dr. Tahsin,BROWSER-INV-${runId},10000,1000,1000`,
        ),
      });
      await page
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .fill('Review synthetic mapped hospital bill import');
      await page.getByRole('button', { name: 'Preview hospital import', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Mapped bill preview prepared; no ledger postings', { exact: true })
        .waitFor();
      const batch = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: hospitalFile, exact: true }) });
      await batch
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .fill('Commit verified synthetic hospital bill');
      await batch
        .getByRole('button', { name: 'Commit validated hospital bills', exact: true })
        .click();
      await page
        .getByRole('status')
        .getByText('Mapped bills committed once', { exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Bank matching', exact: true }).click();
      await page.getByLabel('Bank account alias', { exact: true }).fill('BROWSER-TEST-AED');
      await page.getByLabel('Bank statement file', { exact: true }).setInputFiles({
        name: `Browser-bank-${runId}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(
          `transactionId,date,direction,amount,reference\nBROWSER-BANK-${runId},2026-06-30,In,100,Synthetic browser bank evidence`,
        ),
      });
      await page
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .first()
        .fill('Preview synthetic bank statement evidence');
      await page.getByRole('button', { name: 'Preview bank statement', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Bank statement preview created without cash postings', { exact: true })
        .waitFor();
      const statement = page
        .locator('section')
        .filter({ has: page.getByRole('combobox', { name: /Imported bank statement/ }) });
      await statement
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .fill('Review synthetic bank source and allocate cash');
      await statement.getByRole('button', { name: 'Commit bank statement', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Bank statement committed; no cash postings', { exact: true })
        .waitFor();
      await statement.getByRole('button', { name: 'Allocate bank row', exact: true }).click();
      const choices = page.getByRole('combobox', { name: /Recorded cash event/ });
      const cashId = await choices
        .locator('option')
        .filter({ hasText: patientReference })
        .getAttribute('value');
      await choices.selectOption(cashId);
      await page.getByRole('button', { name: 'Match recorded cash', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Bank evidence matched to recorded cash', { exact: true })
        .waitFor();
      await statement
        .getByRole('button', { name: 'Unmatch with reason below', exact: true })
        .click();
      await page
        .getByRole('status')
        .getByText('Allocation reversed; cash posting preserved', { exact: true })
        .waitFor();
      await statement
        .getByRole('button', { name: 'Void committed statement', exact: true })
        .click();
      await page
        .getByRole('status')
        .getByText('Statement voided; original evidence and cash preserved', { exact: true })
        .waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: '/tmp/swizton-daily-operations.png', fullPage: true });
    }
    if (name === 'Finance validation') {
      const signInAs = async (role) => {
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await page.getByRole('textbox', { name: 'Email', exact: true }).fill(`${role}@demo.local`);
        await page.getByRole('textbox', { name: 'Password', exact: true }).fill('demo-only');
        await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
        await page
          .getByRole('heading', { name: 'Finance validation & approval', exact: true })
          .waitFor();
      };
      await signInAs('finance');
      await page.getByLabel('FX month', { exact: true }).fill('2026-10');
      await page.getByRole('combobox', { name: /Averaging method/ }).selectOption('Daily average');
      await page.getByLabel('AED per USD', { exact: true }).fill('3.6725');
      await page
        .getByLabel('Rate source / publication reference', { exact: true })
        .fill(`Synthetic browser FX ${runId}`);
      await page
        .getByLabel('Daily observations CSV · INR per AED', { exact: true })
        .fill('date,rate\n2026-10-01,25.4\n2026-10-02,25.6');
      await page
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .fill('Synthetic daily average source verification');
      await page.getByRole('button', { name: 'Preview monthly average', exact: true }).click();
      await page.getByRole('status').getByText('FX average calculated', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Submit rate for review', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Monthly FX submitted for independent review', { exact: true })
        .waitFor();
      await signInAs('admin');
      const register = page.locator('section').filter({
        has: page.getByRole('heading', { name: 'Rate approval register', exact: true }),
      });
      await register
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .fill('Independently verified synthetic source and coverage');
      await register
        .getByRole('row')
        .filter({ hasText: `Synthetic browser FX ${runId}` })
        .getByRole('button', { name: 'Approve rate', exact: true })
        .click();
      await page
        .getByRole('status')
        .getByText('Monthly FX approved and applied', { exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Exception register', exact: true }).click();
      await page
        .getByRole('heading', { name: 'Workbook exception register', exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Reconciliation & sign-off', exact: true }).click();
      await page
        .getByRole('heading', { name: 'Original baseline vs application Actual', exact: true })
        .waitFor();
      await page.getByText('Sign-off blockers', { exact: true }).waitFor();
      await page.screenshot({ path: '/tmp/swizton-finance-validation.png', fullPage: true });
    }
    if (name === 'Planning') {
      await page.getByRole('button', { name: '+ New procedure lead', exact: true }).click();
      await page.getByLabel('Patient / lead reference', { exact: true }).fill(patientReference);
      await page.getByLabel('Expected procedure date', { exact: true }).fill('2026-06-20');
      await page.getByLabel('Expected gross approval · AED', { exact: true }).fill('10000');
      await page
        .getByLabel('Lead / referral source', { exact: true })
        .fill('Synthetic browser referral');
      await page
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .fill('Synthetic browser forecast lifecycle');
      await page.getByRole('button', { name: 'Save procedure lead', exact: true }).click();
      await page.getByRole('status').getByText('Procedure lead saved', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Rolling forecast', exact: true }).click();
      await page.getByLabel('Forecast cutoff', { exact: true }).fill('2026-06-01');
      await page.getByRole('button', { name: 'Preview rolling forecast', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Forecast preview calculated', { exact: true })
        .waitFor();
      await page
        .getByRole('textbox', { name: 'Reason / approval note', exact: true })
        .fill('Synthetic browser snapshot capture');
      await page.getByRole('button', { name: 'Save forecast snapshot', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Immutable forecast snapshot saved', { exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Forecast accuracy', exact: true }).click();
      await page.getByRole('button', { name: 'Cash outlook', exact: true }).click();
      await page.getByRole('button', { name: 'Calculate cash outlook', exact: true }).click();
      await page
        .getByRole('status')
        .getByText('Cash outlook calculated', { exact: true })
        .waitFor();
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
  if (await page.locator('aside').isVisible()) throw Error('Mobile navigation should start closed');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.keyboard.press('Escape');
  if (await page.locator('aside').isVisible()) throw Error('Escape must close mobile navigation');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Planning', exact: true }).click();
  await page.getByRole('heading', { name: 'Forecasting & cash planning', exact: true }).waitFor();
  if (await page.locator('aside').isVisible())
    throw Error('Navigation must close after selecting a screen');
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw Error('Mobile planning workspace has horizontal overflow');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Profit & Loss', exact: true })
    .click();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw Error('Mobile P&L table must scroll within its container');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Daily operations', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Daily operations workspace', exact: true }).waitFor();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw Error('Mobile case register has horizontal overflow');
  await page.getByRole('button', { name: 'Bank matching', exact: true }).click();
  await page.getByRole('heading', { name: 'Bank statement evidence · AED', exact: true }).waitFor();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw Error('Mobile bank matching has horizontal overflow');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Overview', exact: true }).click();
  await page.screenshot({ path: '/tmp/swizton-mobile.png', fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw Error('Mobile viewport has horizontal overflow');
  if (errors.length) throw Error(errors.join('\n'));
  console.log(
    'PASS login, receipt creation, source drilldown, budget calculation, mobile drawer/keyboard access, responsive planning and P&L; no browser errors',
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
