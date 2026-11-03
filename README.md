# Swizton Dubai — Finance workspace

P&L and revenue-share management for **NINETY EIGHT FAHRENHEIT MEDICAL SERVICES FZCO**. React + TypeScript, Node/Express, PostgreSQL 16 and Decimal.js.

**Advanced finance operations application (v0.2) with clearly labelled sample data. The supplied workbook has been privately inspected. Exact FY 2026 reconciliation remains pending resolution of source exceptions, historical balances and approved share/FX rules.** Do not treat demo amounts as company accounts.

## Quick start: sample workspace

Requires Node 22.12+ (Node 24 tested) and npm.

```sh
cd /workspace/Swizton-Dubai
npm ci
npm run build
DEMO_MODE=true NODE_ENV=production npm start
```

The server serves the built React app on port 3001. Demo logins: `admin@demo.local`, `finance@demo.local`, `management@demo.local`; password `demo-only`. These accounts work **only** with `DEMO_MODE=true`. Demo records live in memory, reset on restart and must never contain real patient data. Local requests can use `/api/health` for readiness.

For development, run `DEMO_MODE=true npm run dev`. For front-end hot reload, run `npm run client` in a second terminal; Vite proxies `/api` to port 3001.

## PostgreSQL mode

Provide a PostgreSQL 16 database, set `DATABASE_URL` and a random `JWT_SECRET` of at least 32 characters via a secure environment provider. `.env.example` lists names; scripts do not automatically load `.env`. No production passwords or default users are created.

```sh
npm run db:migrate
# Set NEW_USER_PASSWORD securely in the process environment (12+ characters).
npm run user:create -- finance-admin@your-company.example Admin
npm run build
DEMO_MODE=false NODE_ENV=production npm start
```

Migrations create tables and seed master **names/categories only**, with empty rules, FX and targets. Before entering data, Admin must add approved effective-dated rules for each hospital, OP Consultation and Admin Cost Reimbursement, monthly FX for all 12 months, and monthly targets through Masters. A fresh organisation displays the master editor when required FX is absent. Historical annual AED/INR lakh values must be supplied explicitly.

Use a private, authenticated database; the loopback-only trust-authenticated container used during development validation is a disposable test fixture, not a deployment configuration. Apply [schema.sql](db/schema.sql) with a migration role, then grant the application only the necessary table/sequence rights; never permit updates/deletes/truncates on audit events. Keep the database TLS settings appropriate for the deployment; certificate verification must remain enabled for remote databases.

## Verification

```sh
npm test
npm run build
# Optional full PostgreSQL integration suite, using a disposable local test database:
SWIZTON_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/swizton npm test
```

With the demo app running, `npm run test:browser` executes the Chromium UI smoke test; set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`. It checks the sample-mode flag before creating synthetic records.

The default suite executes engine, API and workflow tests; database-only and private-source tests are explicitly skipped when their optional prerequisites are absent. The PostgreSQL suite uses a temporary schema. Add `SWIZTON_GOLDEN_FIXTURE` pointing outside the checkout to include private source-row checks. Synthetic expectations are mathematically checked; none is represented as a recovered Excel result.

## Deliverables

- [Advanced workflows, additional APIs, schema extension and deployment guide](docs/ADVANCED_APP.md)
- [Architecture, ERD, API list, screen wireframes, financial assumptions, migration plan and phased roadmap](docs/ARCHITECTURE.md)
- [Executable PostgreSQL schema](db/schema.sql)
- [Calculation engine](server/engine.ts) and [unit tests](tests/engine.test.ts)
- [API integration tests](tests/api.test.ts)
- [Private workbook reconciliation workflow](docs/WORKBOOK_RECONCILIATION.md)
- [Hospital bill CSV import template](docs/bills-template.csv)

## Financial conventions

FY totals are **Actual only**. A separate working outlook uses Approx until a month is locked, then Actual. INR is reported in lakh and annually sums monthly FX translations. Missing historical comparisons remain missing. Prepaid costs use inclusive whole-month amortisation; wallet additions are never marketing expenses. Shares come from effective-dated masters. Every change requires a reason and is audited; locked periods reject covered inputs and any master change that alters their calculations. Future master additions can be saved safely when closed values remain identical.

Workbook inspection confirmed the forecast chain (gross approval → net procedure charge → doctor payout → Swizton share). Recorded bill deductions now support reasoned overrides. Deduction bases, refundable treatment, recognition timing, source errors, FX approvals and exact automated print layout remain to be settled. XLSX has Jan–Dec Approx/Actual blocks with three currencies/ratio columns; PDF currently uses readable monthly pages. Guided masters, classified breakeven, case-linked costs, hospital collections, professional-fee payments, adjustment approvals, saved budget snapshots and workbook review are implemented. Statutory VAT/Corporate Tax calculation, bank execution/reversals, SSO/MFA and production hosting/backup operations remain outside this release. See the architecture document for the complete acceptance boundary.

## Upgrading to v0.2

Run the schema migration before starting the new server. It adds persistent workflow items for imports, approvals, collections, doctor payments, budgets and workbook reviews. Master changes no longer require reopening every month: only changes affecting locked results are rejected. Manual adjustments now go through independent Admin approval; use Operations to review them. Set `PRIVATE_DATA_DIR` outside the checkout before using real workbook review in PostgreSQL mode. Source workbooks and private reconciliation artifacts must never be pushed to the public repository.
