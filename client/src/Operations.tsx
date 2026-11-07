import React, { useEffect, useState } from 'react';
import type { Dataset } from '../../server/model';
import type {
  WorkflowItem,
  ImportBatch,
  AdjustmentRequest,
  WorkbookReview,
} from '../../server/workflow-model';
import { api, download } from './api';
const fmt = (v: any, d = 2) =>
  Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
type Props = {
  ds: Dataset;
  revision: number;
  user: { id: string; role: string };
  month: string;
  refresh: () => Promise<void>;
  demo: boolean;
};
export function useAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  return {
    busy,
    error,
    notice,
    act: async (fn: () => Promise<any>, message = 'Saved successfully') => {
      setBusy(true);
      setError('');
      setNotice('');
      try {
        const r = await fn();
        await refresh();
        setNotice(message);
        return r;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
  };
}
export function Alerts({ s }: { s: ReturnType<typeof useAction> }) {
  return (
    <>
      {s.error && (
        <div className="error" role="alert">
          {s.error}
        </div>
      )}
      {s.notice && (
        <div className="success" role="status">
          {s.notice}
        </div>
      )}
      {s.busy && <p role="status">Working…</p>}
    </>
  );
}
export function Reason({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>
      Reason / approval note
      <input
        required
        minLength={8}
        maxLength={1000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe the source and business purpose"
      />
    </label>
  );
}
async function fileContent(file: File) {
  if (file.size > 5_000_000) throw Error('Maximum file size is 5 MB');
  if (file.name.toLowerCase().endsWith('.csv'))
    return { format: 'csv', content: await file.text() };
  return {
    format: 'xlsx',
    content: btoa(
      Array.from(new Uint8Array(await file.arrayBuffer()), (c) => String.fromCharCode(c)).join(''),
    ),
  };
}
export function Operations({ ds, revision, user, month, refresh }: Props) {
  const s = useAction(refresh),
    [tab, setTab] = useState('Import review'),
    [reason, setReason] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [scenario, setScenario] = useState({
      name: '',
      fixedCost: '',
      hospital: ds.masters.hospitals[0]?.id ?? '',
      procedure: ds.masters.procedures[0] ?? '',
      cases: 1,
      revenuePerCase: '',
    }),
    [items, setItems] = useState<any[]>([]),
    [projection, setProjection] = useState<any>(null);
  const ops = ds.operations ?? [],
    pending = ops.filter((o) => o.kind === 'adjustment_request' && o.status === 'Pending');
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Finance operations</h2>
          <p>Review first, commit once. All operational changes carry an audit reason.</p>
        </div>
        <span className="badge">{pending.length} pending approvals</span>
      </div>
      <div className="master-tabs">
        {['Import review', 'Adjustment approvals', 'Saved budgets'].map((t) => (
          <button key={t} className={tab === t ? 'primary' : 'outline'} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <Alerts s={s} />
      {tab === 'Import review' && (
        <>
          <section className="panel">
            <h3>Preview a bill upload</h3>
            <p>
              CSV or XLSX using the bill template. Every row is checked for duplicates, master
              mappings, rates and locked months. Preview creates no revenue.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                s.act(async () => {
                  if (!file) throw Error('Choose a file');
                  return api('/imports/preview', {
                    ...(await fileContent(file)),
                    name: file.name,
                    reason,
                    revision,
                  });
                }, 'Import preview prepared; review row results below');
              }}
            >
              <div className="form-grid">
                <label>
                  Bill file
                  <input
                    required
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <Reason value={reason} onChange={setReason} />
              </div>
              <button className="primary" disabled={s.busy || user.role === 'Management'}>
                Validate & preview
              </button>
            </form>
          </section>
          {ops
            .filter((o): o is ImportBatch => o.kind === 'import_batch')
            .slice()
            .reverse()
            .map((batch) => (
              <section className="panel" key={batch.id}>
                <div className="panel-heading">
                  <div>
                    <h3>{batch.name}</h3>
                    <p>
                      {batch.rows.length} rows · {batch.rows.filter((r) => r.errors.length).length}{' '}
                      with errors
                    </p>
                  </div>
                  <span className="badge">{batch.status}</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Invoice</th>
                        <th>Hospital</th>
                        <th>Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.rows.map((row) => (
                        <tr key={row.row}>
                          <td>{row.row}</td>
                          <td>{row.entry?.kind === 'bill' ? row.entry.invoice : '—'}</td>
                          <td>{row.entry && 'hospital' in row.entry ? row.entry.hospital : '—'}</td>
                          <td className={row.errors.length ? 'red' : ''}>
                            {row.errors.length ? row.errors.join('; ') : 'Ready'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {batch.status === 'Preview' && user.role !== 'Management' && (
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={s.busy || batch.rows.some((r) => r.errors.length)}
                      onClick={() =>
                        s.act(
                          () =>
                            api(`/imports/${batch.id}/commit`, {
                              revision,
                              reason: reason.length >= 8 ? reason : batch.reason,
                            }),
                          'Validated batch committed to the ledger',
                        )
                      }
                    >
                      Commit validated batch
                    </button>
                    <button
                      className="outline"
                      disabled={s.busy}
                      onClick={() =>
                        s.act(
                          () =>
                            api(`/imports/${batch.id}/cancel`, {
                              revision,
                              reason: reason.length >= 8 ? reason : batch.reason,
                            }),
                          'Preview cancelled',
                        )
                      }
                    >
                      Cancel preview
                    </button>
                  </div>
                )}
              </section>
            ))}
        </>
      )}
      {tab === 'Adjustment approvals' && (
        <section className="panel">
          <h3>Independent adjustment review</h3>
          <p>
            Submit adjustments from Revenue & bills or Expense ledger. A different Admin must review
            them. Pending requests do not change the P&L and block month close.
          </p>
          <Reason value={reason} onChange={setReason} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date / version</th>
                  <th>Line / purpose</th>
                  <th>AED basis</th>
                  <th>Submission reason</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {ops
                  .filter((o): o is AdjustmentRequest => o.kind === 'adjustment_request')
                  .slice()
                  .reverse()
                  .map((o) => (
                    <tr key={o.id}>
                      <td>
                        {o.entry.date} · {o.entry.version}
                      </td>
                      <td>
                        {o.entry.line}
                        <small className="block">
                          {o.entry.adjustmentType === 'ChinmayEligibility'
                            ? 'Eligible-revenue basis only'
                            : 'Source amount'}
                        </small>
                      </td>
                      <td>{fmt(o.entry.amount)}</td>
                      <td>{o.reason}</td>
                      <td>
                        <span className="badge">{o.status}</span>
                      </td>
                      <td>
                        {o.status === 'Pending' &&
                        user.role === 'Admin' &&
                        o.createdBy !== user.id ? (
                          <>
                            <button
                              className="text-button"
                              disabled={s.busy || reason.length < 8}
                              onClick={() =>
                                s.act(
                                  () =>
                                    api(`/adjustments/${o.id}/review`, {
                                      approve: true,
                                      reason,
                                      revision,
                                    }),
                                  'Adjustment approved and posted',
                                )
                              }
                            >
                              Approve
                            </button>
                            <button
                              className="text-button red"
                              disabled={s.busy || reason.length < 8}
                              onClick={() =>
                                s.act(
                                  () =>
                                    api(`/adjustments/${o.id}/review`, {
                                      approve: false,
                                      reason,
                                      revision,
                                    }),
                                  'Adjustment rejected',
                                )
                              }
                            >
                              Reject
                            </button>
                          </>
                        ) : o.status === 'Pending' ? (
                          'Awaiting another Admin'
                        ) : (
                          o.reviewNote
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!ops.some((o) => o.kind === 'adjustment_request') && (
            <p className="empty">No requests submitted.</p>
          )}
        </section>
      )}
      {tab === 'Saved budgets' && (
        <>
          <section className="panel">
            <h3>Versioned budget scenarios · {month}</h3>
            <p>
              Save multiple procedure rows as a named scenario. Calculations always use the
              currently effective master share; saved inputs retain the audit timestamp.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                s.act(
                  () =>
                    api('/budgets', {
                      name: scenario.name,
                      month,
                      fixedCost: scenario.fixedCost,
                      items,
                      reason,
                      revision,
                    }),
                  'Budget scenario saved',
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Scenario name
                  <input
                    required
                    value={scenario.name}
                    onChange={(e) => setScenario({ ...scenario, name: e.target.value })}
                  />
                </label>
                <label>
                  Fixed cost · AED
                  <input
                    type="number"
                    min="0"
                    required
                    value={scenario.fixedCost}
                    onChange={(e) => setScenario({ ...scenario, fixedCost: e.target.value })}
                  />
                </label>
                <label>
                  Hospital
                  <select
                    value={scenario.hospital}
                    onChange={(e) => setScenario({ ...scenario, hospital: e.target.value })}
                  >
                    {ds.masters.hospitals.map((h) => (
                      <option key={h.id}>{h.id}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Procedure
                  <select
                    value={scenario.procedure}
                    onChange={(e) => setScenario({ ...scenario, procedure: e.target.value })}
                  >
                    {ds.masters.procedures.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Cases
                  <input
                    type="number"
                    min="0"
                    value={scenario.cases}
                    onChange={(e) => setScenario({ ...scenario, cases: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Final-share revenue per case · AED
                  <input
                    type="number"
                    min="0"
                    value={scenario.revenuePerCase}
                    onChange={(e) => setScenario({ ...scenario, revenuePerCase: e.target.value })}
                  />
                </label>
              </div>
              <button
                className="outline"
                type="button"
                onClick={() => {
                  setItems([
                    ...items,
                    {
                      hospital: scenario.hospital,
                      procedure: scenario.procedure,
                      cases: scenario.cases,
                      revenuePerCase: scenario.revenuePerCase,
                    },
                  ]);
                  setProjection(null);
                }}
              >
                + Add scenario row
              </button>
              {items.map((item, i) => (
                <div className="waterfall" key={i}>
                  <span>
                    {item.hospital} · {item.procedure} · {item.cases} × {fmt(item.revenuePerCase)}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <Reason value={reason} onChange={setReason} />
              <button
                className="primary"
                disabled={s.busy || !items.length || user.role === 'Management'}
              >
                Save scenario
              </button>
            </form>
          </section>
          {ops
            .filter((o) => o.kind === 'budget')
            .slice()
            .reverse()
            .map(
              (o) =>
                o.kind === 'budget' && (
                  <section className="panel" key={o.id}>
                    <div className="panel-heading">
                      <div>
                        <h3>
                          {o.name} · {o.month} · v{o.version}
                        </h3>
                        <p>
                          {o.items.length} procedure rows · AED {fmt(o.fixedCost)} fixed cost ·
                          Saved profit AED {fmt(o.projection?.profit)}
                        </p>
                      </div>
                      <button
                        className="outline"
                        onClick={() =>
                          s.act(async () => {
                            const result = await api('/budget', {
                              month: o.month,
                              fixedCost: o.fixedCost,
                              items: o.items,
                            });
                            setProjection({ ...result, name: o.name });
                            return result;
                          }, 'Scenario recalculated with current masters')
                        }
                      >
                        Calculate current projection
                      </button>
                      <button
                        className="outline"
                        onClick={() =>
                          s.act(async () => {
                            const v = await api(`/budgets/${o.id}/variance`);
                            setProjection({
                              ...v.budget,
                              name: `${o.name} v${o.version} vs Actual`,
                              basis: `Actual profit AED ${fmt(v.actual.profit)}; variance AED ${fmt(Number(v.actual.profit) - Number(v.budget.profit))}. The budget uses its saved share snapshot.`,
                            });
                            return v;
                          }, 'Saved budget compared with Actual')
                        }
                      >
                        Compare with Actual
                      </button>
                    </div>
                  </section>
                ),
            )}
          {projection && (
            <section className="panel">
              <h3>{projection.name}</h3>
              <div className="metrics">
                <div className="metric">
                  <span>Swizton revenue</span>
                  <strong>AED {fmt(projection.swizton)}</strong>
                </div>
                <div className="metric">
                  <span>Profit / loss</span>
                  <strong>AED {fmt(projection.profit)}</strong>
                </div>
              </div>
              <p>{projection.basis}</p>
            </section>
          )}
        </>
      )}
    </>
  );
}
export function Receivables({ ds, revision, user, month, refresh }: Props) {
  const s = useAction(refresh),
    [asOf, setAsOf] = useState(`${month}-28`),
    [rows, setRows] = useState<any[]>([]),
    [loadError, setLoadError] = useState(''),
    [search, setSearch] = useState(''),
    [billId, setBillId] = useState(''),
    [amount, setAmount] = useState(''),
    [date, setDate] = useState(`${month}-15`),
    [reference, setReference] = useState(''),
    [reason, setReason] = useState('');
  useEffect(() => {
    let active = true;
    setLoadError('');
    setRows([]);
    api(`/receivables?asOf=${asOf}`)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setLoadError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [asOf, ds]);
  const filtered = rows.filter((r) =>
    `${r.hospital} ${r.invoice} ${r.patient}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Hospital collections & ageing</h2>
          <p>
            Receivable = final doctor-fee share less linked collections. Collections do not
            recognise revenue again.
          </p>
        </div>
        <label>
          As of
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
      </div>
      <Alerts s={s} />
      {loadError && (
        <div className="error" role="alert">
          Balances unavailable: {loadError}
        </div>
      )}
      <div className="metrics">
        {['0–30', '31–60', '61–90', '90+'].map((bucket) => (
          <div className="metric" key={bucket}>
            <span className="metric-label">{bucket} DAYS OUTSTANDING</span>
            <strong>
              AED{' '}
              {fmt(
                rows
                  .filter((r) => r.bucket === bucket)
                  .reduce((a, r) => a + Number(r.outstanding), 0),
              )}
            </strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <label>
          Search invoices, hospitals or patient references
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice / original date</th>
                <th>Hospital</th>
                <th>Patient reference</th>
                <th>Total share AED</th>
                <th>Collected AED</th>
                <th>Outstanding AED</th>
                <th>Age</th>
                <th>History</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.invoice}
                    <small className="block">
                      {r.date} · recognised {r.recognitionMonth}
                    </small>
                  </td>
                  <td>{r.hospital}</td>
                  <td>{r.patient}</td>
                  <td>{fmt(r.total)}</td>
                  <td>{fmt(r.paid)}</td>
                  <td>{fmt(r.outstanding)}</td>
                  <td>{r.days} days</td>
                  <td>
                    <details>
                      <summary>{r.payments.length} collections</summary>
                      {r.payments.map((p: any) => (
                        <p key={p.id}>
                          {p.date} · {p.reference} · AED {fmt(p.amount)}
                        </p>
                      ))}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {user.role !== 'Management' && (
        <section className="panel">
          <h3>Record a collection</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              s.act(async () => {
                const r = await api('/settlements', {
                  billId,
                  date,
                  amount,
                  reference,
                  reason,
                  revision,
                });
                return r;
              }, 'Collection recorded; revenue is unchanged');
            }}
          >
            <div className="form-grid">
              <label>
                Bill
                <select required value={billId} onChange={(e) => setBillId(e.target.value)}>
                  <option value="">Choose a bill</option>
                  {rows
                    .filter((r) => Number(r.outstanding) > 0)
                    .map((r) => (
                      <option value={r.id} key={r.id}>
                        {r.hospital} · {r.invoice} · {fmt(r.outstanding)} outstanding
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Collection date
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Amount · AED
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Bank / receipt reference
                <input required value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
            </div>
            <Reason value={reason} onChange={setReason} />
            <button className="primary" disabled={s.busy}>
              Record collection
            </button>
          </form>
        </section>
      )}
    </>
  );
}
export function WorkbookCenter({ ds, revision, user, refresh, demo }: Props) {
  const s = useAction(refresh),
    [file, setFile] = useState<File | null>(null),
    [reason, setReason] = useState(''),
    [selected, setSelected] = useState(''),
    [filter, setFilter] = useState('All');
  const reviews = (ds.operations ?? []).filter(
    (o): o is WorkbookReview => o.kind === 'workbook_review',
  );
  const review = reviews.find((r) => r.id === selected) ?? reviews.at(-1);
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Workbook reconciliation centre</h2>
          <p>
            Keep the original statement, identify differences and review the evidence before
            migration.
          </p>
        </div>
        <span className="badge">Original figures protected</span>
      </div>
      <Alerts s={s} />
      <div className="decision-grid">
        <div>
          <b>September / FY</b>
          <span>Preserve original pending Finance review</span>
        </div>
        <div>
          <b>Monthly FX</b>
          <span>Approval status is available in Finance validation</span>
        </div>
        <div>
          <b>Recognition</b>
          <span>Keep invoice date and recognition month separate</span>
        </div>
      </div>
      <section className="panel">
        <h3>Inspect a workbook version</h3>
        <p>
          Read-only inspection creates a private source snapshot, formula findings and pseudonymous
          calculation checks. It never posts ledger entries or approves FX.
        </p>
        {demo && (
          <p className="info-note">
            Real workbook uploads require PostgreSQL mode. The public demo contains illustrative
            transactions only. Existing private analysis remains outside the repository.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            s.act(async () => {
              if (!file) throw Error('Choose an XLSX workbook');
              return api('/workbooks/review', {
                name: file.name,
                content: (await fileContent(file)).content,
                reason,
                revision,
              });
            }, 'Private workbook review prepared');
          }}
        >
          <div className="form-grid">
            <label>
              FY2026 source workbook
              <input
                required
                type="file"
                accept=".xlsx"
                disabled={demo}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <Reason value={reason} onChange={setReason} />
          </div>
          <button className="primary" disabled={demo || s.busy || user.role === 'Management'}>
            Inspect without importing
          </button>
        </form>
      </section>
      {reviews.length > 0 && (
        <section className="panel">
          <label>
            Workbook version
            <select value={review?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {reviews.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {new Date(r.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      {review && (
        <>
          <div className="metrics">
            {[
              ['Matched source checks', review.readiness.matchedChecks],
              ['Unresolved differences', review.readiness.mismatchedChecks],
              ['Incomplete source checks', review.readiness.blockedChecks],
              ['Statement findings', review.issues.length],
            ].map(([label, n]) => (
              <div className="metric" key={label}>
                <span className="metric-label">{label}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          <WorkbookEvidence key={review.id} review={review} />
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Preserved source P&L · cached values</h3>
                <p>
                  Original workbook observations. No correction or recalculation has been applied.
                </p>
              </div>
              <button
                className="outline"
                onClick={() =>
                  s.act(
                    () =>
                      download(
                        `/workbooks/${review.id}/baseline`,
                        'Swizton-preserved-baseline.xlsx',
                      ),
                    'Baseline downloaded',
                  )
                }
              >
                Download source layout
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Revenue AED</th>
                    <th>Swizton AED</th>
                    <th>Expense AED</th>
                    <th>Profit / loss AED</th>
                  </tr>
                </thead>
                <tbody>
                  {review.baseline.map((b) => (
                    <tr key={b.month}>
                      <th>{b.month}</th>
                      <td>{fmt(b.revenue)}</td>
                      <td>{fmt(b.swizton)}</td>
                      <td>{fmt(b.expense)}</td>
                      <td>{fmt(b.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h3>Formula & reconciliation exceptions</h3>
              <select
                aria-label="Finding category"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {['All', ...new Set(review.issues.map((i) => i.code))].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Source cells</th>
                    <th>Finding</th>
                    <th>Cached</th>
                    <th>Arithmetic expectation</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {review.issues
                    .filter((i) => filter === 'All' || i.code === filter)
                    .map((i, n) => (
                      <tr key={n}>
                        <td>{i.code}</td>
                        <td>{i.cells.join(', ')}</td>
                        <td className="wrap-cell">{i.detail}</td>
                        <td>{i.actual ? fmt(i.actual) : '—'}</td>
                        <td>{i.expected ? fmt(i.expected) : '—'}</td>
                        <td>{i.delta ? fmt(i.delta) : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
export function UserAccess({ revision, user, refresh }: Props) {
  const s = useAction(refresh),
    [accounts, setAccounts] = useState<any[]>([]),
    [form, setForm] = useState({ id: '', email: '', role: 'Finance', active: true, password: '' }),
    [reason, setReason] = useState('');
  useEffect(() => {
    api('/accounts')
      .then(setAccounts)
      .catch(() => {});
  }, [revision]);
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Named users & permissions</h2>
          <p>Accounts are checked on every API call. Deactivation takes effect immediately.</p>
        </div>
      </div>
      <Alerts s={s} />
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Access</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.email}</td>
                  <td>{a.role}</td>
                  <td>{a.active ? 'Active' : 'Disabled'}</td>
                  <td>
                    <button
                      className="text-button"
                      disabled={a.id === user.id}
                      onClick={() => setForm({ ...a, password: '' })}
                    >
                      Edit / reset access
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h3>{form.id ? 'Update user' : 'Create user'}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            s.act(
              () =>
                api('/accounts', {
                  ...form,
                  id: form.id || undefined,
                  password: form.password || undefined,
                  reason,
                  revision,
                }),
              'Account access saved',
            );
          }}
        >
          <div className="form-grid">
            <label>
              Email
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              Role
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {['Admin', 'Finance', 'Management'].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              {form.id ? 'New password (leave blank to retain)' : 'Initial password'}
              <input
                autoComplete="new-password"
                type="password"
                required={!form.id}
                minLength={12}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label>
              Account state
              <select
                value={String(form.active)}
                onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}
              >
                <option value="true">Active</option>
                <option value="false">Disabled</option>
              </select>
            </label>
          </div>
          <Reason value={reason} onChange={setReason} />
          <div className="button-row">
            <button className="primary" disabled={s.busy}>
              Save user access
            </button>
            <button
              type="button"
              className="outline"
              onClick={() =>
                setForm({ id: '', email: '', role: 'Finance', active: true, password: '' })
              }
            >
              New user
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
export function CloseChecklist({ month, revision }: { month: string; revision: number }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api(`/months/${month}/readiness`)
      .then(setData)
      .catch((e) => setData({ blockers: [e.message], warnings: [] }));
  }, [month, revision]);
  return data ? (
    <div className="close-checklist">
      <h3>Close readiness</h3>
      {data.blockers.map((b: string) => (
        <p key={b} className="red">
          ✕ {b}
        </p>
      ))}
      {data.warnings.map((w: string) => (
        <p key={w}>△ {w}</p>
      ))}
      {!data.blockers.length && <p>✓ Required validations complete</p>}
    </div>
  ) : (
    <p>Checking period readiness…</p>
  );
}
export function ContributionDetails({
  context,
}: {
  context: {
    line: string;
    ids: string[];
    sourceLine?: string;
    year?: number;
    period?: string;
    view?: 'actual' | 'approx' | 'outlook';
  };
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    setError('');
    if (!context.ids.length) return;
    const query = new URLSearchParams({
      year: String(context.year ?? 2026),
      line: context.sourceLine ?? context.line,
      view: context.view ?? 'actual',
      ...(context.period ? { period: context.period } : {}),
    });
    api(`/reports/drilldown?${query}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [context]);
  if (!context.ids.length)
    return (
      <p className="info-note">
        No transactional sources are loaded for this figure. Historical comparatives may have been
        entered as aggregate balances.
      </p>
    );
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Calculating source contributions…</p>;
  return (
    <section className="panel">
      <h3>Allocated contribution to this figure · {data.period}</h3>
      <p>
        These values include share allocation, monthly FX and prepaid recognition for the selected
        row. The source amounts below can differ from these recognised contributions.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Original date</th>
              <th>Recognition</th>
              <th>Contribution AED</th>
              <th>INR lakh</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.id}>
                <td>{r.reference}</td>
                <td>{r.date}</td>
                <td>{r.recognitionMonth}</td>
                <td>{fmt(r.aed)}</td>
                <td>{fmt(r.inrLakh, 4)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3}>Reported total</th>
              <th>{fmt(data.total.aed)}</th>
              <th>{fmt(data.total.inr, 4)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      {Number(data.roundingResidual) !== 0 && (
        <p className="info-note">Representation rounding residual: AED {data.roundingResidual}</p>
      )}
    </section>
  );
}
export function DoctorPayables({ ds, revision, user, month, refresh }: Props) {
  const s = useAction(refresh),
    [rows, setRows] = useState<any[]>([]),
    [loadError, setLoadError] = useState(''),
    [doctor, setDoctor] = useState('Tahsin'),
    [amount, setAmount] = useState(''),
    [date, setDate] = useState(`${month}-28`),
    [reference, setReference] = useState(''),
    [reason, setReason] = useState('');
  useEffect(() => {
    let active = true;
    setLoadError('');
    setRows([]);
    api(`/doctor-payables/${month}`)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setLoadError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [month, ds]);
  return (
    <section className="panel">
      <h3>Professional fee payables · {month}</h3>
      <p>
        These amounts are allocated before Swizton revenue. Paying an accrued doctor fee does not
        add an expense to the P&L again. Due amounts reflect the configured share rules, not the
        unresolved legacy workbook baseline.
      </p>
      <Alerts s={s} />
      {loadError && (
        <div className="error" role="alert">
          Fee balances unavailable: {loadError}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Doctor</th>
              <th>Accrued fee AED</th>
              <th>Paid AED</th>
              <th>Outstanding AED</th>
              <th>Payment history</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.doctor}>
                <th>Dr. {r.doctor}</th>
                <td>{fmt(r.accrued)}</td>
                <td>{fmt(r.paid)}</td>
                <td>{fmt(r.outstanding)}</td>
                <td>
                  <details>
                    <summary>{r.payments.length} payments</summary>
                    {r.payments.map((p: any) => (
                      <p key={p.id}>
                        {p.date} · {p.reference} · AED {fmt(p.amount)}
                      </p>
                    ))}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {user.role !== 'Management' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            s.act(
              () =>
                api('/doctor-payments', {
                  doctor,
                  period: month,
                  date,
                  amount,
                  reference,
                  reason,
                  revision,
                }),
              'Professional fee payment recorded without duplicating P&L cost',
            );
          }}
        >
          <div className="form-grid">
            <label>
              Doctor
              <select value={doctor} onChange={(e) => setDoctor(e.target.value)}>
                <option>Tahsin</option>
                <option>Chinmay</option>
              </select>
            </label>
            <label>
              Payment date
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Payment · AED
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Bank / payout reference
              <input required value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          </div>
          <Reason value={reason} onChange={setReason} />
          <button className="primary" disabled={s.busy}>
            Record fee payment
          </button>
        </form>
      )}
    </section>
  );
}

function WorkbookEvidence({ review }: { review: WorkbookReview }) {
  const [status, setStatus] = useState('Unresolved');
  const rows = (review.sourceChecks ?? []).filter(
    (r) =>
      status === 'All' || (status === 'Unresolved' ? r.status !== 'matched' : r.status === status),
  );
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Feeder calculation evidence</h3>
            <p>Observed source arithmetic; these findings are not approved balancing entries.</p>
          </div>
          <select
            aria-label="Source check status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {['Unresolved', 'All', 'matched', 'mismatch', 'blocked'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source cell</th>
                <th>Check type</th>
                <th>Status</th>
                <th>Cached AED</th>
                <th>Computed AED</th>
                <th>Difference</th>
                <th>Evidence gap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th>{r.source}</th>
                  <td>{r.kind}</td>
                  <td>{r.status}</td>
                  <td>{r.expected === undefined ? '—' : fmt(r.expected)}</td>
                  <td>{r.computed === undefined ? '—' : fmt(r.computed)}</td>
                  <td>{r.delta === undefined ? '—' : fmt(r.delta)}</td>
                  <td className="wrap-cell">{r.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="empty">No source checks in this filter.</p>}
      </section>
      <details className="panel">
        <summary>Workbook inventory and cached error counts</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Rows</th>
                <th>Columns</th>
                <th>Formulas</th>
                <th>Missing caches</th>
                <th>Cached errors</th>
              </tr>
            </thead>
            <tbody>
              {(review.inventory as any[]).map((s) => (
                <tr key={s.name}>
                  <th>{s.name}</th>
                  <td>{s.rows}</td>
                  <td>{s.columns}</td>
                  <td>{s.formulas}</td>
                  <td>{s.missingCaches}</td>
                  <td>{s.errors?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
