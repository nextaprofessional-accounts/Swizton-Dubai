# Daily operations — v0.5

The **Daily operations** module adds three operational workspaces: Case register, Hospital imports and Bank matching. Finance/Admin can prepare and maintain records; Management can inspect and export but cannot post or change them. Existing independent FX/adjustment approvals, locks and audit controls remain in effect.

## Case register

Each Actual hospital bill is one source-linked financial case, including IP and OP bills. The register does not create a new patient identity, merge people by name, or replace a clinical record system. Repeated procedures and separate hospital invoices remain separate cases.

The register shows invoice/patient reference, hospital, procedure, doctor, original invoice date, separate recognition month, final share, Swizton share, collected amount and outstanding balance. Collections are limited to the selected cash cutoff date. Invoice aging uses 0–30, 31–60, 61–90 and 90+ day buckets; these are **not** assumed credit terms. A case is labelled overdue only when Finance has explicitly recorded an expected collection date and a balance remains after that date.

Finance can record a hospital case reference, insurance authorization reference, expected collection date, notes and billing status:

- Documentation pending
- Claim submitted (insurance bills only)
- Collection follow-up
- Settled (requires no remaining balance at the current business date)

Case references must be unique within the hospital. Updates carry a reason, organization revision and optimistic case-update timestamp. Changes are audited with before/after metadata. They do not change original bill fields, invoice dates, recognition months or P&L entries. Existing closed months can receive case-follow-up notes because these are operational metadata, not financial restatements.

The case detail also displays linked collections, approved Won pipeline linkage and directly linked expense entries. Expense amounts retain their original currencies and are not represented as fully allocated case profit. Use Analytics for the established cost-allocation model. The selected cash cutoff affects financial balances, while workflow notes show the latest saved metadata rather than a historical workflow snapshot. A latest Settled label is flagged if a balance remains at the selected cutoff.

## Hospital import mappings

Finance can configure a named mapping per hospital, selecting source column headers, an explicit date format and number format. The first worksheet/first row must contain a rectangular data table with nonempty, unique headers. Maximum file size is 5 MB and maximum row count is 1,000. Existing archive, macro/external-link and formula-cell protections apply. CSV/XLSX files must contain values, not calculated formulas.

A mapping stores:

| Setting        | Behavior                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hospital       | Configured hospital ID. A mapped hospital value must agree; mixed-hospital uploads are not silently reassigned.                                                                                |
| Date format    | ISO, DD/MM/YYYY or MM/DD/YYYY. Native Excel dates arrive as unambiguous ISO dates and are accepted.                                                                                            |
| Number format  | Plain decimal or comma-grouped thousands. Currency symbols, malformed grouping, negatives and blank mapped required money values are rejected.                                                 |
| Source headers | Explicit mapping to bill fields, optional recognition month and individual Al Garhoud component amounts. Gross bill amount must be supplied as a mapped source column.                         |
| Defaults       | Explicitly configured values for bill type, payment mode, regime, visits, consumables, pharmacy/lab, VAT, tax, hospital or AED currency. Defaults used in a preview are disclosed as warnings. |
| Value aliases  | Explicit hospital/procedure/doctor/payment/type/regime code translations. No fuzzy matching or inferred master changes.                                                                        |

All hospital amounts must already be AED. A source currency field mapped to `currency`, or an explicitly named Currency column, must contain AED. The module does not convert foreign hospital bill currencies. Keep invoice identifiers as text in Excel to preserve leading zeros; numeric cells cannot recover zeros omitted by the source.

The required core mappings are date, patient, procedure, doctor, invoice and gross. Net-share bills also need source consumable/pharmacy values or explicit approved defaults. Component fields use keys such as `component:Consultation` and `component:Surgeon Fee`; effective component percentages remain in the master rules. Share percentages cannot be configured in mappings or imported as overrides. Blank mapped component amounts must be corrected to explicit values rather than silently treated as zero.

Example value alias configuration:

```json
{
  "procedure": { "RF": "RFA" },
  "payment": { "INS": "Insurance" }
}
```

Profile versions are immutable. **Copy as new version** loads an existing definition; saving under the same exact name and hospital creates another version and ID. Each mapped preview retains its profile ID, version and hospital. The source file hash prevents repeated active imports. Profiles are not automatically approved clinical/financial source data: Finance must verify mappings and all preview rows before committing.

Previews run existing master, rule, currency, date, lock and duplicate validation. They create no revenue. An explicit commit rechecks all rows against the current ledger atomically and posts once. Any error prevents the entire batch from posting. Preview cancellation is available; committed bill correction continues through existing approved adjustment workflows rather than deletion.

Duplicate hospital invoices now use normalized identity (Unicode normalization, trimmed/collapsed whitespace and case folding), without case-folding or rewriting the stored identifier for duplicate detection. Mapped imports explicitly trim outer cell whitespace during source-field normalization. Same-day patient/procedure/gross-amount repeats under another invoice are warnings requiring source review, not automatic merges or automatic rejection. The stronger duplicate rule applies to all bill-entry/import paths; pre-existing ambiguous duplicates require Finance resolution rather than being silently relabelled.

## Bank statement matching

This is matching of bank evidence to **cash already recorded in the application**. It is not bank connectivity, payment execution, cash posting, bank balance certification, or a full double-entry bank reconciliation ledger.

Prepare a canonical AED CSV or XLSX table with:

```csv
transactionId,date,direction,amount,reference
SYNTHETIC-BANK-001,2026-06-30,In,100.00,Synthetic receipt reference
```

Use stable bank transaction IDs and one consistent Finance-approved account alias for each physical account. Account aliases are normalized to uppercase; transaction IDs are normalized for duplicate checks within that alias. Repeated payments sharing a reference need distinct bank transaction IDs. The application cannot detect that two different account aliases represent the same physical account.

Bank dates must be ISO calendar dates, directions In/Out and amounts positive AED with at most two decimals. Explicit foreign-currency columns are rejected; no settlement FX rate is guessed. Statement previews disclose all row errors. Committing rechecks IDs against previously committed statements, preventing concurrent/repeated imports. Statement import and commitment create **no** financial entries. A bad preview can be cancelled. To correct a committed statement, first unmatch every active allocation; an Admin can then void the statement with a reason. Original rows, void metadata and allocation history remain available. A reviewed replacement can reuse transaction IDs from the voided statement, but cannot duplicate any other currently committed statement. This never reverses or deletes source cash postings.

For each committed line, candidate cash sources include recorded consultation/admin receipts, hospital settlements, doctor payments, paid expense cash, wallet funding and explicit cash movements. The system ranks suggestions by reference agreement, available amount and date proximity; it never automatically allocates them. Source references, dates and available amounts are shown so Finance can verify the evidence. Dates can differ, but are not automatically corrected.

Allocations can split one cash event across bank rows or combine several cash events into one bank row. Directions must agree. Transactional revision checks and Decimal arithmetic prevent either side being overallocated. Matching records the source cash snapshot, actor, reason and time. Unmatching is an audited reversal of the evidence link and preserves both the source cash posting and the original allocation history.

The second register shows recorded cash without full bank evidence across the organization, not just the selected account. It can include cash on hand and is not proof that every record must appear on a bank statement. Candidate search shows up to 200 results; the unallocated-cash view shows up to 100 matching records. Refine reference searches for larger datasets.

If a later accounting change alters a linked source cash amount/date/direction, the allocation is flagged **source changed**. It remains reserved and auditable until explicitly unmatched; it cannot silently become another available allocation. A bank row with changed source evidence is excluded from the fully allocated count. The user must unmatch, verify the revised source and allocate again; any remaining difference stays visible. No FX gain/loss, fee, refund or balancing entry is manufactured.

Existing paid-expense records use the application's source-date/book-FX convention, while explicit cash payments have fixed recorded AED amounts. A bank difference arising from settlement FX or actual payment timing requires the approved accounting workflow/policy; matching cannot repair it. Prepaid amortisation and wallet ad spend are not duplicated as cash.

The XLSX matching register contains bank rows and review flags, recorded-cash balances, full allocation/reversal history and original linked cash snapshots. It is private financial evidence. No bank or other person receives a message or payment through this module.

## API additions

| Method | Endpoint                                     | Purpose                                                            |
| ------ | -------------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/daily/import-fields`                   | Supported canonical bill mapping fields                            |
| POST   | `/api/daily/profiles`                        | Create an immutable hospital mapping version                       |
| POST   | `/api/daily/imports/preview`                 | Prepare mapped bill rows in the existing import workflow           |
| GET    | `/api/daily/cases?asOf=YYYY-MM-DD`           | Derived bill cases, dated balances and current case metadata       |
| PUT    | `/api/daily/cases/:billId`                   | Save source-linked tracking with concurrency checks                |
| GET    | `/api/daily/bank`                            | Statement rows, current allocations and recorded-cash availability |
| POST   | `/api/daily/bank/preview`                    | Parse/validate bank evidence without posting cash                  |
| POST   | `/api/daily/bank/:id/commit`                 | Commit a valid statement after duplicate recheck                   |
| POST   | `/api/daily/bank/:id/cancel`                 | Cancel a preview                                                   |
| GET    | `/api/daily/bank/:id/rows/:rowId/candidates` | Ranked cash suggestions; optional reference search                 |
| POST   | `/api/daily/bank/matches`                    | Allocate to an existing recorded cash event                        |
| POST   | `/api/daily/bank/matches/:id/reverse`        | Unmatch with a reason; preserve source cash                        |
| GET    | `/api/daily/bank/export`                     | Download matching evidence                                         |

Mapped bill commits/cancellations use the existing `/api/imports/:id/commit` and `/cancel` routes. All writes require Finance/Admin, current revision and a reason. Management remains read-only.

## Persistence and upgrade

The audited `workflow_item` schema adds `hospital_profile`, `case_record`, `bank_statement` and `bank_match`. Mapped import batches gain optional provenance and row warnings. Existing bill payloads remain unchanged. Links are checked by application transactions; JSON references are not SQL foreign keys.

Back up the PostgreSQL database, stop the old server, then run:

```sh
npm ci
npm run db:migrate
npm run build
```

Restart with the existing database, JWT and private-file settings. The migration expands allowed workflow kinds without resetting approved masters or posting source records. Demo users only need dependency installation/build and startup with `DEMO_MODE=true`; all demo operations reset on restart. The README contains Windows PowerShell commands.

No private workbook, patient records or real bank statements are added to the public repository. Actual Finance approvals and the remaining full FY2026 reconciliation are still required. This phase does not certify production hosting, statutory accounts or complete bank GL reconciliation.
