# Swizton Dubai — Finance workspace

P&L and revenue-share management for **NINETY EIGHT FAHRENHEIT MEDICAL SERVICES FZCO**. React + TypeScript, Node/Express, PostgreSQL 16 and Decimal.js.

**Working MVP with clearly labelled sample data. Exact FY 2026 workbook reconciliation is pending the original workbook, historical balances and approved share/FX rules.** Do not treat demo amounts as company accounts.

## Quick start: sample workspace

Requires Node 22.12+ (Node 24 tested) and npm.

```sh
cd /workspace/Swizton-Dubai
npm ci
npm run build
DEMO_MODE=true npm run dev
```

The server serves the built React app on port 3001. Demo logins: `admin@demo.local`, `finance@demo.local`, `management@demo.local`; password `demo-only`. These accounts work **only** with `DEMO_MODE=true`. Demo records live in memory, reset on restart and must never contain real patient data. Local requests can use `/api/health` for readiness.

For front-end hot reload, run `npm run client` in a second terminal; Vite proxies `/api` to port 3001.

## PostgreSQL mode

Provide a PostgreSQL 16 database, set `DATABASE_URL` and a random `JWT_SECRET` of at least 32 characters via a secure environment provider. `.env.example` lists names; scripts do not automatically load `.env`. No production passwords or default users are created.

```sh
npm run db:migrate
# Set NEW_USER_PASSWORD securely in the process environment (12+ characters).
npm run user:create -- finance-admin@your-company.example Admin
npm run build
DEMO_MODE=false npm run dev
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

The default suite executes engine and API tests, with one database-only audit test skipped. The PostgreSQL suite uses a temporary schema and exercises all cases. Synthetic expectations are mathematically checked; none is represented as a recovered Excel result.

## Deliverables

- [Architecture, ERD, API list, screen wireframes, financial assumptions, migration plan and phased roadmap](docs/ARCHITECTURE.md)
- [Executable PostgreSQL schema](db/schema.sql)
- [Calculation engine](server/engine.ts) and [unit tests](tests/engine.test.ts)
- [API integration tests](tests/api.test.ts)
- [Hospital bill CSV import template](docs/bills-template.csv)

## Financial conventions

FY totals are **Actual only**. A separate working outlook uses Approx until a month is locked, then Actual. INR is reported in lakh and annually sums monthly FX translations. Missing historical comparisons remain missing. Prepaid costs use inclusive whole-month amortisation; wallet additions are never marketing expenses. Shares come from effective-dated masters. Every change requires a reason and is audited; locked periods reject covered inputs and master changes.

The source workbook must settle the CSH/IMH deduction base, Approx approval/payout basis, refundable treatment and exact layout. XLSX has Jan–Dec Approx/Actual blocks with three currencies/ratio columns; PDF currently uses readable monthly pages. Statutory VAT/Corporate Tax calculation, fixed/variable cost accounting, settlement workflows, SSO/MFA and production security/backup operations remain explicit follow-up scope. See the architecture document for the complete acceptance boundary.
