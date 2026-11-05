import React, { useEffect, useState } from 'react';
import type { Dataset } from '../../server/model';
import type {
  Lead,
  ForecastParams,
  ForecastResult,
  ForecastSnapshot,
  CashPlan,
} from '../../server/planning-model';
import { businessDate, monthRange, addDays } from '../../server/planning-calendar';
import { api, download } from './api';
import { useAction, Alerts, Reason } from './Operations';
type Props = {
  ds: Dataset;
  revision: number;
  user: { id: string; role: string };
  refresh: () => Promise<void>;
};
const stages: Lead['stage'][] = ['New', 'Qualified', 'Approved', 'Scheduled', 'Won', 'Lost'];
const fmt = (v: string | number | null | undefined, n = 2) =>
  v == null
    ? '—'
    : Number(v).toLocaleString('en-IN', { minimumFractionDigits: n, maximumFractionDigits: n });
export function Planning({ ds, revision, user, refresh }: Props) {
  const [tab, setTab] = useState('Procedure pipeline');
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Forecasting & cash planning</h2>
          <p>
            Explicit assumptions, immutable forecast versions and traceable cash timing. No forecast
            posts to the P&L.
          </p>
        </div>
        <span className="badge">Planning workspace</span>
      </div>
      <div className="master-tabs">
        {['Procedure pipeline', 'Rolling forecast', 'Forecast accuracy', 'Cash outlook'].map(
          (t) => (
            <button key={t} className={tab === t ? 'primary' : 'outline'} onClick={() => setTab(t)}>
              {t}
            </button>
          ),
        )}
      </div>
      {tab === 'Procedure pipeline' && (
        <Pipeline ds={ds} revision={revision} user={user} refresh={refresh} />
      )}
      {tab === 'Rolling forecast' && (
        <ForecastPlanner ds={ds} revision={revision} user={user} refresh={refresh} />
      )}
      {tab === 'Forecast accuracy' && <Accuracy ds={ds} />}
      {tab === 'Cash outlook' && (
        <CashWorkspace ds={ds} revision={revision} user={user} refresh={refresh} />
      )}
    </>
  );
}
function Pipeline({ ds, revision, user, refresh }: Props) {
  const action = useAction(refresh),
    leads = (ds.operations ?? []).filter((o): o is Lead => o.kind === 'lead'),
    [search, setSearch] = useState(''),
    [view, setView] = useState('All'),
    [editing, setEditing] = useState(false);
  const blank = () => ({
    id: '',
    updatedAt: '',
    patientReference: '',
    contact: '',
    hospital: ds.masters.hospitals[0]?.id ?? '',
    procedure: ds.masters.procedures[0] ?? '',
    expectedDate: addDays(businessDate(), 7),
    recognitionMonth: '',
    stage: 'New' as Lead['stage'],
    probability: '0.5',
    approvalAmount: '',
    consumablesRate: '0',
    collectionLagDays: 15,
    owner: '',
    source: '',
    linkedBillId: '',
    reason: '',
  });
  const [form, setForm] = useState(blank);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const active = leads.filter((l) => !['Won', 'Lost'].includes(l.stage)),
    closed = leads.filter((l) => ['Won', 'Lost'].includes(l.stage));
  const filtered = leads.filter(
    (l) =>
      (view === 'All' || l.stage === view) &&
      `${l.patientReference} ${l.hospital} ${l.procedure} ${l.owner}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const field = (key: string, label: string, type = 'text', required = true) => (
    <label key={key}>
      {label}
      <input
        type={type}
        required={required}
        step={type === 'number' ? 'any' : undefined}
        value={String(form[key as keyof typeof form] ?? '')}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  return (
    <>
      <Alerts s={action} />
      <div className="metrics">
        <div className="metric">
          <span className="metric-label">ACTIVE PROCEDURE LEADS</span>
          <strong>{active.length}</strong>
          <small>Lost and Won are excluded from forward pipeline</small>
        </div>
        <div className="metric">
          <span className="metric-label">WEIGHTED CASE DEMAND</span>
          <strong>{fmt(active.reduce((s, l) => s + Number(l.probability), 0))}</strong>
          <small>Sum of explicit probabilities; not booked cases</small>
        </div>
        <div className="metric">
          <span className="metric-label">CLOSED-LEAD CONVERSION</span>
          <strong>
            {closed.length
              ? fmt((closed.filter((l) => l.stage === 'Won').length / closed.length) * 100, 1) + '%'
              : '—'}
          </strong>
          <small>Won ÷ (Won + Lost)</small>
        </div>
        <div className="metric">
          <span className="metric-label">OVERDUE OPEN LEADS</span>
          <strong>{active.filter((l) => l.expectedDate < businessDate()).length}</strong>
          <small>Reschedule before inclusion in forecasts</small>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h3>Procedure lead pipeline</h3>
          {user.role !== 'Management' && (
            <button
              className="primary"
              onClick={() => {
                setForm(blank());
                setEditing(true);
              }}
            >
              + New procedure lead
            </button>
          )}
        </div>
        <div className="form-grid">
          <label>
            Search pipeline
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Patient reference, procedure, hospital or owner"
            />
          </label>
          <label>
            Stage
            <select value={view} onChange={(e) => setView(e.target.value)}>
              {['All', ...stages].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="pipeline-board">
          {stages
            .filter((stage) => view === 'All' || stage === view)
            .map((stage) => (
              <section className="pipeline-column" key={stage}>
                <h4>
                  {stage}
                  <span>{filtered.filter((l) => l.stage === stage).length}</span>
                </h4>
                {filtered
                  .filter((l) => l.stage === stage)
                  .map((l) => (
                    <article className="lead-card" key={l.id}>
                      <b>{l.patientReference}</b>
                      <p>
                        {l.procedure} · {l.hospital}
                      </p>
                      <small>
                        {l.expectedDate} · {fmt(Number(l.probability) * 100, 0)}% probability
                      </small>
                      <p>AED {fmt(l.approvalAmount)} gross approval</p>
                      <small>
                        {l.owner || 'Unassigned'} · {l.source}
                      </small>
                      <details>
                        <summary>Lead detail</summary>
                        <p>
                          Contact: {l.contact || 'Not entered'}
                          <br />
                          Recognition: {l.recognitionMonth || l.expectedDate.slice(0, 7)}
                          <br />
                          Collection lag: {l.collectionLagDays} days
                        </p>
                      </details>
                      {user.role !== 'Management' && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setForm({
                              ...l,
                              recognitionMonth: l.recognitionMonth ?? '',
                              linkedBillId: l.linkedBillId ?? '',
                            });
                            setEditing(true);
                          }}
                        >
                          Edit / update stage
                        </button>
                      )}
                    </article>
                  ))}
              </section>
            ))}
        </div>
      </section>
      {editing && (
        <section className="panel">
          <h3>{form.id ? 'Update procedure lead' : 'New procedure lead'}</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.act(async () => {
                const lead = {
                    ...form,
                    recognitionMonth: form.recognitionMonth || undefined,
                    linkedBillId: form.linkedBillId || undefined,
                    collectionLagDays: Number(form.collectionLagDays),
                  },
                  result = await api(
                    form.id ? `/leads/${form.id}` : '/leads',
                    { lead, revision, ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}) },
                    form.id ? 'PUT' : 'POST',
                  );
                setEditing(false);
                return result;
              }, 'Procedure lead saved');
            }}
          >
            <div className="form-grid">
              {field('patientReference', 'Patient / lead reference')}
              {field('contact', 'Contact (optional)', 'text', false)}
              <label>
                Hospital
                <select value={form.hospital} onChange={(e) => set('hospital', e.target.value)}>
                  {ds.masters.hospitals.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Procedure
                <select value={form.procedure} onChange={(e) => set('procedure', e.target.value)}>
                  {ds.masters.procedures.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              {field('expectedDate', 'Expected procedure date', 'date')}
              {field(
                'recognitionMonth',
                'Expected revenue recognition month (optional)',
                'month',
                false,
              )}
              <label>
                Lead stage
                <select
                  value={form.stage}
                  onChange={(e) => {
                    set('stage', e.target.value);
                    if (e.target.value === 'Won') set('probability', '1');
                    if (e.target.value !== 'Won') set('linkedBillId', '');
                    if (e.target.value === 'Lost') set('probability', '0');
                  }}
                >
                  {stages.map((stage) => (
                    <option key={stage}>{stage}</option>
                  ))}
                </select>
              </label>
              {field('probability', 'Win probability fraction · 0 to 1', 'number')}
              {field('approvalAmount', 'Expected gross approval · AED', 'number')}
              {field('consumablesRate', 'Material/deduction fraction · 0 to 1', 'number')}
              {field('collectionLagDays', 'Expected collection lag · days', 'number')}
              {field('owner', 'Lead owner (optional)', 'text', false)}
              {field('source', 'Lead / referral source')}
              {form.stage === 'Won' && (
                <label>
                  Completed Actual IP bill
                  <select
                    required
                    value={form.linkedBillId}
                    onChange={(e) => set('linkedBillId', e.target.value)}
                  >
                    <option value="">Choose the matching bill</option>
                    {ds.entries
                      .filter(
                        (e) =>
                          e.kind === 'bill' &&
                          e.version === 'Actual' &&
                          e.billType === 'IP' &&
                          e.hospital === form.hospital &&
                          e.procedure === form.procedure,
                      )
                      .map(
                        (e) =>
                          e.kind === 'bill' && (
                            <option key={e.id} value={e.id}>
                              {e.invoice} · {e.patient} · {e.date}
                            </option>
                          ),
                      )}
                  </select>
                </label>
              )}
            </div>
            <Reason value={form.reason} onChange={(v) => set('reason', v)} />
            <div className="button-row">
              <button className="primary" disabled={action.busy}>
                Save procedure lead
              </button>
              <button type="button" className="outline" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            <p className="info-note">
              0.5 means 50%. Each lead represents one possible procedure. Won leads require a unique
              Actual bill link and are excluded from future pipeline to avoid double counting.
              Forecast prices come from effective master rules when previewed; intake does not
              approve a contract rate.
            </p>
          </form>
        </section>
      )}
    </>
  );
}
function ForecastPlanner({ ds, revision, user, refresh }: Props) {
  const action = useAction(refresh),
    [params, setParams] = useState<ForecastParams>({
      name: 'Base rolling outlook',
      asOfDate: businessDate(),
      months: 3,
      probabilityMultiplier: '1',
      revenueMultiplier: '1',
      monthly: monthRange(businessDate().slice(0, 7), 3).map((month) => ({
        month,
        fixedCost: '18000',
        variableCostPerCase: '0',
        capacity: 20,
      })),
      reason: '',
    }),
    [preview, setPreview] = useState<{ key: string; result: ForecastResult } | null>(null);
  const snapshots = (ds.operations ?? []).filter(
      (o): o is ForecastSnapshot => o.kind === 'forecast_snapshot',
    ),
    [selected, setSelected] = useState('');
  const snapshot = snapshots.find((s) => s.id === selected);
  const key = JSON.stringify({ ...params, reason: '' });
  const output = snapshot?.result ?? (preview?.key === key ? preview.result : null);
  function horizon(asOfDate: string, months: number) {
    if (!asOfDate || months < 1 || months > 12) return;
    setParams((p) => ({
      ...p,
      asOfDate,
      months,
      monthly: monthRange(asOfDate.slice(0, 7), months).map(
        (month) =>
          p.monthly.find((m) => m.month === month) ?? {
            month,
            fixedCost: '18000',
            variableCostPerCase: '0',
            capacity: 20,
          },
      ),
    }));
    setSelected('');
  }
  return (
    <>
      <Alerts s={action} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Rolling outlook assumptions</h3>
            <p>
              Probability-weighted procedure pipeline plus known Actual. This view does not replace
              the original Approx/Actual statement.
            </p>
          </div>
          <span className="badge">Assumptions only</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action.act(async () => {
              const r = await api('/forecasts', { params, revision });
              setSelected(r.id);
              return r;
            }, 'Immutable forecast snapshot saved');
          }}
        >
          <div className="form-grid">
            <label>
              Forecast name
              <input
                required
                value={params.name}
                onChange={(e) => {
                  setSelected('');
                  setParams({ ...params, name: e.target.value });
                }}
              />
            </label>
            <label>
              Forecast cutoff
              <input
                type="date"
                required
                value={params.asOfDate}
                onChange={(e) => horizon(e.target.value, params.months)}
              />
            </label>
            <label>
              Horizon · months
              <input
                type="number"
                min="1"
                max="12"
                required
                value={params.months}
                onChange={(e) => horizon(params.asOfDate, Number(e.target.value))}
              />
            </label>
            <label>
              Probability sensitivity factor
              <input
                type="number"
                min="0"
                max="3"
                step="0.01"
                value={params.probabilityMultiplier}
                onChange={(e) => {
                  setSelected('');
                  setParams({ ...params, probabilityMultiplier: e.target.value });
                }}
              />
            </label>
            <label>
              Revenue sensitivity factor
              <input
                type="number"
                min="0"
                max="3"
                step="0.01"
                value={params.revenueMultiplier}
                onChange={(e) => {
                  setSelected('');
                  setParams({ ...params, revenueMultiplier: e.target.value });
                }}
              />
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Total fixed-cost plan · AED</th>
                  <th>Variable cost / case · AED</th>
                  <th>Case capacity</th>
                </tr>
              </thead>
              <tbody>
                {params.monthly.map((m, i) => (
                  <tr key={m.month}>
                    <th>{m.month}</th>
                    {(['fixedCost', 'variableCostPerCase', 'capacity'] as const).map((field) => (
                      <td key={field}>
                        <input
                          aria-label={`${m.month} ${field}`}
                          type="number"
                          min="0"
                          step={field === 'capacity' ? '1' : '0.01'}
                          value={m[field]}
                          onChange={(e) => {
                            setSelected('');
                            setParams({
                              ...params,
                              monthly: params.monthly.map((a, j) =>
                                j === i
                                  ? {
                                      ...a,
                                      [field]:
                                        field === 'capacity'
                                          ? Number(e.target.value)
                                          : e.target.value,
                                    }
                                  : a,
                              ),
                            });
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Reason value={params.reason} onChange={(v) => setParams({ ...params, reason: v })} />
          <div className="button-row">
            <button
              className="outline"
              type="button"
              disabled={action.busy}
              onClick={() =>
                action.act(async () => {
                  const result = await api('/forecasts/preview', {
                    ...params,
                    reason:
                      params.reason.length >= 8 ? params.reason : 'Interactive forecast preview',
                  });
                  setPreview({ key, result });
                  setSelected('');
                  return result;
                }, 'Forecast preview calculated')
              }
            >
              Preview rolling forecast
            </button>
            {user.role !== 'Management' && (
              <button className="primary" disabled={action.busy}>
                Save forecast snapshot
              </button>
            )}
          </div>
          <p className="info-note">
            Factors are sensitivity assumptions, not statistical confidence intervals. Probability
            is capped at 100% per lead. Monthly cost is the higher of known Actual and fixed plan +
            expected cases × variable cost. Capacity overloads are shown rather than silently
            cancelling expected cases. Missing approved FX leaves INR unavailable; no rate is
            invented.
          </p>
        </form>
      </section>
      {snapshots.length > 0 && (
        <section className="panel">
          <label>
            Saved immutable version
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Current draft / preview</option>
              {snapshots
                .slice()
                .reverse()
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.params.name} · cutoff {s.params.asOfDate} · v{s.version}
                  </option>
                ))}
            </select>
          </label>
          {snapshot && (
            <div className="button-row">
              <button
                className="outline"
                onClick={() =>
                  action.act(
                    () => download(`/forecasts/${snapshot.id}/export`, 'Swizton-forecast.xlsx'),
                    'Forecast exported',
                  )
                }
              >
                Export frozen forecast
              </button>
              <span className="muted">
                Captured {new Date(snapshot.createdAt).toLocaleString()}
              </span>
            </div>
          )}
        </section>
      )}
      {output && (
        <ForecastView
          result={output}
          title={
            snapshot ? `${snapshot.params.name} · v${snapshot.version}` : 'Current forecast preview'
          }
        />
      )}
      {preview && !output && !snapshot && (
        <p className="info-note">
          The draft changed. Preview again to update the calculated values.
        </p>
      )}
    </>
  );
}
function ForecastView({ result, title }: { result: ForecastResult; title: string }) {
  const max = Math.max(1, ...result.rows.map((r) => Math.abs(Number(r.profit))));
  return (
    <>
      <div className="metrics">
        {[
          ['EXPECTED SWIZTON REVENUE', result.totals.swizton],
          ['FORECAST EXPENSE', result.totals.expense],
          ['FORECAST PROFIT / LOSS', result.totals.profit],
          ['EXPECTED CASES', result.totals.expectedCases],
        ].map(([label, v]) => (
          <div className="metric" key={label}>
            <span className="metric-label">{label}</span>
            <strong>
              {label === 'EXPECTED CASES' ? '' : 'AED '}
              {fmt(v)}
            </strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <h3>{title}</h3>
        <p>{result.basis}</p>
        <div className="forecast-trend">
          {result.rows.map((r) => (
            <div key={r.month}>
              <span>{r.month}</span>
              <div>
                <i
                  className={Number(r.profit) < 0 ? 'loss' : ''}
                  style={{ width: `${Math.max(2, (Math.abs(Number(r.profit)) / max) * 100)}%` }}
                />
              </div>
              <b>{fmt(r.profit)}</b>
            </div>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month / basis</th>
                <th>Known Actual AED</th>
                <th>Weighted pipeline AED</th>
                <th>Swizton AED</th>
                <th>Expense AED</th>
                <th>Profit AED</th>
                <th>Expected cases</th>
                <th>Capacity gap</th>
                <th>INR lakh</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.month}>
                  <th>
                    {r.month}
                    <small className="block">{r.basis}</small>
                  </th>
                  <td>{fmt(r.actualSwizton)}</td>
                  <td>{fmt(r.pipelineSwizton)}</td>
                  <td>{fmt(r.swizton)}</td>
                  <td>{fmt(r.expense)}</td>
                  <td>{fmt(r.profit)}</td>
                  <td>{fmt(r.expectedCases)}</td>
                  <td className={Number(r.capacityGap) > 0 ? 'red' : ''}>{fmt(r.capacityGap)}</td>
                  <td>{fmt(r.inrLakh, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {[
          ...result.warnings,
          ...result.rows.flatMap((r) => r.warnings.map((w) => `${r.month}: ${w}`)),
        ].map((w, i) => (
          <p key={i} className="info-note">
            {w}
          </p>
        ))}
        <details>
          <summary>Priced lead and master-rule evidence</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lead ID</th>
                  <th>Hospital / procedure</th>
                  <th>Case date</th>
                  <th>Recognition</th>
                  <th>Probability</th>
                  <th>Weighted Swizton AED</th>
                  <th>Rule ID</th>
                </tr>
              </thead>
              <tbody>
                {result.leads.map((l) => (
                  <tr key={l.leadId}>
                    <td>{l.leadId}</td>
                    <td>
                      {l.hospital} · {l.procedure}
                    </td>
                    <td>{l.date}</td>
                    <td>{l.recognitionMonth}</td>
                    <td>{fmt(Number(l.probabilityUsed) * 100, 1)}%</td>
                    <td>{fmt(l.weightedSwizton)}</td>
                    <td>{l.ruleId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  );
}
function Accuracy({ ds }: { ds: Dataset }) {
  const snapshots = (ds.operations ?? []).filter(
      (o): o is ForecastSnapshot => o.kind === 'forecast_snapshot',
    ),
    [selected, setSelected] = useState(''),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState('');
  const id = selected || snapshots.at(-1)?.id;
  useEffect(() => {
    let active = true;
    setResult(null);
    setError('');
    if (id)
      api(`/forecasts/${id}/accuracy`)
        .then((r) => {
          if (active) setResult(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [id, ds]);
  return (
    <section className="panel">
      <h3>Forecast accuracy against closed Actual</h3>
      <p>
        Snapshots remain unchanged after lead or master updates. Only eligible, prospective
        snapshots are scored; open-month and retrospective comparisons remain labelled.
      </p>
      <label>
        Forecast snapshot
        <select value={id ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.params.name} · {s.params.asOfDate} · v{s.version}
            </option>
          ))}
        </select>
      </label>
      {!id && <p className="empty">Save a forecast snapshot to begin measuring accuracy.</p>}
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          <div className="metrics">
            {[
              ['SCORED MONTHS', result.summary.scoredMonths],
              ['MEAN ABSOLUTE ERROR · AED', result.summary.mae],
              ['WAPE · %', result.summary.wape],
              ['AVERAGE BIAS · AED', result.summary.bias],
            ].map(([label, v]) => (
              <div className="metric" key={label}>
                <span className="metric-label">{label}</span>
                <strong>{fmt(v)}</strong>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Eligibility</th>
                  <th>Frozen forecast AED</th>
                  <th>Actual AED</th>
                  <th>Error AED</th>
                  <th>Error %</th>
                  <th>Expected cases</th>
                  <th>Actual cases</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r: any) => (
                  <tr key={r.month}>
                    <th>{r.month}</th>
                    <td>{r.status}</td>
                    <td>{fmt(r.forecast)}</td>
                    <td>{fmt(r.actual)}</td>
                    <td>{fmt(r.error)}</td>
                    <td>{fmt(r.percentageError)}</td>
                    <td>{fmt(r.forecastCases)}</td>
                    <td>{r.actualCases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="info-note">{result.basis}</p>
        </>
      )}
    </section>
  );
}
function CashWorkspace({ ds, revision, user, refresh }: Props) {
  const action = useAction(refresh),
    [settings, setSettings] = useState({
      asOfDate: businessDate(),
      months: 3,
      opening: '0',
      pipeline: false,
      doctorLagDays: 0,
    }),
    [result, setResult] = useState<any>(null),
    [balances, setBalances] = useState<any[]>([]),
    [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({
      date: addDays(businessDate(), 7),
      direction: 'In',
      amount: '',
      target: 'bill',
      linkedId: '',
      doctor: 'Tahsin',
      period: businessDate().slice(0, 7),
      description: '',
      reason: '',
    }),
    [realization, setRealization] = useState({
      id: '',
      date: businessDate(),
      amount: '',
      reference: '',
      reason: '',
    });
  const plans = (ds.operations ?? []).filter((o): o is CashPlan => o.kind === 'cash_plan');
  useEffect(() => {
    let active = true;
    api('/cash/expense-balances')
      .then((r) => {
        if (active) {
          setBalances(r);
          setLoadError('');
        }
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      });
    return () => {
      active = false;
    };
  }, [ds]);
  const draftKey = JSON.stringify(settings);
  const [calculatedKey, setCalculatedKey] = useState('');
  return (
    <>
      <Alerts s={action} />
      {loadError && <p className="error">{loadError}</p>}
      <section className="panel">
        <h3>Cash outlook assumptions</h3>
        <p>
          Cash timing is separate from recognised profit. Opening balance is the bank balance at the
          beginning of the cutoff day.
        </p>
        <div className="form-grid">
          <label>
            Cash cutoff date
            <input
              type="date"
              value={settings.asOfDate}
              onChange={(e) => setSettings({ ...settings, asOfDate: e.target.value })}
            />
          </label>
          <label>
            Cash horizon · months
            <input
              type="number"
              min="1"
              max="12"
              value={settings.months}
              onChange={(e) => setSettings({ ...settings, months: Number(e.target.value) })}
            />
          </label>
          <label>
            Opening bank cash · AED
            <input
              type="number"
              step="0.01"
              value={settings.opening}
              onChange={(e) => setSettings({ ...settings, opening: e.target.value })}
            />
          </label>
          <label>
            Include current weighted pipeline
            <select
              value={String(settings.pipeline)}
              onChange={(e) => setSettings({ ...settings, pipeline: e.target.value === 'true' })}
            >
              <option value="false">No</option>
              <option value="true">Yes — current lead probabilities</option>
            </select>
          </label>
          <label>
            Doctor-payment lag after collection · days
            <input
              type="number"
              min="0"
              max="365"
              value={settings.doctorLagDays}
              onChange={(e) => setSettings({ ...settings, doctorLagDays: Number(e.target.value) })}
            />
          </label>
        </div>
        <button
          className="primary"
          disabled={action.busy}
          onClick={() =>
            action.act(async () => {
              const r = await api('/cash/forecast', settings);
              setResult(r);
              setCalculatedKey(draftKey);
              return r;
            }, 'Cash outlook calculated')
          }
        >
          Calculate cash outlook
        </button>
        <p className="info-note">
          Weighted pipeline uses current lead probabilities, not a saved scenario's sensitivity
          factors. Existing receivables and unpaid obligations need explicit dated cash plans.
          Monthly P&L cost assumptions do not automatically become cash payments.
        </p>
      </section>
      {result && calculatedKey === draftKey && (
        <section className="panel">
          <div className="panel-heading">
            <h3>Expected cash position</h3>
            <button
              className="outline"
              onClick={() =>
                action.act(
                  () => download('/cash/export', 'Swizton-cash-outlook.xlsx', settings),
                  'Cash outlook exported',
                )
              }
            >
              Export cash outlook
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Opening AED</th>
                  <th>Inflow AED</th>
                  <th>Outflow AED</th>
                  <th>Closing AED</th>
                  <th>Shortfall AED</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r: any) => (
                  <tr key={r.month}>
                    <th>{r.month}</th>
                    <td>{fmt(r.opening)}</td>
                    <td>{fmt(r.inflow)}</td>
                    <td>{fmt(r.outflow)}</td>
                    <td>{fmt(r.closing)}</td>
                    <td className={Number(r.shortfall) > 0 ? 'red' : ''}>{fmt(r.shortfall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.warnings.map((w: string, i: number) => (
            <p key={i} className="info-note">
              {w}
            </p>
          ))}
          <details>
            <summary>Cash-event evidence</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Source</th>
                    <th>Direction</th>
                    <th>AED</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {result.events.map((e: any) => (
                    <tr key={e.id}>
                      <td>{e.date}</td>
                      <td>{e.type}</td>
                      <td>{e.origin}</td>
                      <td>{e.direction}</td>
                      <td>{fmt(e.amount)}</td>
                      <td>{e.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="info-note">{result.basis}</p>
        </section>
      )}
      {user.role !== 'Management' && (
        <section className="panel">
          <h3>Plan a dated cash movement</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.act(async () => {
                const saved = await api('/cash/plans', {
                  revision,
                  plan: {
                    ...form,
                    linkedId: ['bill', 'expense'].includes(form.target) ? form.linkedId : undefined,
                    doctor: form.target === 'doctor' ? form.doctor : undefined,
                    period: form.target === 'doctor' ? form.period : undefined,
                  },
                });
                setResult(null);
                return saved;
              }, 'Cash plan saved without posting to the ledger');
            }}
          >
            <div className="form-grid">
              <label>
                Cash-plan purpose
                <select
                  value={form.target}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      target: e.target.value,
                      linkedId: '',
                      direction: e.target.value === 'bill' ? 'In' : 'Out',
                    })
                  }
                >
                  <option value="bill">Hospital collection</option>
                  <option value="expense">Unpaid expense payment</option>
                  <option value="doctor">Accrued professional fee</option>
                  <option value="other">Capital / financing only</option>
                </select>
              </label>
              <label>
                Planned bank date
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </label>
              <label>
                Planned amount · AED
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </label>
              {form.target === 'bill' && (
                <label>
                  Linked Actual bill
                  <select
                    required
                    value={form.linkedId}
                    onChange={(e) => setForm({ ...form, linkedId: e.target.value })}
                  >
                    <option value="">Choose a bill</option>
                    {ds.entries
                      .filter((e) => e.kind === 'bill' && e.version === 'Actual')
                      .map(
                        (e) =>
                          e.kind === 'bill' && (
                            <option key={e.id} value={e.id}>
                              {e.hospital} · {e.invoice} · {e.patient}
                            </option>
                          ),
                      )}
                  </select>
                </label>
              )}
              {form.target === 'expense' && (
                <label>
                  Unpaid expense
                  <select
                    required
                    value={form.linkedId}
                    onChange={(e) => setForm({ ...form, linkedId: e.target.value })}
                  >
                    <option value="">Choose an expense</option>
                    {balances
                      .filter((b) => Number(b.outstanding) > 0 && !b.error)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.head} · {b.date} · AED {fmt(b.outstanding)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {form.target === 'doctor' && (
                <>
                  <label>
                    Doctor
                    <select
                      value={form.doctor}
                      onChange={(e) => setForm({ ...form, doctor: e.target.value })}
                    >
                      <option>Tahsin</option>
                      <option>Chinmay</option>
                    </select>
                  </label>
                  <label>
                    Accrued fee month
                    <input
                      type="month"
                      required
                      value={form.period}
                      onChange={(e) => setForm({ ...form, period: e.target.value })}
                    />
                  </label>
                </>
              )}
              {form.target === 'other' && (
                <label>
                  Direction
                  <select
                    value={form.direction}
                    onChange={(e) => setForm({ ...form, direction: e.target.value })}
                  >
                    <option value="In">Inflow</option>
                    <option value="Out">Outflow</option>
                  </select>
                </label>
              )}
              <label>
                Description
                <input
                  required
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
            </div>
            <Reason value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
            <button className="primary" disabled={action.busy}>
              Save cash plan
            </button>
          </form>
        </section>
      )}
      <section className="panel">
        <h3>Cash-plan register</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Purpose</th>
                <th>Direction</th>
                <th>Amount AED</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {plans
                .slice()
                .reverse()
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.date}</td>
                    <td>
                      {p.description}
                      <small className="block">{p.target}</small>
                    </td>
                    <td>{p.direction}</td>
                    <td>{fmt(p.amount)}</td>
                    <td>{p.status}</td>
                    <td>
                      {p.status === 'Open' && user.role !== 'Management' && (
                        <>
                          <button
                            className="text-button"
                            onClick={() =>
                              setRealization({
                                id: p.id,
                                date: businessDate(),
                                amount: p.amount,
                                reference: '',
                                reason: '',
                              })
                            }
                          >
                            Record actual bank movement
                          </button>
                          <button
                            className="text-button red"
                            disabled={action.busy || form.reason.length < 8}
                            onClick={() =>
                              action.act(async () => {
                                const cancelled = await api(`/cash/plans/${p.id}/cancel`, {
                                  revision,
                                  reason: form.reason,
                                });
                                setResult(null);
                                return cancelled;
                              }, 'Plan cancelled')
                            }
                          >
                            Cancel with reason above
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {realization.id && (
        <section className="panel">
          <h3>Record bank evidence for this plan</h3>
          <p>
            This records a confirmed collection/payment; it does not execute a bank transfer.
            Posting uses the existing bill/doctor/expense controls and prevents double realisation.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.act(async () => {
                const r = await api(`/cash/plans/${realization.id}/realize`, {
                  ...realization,
                  revision,
                });
                setRealization({ ...realization, id: '' });
                setResult(null);
                return r;
              }, 'Actual cash recorded; P&L recognition unchanged');
            }}
          >
            <div className="form-grid">
              <label>
                Actual bank date
                <input
                  type="date"
                  required
                  value={realization.date}
                  onChange={(e) => setRealization({ ...realization, date: e.target.value })}
                />
              </label>
              <label>
                Actual amount · AED
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={realization.amount}
                  onChange={(e) => setRealization({ ...realization, amount: e.target.value })}
                />
              </label>
              <label>
                Unique bank allocation reference
                <input
                  required
                  value={realization.reference}
                  onChange={(e) => setRealization({ ...realization, reference: e.target.value })}
                />
              </label>
            </div>
            <Reason
              value={realization.reason}
              onChange={(v) => setRealization({ ...realization, reason: v })}
            />
            <button className="primary" disabled={action.busy}>
              Confirm recorded cash
            </button>
          </form>
        </section>
      )}
      <details className="panel">
        <summary>Expense book balances and payment status</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Expense</th>
                <th>Original date</th>
                <th>Book value AED</th>
                <th>Unpaid AED</th>
                <th>Conversion issue</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.id}>
                  <td>{b.head}</td>
                  <td>{b.date}</td>
                  <td>{fmt(b.bookValue)}</td>
                  <td>{fmt(b.outstanding)}</td>
                  <td>{b.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
