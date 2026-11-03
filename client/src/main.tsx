import React, { useEffect, useState, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import type { Dataset, Entry, Masters } from '../../server/model';
import { recognitionMonthOf } from '../../server/period';
import type { calculateYear, Cell } from '../../server/engine';
import { api } from './api';
import { MasterWorkbench } from './MasterWorkbench';
import {
  Operations,
  Receivables,
  WorkbookCenter,
  UserAccess,
  CloseChecklist,
  ContributionDetails,
  DoctorPayables,
} from './Operations';
import './style.css';
type Report = ReturnType<typeof calculateYear>;
type Drill = {
  line: string;
  ids: string[];
  sourceLine?: string;
  year?: number;
  period?: string;
  view?: 'actual' | 'approx' | 'outlook';
};
type User = { id: string; email: string; role: string };
const fmt = (v: string | number | null | undefined, d = 0) =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FactsContext = createContext<Record<string, Record<string, string>>>({});
let token = sessionStorage.getItem('swizton-token') ?? '';
function App() {
  const [user, setUser] = useState<User | null>(null),
    [ds, setDs] = useState<Dataset | null>(null),
    [revision, setRevision] = useState(0),
    [demo, setDemo] = useState(false),
    [report, setReport] = useState<Report | null>(null);
  const [page, setPage] = useState('Overview'),
    [year, setYear] = useState(2026),
    [mi, setMi] = useState(5),
    [version, setVersion] = useState<'Actual' | 'Approx'>('Actual'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [drill, setDrill] = useState<Drill | null>(null);
  const [facts, setFacts] = useState<Record<string, Record<string, string>>>({});
  const [reportError, setReportError] = useState('');
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const month = `${year}-${String(mi + 1).padStart(2, '0')}`;
  useEffect(() => {
    const expired = () => {
      token = '';
      setUser(null);
      setDs(null);
      setReport(null);
      setError('Your session has ended. Please sign in again.');
    };
    window.addEventListener('swizton-session-expired', expired);
    return () => window.removeEventListener('swizton-session-expired', expired);
  }, []);
  async function load() {
    const s = await api('/data');
    setDs(s.data);
    setFacts(s.facts ?? {});
    setRevision(s.revision);
    setDemo(s.demo);
    setReport(null);
    try {
      const p = await api(`/pnl/${year}`);
      setReport(p);
      setReportError('');
    } catch (e) {
      setReportError((e as Error).message);
    }
  }
  useEffect(() => {
    if (token)
      api('/me')
        .then(setUser)
        .catch(() => {
          token = '';
          sessionStorage.removeItem('swizton-token');
        });
  }, []);
  useEffect(() => {
    if (user) {
      setBusy(true);
      load()
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
    }
  }, [user, year]);
  async function run(fn: () => Promise<unknown>, message = 'Saved successfully') {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const result = await api('/auth/login', { email, password });
      token = result.token;
      sessionStorage.setItem('swizton-token', token);
      setUser(result.user);
      setPassword('');
      setDemo(result.demo);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const writable = user?.role !== 'Management';
  const independent = ['Operations', 'Receivables', 'Workbook review', 'Masters', 'User access'];
  if (!user)
    return (
      <div className="login">
        <div className="login-story">
          <Logo />
          <span className="eyebrow">SWIZTON DUBAI · FINANCE WORKSPACE</span>
          <h1>
            A clearer view of
            <br />
            every contribution.
          </h1>
          <p>
            From a hospital bill to your bottom line.
            <br />
            One place for revenue, shares and performance.
          </p>
          <div className="login-rule" />
          <small>
            NINETY EIGHT FAHRENHEIT
            <br />
            MEDICAL SERVICES FZCO
          </small>
        </div>
        <form className="login-card" onSubmit={login}>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>Sign in to your workspace</h2>
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <button className="primary">Sign in →</button>
          <details>
            <summary>Explore the sample workspace</summary>
            <p>
              Only available when the server runs in DEMO_MODE. Sample data is not your financial
              statement.
            </p>
            {['admin', 'finance', 'management'].map((r) => (
              <button
                type="button"
                className="ghost"
                key={r}
                onClick={() => {
                  setEmail(`${r}@demo.local`);
                  setPassword('demo-only');
                }}
              >
                {r}
              </button>
            ))}
          </details>
        </form>
      </div>
    );
  const period = report?.[version === 'Actual' ? 'actual' : 'approx'][mi];
  return (
    <FactsContext.Provider value={facts}>
      <div className="shell">
        <aside>
          <Logo />
          <div className="org-label">DUBAI FINANCE</div>
          <nav>
            {[
              'Overview',
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
            ]
              .filter(
                (p) =>
                  !(p === 'Audit trail' && !writable) &&
                  !(p === 'User access' && user.role !== 'Admin'),
              )
              .map((p, i) => (
                <button
                  className={page === p ? 'active' : ''}
                  key={p}
                  onClick={() => {
                    setPage(p);
                    setNotice('');
                    setError('');
                  }}
                >
                  <span aria-hidden="true">
                    {['◫', '▤', '↗', '▧', '◉', '▥', '◇', '↔', '⌁', '▣', '⚙', '▣', '♙', '≡'][i]}
                  </span>
                  {p}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="avatar">{user.role[0]}</div>
            <div>
              <b>{user.role}</b>
              <small>{user.email}</small>
            </div>
            <button
              aria-label="Sign out"
              onClick={() => {
                token = '';
                sessionStorage.clear();
                setUser(null);
                setDs(null);
                setReport(null);
              }}
            >
              ↪
            </button>
          </div>
        </aside>
        <main>
          <header>
            <div>
              <span className="eyebrow">NINETY EIGHT FAHRENHEIT MEDICAL SERVICES FZCO</span>
              <h1>{page}</h1>
            </div>
            <div className="header-controls">
              <span className="live-dot" /> Finance workspace
              <select
                aria-label="Financial year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {[2026, 2025, 2024, 2023].map((y) => (
                  <option key={y} value={y}>
                    FY {y}
                  </option>
                ))}
              </select>
            </div>
          </header>
          {demo && (
            <div className="demo-banner">
              <b>SAMPLE WORKSPACE</b>
              <span>
                Illustrative transactions and unapproved share / FX assumptions. Not the FY 2026
                Excel statement.
              </span>
            </div>
          )}
          <div className="toolbar">
            <div className="period-control">
              <select aria-label="Month" value={mi} onChange={(e) => setMi(Number(e.target.value))}>
                {months.map((m, i) => (
                  <option key={m} value={i}>
                    {m} {year}
                  </option>
                ))}
              </select>
              <span className={`badge ${period?.locked ? 'closed' : ''}`}>
                {period?.locked ? 'Locked' : 'Open period'}
              </span>
            </div>
            <div className="segmented">
              {(['Actual', 'Approx'] as const).map((v) => (
                <button
                  className={v === version ? 'selected' : ''}
                  key={v}
                  onClick={() => setVersion(v)}
                >
                  {v === 'Approx' ? 'Approx / forecast' : v}
                </button>
              ))}
            </div>
            <span className="muted">AED · INR in lakh</span>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError('')}>×</button>
            </div>
          )}
          {notice && (
            <div className="success" role="status">
              {notice}
            </div>
          )}
          {busy && (
            <div className="loading" role="status">
              Updating workspace…
            </div>
          )}
          {ds && page === 'Operations' && (
            <Operations
              ds={ds}
              revision={revision}
              user={user}
              month={month}
              refresh={load}
              demo={demo}
            />
          )}
          {ds && page === 'Receivables' && (
            <DoctorPayables
              ds={ds}
              revision={revision}
              user={user}
              month={month}
              refresh={load}
              demo={demo}
            />
          )}
          {ds && page === 'Receivables' && (
            <Receivables
              ds={ds}
              revision={revision}
              user={user}
              month={month}
              refresh={load}
              demo={demo}
            />
          )}
          {ds && page === 'Workbook review' && (
            <WorkbookCenter
              ds={ds}
              revision={revision}
              user={user}
              month={month}
              refresh={load}
              demo={demo}
            />
          )}
          {ds && page === 'User access' && user.role === 'Admin' && (
            <UserAccess
              ds={ds}
              revision={revision}
              user={user}
              month={month}
              refresh={load}
              demo={demo}
            />
          )}
          {ds && page === 'Masters' && (
            <MasterWorkbench
              masters={ds.masters}
              readOnly={user.role !== 'Admin'}
              save={(masters, reason) =>
                api('/masters', { masters, reason, revision }, 'PUT').then(load)
              }
            />
          )}
          {!independent.includes(page) &&
            (!ds || !report || !period ? (
              <div className="empty">
                {reportError
                  ? `Statement unavailable: ${reportError}. Configure approved rules and FX in Masters; operational screens remain available.`
                  : 'Loading financial workspace…'}
                {ds && user.role === 'Admin' && (
                  <MasterWorkbench
                    masters={ds.masters}
                    save={(masters, reason) =>
                      api('/masters', { masters, reason, revision }, 'PUT').then(load)
                    }
                  />
                )}
              </div>
            ) : (
              <>
                {page === 'Overview' && (
                  <Overview
                    report={report}
                    mi={mi}
                    version={version}
                    go={setPage}
                    drill={(d) =>
                      setDrill({
                        ...d,
                        sourceLine: d.line,
                        year,
                        period: month,
                        view: version === 'Actual' ? 'actual' : 'approx',
                      })
                    }
                  />
                )}
                {page === 'Profit & Loss' && (
                  <Pnl
                    report={report}
                    drill={setDrill}
                    exportFile={async (format) => {
                      setError('');
                      try {
                        const r = await fetch(`/api/export/${year}/${format}`, {
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        if (!r.ok) throw Error((await r.json()).error);
                        const url = URL.createObjectURL(await r.blob());
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `Swizton-FY${year}.${format}`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 10000);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  />
                )}
                {['Revenue & bills', 'Expense ledger', 'Marketing wallet'].includes(page) && (
                  <Inputs
                    prepaids={period.prepaids}
                    key={page + month}
                    page={page}
                    ds={ds}
                    month={month}
                    writable={writable}
                    version={version}
                    save={(entry, reason) =>
                      run(
                        () =>
                          api(entry.kind === 'adjustment' ? '/adjustments' : '/entries', {
                            entry,
                            reason,
                            revision,
                          }),
                        entry.kind === 'adjustment'
                          ? 'Adjustment submitted for independent review'
                          : 'Saved successfully',
                      )
                    }
                    importBills={(format, content, reason) =>
                      run(
                        () =>
                          api('/imports/preview', {
                            format,
                            content,
                            name: 'Ledger upload',
                            reason,
                            revision,
                          }),
                        'Preview created. Open Operations → Import review to inspect and commit.',
                      )
                    }
                  />
                )}
                {page === 'Analytics' && <Analytics month={month} report={report} />}
                {page === 'Budget planner' && <Budget month={month} masters={ds.masters} />}
                {page === 'Month close' && (
                  <div className="panel narrow">
                    <span className="eyebrow">PERIOD CONTROL</span>
                    <h2>
                      {months[mi]} {year}
                    </h2>
                    <p>
                      Actual is {period.locked ? 'locked and used' : 'open; forecast is used'} in
                      the working outlook. The statutory FY column always uses Actuals only.
                    </p>
                    <p>
                      Locking protects covered transactions and financial calculations. Future
                      masters may be added only if closed periods remain identical. Finance can
                      close; only Admin can reopen. Confirm all bills, accruals, FX and targets
                      before close.
                    </p>
                    <CloseChecklist month={month} revision={revision} />
                    <ActionReason
                      disabled={!writable || busy || (period.locked && user.role !== 'Admin')}
                      label={period.locked ? 'Reopen month' : 'Close & lock Actual'}
                      action={(reason) =>
                        run(() =>
                          api(`/months/${month}/close`, {
                            locked: !period.locked,
                            reason,
                            revision,
                          }),
                        )
                      }
                    />
                  </div>
                )}
                {page === 'Audit trail' && <Audit revision={revision} />}
              </>
            ))}
          <footer>
            Swizton Dubai{' '}
            <span>Financial operations · {user.role} access · Monthly FX translation</span>
          </footer>
        </main>
        {drill && ds && (
          <div className="modal-backdrop" onClick={() => setDrill(null)}>
            <section className="modal" onClick={(e) => e.stopPropagation()}>
              <button className="close" onClick={() => setDrill(null)}>
                ×
              </button>
              <span className="eyebrow">SOURCE TRANSACTIONS</span>
              <h2>{drill.line}</h2>
              <p>
                {drill.ids.length} source records. Derived figures include all contributing revenue
                and expense records.
              </p>
              <ContributionDetails context={drill} />
              <EntryTable entries={ds.entries.filter((e) => drill.ids.includes(e.id))} />
            </section>
          </div>
        )}
      </div>
    </FactsContext.Provider>
  );
}
function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark">s</span>
      <strong>
        swizton<span>healthcare</span>
      </strong>
    </div>
  );
}
function Metric({
  label,
  value,
  sub,
  negative = false,
}: {
  label: string;
  value: string;
  sub: string;
  negative?: boolean;
}) {
  return (
    <div className={`metric ${negative ? 'negative' : ''}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
function Overview({
  report: r,
  mi,
  version,
  go,
  drill,
}: {
  report: Report;
  mi: number;
  version: 'Actual' | 'Approx';
  go: (p: string) => void;
  drill: (d: Drill) => void;
}) {
  const p = r[version === 'Actual' ? 'actual' : 'approx'][mi],
    row = p.rows,
    profit = Number(row['NET PROFIT / LOSS'].aed);
  const trend = r.actual.map((p) => Number(p.rows['NET PROFIT / LOSS'].aed));
  const max = Math.max(...trend.map(Math.abs), 1);
  const hospitals = Object.keys(row)
      .filter((l) => l.startsWith('Swizton • '))
      .map((l) => l.slice(10))
      .filter((l) => !['Admin Cost Reimbursement', 'OP Consultation'].includes(l)),
    total = Number(row['Total Revenue'].aed);
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Your monthly financial pulse</h2>
          <p>
            {months[mi]} {r.year} ·{' '}
            {version === 'Actual' ? 'Recognised performance' : 'Forecast performance'} at a glance
          </p>
        </div>
        <button className="outline" onClick={() => go('Profit & Loss')}>
          View full statement ↗
        </button>
      </div>
      <div className="metrics">
        <Metric
          label="SWIZTON REVENUE"
          value={`AED ${fmt(row['Swizton Revenue'].aed)}`}
          sub={`₹ ${fmt(row['Swizton Revenue'].inr, 2)} lakh · 100% base`}
        />
        <Metric
          label="TOTAL EXPENSES"
          value={`AED ${fmt(row['Total Expense'].aed)}`}
          sub={`${fmt(row['Total Expense'].pct, 1)}% of Swizton revenue`}
        />
        <Metric
          label="NET PROFIT / LOSS"
          value={`AED ${fmt(profit)}`}
          sub={`${fmt(row['NET PROFIT / LOSS'].pct, 1)}% net margin`}
          negative={profit < 0}
        />
        <Metric
          label="CASES / TARGET"
          value={`${p.kpis.cases} / ${p.kpis.target}`}
          sub={`${fmt(p.kpis.achievement, 1)}% achievement · ${p.kpis.visits} visits`}
        />
      </div>
      <div className="chart-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Net profit / loss trend</h3>
              <p>Actual performance · AED</p>
            </div>
            <span className="legend">
              <i /> Net P/L
            </span>
          </div>
          <div className="bar-chart">
            {trend.map((v, i) => (
              <div className={`bar-col ${i === mi ? 'focused' : ''}`} key={i}>
                <span className="bar-value">{fmt(v / 1000, 1)}k</span>
                <div className="bar-space">
                  <div
                    className={`bar ${v < 0 ? 'loss' : ''}`}
                    style={{ height: `${Math.max((Math.abs(v) / max) * 100, 2)}%` }}
                  />
                </div>
                <small>{months[i]}</small>
              </div>
            ))}
          </div>
          <div className="chart-note">
            Jan–Dec {r.year}{' '}
            <span>Unentered months display zero; they are not confirmed results.</span>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Revenue composition</h3>
              <p>Hospital final / doctor-fee shares</p>
            </div>
            <span>◉</span>
          </div>
          <div className="revenue-total">
            <span>Total revenue</span>
            <b>AED {fmt(total)}</b>
          </div>
          {[...hospitals, 'Admin Cost Reimbursement', 'OP Consultation'].map((h, i) => (
            <div className="mix-row" key={h}>
              <div>
                <span>
                  <i
                    style={{
                      background: ['#186859', '#8cb3a5', '#d5a95b', '#899bc0', '#c2b9a7'][i],
                    }}
                  />
                  {h}
                </span>
                <b>{fmt(row[h]?.aed)}</b>
              </div>
              <div className="progress-track">
                <div
                  style={{
                    width: `${total ? Math.max(0, (Number(row[h]?.aed) / total) * 100) : 0}%`,
                    background: ['#186859', '#8cb3a5', '#d5a95b', '#899bc0', '#c2b9a7'][i],
                  }}
                />
              </div>
            </div>
          ))}
        </section>
      </div>
      <div className="chart-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Revenue waterfall</h3>
              <p>Every figure links to its source records</p>
            </div>
            <button className="text-button" onClick={() => go('Revenue & bills')}>
              Open ledger →
            </button>
          </div>
          {[
            'Total Revenue',
            'Dr. Chinmay – Professional Fee',
            'Dr. Tahsin – Professional Fee',
            'Swizton Revenue',
            'Total Expense',
            'NET PROFIT / LOSS',
          ].map((l) => (
            <button
              className="waterfall"
              key={l}
              onClick={() => drill({ line: l, ids: row[l].ids })}
            >
              <span>{l}</span>
              <b className={Number(row[l].aed) < 0 ? 'red' : ''}>
                {fmt(row[l].aed, 2)} <small>AED ↗</small>
              </b>
            </button>
          ))}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Procedure mix</h3>
              <p>IP case count · {months[mi]}</p>
            </div>
            <span className="badge">{p.kpis.cases} cases</span>
          </div>
          {Object.entries(p.kpis.mix)
            .filter(([, n]) => n > 0)
            .map(([name, n]) => (
              <div className="procedure-row" key={name}>
                <span>{name}</span>
                <div className="progress-track">
                  <div style={{ width: `${p.kpis.cases ? (n / p.kpis.cases) * 100 : 0}%` }} />
                </div>
                <b>{n}</b>
              </div>
            ))}
          {!p.kpis.cases && <p className="empty">No cases entered for this month.</p>}
          <div className="info-note">
            Monthly target: {p.kpis.target} cases. Targets and procedures are maintained in Masters.
          </div>
        </section>
      </div>
    </>
  );
}
function Pnl({
  report: r,
  drill,
  exportFile,
}: {
  report: Report;
  drill: (d: Drill) => void;
  exportFile: (f: string) => void;
}) {
  const [mode, setMode] = useState('Monthly'),
    [currency, setCurrency] = useState<'aed' | 'inr' | 'pct'>('aed');
  const blocks =
    mode === 'Monthly'
      ? r.actual.flatMap((a, i) => [
          {
            label: `${months[i]} Approx`,
            rows: r.approx[i].rows,
            period: r.approx[i].month,
            view: 'approx' as const,
          },
          {
            label: `${months[i]} Actual${a.locked ? ' ▣' : ''}`,
            rows: a.rows,
            period: a.month,
            view: 'actual' as const,
          },
        ])
      : [
          { label: `FY ${r.year} Actual`, rows: r.total, view: 'actual' as const },
          ...Object.entries(r.comparatives)
            .reverse()
            .map(([y, rows]) => ({ label: `FY ${y}`, rows })),
          { label: 'Combined', rows: r.combined },
          { label: 'Working outlook', rows: r.outlook, view: 'outlook' as const },
        ];
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>Profit & Loss Statement</h3>
          <p>
            Actual FY total · Sum of monthly INR translations · Percentage base: Swizton revenue
          </p>
        </div>
        <div className="button-row">
          <button className="outline" onClick={() => exportFile('xlsx')}>
            ↓ Excel
          </button>
          <button className="outline" onClick={() => exportFile('pdf')}>
            ↓ PDF
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="segmented">
          {['Monthly', 'Yearly comparison'].map((m) => (
            <button className={mode === m ? 'selected' : ''} onClick={() => setMode(m)} key={m}>
              {m}
            </button>
          ))}
        </div>
        <select
          aria-label="Display currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value as typeof currency)}
        >
          <option value="aed">AED</option>
          <option value="inr">INR (Lakh)</option>
          <option value="pct">% of Swizton Revenue</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="pnl">
          <thead>
            <tr>
              <th>Particulars</th>
              {blocks.map((b) => (
                <th key={b.label}>{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(r.total).map((l) => (
              <tr
                key={l}
                className={
                  ['Swizton Revenue', 'Total Expense', 'Total Revenue'].includes(l)
                    ? 'subtotal'
                    : l === 'NET PROFIT / LOSS'
                      ? 'profit-row'
                      : ''
                }
              >
                <th>{l}</th>
                {blocks.map((b) => {
                  const c = b.rows[l];
                  return (
                    <td key={b.label}>
                      <button
                        title={c ? 'View source transactions' : 'Comparative not supplied'}
                        className={c && Number(c[currency]) < 0 ? 'red' : ''}
                        disabled={!c}
                        onClick={() =>
                          c &&
                          drill({
                            line: `${b.label} · ${l}`,
                            ids: c.ids,
                            sourceLine: l,
                            year: r.year,
                            period: 'period' in b ? b.period : undefined,
                            view: 'view' in b ? b.view : 'actual',
                          })
                        }
                      >
                        {c ? fmt(c[currency], currency === 'pct' ? 1 : 2) : 'Not supplied'}
                        {currency === 'pct' && c?.pct !== null ? '%' : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="kpi-title">Volume & achievement</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>KPI · Actual</th>
              {months.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>FY Actual</th>
            </tr>
          </thead>
          <tbody>
            {(['cases', 'visits', 'target', 'achievement'] as const).map((k) => (
              <tr key={k}>
                <th>{k}</th>
                {r.actual.map((p) => (
                  <td key={p.month}>
                    {fmt(p.kpis[k], k === 'achievement' ? 1 : 0)}
                    {k === 'achievement' ? '%' : ''}
                  </td>
                ))}
                <td>
                  {fmt(r.kpis[k], k === 'achievement' ? 1 : 0)}
                  {k === 'achievement' ? '%' : ''}
                </td>
              </tr>
            ))}
            {Object.keys(r.actual[0].kpis.mix).map((p) => (
              <tr key={p}>
                <th>{p}</th>
                {r.actual.map((a) => (
                  <td key={a.month}>{a.kpis.mix[p]}</td>
                ))}
                <td>{r.kpis.mix[p]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="info-note">
        Excel exports each month as Approx + Actual with AED, INR lakh and % side by side.
        Historical years remain “Not supplied” until imported. PDF uses readable monthly pages;
        exact workbook styling awaits the source file.
      </p>
    </section>
  );
}
function EntryTable({ entries }: { entries: Entry[] }) {
  const facts = useContext(FactsContext);
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(0);
  const filtered = entries.filter((e) =>
    JSON.stringify(e).toLowerCase().includes(search.toLowerCase()),
  );
  const visible = filtered.slice(page * 50, page * 50 + 50);
  return (
    <>
      <div className="ledger-controls">
        <label>
          Search source records
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Invoice, patient reference, head or amount"
          />
        </label>
        <span>{filtered.length} matching records</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Original date</th>
              <th>Recognition month</th>
              <th>Type</th>
              <th>Reference / head</th>
              <th>Patient / remarks</th>
              <th>Amount / gross</th>
              <th>Final share / net</th>
              <th>Swizton AED</th>
              <th>Basis / details</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td>{recognitionMonthOf(e)}</td>
                <td>
                  <span className="badge">{e.kind}</span>
                </td>
                <td>
                  {e.kind === 'bill'
                    ? `${e.hospital} · ${e.invoice}`
                    : e.kind === 'expense'
                      ? e.head
                      : e.kind === 'receipt'
                        ? e.source
                        : e.kind === 'estimate'
                          ? e.hospital
                          : e.kind === 'adjustment'
                            ? e.line
                            : e.action}
                </td>
                <td>
                  {'patient' in e
                    ? e.patient
                    : 'remarks' in e
                      ? e.remarks
                      : e.kind === 'adjustment'
                        ? e.reason
                        : ''}
                </td>
                <td>
                  {fmt(
                    'gross' in e
                      ? e.gross
                      : 'amount' in e
                        ? e.amount
                        : e.kind === 'estimate'
                          ? e.approval
                          : 0,
                    2,
                  )}{' '}
                  {'currency' in e ? e.currency : 'AED'}
                </td>
                <td>{facts[e.id] ? fmt(facts[e.id].finalShare ?? facts[e.id].net, 2) : '—'}</td>
                <td>{facts[e.id] ? fmt(facts[e.id].swizton, 2) : '—'}</td>
                <td>
                  <details>
                    <summary>{e.version} · Details</summary>
                    <pre>{JSON.stringify({ source: e, calculation: facts[e.id] }, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className="empty">No records for this period.</p>}
      </div>
      <div className="button-row">
        <button className="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous records
        </button>
        <span>
          Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 50))}
        </span>
        <button
          className="outline"
          disabled={(page + 1) * 50 >= filtered.length}
          onClick={() => setPage(page + 1)}
        >
          Next records
        </button>
      </div>
    </>
  );
}
function ActionReason({
  action,
  label,
  disabled = false,
}: {
  action: (reason: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="reason-form"
      onSubmit={(e) => {
        e.preventDefault();
        action(reason);
      }}
    >
      <label>
        Reason / audit note
        <input
          required
          minLength={8}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain this change (at least 8 characters)"
        />
      </label>
      <button className="primary" disabled={disabled}>
        {label}
      </button>
    </form>
  );
}
const componentNames = [
  'Consultation',
  'Lab',
  'Radiology',
  'Procedures',
  'Room',
  'Surgeon Fee',
  'OT/Anaesthesia',
  'Nursing',
  'Pharmacy',
  'Consumables',
  'Reports',
];
function Inputs({
  page,
  ds,
  month,
  version,
  writable,
  save,
  importBills,
  prepaids,
}: {
  prepaids: { id: string; monthlyNative: string; outstandingNative: string; currency: string }[];
  page: string;
  ds: Dataset;
  month: string;
  version: 'Actual' | 'Approx';
  writable: boolean;
  save: (e: Entry, reason: string) => Promise<void>;
  importBills: (f: string, c: string, r: string) => Promise<void>;
}) {
  const kinds =
    page === 'Revenue & bills'
      ? ['bill', 'estimate', 'receipt', 'adjustment']
      : page === 'Expense ledger'
        ? ['expense', 'adjustment']
        : ['wallet'];
  const [kind, setKind] = useState(kinds[0]),
    [show, setShow] = useState(false),
    [reason, setReason] = useState(''),
    [fields, setFields] = useState<Record<string, string>>({}),
    [importReason, setImportReason] = useState(''),
    [localError, setLocalError] = useState('');
  const m = ds.masters,
    entries = ds.entries.filter(
      (e) => e.version === version && recognitionMonthOf(e) === month && kinds.includes(e.kind),
    );
  const put = (key: string, value: string) =>
    setFields((f) => ({
      ...f,
      ...(key === 'hospital' ? { adminAmount: '', refundableAmount: '' } : {}),
      [key]: value,
    }));
  const val = (k: string, d = '') => fields[k] ?? d;
  const field = (key: string, label: string, type = 'text', def = '', required = true) => (
    <label key={key}>
      {label}
      <input
        type={type}
        required={required}
        min={type === 'number' ? '0' : undefined}
        step={type === 'number' ? 'any' : undefined}
        value={val(key, def)}
        onChange={(e) => put(key, e.target.value)}
      />
    </label>
  );
  const select = (key: string, label: string, options: string[], def = options[0]) => (
    <label key={key}>
      {label}
      <select value={val(key, def)} onChange={(e) => put(key, e.target.value)}>
        {options.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');
    const base = { id: crypto.randomUUID(), date: val('date', `${month}-15`), version };
    let entry: unknown;
    try {
      if (kind === 'bill')
        entry = {
          ...base,
          version: 'Actual',
          kind,
          ...(val('recognitionMonth') ? { recognitionMonth: val('recognitionMonth') } : {}),
          hospital: val('hospital', m.hospitals[0]?.id),
          patient: val('patient'),
          procedure: val('procedure', m.procedures[0]),
          doctor: val('doctor', m.doctors[0]),
          billType: val('billType', 'IP'),
          payment: val('payment', 'Cash'),
          invoice: val('invoice'),
          gross: val('gross', '0'),
          consumables: val('consumables', '0'),
          pharmacyLab: val('pharmacyLab', '0'),
          ...(val('adminAmount')
            ? { adminAmount: val('adminAmount'), deductionReason: reason }
            : {}),
          ...(val('refundableAmount')
            ? { refundableAmount: val('refundableAmount'), deductionReason: reason }
            : {}),
          regime: val('regime', 'Standard'),
          components: Object.fromEntries(
            componentNames.map((c) => [c, val(`component:${c}`, '0')]),
          ),
          visits: Number(val('visits', '1')),
          vat: val('vat', '0'),
          tax: val('tax', '0'),
        };
      if (kind === 'estimate')
        entry = {
          ...base,
          version: 'Approx',
          kind,
          hospital: val('hospital', m.hospitals[0]?.id),
          patient: val('patient'),
          contact: val('contact'),
          procedure: val('procedure', m.procedures[0]),
          leadSource: val('leadSource'),
          payment: val('payment', 'Cash'),
          approval: val('approval', '0'),
          consumablesRate: val('consumablesRate', '0'),
          visits: Number(val('visits', '1')),
        };
      if (kind === 'receipt')
        entry = {
          ...base,
          kind,
          ...(val('recognitionMonth') ? { recognitionMonth: val('recognitionMonth') } : {}),
          source: val('source', 'OP Consultation'),
          amount: val('amount', '0'),
          patient: val('patient'),
          visits: Number(val('visits', '1')),
        };
      if (kind === 'expense')
        entry = {
          ...base,
          kind,
          ...(val('caseId') ? { caseId: val('caseId') } : {}),
          head: val('head', m.expenseHeads[0]?.name),
          amount: val('amount', '0'),
          currency: val('currency', 'AED'),
          basis: val('basis', 'Actual'),
          paid: val('paid', 'Paid') === 'Paid',
          remarks: val('remarks'),
          coverageStart: val('coverageStart') || null,
          coverageEnd: val('coverageEnd') || null,
        };
      if (kind === 'wallet')
        entry = {
          ...base,
          kind,
          costBehavior: val('costBehavior', 'Unclassified'),
          action: val('action', 'topup'),
          amount: val('amount', '0'),
          remarks: val('remarks'),
        };
      if (kind === 'adjustment')
        entry = {
          ...base,
          kind,
          adjustmentType: val('adjustmentType', 'Amount'),
          line: val('line', m.hospitals[0]?.id),
          amount: val('amount', '0'),
          reason,
        };
      await save(entry as Entry, reason);
    } catch (e) {
      setLocalError((e as Error).message);
    }
  }
  const wallet = page === 'Marketing wallet';
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>
            {page === 'Revenue & bills'
              ? 'Revenue source ledger'
              : wallet
                ? 'Digital marketing wallet'
                : 'Recognised expenses'}
          </h2>
          <p>
            {wallet
              ? 'Opening + additions − ad spend = closing. Only spend reaches the P&L.'
              : page === 'Expense ledger'
                ? 'Accruals and paid expenses are recognised once. Covered costs are spread evenly by month.'
                : 'Hospital bills, OP receipts and revenue estimates. All changes are audited.'}
          </p>
        </div>
        {writable && (
          <button className="primary" onClick={() => setShow(!show)}>
            {show ? 'Close form' : '+ Add record'}
          </button>
        )}
      </div>
      {wallet && <WalletSummary ds={ds} month={month} version={version} />}
      {show && writable && (
        <section className="panel">
          <div className="panel-heading">
            <h3>New financial record</h3>
          </div>
          <div className="button-row">
            {kinds.map((k) => (
              <button
                key={k}
                className={kind === k ? 'primary' : 'outline'}
                onClick={() => {
                  setKind(k);
                  setFields({});
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <form onSubmit={submit}>
            <div className="form-grid">
              {field(
                'date',
                kind === 'bill'
                  ? 'Original invoice / occurrence date'
                  : 'Transaction / occurrence date',
                'date',
                `${month}-15`,
              )}
              {['bill', 'receipt'].includes(kind) &&
                field(
                  'recognitionMonth',
                  'Revenue recognition month (optional)',
                  'month',
                  '',
                  false,
                )}
              {['bill', 'estimate'].includes(kind) && (
                <>
                  {select(
                    'hospital',
                    'Hospital / centre',
                    m.hospitals.map((h) => h.id),
                  )}
                  {field('patient', 'Patient reference')}
                  {select('procedure', 'Procedure', m.procedures)}
                  {select('payment', 'Payment mode', ['Cash', 'Insurance'])}
                  {field('visits', 'Visit count', 'number', '1')}
                </>
              )}
              {kind === 'bill' && (
                <>
                  {field('invoice', 'Invoice number')}
                  {select('doctor', 'Doctor', m.doctors)}
                  {select('billType', 'Bill type', ['IP', 'OP'])}
                  {select('regime', 'Fee regime', ['Standard', 'HMS', 'Insurance-OP'])}
                  {field('gross', 'Gross amount · AED', 'number', '0')}
                  {field('consumables', 'Consumables · AED', 'number', '0')}
                  {field('pharmacyLab', 'Pharmacy & lab · AED', 'number', '0')}
                  {m.hospitals.find((h) => h.id === val('hospital', m.hospitals[0]?.id))?.method !==
                    'components' && (
                    <>
                      {field(
                        'adminAmount',
                        'Recorded admin deduction · AED (optional)',
                        'number',
                        '',
                        false,
                      )}
                      {field(
                        'refundableAmount',
                        'Recorded refundable deduction · AED (optional)',
                        'number',
                        '',
                        false,
                      )}
                    </>
                  )}
                  {field('vat', 'VAT disclosure · AED', 'number', '0')}
                  {field('tax', 'Corporate tax disclosure · AED', 'number', '0')}
                </>
              )}
              {kind === 'estimate' && (
                <>
                  {field('contact', 'Contact', 'text', '', false)}
                  {field('leadSource', 'Lead source / referral')}
                  {field('approval', 'Approved gross amount · AED', 'number', '0')}
                  {field('consumablesRate', 'Consumables fraction (0–1)', 'number', '0')}
                </>
              )}
              {kind === 'receipt' && (
                <>
                  {select('source', 'Receipt source', [
                    'OP Consultation',
                    'Admin Cost Reimbursement',
                  ])}
                  {field('patient', 'Patient / reference', 'text', '', false)}
                  {field('visits', 'OP visits', 'number', '1')}
                  {field('amount', 'Receipt · AED', 'number', '0')}
                </>
              )}
              {kind === 'expense' && (
                <>
                  <label>
                    Related bill / case (optional)
                    <select value={val('caseId')} onChange={(e) => put('caseId', e.target.value)}>
                      <option value="">Shared cost</option>
                      {ds.entries
                        .filter((e): e is Extract<Entry, { kind: 'bill' }> => e.kind === 'bill')
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.hospital} · {e.invoice}
                          </option>
                        ))}
                    </select>
                  </label>
                  {select(
                    'head',
                    'Expense head',
                    m.expenseHeads.map((h) => h.name),
                  )}
                  {field('amount', 'Amount', 'number', '0')}
                  {select('currency', 'Source currency', ['AED', 'INR', 'USD'])}
                  {select('basis', 'Recognition basis', ['Actual', 'Accrual'])}
                  {select('paid', 'Payment status', ['Paid', 'Not Paid'])}
                  {field('coverageStart', 'Coverage from (optional)', 'date', '', false)}
                  {field('coverageEnd', 'Coverage to (optional)', 'date', '', false)}
                  {field('remarks', 'Remarks')}
                </>
              )}
              {kind === 'wallet' && (
                <>
                  {select('costBehavior', 'Cost behaviour', ['Unclassified', 'Fixed', 'Variable'])}
                  {select('action', 'Wallet movement', ['topup', 'spend', 'opening'])}
                  {field('amount', 'Amount · AED', 'number', '0')}
                  {field('remarks', 'Ad invoice / top-up reference')}
                </>
              )}
              {kind === 'adjustment' && (
                <>
                  <label>
                    Adjustment purpose
                    <select
                      value={val('adjustmentType', 'Amount')}
                      onChange={(e) => {
                        put('adjustmentType', e.target.value);
                        put('line', m.hospitals[0]?.id ?? '');
                      }}
                    >
                      <option value="Amount">Revenue / expense amount</option>
                      <option value="ChinmayEligibility">
                        Chinmay eligible-revenue basis only
                      </option>
                    </select>
                  </label>
                  {select('line', 'Source P&L line', [
                    ...m.hospitals.map((h) => h.id),
                    'Admin Cost Reimbursement',
                    'OP Consultation',
                    ...(val('adjustmentType', 'Amount') === 'Amount'
                      ? [
                          'HR Cost',
                          'Marketing Expense',
                          'Administration Expense',
                          'Finance & Other Expense',
                        ]
                      : []),
                  ])}
                  <label>
                    Signed adjustment · AED
                    <input
                      required
                      value={val('amount', '0')}
                      onChange={(e) => put('amount', e.target.value)}
                      pattern="-?[0-9]+(\.[0-9]+)?"
                    />
                  </label>
                </>
              )}
            </div>
            {kind === 'bill' && val('hospital', m.hospitals[0]?.id) === 'Al Garhoud' && (
              <>
                <h4>Component amounts · AED</h4>
                <div className="form-grid">
                  {componentNames.map((c) => field(`component:${c}`, c, 'number', '0'))}
                </div>
              </>
            )}
            <p className="info-note">
              {kind === 'bill'
                ? 'Bills are always Actual. Separate recognition month preserves invoice date; case/visit KPIs remain on the original date. Recorded admin/refundable amounts override percentage defaults and require the audit note. Net-share calculation deducts consumables, pharmacy/lab and both percentages of gross before applying the effective share. Al Garhoud uses component shares. VAT/tax are disclosures and are not automatically booked.'
                : kind === 'estimate'
                  ? 'Estimates are always Approx. Approval × (1 − consumables fraction) × effective forecast doctor share gives doctor payout; Swizton receives its configured share of that payout.'
                  : 'All amounts use the centrally approved recognition-month FX. Add a prepaid coverage range only when the cost spans multiple months.'}
            </p>
            <label>
              Reason / audit note
              <input
                minLength={8}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {localError && <p className="error">{localError}</p>}
            <button className="primary">Save record</button>
          </form>
        </section>
      )}
      {page === 'Revenue & bills' && writable && (
        <details className="panel import-panel">
          <summary>Bulk import hospital bills · CSV or Excel</summary>
          <p>
            Use the template in docs/bills-template.csv. Up to 1,000 rows; the whole batch passes
            validation or none is saved.
          </p>
          <label>
            Batch reason
            <input
              minLength={8}
              value={importReason}
              onChange={(e) => setImportReason(e.target.value)}
            />
          </label>
          <input
            aria-label="Import bills file"
            type="file"
            accept=".csv,.xlsx"
            disabled={importReason.length < 8}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 5000000) {
                setLocalError('Maximum file size is 5 MB');
                return;
              }
              const format = file.name.endsWith('.csv') ? 'csv' : 'xlsx';
              const content =
                format === 'csv'
                  ? await file.text()
                  : btoa(
                      Array.from(new Uint8Array(await file.arrayBuffer()), (b) =>
                        String.fromCharCode(b),
                      ).join(''),
                    );
              await importBills(format, content, importReason);
              e.target.value = '';
            }}
          />
        </details>
      )}
      {page === 'Expense ledger' && (
        <section className="panel">
          <h3>Prepaid amortisation · {month}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Expense head</th>
                  <th>Monthly recognition</th>
                  <th>O/S after this month</th>
                  <th>Currency</th>
                </tr>
              </thead>
              <tbody>
                {prepaids.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {
                        (
                          ds.entries.find((e) => e.id === p.id) as Extract<
                            Entry,
                            { kind: 'expense' }
                          >
                        )?.head
                      }
                    </td>
                    <td>{fmt(p.monthlyNative, 2)}</td>
                    <td>{fmt(p.outstandingNative, 2)}</td>
                    <td>{p.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h3>
            {version} records · {month}
          </h3>
          <span className="badge">{entries.length} records</span>
        </div>
        <EntryTable entries={entries} />
      </section>
    </>
  );
}
function WalletSummary({ ds, month, version }: { ds: Dataset; month: string; version: string }) {
  const es = ds.entries.filter(
    (e): e is Extract<Entry, { kind: 'wallet' }> =>
      e.kind === 'wallet' && e.version === version && e.date.slice(0, 7) <= month,
  );
  const opening = es
      .filter((e) => e.date.slice(0, 7) < month || e.action === 'opening')
      .reduce((s, e) => s + (e.action === 'spend' ? -1 : 1) * Number(e.amount), 0),
    addition = es
      .filter((e) => e.date.startsWith(month) && e.action === 'topup')
      .reduce((s, e) => s + Number(e.amount), 0),
    spend = es
      .filter((e) => e.date.startsWith(month) && e.action === 'spend')
      .reduce((s, e) => s + Number(e.amount), 0);
  return (
    <div className="metrics">
      {[
        ['Opening', opening],
        ['Additions', addition],
        ['Spend', spend],
        ['Closing', opening + addition - spend],
      ].map(([l, n]) => (
        <Metric
          key={l}
          label={String(l)}
          value={`AED ${fmt(n)}`}
          sub={l === 'Spend' ? 'Recognised as marketing expense' : 'Wallet movement only'}
        />
      ))}
    </div>
  );
}

function Analytics({ month, report }: { month: string; report: Report }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    api(`/analytics/${month}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [month, report]);
  if (!data) return <p>{error || 'Calculating analytics…'}</p>;
  return (
    <>
      <div className="metrics">
        <Metric
          label="FIXED-COST BREAKEVEN"
          value={data.costs.fixedCostBreakeven ? `${data.costs.fixedCostBreakeven} cases` : '—'}
          sub={data.costs.status}
        />
        <Metric
          label="FIXED / VARIABLE COST"
          value={`${fmt(data.costs.fixed)} / ${fmt(data.costs.variable)}`}
          sub={`AED · ${data.costs.unclassifiedCount} unclassified expense records`}
        />
        <Metric
          label="PROCEDURE / HOSPITAL PAIRS"
          value={String(data.ranking.length)}
          sub={month}
        />
      </div>
      <section className="panel">
        <h3>Hospital × procedure ranking</h3>
        <p>{data.allocationBasis}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  'Hospital',
                  'Procedure',
                  'Cases',
                  'Swizton AED',
                  'AED / case',
                  'Direct expense',
                  'Allocated shared expense',
                  'Profit after allocation',
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.ranking.map((r: any) => (
                <tr key={r.hospital + r.procedure}>
                  <td>{r.hospital}</td>
                  <td>{r.procedure}</td>
                  <td>{r.cases}</td>
                  <td>{fmt(r.swizton, 2)}</td>
                  <td>{fmt(r.perCase, 2)}</td>
                  <td>{fmt(r.directExpense, 2)}</td>
                  <td>{fmt(r.allocatedExpense, 2)}</td>
                  <td>{fmt(r.profitAfterAllocation, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h3>Hospital × procedure revenue matrix · AED</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Procedure</th>
                {[...new Set<string>(data.ranking.map((r: any) => r.hospital))].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...new Set<string>(data.ranking.map((r: any) => r.procedure))].map((p) => (
                <tr key={p}>
                  <th>{p}</th>
                  {[...new Set<string>(data.ranking.map((r: any) => r.hospital))].map((h) => {
                    const v = data.ranking.find((r: any) => r.hospital === h && r.procedure === p);
                    return (
                      <td key={h} style={{ background: v ? '#e8f1e7' : undefined }}>
                        {v ? fmt(v.swizton, 2) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h3>Approx vs Actual · {month}</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th>Approx AED</th>
                <th>Actual AED</th>
                <th>Actual − Approx</th>
              </tr>
            </thead>
            <tbody>
              {data.variance.map((v: any) => (
                <tr key={v.line}>
                  <th>{v.line}</th>
                  <td>{fmt(v.approx, 2)}</td>
                  <td>{fmt(v.actual, 2)}</td>
                  <td className={Number(v.variance) < 0 ? 'red' : ''}>{fmt(v.variance, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function Budget({ month, masters: m }: { month: string; masters: Masters }) {
  const [hospital, setHospital] = useState(m.hospitals[0]?.id ?? ''),
    [procedure, setProcedure] = useState(m.procedures[0] ?? ''),
    [cases, setCases] = useState(20),
    [revenue, setRevenue] = useState('7000'),
    [cost, setCost] = useState('18000'),
    [items, setItems] = useState<any[]>([]),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState('');
  return (
    <section className="panel">
      <h3>Build a procedure-count budget</h3>
      <p>
        Model hospital final-share revenue per case. Revenue share uses the rule effective on the
        first day of {month}.
      </p>
      <div className="form-grid">
        <label>
          Hospital
          <select value={hospital} onChange={(e) => setHospital(e.target.value)}>
            {m.hospitals.map((h) => (
              <option key={h.id}>{h.id}</option>
            ))}
          </select>
        </label>
        <label>
          Procedure
          <select value={procedure} onChange={(e) => setProcedure(e.target.value)}>
            {m.procedures.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Case count
          <input
            type="number"
            min="0"
            value={cases}
            onChange={(e) => setCases(Number(e.target.value))}
          />
        </label>
        <label>
          Revenue base per case · AED
          <input
            type="number"
            min="0"
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
          />
        </label>
        <label>
          Monthly fixed-cost assumption · AED
          <input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
      </div>
      <div className="button-row">
        <button
          className="outline"
          onClick={() => {
            setItems([...items, { hospital, procedure, cases, revenuePerCase: revenue }]);
            setResult(null);
          }}
        >
          + Add procedure
        </button>
        <button
          className="primary"
          onClick={async () => {
            try {
              setResult(
                await api('/budget', {
                  month,
                  fixedCost: cost,
                  items: items.length
                    ? items
                    : [{ hospital, procedure, cases, revenuePerCase: revenue }],
                }),
              );
              setError('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Calculate projection
        </button>
        <button
          className="ghost"
          onClick={() => {
            setItems([]);
            setResult(null);
          }}
        >
          Clear
        </button>
      </div>
      {items.map((i, n) => (
        <p key={n}>
          {i.hospital} · {i.procedure} · {i.cases} cases × AED {fmt(i.revenuePerCase)}{' '}
          <button
            className="ghost"
            onClick={() => {
              setItems(items.filter((_, j) => j !== n));
              setResult(null);
            }}
          >
            Remove
          </button>
        </p>
      ))}
      {error && <div className="error">{error}</div>}
      {result && (
        <>
          <div className="metrics">
            <Metric
              label="PROJECTED SWIZTON REVENUE"
              value={`AED ${fmt(result.swizton)}`}
              sub="Effective master share"
            />
            <Metric
              label="PROJECTED PROFIT / LOSS"
              value={`AED ${fmt(result.profit)}`}
              sub={`AED ${fmt(result.expense)} planned fixed cost`}
              negative={Number(result.profit) < 0}
            />
          </div>
          <p className="info-note">{result.basis} This scenario is not saved to the ledger.</p>
        </>
      )}
    </section>
  );
}
function Audit({ revision }: { revision: number }) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(''),
    [more, setMore] = useState(false);
  useEffect(() => {
    api('/audit')
      .then((r) => {
        setRows(r);
        setMore(r.length === 200);
      })
      .catch((e) => setError(e.message));
  }, [revision]);
  return (
    <section className="panel">
      <h3>Append-only audit trail</h3>
      <p>
        Changed records, independent approvals, account access and financial inputs retain their
        before/after evidence. Load older events to review the full history.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Reason</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sequence}>
                <td>{new Date(r.occurred_at).toLocaleString()}</td>
                <td>{r.actor_email ?? r.actor}</td>
                <td>{r.action}</td>
                <td>{r.reason}</td>
                <td>
                  <details>
                    <summary>Change evidence</summary>
                    <pre>
                      {JSON.stringify({ before: r.before_data, after: r.after_data }, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">No changes recorded in this workspace.</p>}
      </div>
      {more && (
        <button
          className="outline"
          onClick={async () => {
            try {
              const older = await api(
                `/audit?before=${Math.min(...rows.map((r) => Number(r.sequence)))}`,
              );
              setRows([...rows, ...older]);
              setMore(older.length === 200);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Load older events
        </button>
      )}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
