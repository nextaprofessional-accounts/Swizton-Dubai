import React, { useEffect, useState } from 'react';
import type { Dataset } from '../../server/model';
import type { HospitalProfile } from '../../server/daily-model';
import type { caseRegister, bankRegister } from '../../server/daily';
import { businessDate } from '../../server/planning-calendar';
import { api, download } from './api';
import { useAction, Alerts, Reason } from './Operations';
type Props = {
  ds: Dataset;
  revision: number;
  user: { id: string; role: string };
  refresh: () => Promise<void>;
};
const fmt = (v: string | number | null | undefined) =>
  v == null
    ? '—'
    : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function fileData(file: File) {
  if (file.size > 5_000_000) throw Error('Maximum file size is 5 MB');
  return file.name.toLowerCase().endsWith('.csv')
    ? { format: 'csv', content: await file.text() }
    : {
        format: 'xlsx',
        content: btoa(
          Array.from(new Uint8Array(await file.arrayBuffer()), (c) => String.fromCharCode(c)).join(
            '',
          ),
        ),
      };
}
export function DailyOperations(props: Props) {
  const [tab, setTab] = useState('Case register');
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Daily operations workspace</h2>
          <p>
            Track bill cases, validate hospital uploads and match bank evidence to recorded cash.
          </p>
        </div>
        <span className="badge">Source-linked operations</span>
      </div>
      <div className="master-tabs">
        {['Case register', 'Hospital imports', 'Bank matching'].map((t) => (
          <button key={t} className={tab === t ? 'primary' : 'outline'} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Case register' && <Cases {...props} />}{' '}
      {tab === 'Hospital imports' && <HospitalImports {...props} />}{' '}
      {tab === 'Bank matching' && <BankMatching {...props} />}
    </>
  );
}
function Cases({ ds, revision, user, refresh }: Props) {
  const action = useAction(refresh),
    [asOf, setAsOf] = useState(businessDate()),
    [rows, setRows] = useState<ReturnType<typeof caseRegister>>([]),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [hospital, setHospital] = useState('All'),
    [onlyOpen, setOnlyOpen] = useState(false),
    [page, setPage] = useState(0),
    [id, setId] = useState(''),
    [form, setForm] = useState({
      status: 'Documentation pending',
      hospitalCaseReference: '',
      authorizationReference: '',
      expectedCollectionDate: '',
      notes: '',
      reason: '',
    });
  useEffect(() => {
    let active = true;
    setRows([]);
    api(`/daily/cases?asOf=${asOf}`)
      .then((r) => {
        if (active) {
          setRows(r.rows);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [asOf, revision]);
  const filtered = rows.filter(
      (r) =>
        (hospital === 'All' || r.hospital === hospital) &&
        (!onlyOpen || Number(r.outstanding) > 0) &&
        `${r.patient} ${r.invoice} ${r.procedure} ${r.record?.hospitalCaseReference ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ),
    selected = rows.find((r) => r.id === id);
  const edit = (r: (typeof rows)[number]) => {
    setId(r.id);
    setForm({
      status: r.record?.status ?? 'Documentation pending',
      hospitalCaseReference: r.record?.hospitalCaseReference ?? '',
      authorizationReference: r.record?.authorizationReference ?? '',
      expectedCollectionDate: r.record?.expectedCollectionDate ?? '',
      notes: r.record?.notes ?? '',
      reason: '',
    });
  };
  return (
    <>
      <Alerts s={action} />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="metrics">
        {[
          ['BILL CASES', filtered.length],
          ['OUTSTANDING AED', fmt(filtered.reduce((s, r) => s + Number(r.outstanding), 0))],
          ['EXPLICITLY OVERDUE', filtered.filter((r) => r.overdue).length],
          [
            'IP / OP',
            `${filtered.filter((r) => r.billType === 'IP').length} / ${filtered.filter((r) => r.billType === 'OP').length}`,
          ],
        ].map(([l, v]) => (
          <div className="metric" key={l}>
            <span className="metric-label">{l}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="form-grid">
          <label>
            Cash position as of
            <input
              type="date"
              value={asOf}
              onChange={(e) => {
                setAsOf(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            Search bill cases
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Patient reference, invoice or procedure"
            />
          </label>
          <label>
            Case hospital
            <select
              value={hospital}
              onChange={(e) => {
                setHospital(e.target.value);
                setPage(0);
              }}
            >
              <option>All</option>
              {ds.masters.hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={onlyOpen}
              onChange={(e) => {
                setOnlyOpen(e.target.checked);
                setPage(0);
              }}
            />{' '}
            Show outstanding balances only
          </span>
        </label>
        <p className="info-note">
          Each Actual IP/OP bill is a separate financial case. Invoice aging is not an assumed due
          date. Overdue requires a saved expected collection date. Cash totals use the selected
          date; workflow notes show the latest saved state.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice / patient</th>
                <th>Hospital / procedure</th>
                <th>Invoice / recognition</th>
                <th>Workflow</th>
                <th>Final share AED</th>
                <th>Collected AED</th>
                <th>Outstanding AED</th>
                <th>Invoice age</th>
                <th>Source details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(page * 50, page * 50 + 50).map((r) => (
                <tr key={r.id}>
                  <th>
                    {r.invoice}
                    <small className="block">{r.patient}</small>
                  </th>
                  <td>
                    {r.hospital}
                    <small className="block">
                      {r.procedure} · {r.billType}
                    </small>
                  </td>
                  <td>
                    {r.date}
                    <small className="block">Recognised {r.recognitionMonth}</small>
                  </td>
                  <td>
                    <span className={`badge ${r.overdue ? 'warning' : 'neutral'}`}>{r.status}</span>
                    {r.overdue && <small className="block red">Expected collection overdue</small>}
                    {r.statusWarning && <small className="block red">{r.statusWarning}</small>}
                  </td>
                  <td>{fmt(r.total)}</td>
                  <td>{fmt(r.paid)}</td>
                  <td>{fmt(r.outstanding)}</td>
                  <td>
                    {r.age} days · {r.ageBucket}
                  </td>
                  <td>
                    <button className="text-button" onClick={() => edit(r)}>
                      Open case
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && <p className="empty">No bill cases match these filters.</p>}
        <div className="button-row">
          <button className="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous cases
          </button>
          <span>
            {filtered.length} cases · page {page + 1}
          </span>
          <button
            className="outline"
            disabled={(page + 1) * 50 >= filtered.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Next cases
          </button>
        </div>
      </section>
      {selected && (
        <section className="panel">
          <h3>Case · {selected.invoice}</h3>
          <p>
            {selected.patient} · {selected.hospital} · {selected.procedure} · {selected.doctor}
          </p>
          <p>
            Swizton share AED {fmt(selected.swizton)} · {selected.payments.length} recorded
            collections · {selected.expenses.length} linked expense entries
            {selected.leadId ? ' · Completed pipeline lead linked' : ''}
          </p>
          <details>
            <summary>Linked source entries</summary>
            {selected.payments.map((p) => (
              <p key={p.id}>
                {p.kind === 'settlement' ? `${p.date} · AED ${p.amount} · ${p.reference}` : ''}
              </p>
            ))}
            {selected.expenses.map((e) => (
              <p key={e.id}>
                {e.kind === 'expense' ? `${e.date} · ${e.head} · ${e.amount} ${e.currency}` : ''}
              </p>
            ))}
            <p>
              Amounts above are original entries, not a fully allocated case profit calculation.
            </p>
          </details>
          {user.role !== 'Management' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action.act(
                  () =>
                    api(
                      `/daily/cases/${selected.id}`,
                      {
                        ...form,
                        expectedCollectionDate: form.expectedCollectionDate || undefined,
                        expectedUpdatedAt: selected.record?.updatedAt,
                        revision,
                      },
                      'PUT',
                    ),
                  'Case tracking saved without changing the bill',
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Case workflow status
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {[
                      'Documentation pending',
                      'Claim submitted',
                      'Collection follow-up',
                      'Settled',
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Hospital case reference
                  <input
                    value={form.hospitalCaseReference}
                    maxLength={160}
                    onChange={(e) => setForm({ ...form, hospitalCaseReference: e.target.value })}
                  />
                </label>
                <label>
                  Insurance authorization reference
                  <input
                    value={form.authorizationReference}
                    maxLength={160}
                    onChange={(e) => setForm({ ...form, authorizationReference: e.target.value })}
                  />
                </label>
                <label>
                  Expected collection date
                  <input
                    type="date"
                    value={form.expectedCollectionDate}
                    onChange={(e) => setForm({ ...form, expectedCollectionDate: e.target.value })}
                  />
                </label>
                <Reason value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
              </div>
              <label>
                Case notes
                <textarea
                  value={form.notes}
                  rows={3}
                  maxLength={2000}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <button className="primary" disabled={action.busy}>
                Save case tracking
              </button>
            </form>
          )}
          {user.role === 'Management' && <p>{selected.record?.notes ?? 'No case notes saved.'}</p>}
        </section>
      )}
    </>
  );
}
const baseColumns = {
  date: 'date',
  patient: 'patient',
  procedure: 'procedure',
  doctor: 'doctor',
  invoice: 'invoice',
  gross: 'gross',
  consumables: 'consumables',
  pharmacyLab: 'pharmacyLab',
};
function HospitalImports({ ds, revision, user, refresh }: Props) {
  const action = useAction(refresh),
    profiles = (ds.operations ?? []).filter(
      (o): o is HospitalProfile => o.kind === 'hospital_profile',
    ),
    [profileId, setProfileId] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [reason, setReason] = useState(''),
    [fields, setFields] = useState<string[]>([]),
    [fieldError, setFieldError] = useState(''),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState({
      name: '',
      hospital: ds.masters.hospitals[0]?.id ?? '',
      dateFormat: 'ISO',
      numberFormat: 'Plain',
      columns: baseColumns as Record<string, string>,
      defaults: JSON.stringify(
        {
          billType: 'IP',
          payment: 'Insurance',
          regime: 'Standard',
          visits: '1',
          vat: '0',
          tax: '0',
        },
        null,
        2,
      ),
      aliases: '{}',
      reason: '',
    });
  useEffect(() => {
    api('/daily/import-fields')
      .then(setFields)
      .catch((e) => setFieldError(e.message));
  }, []);
  const batches = (ds.operations ?? []).filter((o) => o.kind === 'import_batch' && o.mapping);
  return (
    <>
      <Alerts s={action} />
      {fieldError && (
        <div className="error" role="alert">
          {fieldError}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Versioned hospital import mappings</h3>
            <p>
              Map source headers explicitly. Dates and number formats are never guessed; bill
              amounts must be AED.
            </p>
          </div>
          {user.role !== 'Management' && (
            <button className="outline" onClick={() => setEditing(!editing)}>
              {editing ? 'Hide mapping editor' : 'New hospital mapping'}
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Hospital</th>
                <th>Version / formats</th>
                <th>Mappings</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <th>{p.name}</th>
                  <td>{p.hospital}</td>
                  <td>
                    v{p.version} · {p.dateFormat} · {p.numberFormat}
                  </td>
                  <td>
                    {user.role !== 'Management' && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setDraft({
                            name: p.name,
                            hospital: p.hospital,
                            dateFormat: p.dateFormat,
                            numberFormat: p.numberFormat,
                            columns: structuredClone(p.columns),
                            defaults: JSON.stringify(p.defaults, null, 2),
                            aliases: JSON.stringify(p.aliases, null, 2),
                            reason: '',
                          });
                          setEditing(true);
                        }}
                      >
                        Copy as new version
                      </button>
                    )}
                    <details>
                      <summary>Inspect source mapping</summary>
                      {Object.entries(p.columns).map(([k, v]) => (
                        <p key={k}>
                          {k} ← {v}
                        </p>
                      ))}
                      <p>Explicit defaults: {JSON.stringify(p.defaults)}</p>
                      <p>Value aliases: {JSON.stringify(p.aliases)}</p>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editing && user.role !== 'Management' && (
          <form
            className="master-form"
            onSubmit={(e) => {
              e.preventDefault();
              action.act(async () => {
                const r = await api('/daily/profiles', {
                  profile: {
                    ...draft,
                    columns: Object.fromEntries(
                      Object.entries(draft.columns).filter(([, v]) => v.trim()),
                    ),
                    defaults: JSON.parse(draft.defaults),
                    aliases: JSON.parse(draft.aliases),
                  },
                  revision,
                });
                setEditing(false);
                setProfileId(r.id);
                return r;
              }, 'Hospital mapping version saved');
            }}
          >
            <div className="form-grid">
              <label>
                Mapping name
                <input
                  required
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                Mapping hospital
                <select
                  value={draft.hospital}
                  onChange={(e) => setDraft({ ...draft, hospital: e.target.value })}
                >
                  {ds.masters.hospitals.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Source date format
                <select
                  value={draft.dateFormat}
                  onChange={(e) => setDraft({ ...draft, dateFormat: e.target.value })}
                >
                  {['ISO', 'DD/MM/YYYY', 'MM/DD/YYYY'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Source number format
                <select
                  value={draft.numberFormat}
                  onChange={(e) => setDraft({ ...draft, numberFormat: e.target.value })}
                >
                  <option>Plain</option>
                  <option>Comma thousands</option>
                </select>
              </label>
            </div>
            <h4>Canonical field → source column header</h4>
            <div className="form-grid">
              {fields.map((k) => (
                <label key={k}>
                  {k}
                  <input
                    value={draft.columns[k] ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, columns: { ...draft.columns, [k]: e.target.value } })
                    }
                    placeholder="Leave blank if not mapped"
                  />
                </label>
              ))}
            </div>
            <label>
              Explicit defaults JSON
              <textarea
                required
                rows={7}
                value={draft.defaults}
                onChange={(e) => setDraft({ ...draft, defaults: e.target.value })}
              />
            </label>
            <label>
              Value aliases JSON (optional)
              <textarea
                required
                rows={3}
                value={draft.aliases}
                onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
                placeholder={'{"payment":{"INS":"Insurance"}}'}
              />
            </label>
            <Reason value={draft.reason} onChange={(v) => setDraft({ ...draft, reason: v })} />
            <button className="primary" disabled={action.busy}>
              Save mapping version
            </button>
            <p className="info-note">
              A repeated mapping name/hospital creates another immutable version. Optional component
              fields support Al Garhoud bill components. No share percentages are imported or
              hardcoded. Explicit defaults are disclosed in each preview.
            </p>
          </form>
        )}
      </section>
      {user.role !== 'Management' && (
        <section className="panel">
          <h3>Preview mapped hospital bills</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.act(async () => {
                if (!file) throw Error('Select a bill file');
                return api('/daily/imports/preview', {
                  ...(await fileData(file)),
                  name: file.name,
                  profileId,
                  reason,
                  revision,
                });
              }, 'Mapped bill preview prepared; no ledger postings');
            }}
          >
            <div className="form-grid">
              <label>
                Hospital import profile
                <select required value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  <option value="">Select a mapping version</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.hospital} · v{p.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hospital bill file
                <input
                  required
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Reason value={reason} onChange={setReason} />
            </div>
            <button className="primary" disabled={action.busy}>
              Preview hospital import
            </button>
          </form>
        </section>
      )}
      {batches
        .slice()
        .reverse()
        .map(
          (b) =>
            b.kind === 'import_batch' && (
              <section className="panel" key={b.id}>
                <div className="panel-heading">
                  <div>
                    <h3>{b.name}</h3>
                    <p>
                      {b.mapping?.hospital} · mapping v{b.mapping?.version} · {b.status} ·{' '}
                      {b.rows.length} rows
                    </p>
                  </div>
                  <span className={`badge ${b.rows.some((r) => r.errors.length) ? 'warning' : ''}`}>
                    {b.rows.filter((r) => r.errors.length).length} invalid
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Source row</th>
                        <th>Invoice / patient</th>
                        <th>Validation</th>
                        <th>Review warnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((r) => (
                        <tr key={r.row}>
                          <td>{r.row}</td>
                          <td>
                            {r.entry?.kind === 'bill'
                              ? `${r.entry.invoice} · ${r.entry.patient}`
                              : 'Not posted'}
                          </td>
                          <td className="wrap-cell">{r.errors.join('; ') || 'Valid'}</td>
                          <td className="wrap-cell">{r.warnings?.join('; ') || 'None'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {b.status === 'Preview' && user.role !== 'Management' && (
                  <>
                    <Reason value={reason} onChange={setReason} />
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={
                          action.busy || reason.length < 8 || b.rows.some((r) => r.errors.length)
                        }
                        onClick={() =>
                          action.act(
                            () => api(`/imports/${b.id}/commit`, { reason, revision }),
                            'Mapped bills committed once',
                          )
                        }
                      >
                        Commit validated hospital bills
                      </button>
                      <button
                        className="outline"
                        disabled={action.busy || reason.length < 8}
                        onClick={() =>
                          action.act(
                            () => api(`/imports/${b.id}/cancel`, { reason, revision }),
                            'Mapped import preview cancelled',
                          )
                        }
                      >
                        Cancel mapped preview
                      </button>
                    </div>
                  </>
                )}
              </section>
            ),
        )}
    </>
  );
}
function BankMatching({ revision, user, refresh }: Props) {
  const action = useAction(refresh),
    [statements, setStatements] = useState<ReturnType<typeof bankRegister>>([]),
    [error, setError] = useState(''),
    [cash, setCash] = useState<any[]>([]),
    [cashSearch, setCashSearch] = useState(''),
    [selected, setSelected] = useState(''),
    [rowId, setRowId] = useState(''),
    [candidates, setCandidates] = useState<any[]>([]),
    [search, setSearch] = useState(''),
    [form, setForm] = useState({ account: '', reason: '' }),
    [file, setFile] = useState<File | null>(null),
    [eventId, setEventId] = useState(''),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState('');
  useEffect(() => {
    let active = true;
    api('/daily/bank')
      .then((r) => {
        if (active) {
          setStatements(r.statements);
          setCash(r.cash ?? []);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const statement = statements.find((s) => s.id === selected) ?? statements.at(-1),
    row = statement?.rows.find((r) => r.data?.id === rowId);
  useEffect(() => {
    let active = true;
    setCandidates([]);
    setEventId('');
    if (statement?.status === 'Committed' && rowId && Number(row?.remaining) > 0)
      api(
        `/daily/bank/${statement.id}/rows/${rowId}/candidates?search=${encodeURIComponent(search)}`,
      )
        .then((r) => {
          if (active) setCandidates(r.candidates);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [statement?.id, statement?.status, row?.remaining, rowId, search, revision]);
  return (
    <>
      <Alerts s={action} />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Bank statement evidence · AED</h3>
            <p>
              Import, review and allocate to recorded cash. Bank imports and matches never post P&L
              entries. Record missing collections or payments in Receivables or Planning first.
            </p>
          </div>
          <button
            className="outline"
            onClick={() =>
              action.act(
                () => download('/daily/bank/export', 'Swizton-bank-matching.xlsx'),
                'Bank matching evidence exported',
              )
            }
          >
            Export matching register
          </button>
        </div>
        <p className="info-note">
          Required CSV/XLSX headers: transactionId, date (YYYY-MM-DD), direction (In/Out), amount
          (positive AED), reference. Use a stable account alias and bank transaction ID. This is
          statement-to-record matching, not a bank connection or certified bank-balance
          reconciliation.
        </p>
        {user.role !== 'Management' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.act(async () => {
                if (!file) throw Error('Select a bank file');
                const r = await api('/daily/bank/preview', {
                  ...(await fileData(file)),
                  name: file.name,
                  ...form,
                  revision,
                });
                setSelected(r.id);
                setRowId('');
                return r;
              }, 'Bank statement preview created without cash postings');
            }}
          >
            <div className="form-grid">
              <label>
                Bank account alias
                <input
                  required
                  maxLength={100}
                  value={form.account}
                  onChange={(e) => setForm({ ...form, account: e.target.value })}
                  placeholder="Finance-approved account identifier"
                />
              </label>
              <label>
                Bank statement file
                <input
                  required
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Reason value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
            </div>
            <button className="primary" disabled={action.busy}>
              Preview bank statement
            </button>
          </form>
        )}
      </section>
      <section className="panel">
        <label>
          Imported bank statement
          <select
            value={statement?.id ?? ''}
            onChange={(e) => {
              setSelected(e.target.value);
              setRowId('');
              setSearch('');
            }}
          >
            <option value="">Select a statement</option>
            {statements.map((s) => (
              <option key={s.id} value={s.id}>
                {s.account} · {s.name} · {s.status}
              </option>
            ))}
          </select>
        </label>
        {statement && (
          <>
            <p>
              {statement.status} · {statement.rows.length} source rows ·{' '}
              {
                statement.rows.filter(
                  (r) =>
                    r.data &&
                    Number(r.remaining) === 0 &&
                    !r.allocations.some((m) => m.sourceChanged),
                ).length
              }{' '}
              fully allocated
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Row / transaction</th>
                    <th>Date / direction</th>
                    <th>Bank AED</th>
                    <th>Matched / remaining AED</th>
                    <th>Reference / errors</th>
                    <th>Review allocations</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((r) => (
                    <tr key={r.row}>
                      <th>
                        {r.row}
                        <small className="block">{r.data?.transactionId}</small>
                      </th>
                      <td>
                        {r.data?.date}
                        <small className="block">{r.data?.direction}</small>
                      </td>
                      <td>{fmt(r.data?.amount)}</td>
                      <td>
                        {fmt(r.matched)} / {fmt(r.remaining)}
                      </td>
                      <td className="wrap-cell">
                        {r.data?.reference}
                        {r.errors.join('; ')}
                      </td>
                      <td>
                        {r.allocations.some((m) => m.sourceChanged) && (
                          <p className="red">Cash source changed; review and unmatch.</p>
                        )}
                        {statement.status === 'Committed' &&
                          r.data &&
                          Number(r.remaining) > 0 &&
                          user.role !== 'Management' && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setRowId(r.data!.id);
                                setAmount(r.remaining ?? '');
                                setSearch('');
                              }}
                            >
                              Allocate bank row
                            </button>
                          )}
                        {r.allocations.map((m) => (
                          <div key={m.id}>
                            <small className="block">
                              {m.amount} AED → cash {m.eventId.slice(0, 8)}
                            </small>
                            {user.role !== 'Management' && (
                              <button
                                className="text-button red"
                                disabled={action.busy || reason.length < 8}
                                onClick={() =>
                                  action.act(
                                    () =>
                                      api(`/daily/bank/matches/${m.id}/reverse`, {
                                        reason,
                                        revision,
                                      }),
                                    'Allocation reversed; cash posting preserved',
                                  )
                                }
                              >
                                Unmatch with reason below
                              </button>
                            )}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {user.role !== 'Management' && <Reason value={reason} onChange={setReason} />}{' '}
            {statement.status === 'Committed' && user.role === 'Admin' && (
              <div className="button-row">
                <button
                  className="outline"
                  disabled={
                    action.busy ||
                    reason.length < 8 ||
                    statement.rows.some((r) => r.allocations.length > 0)
                  }
                  onClick={() =>
                    action.act(
                      () => api(`/daily/bank/${statement.id}/void`, { reason, revision }),
                      'Statement voided; original evidence and cash preserved',
                    )
                  }
                >
                  Void committed statement
                </button>
                <small>
                  Unmatch all allocations first. Voiding preserves source rows and permits a
                  reviewed replacement import.
                </small>
              </div>
            )}
            {statement.status === 'Preview' && user.role !== 'Management' && (
              <div className="button-row">
                <button
                  className="primary"
                  disabled={
                    action.busy || reason.length < 8 || statement.rows.some((r) => r.errors.length)
                  }
                  onClick={() =>
                    action.act(
                      () => api(`/daily/bank/${statement.id}/commit`, { reason, revision }),
                      'Bank statement committed; no cash postings',
                    )
                  }
                >
                  Commit bank statement
                </button>
                <button
                  className="outline"
                  disabled={action.busy || reason.length < 8}
                  onClick={() =>
                    action.act(
                      () => api(`/daily/bank/${statement.id}/cancel`, { reason, revision }),
                      'Bank preview cancelled',
                    )
                  }
                >
                  Cancel bank preview
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel">
        <h3>Recorded cash without full bank evidence</h3>
        <p>
          Organization-wide cash sources, not just the selected account. Some entries may represent
          cash on hand. This list is not an assertion that every item must appear on a bank
          statement.
        </p>
        <label>
          Search unallocated cash
          <input value={cashSearch} onChange={(e) => setCashSearch(e.target.value)} />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date / direction</th>
                <th>Source / reference</th>
                <th>Recorded AED</th>
                <th>Allocated AED</th>
                <th>Unallocated AED</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {cash
                .filter(
                  (e) =>
                    (Number(e.remaining) !== 0 || e.needsReview) &&
                    `${e.origin} ${e.reference} ${e.sourceReference} ${e.date}`
                      .toLowerCase()
                      .includes(cashSearch.toLowerCase()),
                )
                .slice(0, 100)
                .map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.date} · {e.direction}
                    </td>
                    <td>
                      {e.origin}
                      <small className="block">
                        {e.reference} · {e.sourceReference}
                      </small>
                    </td>
                    <td>{fmt(e.amount)}</td>
                    <td>{fmt(e.allocated)}</td>
                    <td>{fmt(e.remaining)}</td>
                    <td>
                      {e.needsReview ? 'Source changed; unmatch and review' : 'Awaiting evidence'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="info-note">
          Up to 100 matching cash sources are shown. Refine the search for larger ledgers.
          Allocations reserve recorded amounts until explicitly unmatched; a source change never
          silently clears the allocation history.
        </p>
      </section>
      {row?.data &&
        Number(row.remaining) > 0 &&
        statement?.status === 'Committed' &&
        user.role !== 'Management' && (
          <section className="panel">
            <h3>Allocate bank transaction · {row.data.transactionId}</h3>
            <p>
              {row.data.date} · {row.data.direction} · AED {fmt(row.data.amount)} · remaining AED{' '}
              {fmt(row.remaining)}
            </p>
            <label>
              Search recorded cash references
              <input value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action.act(
                  () =>
                    api('/daily/bank/matches', {
                      statementId: statement.id,
                      rowId,
                      eventId,
                      amount,
                      reason,
                      revision,
                    }),
                  'Bank evidence matched to recorded cash',
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Recorded cash event
                  <select required value={eventId} onChange={(e) => setEventId(e.target.value)}>
                    <option value="">Select verified recorded cash</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.date} · {c.origin} · {c.reference} · {c.sourceReference} · available AED{' '}
                        {c.remaining} · {c.daysApart} days apart
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Allocation amount AED
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
              </div>
              <p className="info-note">
                Candidates are suggestions ranked by reference, available amount and date proximity.
                Finance must verify the source. Up to 200 candidates are shown; refine the reference
                search when needed. Partial and combined allocations are supported; unmatched
                differences remain visible.
              </p>
              <button className="primary" disabled={action.busy || reason.length < 8}>
                Match recorded cash
              </button>
            </form>
          </section>
        )}
    </>
  );
}
