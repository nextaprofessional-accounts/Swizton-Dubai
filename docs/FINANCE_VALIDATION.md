# Finance validation — v0.4

This phase provides a controlled route from source evidence to monthly FX approval and financial review. It does not invent approved rates, correct the original workbook automatically, migrate patient records, or certify the entire FY2026 Excel statement. The original September figures and separate invoice/recognition dates remain preserved.

## Working sequence

1. Admin creates a named Finance account in User access. The preparer and approver must be different users.
2. Finance prepares each monthly FX rate in **Finance validation → Monthly FX**, citing the publication or approved Finance reference. Preview does not save or change accounts.
3. An independent Admin checks units, averaging method, coverage and source evidence, then approves or rejects. Approval updates the central master rate atomically; the audit log records the proposal and before/after FX masters.
4. Finance uploads the private source workbook in **Workbook review** using PostgreSQL mode. Inspection preserves its original baseline and does not post entries.
5. In **Finance validation → Exception register**, Finance proposes a disposition for each finding and nonmatching/blocked source check. A different Admin accepts or rejects the evidence.
6. Review **Reconciliation & sign-off**, resolve blockers and export the review pack. An Admin independent of the workbook uploader can record the appropriate sign-off scope.

## Monthly average rates

| Method                   | Input and calculation                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Provided monthly average | A monthly INR/AED average supplied from a documented source. The application does not claim to have calculated its underlying daily average. |
| Daily average            | Equal-weight mean of the supplied dated INR/AED observations.                                                                                |
| Cross-rate average       | Equal-weight mean of supplied dated INR/USD observations divided by the single monthly AED/USD rate supplied by Finance.                     |

Daily CSV headers must be exactly `date,rate`. Dates must be valid, unique and inside the selected month. Maximum 31 observations and 64 KB CSV input. Formula strings and nonnumeric rates are rejected. All rates must be positive. Decimal arithmetic rounds the approved INR/AED average to six decimal places; a rate that rounds to zero is rejected. AED/USD is also supplied explicitly, with up to six decimal places and without an assumed peg.

Example synthetic input:

```csv
date,rate
2026-01-02,25.40
2026-01-05,25.60
```

This yields INR/AED 25.500000 **for the two supplied observations**. It is not proof of a complete January RBI average. The preview and approval register disclose observation count, earliest/latest dates and the calculation basis. Missing dates, weekends and holidays are never filled. Finance must check whether the observations represent the intended publication/averaging calendar; there is no automatic RBI feed or calendar completeness certification.

New proposals do not alter P&L results until approval. Only one Pending proposal per month is allowed. Approved/rejected proposals remain as history; corrections require another proposal. Approval rejects a changed underlying monthly rate and requires a new proposal. Locked months must be reopened before replacement. Existing share, lock and overpayment protections apply to master changes.

**Masters → FX is now read-only.** Direct FX updates through the master API are rejected. Existing legacy/sample rates remain usable for viewing historical calculations but are labelled unapproved until the current master row has a matching independent approval. New month closes require an approved current rate and no pending replacement proposal. Existing locked months are preserved rather than reopened or approved automatically. Annual INR remains the sum of monthly translations; no separate year-end rate is introduced.

## Exception dispositions

Every statement issue and every mismatch/blocked source calculation has a stable key within its immutable workbook review. Finance records a reason and evidence reference, choosing:

- **Retain original**: acknowledge the exception while preserving its figures. This prevents a full reconciliation sign-off.
- **Evidence verified**: record independently checked source/reconciliation evidence. This does not edit the original check or its cached result.
- **Linked approved adjustment**: link an adjustment entry already posted through the existing independent approval workflow. The link itself does not post it again.

An item can have only one Pending or Approved disposition. Rejection allows a new proposal; history remains available in the workflow/audit records. A preparer cannot review their own disposition. Workbook baselines, formulas and source findings remain immutable.

## Reconciliation and sign-off scope

The screen compares four monthly **AED control totals**: total revenue, Swizton revenue, total expense and net profit/loss. Delta is application Actual minus original baseline. A line matches within AED 0.005. Missing, invalid or duplicate source-month values remain unavailable; they are never silently treated as zero. Calculation errors are available on the month status and leave Actual unavailable.

This is a control-total reconciliation. It does **not** certify every Excel cell, original INR formulas, hospital detail, historical comparisons, tax treatment, or statutory accounts. Different approved FX rates can produce different INR figures while AED controls still match.

| Scope                    | Prerequisites and meaning                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed with exceptions | All source findings have independently approved dispositions, all 12 monthly FX masters have matching approval, at least one source month can be compared, and no financial adjustment or replacement FX proposal for the year awaits review. Outstanding control differences, missing source months and retained exceptions remain disclosed in the signed summary. This is acknowledgment of the reviewed state, not full reconciliation approval. |
| Reconciled               | All review prerequisites, all 12 source months available, all 48 AED control lines matched and no retained-original exceptions. This records reconciliation of these monthly control totals only.                                                                                                                                                                                                                                                    |

The source workbook presently covers fewer than 12 Actual baseline months in the inspection mapping. The app therefore cannot claim full-year reconciliation until complete source coverage is available through a verified source/migration extension. It does not manufacture missing months from blank cells.

Sign-offs freeze the workbook source hash, financial fingerprint, actor, timestamp, scope, reason and summary. The fingerprint covers current masters, Actual entries, annual close state, pending adjustments/FX proposals and approved exception dispositions. Financial state changes mark the prior sign-off stale when its fingerprint no longer matches. Planning leads and ordinary cash settlements do not by themselves restate the P&L fingerprint. No sign-off automatically locks a month or closes a year.

## Review export

The authenticated XLSX export contains review status/blockers, source hash and revision, current monthly rates, FX approval history, daily observations and units, monthly AED baseline/Actual/deltas, exception evidence and sign-off history. It contains original source-cell references and reviewer identities for audit purposes. Store it privately with your accounting evidence. Exporting does not approve financial data.

## APIs

All endpoints require authentication. Finance/Admin can prepare; only independent Admins can review or sign. Writes require current organization revision and a reason.

| Method | Endpoint                                     | Purpose                                                 |
| ------ | -------------------------------------------- | ------------------------------------------------------- |
| POST   | `/api/finance/fx/preview`                    | Calculate and disclose coverage without posting         |
| POST   | `/api/finance/fx`                            | Prepare immutable rate evidence for review              |
| POST   | `/api/finance/fx/:id/review`                 | Approve/apply atomically or reject                      |
| GET    | `/api/finance/workbooks/:id/:year/readiness` | Approval status, findings, AED comparisons and blockers |
| POST   | `/api/finance/exceptions`                    | Propose an evidence-backed disposition                  |
| POST   | `/api/finance/exceptions/:id/review`         | Independently accept/reject a disposition               |
| POST   | `/api/finance/signoffs`                      | Record a server-validated financial-state sign-off      |
| GET    | `/api/finance/workbooks/:id/:year/export`    | Download the current review pack                        |

## Schema and migration

`workflow_item` adds `fx_proposal`, `finance_exception` and `finance_signoff` kinds. Approved central FX rows gain an optional `approvalId` linking to their workflow evidence. Existing records are retained and are not retroactively approved. The existing append-only audit log and transactional organization revision lock cover all changes. JSON links are validated by the application, not database foreign keys.

For PostgreSQL upgrades, back up the database, stop the old server, run `npm ci`, `npm run db:migrate` and `npm run build`, then restart with the same database, secret and private-storage settings. Create separate named preparer and approver accounts. Master rates must be approved before any new month close. For the memory-only sample workspace, run `npm ci` and `npm run build`, then start with `DEMO_MODE=true`; sample changes disappear on restart.

The supplied private workbook and reconciliation artifacts remain outside the public repository. This release supplies the review tools; actual source approval and financial sign-off still require Finance action.
