import React, { useEffect, useState } from 'react';
import type { Dataset } from '../../server/model';
import type { FxProposal, FxInput } from '../../server/finance-model';
import type { financeReadiness } from '../../server/finance';
import { api, download } from './api';
import { useAction, Alerts, Reason } from './Operations';
type Props = {
  ds: Dataset;
  revision: number;
  year: number;
  user: { id: string; role: string };
  refresh: () => Promise<void>;
};
type Readiness = ReturnType<typeof financeReadiness>;
const fmt = (v: string | null | undefined) =>
  v == null
    ? 'Unavailable'
    : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const lineLabels: Record<string, string> = {
  revenue: 'Total revenue',
  swizton: 'Swizton revenue',
  expense: 'Total expense',
  profit: 'Net profit / loss',
};
export function FinanceValidation({ ds, revision, year, user, refresh }: Props) {
  const [tab, setTab] = useState('Monthly FX'),
    [selected, setSelected] = useState(''),
    [readiness, setReadiness] = useState<Readiness | null>(null),
    [error, setError] = useState('');
  const action = useAction(refresh),
    reviews = (ds.operations ?? []).filter((o) => o.kind === 'workbook_review'),
    workbook = reviews.find((w) => w.id === selected) ?? reviews.at(-1);
  useEffect(() => {
    let active = true;
    setReadiness(null);
    setError('');
    if (workbook)
      api(`/finance/workbooks/${workbook.id}/${year}/readiness`)
        .then((v) => {
          if (active) setReadiness(v);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [workbook?.id, year, revision]);
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Finance validation & approval</h2>
          <p>
            Approve monthly average rates, review source evidence and sign off a traceable
            reconciliation.
          </p>
        </div>
        <span className="badge">Independent review</span>
      </div>
      <Alerts s={action} />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="master-tabs">
        {['Monthly FX', 'Exception register', 'Reconciliation & sign-off'].map((t) => (
          <button key={t} className={tab === t ? 'primary' : 'outline'} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Monthly FX' && (
        <FxWorkspace ds={ds} revision={revision} year={year} user={user} refresh={refresh} />
      )}
      {tab !== 'Monthly FX' && (
        <>
          <section className="panel">
            <label>
              Financial source workbook
              <select value={workbook?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
                {!reviews.length && <option value="">No workbook inspected yet</option>}
                {reviews.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="info-note">
              Original figures are preserved. Inspect your private workbook in Workbook review
              first. An acknowledged exception is not a corrected or reconciled figure.
            </p>
          </section>
          {readiness && tab === 'Exception register' && (
            <Exceptions
              data={readiness}
              ds={ds}
              revision={revision}
              user={user}
              refresh={refresh}
            />
          )}
          {readiness && tab === 'Reconciliation & sign-off' && (
            <>
              <div className="metrics">
                {[
                  ['MONTHS COMPARED', `${readiness.summary.monthsCompared} / 12`],
                  ['AED LINE DIFFERENCES', readiness.summary.differences],
                  ['RETAINED EXCEPTIONS', readiness.summary.retainedExceptions],
                  [
                    'APPROVED FX MONTHS',
                    `${readiness.rates.filter((r) => r.approved).length} / 12`,
                  ],
                ].map(([label, v]) => (
                  <div className="metric" key={label}>
                    <span className="metric-label">{label}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>Original baseline vs application Actual</h3>
                    <p>
                      Monthly AED control totals · application minus baseline · half-fils tolerance
                    </p>
                  </div>
                  <button
                    className="outline"
                    disabled={action.busy}
                    onClick={() =>
                      action.act(
                        () =>
                          download(
                            `/finance/workbooks/${workbook!.id}/${year}/export`,
                            `Swizton-finance-validation-${year}.xlsx`,
                          ),
                        'Review pack downloaded',
                      )
                    }
                  >
                    Export finance review pack
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Control line</th>
                        <th>Original AED</th>
                        <th>Application AED</th>
                        <th>Delta AED</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readiness.comparisons.flatMap((m) =>
                        m.lines.map((l) => (
                          <tr key={m.month + l.line}>
                            <th>{m.month}</th>
                            <td>{lineLabels[l.line] ?? l.line}</td>
                            <td>{fmt(l.baseline)}</td>
                            <td>{fmt(l.actual)}</td>
                            <td className={l.matched ? '' : 'red'}>{fmt(l.delta)}</td>
                            <td title={m.error ?? ''}>
                              <span
                                className={`badge ${l.matched ? '' : l.delta === null ? 'neutral' : 'warning'}`}
                              >
                                {l.matched
                                  ? 'Matched'
                                  : l.delta === null
                                    ? 'Unavailable'
                                    : 'Difference'}
                              </span>
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="info-note">
                  This checks revenue, Swizton revenue, expenses and profit in AED. It does not
                  certify every workbook cell, historical comparatives, tax treatment or original
                  INR formulas.
                </p>
              </section>
              <Signoff data={readiness} revision={revision} user={user} refresh={refresh} />
            </>
          )}
        </>
      )}
    </>
  );
}
function FxWorkspace({ ds, revision, year, user, refresh }: Props) {
  const action = useAction(refresh),
    [draft, setDraft] = useState({
      month: `${year}-01`,
      method: 'Provided monthly average' as FxInput['method'],
      inrPerAed: '',
      aedPerUsd: '',
      source: '',
      reason: '',
      csv: '',
    }),
    [preview, setPreview] = useState<{ key: string; value: FxProposal['calculated'] } | null>(null),
    [note, setNote] = useState('');
  const proposals = (ds.operations ?? []).filter(
    (o): o is FxProposal => o.kind === 'fx_proposal' && o.input.month.startsWith(`${year}-`),
  );
  const payload = () => ({
    ...draft,
    inrPerAed: draft.method === 'Provided monthly average' ? draft.inrPerAed : undefined,
    csv: draft.method === 'Provided monthly average' ? undefined : draft.csv,
  });
  const key = JSON.stringify(payload()),
    set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <>
      <Alerts s={action} />
      <section className="panel">
        <h3>Monthly reporting rates · FY {year}</h3>
        <p>
          One INR/AED average per month. Legacy and sample rates remain unapproved until
          independently reviewed.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>INR / AED</th>
                <th>AED / USD</th>
                <th>Source</th>
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(
                { length: 12 },
                (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`,
              ).map((month) => {
                const f = ds.masters.fx.find((r) => r.month === month),
                  p = proposals.find(
                    (p) =>
                      p.id === f?.approvalId &&
                      p.status === 'Approved' &&
                      p.calculated.inrPerAed === f?.inrPerAed &&
                      p.input.aedPerUsd === f?.aedPerUsd &&
                      p.input.source === f?.source,
                  );
                return (
                  <tr key={month}>
                    <th>{month}</th>
                    <td>{fmt(f?.inrPerAed)}</td>
                    <td>{fmt(f?.aedPerUsd)}</td>
                    <td className="wrap-cell">{f?.source ?? 'Not supplied'}</td>
                    <td>
                      <span className={`badge ${p ? '' : 'warning'}`}>
                        {p ? 'Independently approved' : f ? 'Unapproved existing rate' : 'Missing'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {user.role !== 'Management' && (
        <section className="panel">
          <h3>Prepare a monthly average</h3>
          <p>
            Enter a source-provided monthly average, or calculate the equal-weight mean of dated
            observations. Missing dates are never filled automatically.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.act(async () => {
                const r = await api('/finance/fx', { input: payload(), revision });
                setPreview(null);
                return r;
              }, 'Monthly FX submitted for independent review');
            }}
          >
            <div className="form-grid">
              <label>
                FX month
                <input
                  type="month"
                  required
                  value={draft.month}
                  onChange={(e) => set('month', e.target.value)}
                />
              </label>
              <label>
                Averaging method
                <select value={draft.method} onChange={(e) => set('method', e.target.value)}>
                  {['Provided monthly average', 'Daily average', 'Cross-rate average'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                AED per USD
                <input
                  required
                  type="number"
                  min="0.00000001"
                  step="0.00000001"
                  value={draft.aedPerUsd}
                  onChange={(e) => set('aedPerUsd', e.target.value)}
                />
              </label>
              {draft.method === 'Provided monthly average' && (
                <label>
                  Monthly average INR per AED
                  <input
                    required
                    type="number"
                    min="0.00000001"
                    step="0.00000001"
                    value={draft.inrPerAed}
                    onChange={(e) => set('inrPerAed', e.target.value)}
                  />
                </label>
              )}
              <label>
                Rate source / publication reference
                <input
                  required
                  minLength={8}
                  maxLength={500}
                  value={draft.source}
                  onChange={(e) => set('source', e.target.value)}
                  placeholder="RBI publication or approved Finance reference"
                />
              </label>
              <Reason value={draft.reason} onChange={(v) => set('reason', v)} />
            </div>
            {draft.method !== 'Provided monthly average' && (
              <>
                <label>
                  Daily observations CSV ·{' '}
                  {draft.method === 'Cross-rate average' ? 'INR per USD' : 'INR per AED'}
                  <textarea
                    required
                    rows={7}
                    maxLength={64000}
                    value={draft.csv}
                    onChange={(e) => set('csv', e.target.value)}
                    placeholder={'date,rate\n2026-01-02,25.40\n2026-01-05,25.60'}
                  />
                </label>
                <label>
                  Load daily rates CSV (optional)
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        action.act(async () => {
                          if (file.size > 64000) throw Error('Maximum CSV size is 64 KB');
                          set('csv', await file.text());
                        }, 'CSV loaded; preview and verify the source');
                    }}
                  />
                </label>
              </>
            )}
            <div className="button-row">
              <button
                type="button"
                className="outline"
                disabled={action.busy}
                onClick={() =>
                  action.act(async () => {
                    const v = await api('/finance/fx/preview', payload());
                    setPreview({ key, value: v });
                  }, 'FX average calculated')
                }
              >
                Preview monthly average
              </button>
              <button className="primary" disabled={action.busy}>
                Submit rate for review
              </button>
            </div>
            {preview?.key === key && (
              <p role="status" className="info-note">
                Calculated INR/AED: <b>{preview.value.inrPerAed}</b> · {preview.value.count} daily
                observations · {preview.value.firstDate ?? 'Externally supplied average'}
                {preview.value.lastDate ? ` to ${preview.value.lastDate}` : ''}
                <br />
                {preview.value.basis}
              </p>
            )}
            <p className="info-note">
              Cross-rate averaging divides supplied INR/USD observations by the single AED/USD rate
              entered above. Check units and date coverage against the original publication.
              Submission does not change financial results; an independent Admin must approve.
              Locked months must be reopened before replacement.
            </p>
          </form>
        </section>
      )}
      <section className="panel">
        <h3>Rate approval register</h3>
        {user.role === 'Admin' && <Reason value={note} onChange={setNote} />}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month / method</th>
                <th>Proposed INR / AED</th>
                <th>Coverage</th>
                <th>Source & preparation</th>
                <th>Status / decision</th>
              </tr>
            </thead>
            <tbody>
              {proposals
                .slice()
                .reverse()
                .map((p) => (
                  <tr key={p.id}>
                    <th>
                      {p.input.month}
                      <small className="block">{p.input.method}</small>
                    </th>
                    <td>{p.calculated.inrPerAed}</td>
                    <td>
                      {p.calculated.count} observations
                      <small className="block">
                        {p.calculated.firstDate ?? 'Supplied average'}
                        {p.calculated.lastDate ? ` to ${p.calculated.lastDate}` : ''}
                      </small>
                    </td>
                    <td className="wrap-cell">
                      {p.input.source}
                      <small className="block">{p.input.reason}</small>
                      <details>
                        <summary>Source observations & prior rate</summary>
                        <p>{p.calculated.basis}</p>
                        <p>Prior INR/AED: {p.previous?.inrPerAed ?? 'Missing'}</p>
                        {p.input.observations.map((o) => (
                          <p key={o.date}>
                            {o.date}: {o.rate}
                          </p>
                        ))}
                      </details>
                    </td>
                    <td>
                      <span
                        className={`badge ${p.status === 'Pending' ? 'warning' : p.status === 'Rejected' ? 'rejected' : ''}`}
                      >
                        {p.status}
                      </span>
                      <small className="block">{p.reviewNote}</small>
                      {p.status === 'Pending' &&
                        user.role === 'Admin' &&
                        (p.createdBy === user.id ? (
                          <p>Another Admin must review your proposal.</p>
                        ) : (
                          <div className="button-row">
                            {[true, false].map((approve) => (
                              <button
                                key={String(approve)}
                                className={approve ? 'primary' : 'outline'}
                                disabled={note.trim().length < 8 || action.busy}
                                onClick={() =>
                                  action.act(
                                    () =>
                                      api(`/finance/fx/${p.id}/review`, {
                                        approve,
                                        reason: note,
                                        revision,
                                      }),
                                    approve
                                      ? 'Monthly FX approved and applied'
                                      : 'Monthly FX rejected',
                                  )
                                }
                              >
                                {approve ? 'Approve rate' : 'Reject rate'}
                              </button>
                            ))}
                          </div>
                        ))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!proposals.length && <p className="empty">No FX proposals for this financial year.</p>}
      </section>
    </>
  );
}
function Exceptions({
  data,
  ds,
  revision,
  user,
  refresh,
}: {
  data: Readiness;
  ds: Dataset;
  revision: number;
  user: Props['user'];
  refresh: Props['refresh'];
}) {
  const action = useAction(refresh),
    [key, setKey] = useState(''),
    [disposition, setDisposition] = useState('Retain original'),
    [evidence, setEvidence] = useState(''),
    [reason, setReason] = useState(''),
    [adjustmentId, setAdjustmentId] = useState(''),
    [note, setNote] = useState(''),
    [filter, setFilter] = useState('All');
  const current = data.exceptions.find((i) => i.key === key),
    adjustments = (ds.operations ?? []).filter(
      (o) => o.kind === 'adjustment_request' && o.status === 'Approved',
    );
  return (
    <>
      <Alerts s={action} />
      <section className="panel">
        <h3>Workbook exception register</h3>
        <p>
          Review the source findings individually. Retaining a baseline exception does not correct
          its formulas or post an adjustment.
        </p>
        <label>
          Exception status filter
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {['All', 'Open', 'Pending', 'Approved'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {user.role === 'Admin' && <Reason value={note} onChange={setNote} />}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Finding / source</th>
                <th>Detail</th>
                <th>Disposition & evidence</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {data.exceptions
                .filter((i) => filter === 'All' || (i.review?.status ?? 'Open') === filter)
                .map((i) => (
                  <tr key={i.key}>
                    <th>
                      {i.key}
                      <small className="block">
                        {i.type} · {i.status}
                      </small>
                      <small className="block">{i.source}</small>
                    </th>
                    <td className="wrap-cell">{i.detail}</td>
                    <td className="wrap-cell">
                      {i.review?.disposition ?? 'Awaiting Finance proposal'}
                      <small className="block">{i.review?.evidence}</small>
                    </td>
                    <td>
                      <span
                        className={`badge ${i.review?.status === 'Approved' ? '' : i.review?.status === 'Pending' ? 'warning' : 'neutral'}`}
                      >
                        {i.review?.status ?? 'Open'}
                      </span>
                      {!i.review && user.role !== 'Management' && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setKey(i.key);
                            setEvidence('');
                            setReason('');
                          }}
                        >
                          Prepare disposition
                        </button>
                      )}
                      {i.review?.status === 'Pending' &&
                        user.role === 'Admin' &&
                        (i.review.createdBy === user.id ? (
                          <p>Independent Admin required.</p>
                        ) : (
                          <div className="button-row">
                            {[true, false].map((approve) => (
                              <button
                                key={String(approve)}
                                className={approve ? 'primary' : 'outline'}
                                disabled={action.busy || note.trim().length < 8}
                                onClick={() =>
                                  action.act(
                                    () =>
                                      api(`/finance/exceptions/${i.review!.id}/review`, {
                                        approve,
                                        reason: note,
                                        revision,
                                      }),
                                    approve
                                      ? 'Exception disposition approved'
                                      : 'Exception disposition rejected',
                                  )
                                }
                              >
                                {approve ? 'Accept disposition' : 'Reject disposition'}
                              </button>
                            ))}
                          </div>
                        ))}
                      {i.review?.reviewNote && (
                        <small className="block">{i.review.reviewNote}</small>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!data.exceptions.length && (
          <p className="empty">
            No findings were returned by this workbook inspection. Check source coverage before
            sign-off.
          </p>
        )}
      </section>
      {current && !current.review && user.role !== 'Management' && (
        <section className="panel">
          <h3>Prepare disposition · {key}</h3>
          <p>{current.detail}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.act(async () => {
                const r = await api('/finance/exceptions', {
                  workbookId: data.workbookId,
                  itemKey: key,
                  disposition,
                  evidence,
                  reason,
                  adjustmentId:
                    disposition === 'Linked approved adjustment' ? adjustmentId : undefined,
                  revision,
                });
                setKey('');
                return r;
              }, 'Exception submitted for independent review');
            }}
          >
            <div className="form-grid">
              <label>
                Proposed disposition
                <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
                  {['Retain original', 'Evidence verified', 'Linked approved adjustment'].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </label>
              {disposition === 'Linked approved adjustment' && (
                <label>
                  Posted approved adjustment
                  <select
                    required
                    value={adjustmentId}
                    onChange={(e) => setAdjustmentId(e.target.value)}
                  >
                    <option value="">Select an approved adjustment</option>
                    {adjustments.map((a) => (
                      <option key={a.id} value={a.kind === 'adjustment_request' ? a.entry.id : ''}>
                        {a.kind === 'adjustment_request' ? `${a.entry.date} · ${a.reason}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Reason value={reason} onChange={setReason} />
            </div>
            <label>
              Evidence / Finance reference
              <textarea
                rows={4}
                required
                minLength={12}
                maxLength={3000}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="Record source documents, reconciliation workings and the reason this disposition is appropriate."
              />
            </label>
            <button className="primary" disabled={action.busy}>
              Submit exception disposition
            </button>
          </form>
        </section>
      )}
    </>
  );
}
function Signoff({
  data,
  revision,
  user,
  refresh,
}: {
  data: Readiness;
  revision: number;
  user: Props['user'];
  refresh: Props['refresh'];
}) {
  const action = useAction(refresh),
    [mode, setMode] = useState('Reviewed with exceptions'),
    [reason, setReason] = useState('');
  const blockers = mode === 'Reconciled' ? data.reconcileBlockers : data.reviewBlockers;
  return (
    <section className="panel">
      <h3>Financial review sign-off</h3>
      <Alerts s={action} />
      <p>
        “Reviewed with exceptions” acknowledges reviewed evidence and still discloses remaining
        differences. “Reconciled” requires all 12 AED monthly control totals to match, approved FX
        and no retained original exceptions. Neither mode certifies every Excel cell or statutory
        accounts.
      </p>
      <label>
        Sign-off scope
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option>Reviewed with exceptions</option>
          <option>Reconciled</option>
        </select>
      </label>
      {blockers.length > 0 ? (
        <div className="info-note">
          <b>Sign-off blockers</b>
          <ul>
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="info-note">
          Automated prerequisites passed. An independent Admin must verify the evidence before
          signing.
        </p>
      )}
      {user.role === 'Admin' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action.act(
              () =>
                api('/finance/signoffs', {
                  workbookId: data.workbookId,
                  year: data.year,
                  mode,
                  reason,
                  revision,
                }),
              'Financial review sign-off recorded',
            );
          }}
        >
          <Reason value={reason} onChange={setReason} />
          <button className="primary" disabled={!!blockers.length || action.busy}>
            Record Finance sign-off
          </button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Scope</th>
              <th>Signed at</th>
              <th>Financial state</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.signoffs.map((s) => (
              <tr key={s.id}>
                <th>{s.mode}</th>
                <td>{new Date(s.createdAt).toLocaleString()}</td>
                <td>
                  <span className={`badge ${s.current ? '' : 'warning'}`}>
                    {s.current ? 'Current' : 'Stale — financial data changed'}
                  </span>
                </td>
                <td className="wrap-cell">{s.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
