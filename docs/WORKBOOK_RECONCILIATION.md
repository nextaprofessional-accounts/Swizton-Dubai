# Private workbook reconciliation workflow

Use the existing checkout. This workflow inspects the uploaded legacy workbook without changing it, executing formulas/instructions, importing patients into the app, or approving master rates.

```sh
npm run workbook:reconcile -- /secure/path/source.xlsx --out /workspace/private/swizton-reconciliation
SWIZTON_GOLDEN_FIXTURE=/workspace/private/swizton-reconciliation/golden-source-rows.json npm test
```

The output directory **must be outside the repository**. The tool rejects a directory resolving inside the checkout, including symlinks into it. Workbook binaries, financial results, source fingerprints and private fixtures must not be added to the public GitHub repository. Directory permissions are 0700 and generated files 0600. Patient names, contact details and referral identities are omitted from the source-row fixtures. This is single-operator local tooling; use a new private output directory for each source version, retain originals and restrict access to it.

## Artifacts

| File                       | Meaning                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `source-inventory.json`    | Sheet dimensions, visibility, formula counts, missing caches and error addresses                                                                                                     |
| `statement-baseline.json`  | FY2026 statement cells, cached values, formulas and number formats                                                                                                                   |
| `statement-baseline.xlsx`  | Formatted source P&L snapshot, same source cells through BY45; formulas replaced with their cached values, including zero, false and errors                                          |
| `golden-source-rows.json`  | Pseudonymous bill/component/forecast fixtures with observed source rates and expected cached outputs; no clinical identities                                                         |
| `reconciliation.json`      | Arithmetic exceptions, forecast references in Actual, FX observations, embedded numeric terms, source-row engine checks, invoice-date/source-report comparison and timing exceptions |
| `migration-decisions.json` | User accounting decisions, retained on read-only reruns; not automatically applied to live masters or entries                                                                        |
| `correction-proposal.json` | Explicit, unapproved bridge from cached FY totals to sums of monthly Actuals                                                                                                         |
| `adjustment-review.json`   | Embedded numeric terms awaiting business reason and Finance approval; no automatic postings                                                                                          |
| `REPORT.md`                | Private review summary, arithmetic differences and decisions needed before migration                                                                                                 |

A cached value is a source observation, **not a recalculated or approved financial balance**. The source snapshot is a baseline representation, not a corrected statement and not the app's automated export. Its style/merges/column widths are retained for comparison; exact PDF/printed pagination still requires Finance review. Source print areas were not defined for the FY2026 statement, so the snapshot defines one explicitly. Feeder sheets and workbook log content are not copied into the snapshot.

The helper reads selected known financial cells and cached formula values using ExcelJS. It never evaluates formula strings, opens hyperlinks/external links, executes macros, treats log text as instructions, or interprets embedded AI conversation history as a user request. Shared/array cached formulas are read as data. ExcelJS's `Cell.value` representation omits falsy formula results; the helper deliberately reads `Cell.result` to retain cached numeric zero and boolean false. Synthetic tests cover this distinction.

## Source mappings

- FY2026 Actual columns: January G, February M, March P, April V, May AB, June AH, July AN, August AT, September AZ. March has no separate Approx block. October–December have single unlabeled-version blocks, so they are **not silently assigned to Actual**.
- Approx columns: January D, February J, April S, May Y, June AE, July AK, August AQ, September AW.
- Rows 6–19: source revenue, doctor allocations, Swizton and its source breakdown; rows 21–30: expenses/profit; rows 31–45: case/visit/target/procedure counts.
- FY26: BL AED, BM raw INR, BN percentage. Historical summaries: BO–BQ / BR–BT / BU–BV; Combined at BW. Raw cached INR cells may use custom visual scaling; the app stores its **INR lakh** measure explicitly by dividing raw INR by 100,000.
- IP bill inputs: `IP Details` C hospital, D invoice date, J gross, K consumables, L pharmacy/lab, M/N recorded admin/refundable deductions, O net, P share, Q final share. T can represent a residual/collection rather than full Q. Patient/doctor identities are not required for source-row arithmetic checks.
- September forecasts: approval H, hospital I/E, net L, doctor payout M, Swizton N. Q4/Q5/Q6 hold observed doctor-share, Swizton-share and Garhoud fee-for-service assumptions. The tool excludes subtotal/benchmark rows by requiring a numeric sequence field.
- Al Garhoud normalised bills: component columns H–R, final doctor fee S; source rate cells are taken from the original fee table. A single-table comparison is provisional: historical Insurance-IP, Insurance-OP, self-pay, rounding, negotiated surgeon amounts and the restructured sheet's completeness must be approved before deriving effective-dated rules.
- Expense and marketing sheets are inventoried, not auto-posted. Dates in the expense ledger can be payment dates for prior-month costs; the report's month, accrual, allocation and FX must be reconciled before ledger migration.

## Calculation changes supported by source inspection

### Forecast chain

Approval (gross) × (1 − material/deduction fraction) = net procedure charge.

Net procedure charge × effective `forecastShare` (fallback `share`) = doctor payout.

Doctor payout × effective `swizton` = Swizton revenue. Chinmay/Tahsin allocations apply to this doctor-payout revenue base, not gross approval. `forecastShare` is effective-dated master data, allowing a fee-for-service source to have a different prospective doctor-share factor. No production rates are populated from the workbook automatically. Budget scenarios already accept **final-share revenue per case**, so their definition and formula are unchanged.

### Recorded deductions

Bills can carry optional `adminAmount` and `refundableAmount`, alongside `deductionReason`. Actual recorded deductions take precedence over percentage defaults; one can be overridden independently. The reason is mandatory when either amount is supplied, and the normal transaction audit captures it. This supports hospital-specific measured/negotiated deduction bases without disguising amounts inside formula code. The default rate remains effective-dated master data. Direct source-row checks preserve recorded values; they do not establish the contractual basis or approval of those values.

## Acceptance gates

1. Verify source integrity and preserve the full workbook privately.
2. Review arithmetic mismatches, cached Excel errors and Actual→Approx dependencies.
3. Approve monthly central FX and the bridge from historical mixed rates/annual retranslation to consistent monthly translation.
4. Explain source-specific revenue additions, doctor eligible-revenue exclusions, rounded/negotiated component fees, missing gross amounts and partial collections.
5. Approve recognition dates for prior-year bills received in the report year; never change invoice dates merely to force the P&L to match.
6. Approve source-version precedence for restructured bills/marketing wallet sheets, expense recognition and prepaid coverage. Do not count original and restructured copies as separate inputs.
7. Run golden fixtures and line-by-line reconciliation again after approved rules are configured. Keep mismatches, blocked checks and true matches separate; a passing diagnostic test that verifies an exception was reported is **not** financial reconciliation sign-off.
8. Import reviewed entries into a private staging database, reconcile the full P&L and exports, and secure Finance approval before live migration/month locking.

## Current limits

The CLI checks the existing known workbook layout rather than arbitrary spreadsheets. Its source-row checks span historical and current-year data; a matched check is not necessarily a FY2026 case. It verifies calculable CSH/IMH final shares, a provisional Al Garhoud component model and September forecast arithmetic. It does not yet migrate the entire expense ledger, wallet, all forecast months or encounter counts. Date-based source aggregation is only a comparison of calculable bills; it does not resolve recognition differences, missing invoices or signed adjustments. No historical balances are posted to production or demo mode by this command. Unresolved source figures must not be turned into unexplained balancing entries.

## Recognition dates

Bills and receipts accept an optional `recognitionMonth` (`YYYY-MM`), defaulting to the original `date` month. The original date is never overwritten. Revenue and recognition-period FX use the recognition month; the effective share rule is selected by the original invoice/receipt date. Case and visit KPIs retain the original occurrence-date period; they must not turn prior-year receipts into new current-year cases. Locks protect both the original occurrence month and revenue recognition month because either may affect reported values. The historical share rule must cover the original invoice date; FX is required for the recognition period. Viewing a historical-year report separately requires that year's reporting FX configuration.

The source ledger shows both dates and filters by revenue recognition period; recognised-bill profitability counts can therefore differ from occurrence-date case KPIs. Partial settlements still require a reviewed allocation workflow; this field does not permit posting the same invoice in full multiple times.
