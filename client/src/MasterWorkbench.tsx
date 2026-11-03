import React, { useEffect, useState } from 'react';
import type { Masters } from '../../server/model';
const categories = [
  'HR Cost',
  'Marketing Expense',
  'Administration Expense',
  'Finance & Other Expense',
];
const components = [
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
type Props = {
  masters: Masters;
  readOnly?: boolean;
  save: (m: Masters, reason: string) => Promise<unknown>;
};
export function MasterWorkbench({ masters, readOnly = false, save }: Props) {
  const [draft, setDraft] = useState<Masters>(structuredClone(masters)),
    [tab, setTab] = useState<keyof Masters>('hospitals'),
    [index, setIndex] = useState(-1),
    [record, setRecord] = useState<any>({}),
    [reason, setReason] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    setDraft(structuredClone(masters));
    setIndex(-1);
    setRecord({});
  }, [masters]);
  const list = draft[tab] as any[],
    strings = ['doctors', 'procedures', 'staff'].includes(tab),
    hospitalOptions = [
      ...draft.hospitals.map((h) => h.id),
      'Admin Cost Reimbursement',
      'OP Consultation',
    ];
  const defaults = () =>
    tab === 'hospitals'
      ? { id: '', name: '', method: 'net-share' }
      : tab === 'expenseHeads'
        ? { name: '', category: categories[0], costBehavior: 'Unclassified' }
        : tab === 'fx'
          ? { month: '2026-01', inrPerAed: '', aedPerUsd: '3.6725', source: '' }
          : tab === 'targets'
            ? { month: '2026-01', cases: 0 }
            : tab === 'comparatives'
              ? { year: 2025, line: 'Swizton Revenue', aed: '', inrLakh: '' }
              : tab === 'rules'
                ? {
                    id: crypto.randomUUID(),
                    hospital: hospitalOptions[0],
                    effectiveFrom: '2026-01-01',
                    effectiveTo: null,
                    share: '0.45',
                    forecastShare: '0.45',
                    swizton: '0.3',
                    doctorPool: '0.7',
                    chinmay: '0.2',
                    chinmayEligible: false,
                    admin: '0',
                    refundable: '0',
                    components: {
                      Standard: Object.fromEntries(components.map((c) => [c, '0'])),
                      HMS: Object.fromEntries(components.map((c) => [c, '0'])),
                      'Insurance-OP': Object.fromEntries(components.map((c) => [c, '0'])),
                    },
                  }
                : { name: '' };
  const set = (k: string, v: any) => setRecord((r: any) => ({ ...r, [k]: v }));
  const input = (k: string, label: string, type = 'text') => (
    <label key={k}>
      {label}
      <input
        type={type}
        step={type === 'number' ? 'any' : undefined}
        required={k !== 'effectiveTo'}
        value={record[k] ?? ''}
        onChange={(e) =>
          set(
            k,
            type === 'number' && ['year', 'cases'].includes(k)
              ? Number(e.target.value)
              : e.target.value,
          )
        }
      />
    </label>
  );
  const select = (k: string, label: string, options: string[]) => (
    <label>
      {label}
      <select value={record[k] ?? options[0]} onChange={(e) => set(k, e.target.value)}>
        {options.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
  );
  const edit = (row: any, i: number) => {
    setIndex(i);
    setRecord(strings ? { name: row } : structuredClone(row));
    setMessage('');
  };
  function stage(e: React.FormEvent) {
    e.preventDefault();
    const next = strings
      ? record.name
      : tab === 'rules'
        ? { ...record, effectiveTo: record.effectiveTo || null }
        : record;
    const values = [...list];
    if (index >= 0) values[index] = next;
    else values.push(next);
    setDraft({ ...draft, [tab]: values });
    setIndex(-1);
    setRecord({});
    setMessage('Change staged locally. Save with a reason to apply it.');
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>Master data workbench</h3>
          <p>Form-based configuration • effective dates • monthly FX • complete change history</p>
        </div>
        <span className="badge">{readOnly ? 'Read only' : 'Admin access'}</span>
      </div>
      <div className="master-tabs">
        {Object.keys(masters).map((k) => (
          <button
            key={k}
            className={tab === k ? 'primary' : 'outline'}
            onClick={() => {
              setTab(k as keyof Masters);
              setRecord({});
              setIndex(-1);
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {(strings
                ? ['Name']
                : Object.keys(list[0] ?? defaults()).filter((k) => k !== 'components')
              ).map((k) => (
                <th key={k}>{k}</th>
              ))}
              {!readOnly && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((row, i) => (
              <tr key={i}>
                {strings ? (
                  <td>{row}</td>
                ) : (
                  Object.keys(list[0] ?? defaults())
                    .filter((k) => k !== 'components')
                    .map((k) => (
                      <td key={k}>
                        {typeof row[k] === 'boolean'
                          ? row[k]
                            ? 'Yes'
                            : 'No'
                          : String(row[k] ?? '—')}
                      </td>
                    ))
                )}
                {!readOnly && (
                  <td>
                    <button className="text-button" onClick={() => edit(row, i)}>
                      Edit
                    </button>
                    <button
                      className="text-button red"
                      onClick={() => {
                        setDraft({ ...draft, [tab]: list.filter((_, n) => n !== i) });
                        setMessage('Removal staged. Referential validation runs on save.');
                      }}
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <>
          <button
            className="outline"
            onClick={() => {
              setIndex(-1);
              setRecord(defaults());
            }}
          >
            + Add {tab === 'rules' ? 'effective rule' : tab === 'fx' ? 'monthly FX rate' : 'record'}
          </button>
          {Object.keys(record).length > 0 && (
            <form onSubmit={stage} className="master-form">
              <h4>
                {index >= 0 ? 'Edit' : 'New'} {tab}
              </h4>
              <div className="form-grid">
                {strings && input('name', 'Name')}
                {tab === 'hospitals' && (
                  <>
                    {input('id', 'Stable ID')}
                    {input('name', 'Hospital name')}
                    {select('method', 'Revenue method', ['net-share', 'components'])}
                  </>
                )}
                {tab === 'expenseHeads' && (
                  <>
                    {input('name', 'Expense head')}
                    {select('category', 'P&L category', categories)}
                    {select('costBehavior', 'Cost behaviour', [
                      'Fixed',
                      'Variable',
                      'Unclassified',
                    ])}
                  </>
                )}
                {tab === 'fx' && (
                  <>
                    {input('month', 'Reporting month', 'month')}
                    {input('inrPerAed', 'Approved INR per AED', 'number')}
                    {input('aedPerUsd', 'AED per USD', 'number')}
                    {input('source', 'RBI source / approval reference')}
                  </>
                )}
                {tab === 'targets' && (
                  <>
                    {input('month', 'Month', 'month')}
                    {input('cases', 'Case target', 'number')}
                  </>
                )}
                {tab === 'comparatives' && (
                  <>
                    {input('year', 'Financial year', 'number')}
                    {input('line', 'Exact P&L line')}
                    {input('aed', 'Historical AED total', 'number')}
                    {input('inrLakh', 'Historical INR lakh total', 'number')}
                  </>
                )}
                {tab === 'rules' && (
                  <>
                    {select('hospital', 'Hospital / income source', hospitalOptions)}
                    {input('effectiveFrom', 'Effective from', 'date')}
                    {input('effectiveTo', 'Effective to (optional)', 'date')}
                    {[
                      'share',
                      'forecastShare',
                      'swizton',
                      'doctorPool',
                      'chinmay',
                      'admin',
                      'refundable',
                    ].map((k) => input(k, `${k} · fraction 0–1`, 'number'))}
                    <label>
                      Chinmay eligible
                      <select
                        value={String(record.chinmayEligible)}
                        onChange={(e) => set('chinmayEligible', e.target.value === 'true')}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              {tab === 'rules' && (
                <>
                  <h4>Component fees by regime · fractions 0–1</h4>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Component</th>
                          {['Standard', 'HMS', 'Insurance-OP'].map((reg) => (
                            <th key={reg}>{reg}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {components.map((c) => (
                          <tr key={c}>
                            <th>{c}</th>
                            {['Standard', 'HMS', 'Insurance-OP'].map((reg) => (
                              <td key={reg}>
                                <input
                                  aria-label={`${reg} ${c} rate`}
                                  type="number"
                                  min="0"
                                  max="1"
                                  step="0.001"
                                  value={record.components?.[reg]?.[c] ?? '0'}
                                  onChange={(e) =>
                                    setRecord((r: any) => ({
                                      ...r,
                                      components: {
                                        ...r.components,
                                        [reg]: { ...r.components?.[reg], [c]: e.target.value },
                                      },
                                    }))
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <button className="primary">Stage this change</button>
              <button type="button" className="ghost" onClick={() => setRecord({})}>
                Cancel edit
              </button>
            </form>
          )}
          <form
            className="reason-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await save(draft, reason);
                setMessage('Master changes submitted. Check the save result above.');
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            <label>
              Approval / change reason
              <input
                minLength={8}
                maxLength={1000}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Include the source or Finance approval reference"
              />
            </label>
            <div className="button-row">
              <button className="primary">Save master changes</button>
              <button
                type="button"
                className="outline"
                onClick={() => {
                  setDraft(structuredClone(masters));
                  setRecord({});
                  setMessage('Local changes discarded');
                }}
              >
                Discard local changes
              </button>
            </div>
          </form>
        </>
      )}
      {message && (
        <p role="status" className="info-note">
          {message}
        </p>
      )}
      <p className="info-note">
        Rates shown in a new form are suggestions only. Finance must approve source rates before
        saving. Future master additions are allowed after close only when locked calculations and
        source shares remain identical.
      </p>
    </section>
  );
}
