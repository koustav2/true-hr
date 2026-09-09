'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Field, Spinner, Empty, Badge, PageHeader, SearchPicker } from '@/components/ui.jsx';

const CALCS = [
  { key: 'PCT_CTC', label: '% of monthly CTC', unit: '%' },
  { key: 'PCT_OF', label: '% of another component', unit: '%' },
  { key: 'FLAT', label: 'Fixed rupees', unit: '₹' },
  { key: 'BALANCE', label: 'Balance of CTC', unit: '' },
];
const STATUTORY = ['', 'PF', 'PT', 'WELFARE', 'ESIC', 'TDS'];
const unitOf = (calc) => CALCS.find((c) => c.key === calc)?.unit || '';
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** Mirror of the server engine, so the preview matches the payslip. */
function preview(components, ctc) {
  const r2 = (n) => Math.round(Number(n) || 0);
  const earn = components.filter((c) => c.kind === 'EARNING' && c.active !== false);
  const ded = components.filter((c) => c.kind === 'DEDUCTION' && c.active !== false);
  const full = {};
  const named = earn.filter((c) => c.calc !== 'BALANCE');
  for (const c of named) {
    if (c.calc === 'PCT_CTC') full[c.code] = (ctc * Number(c.value)) / 100;
    else if (c.calc === 'FLAT') full[c.code] = Number(c.value);
  }
  for (const c of named) {
    if (c.calc === 'PCT_OF') full[c.code] = ((Number(full[c.basisCode]) || 0) * Number(c.value)) / 100;
  }
  const namedTotal = named.reduce((a, c) => a + (Number(full[c.code]) || 0), 0);
  for (const c of earn) if (c.calc === 'BALANCE') full[c.code] = Math.max(0, ctc - namedTotal);
  const earnings = earn.map((c) => ({ label: c.label || c.code, amount: r2(full[c.code] || 0) }));
  const finalEarn = Object.fromEntries(earn.map((c, i) => [c.code, earnings[i].amount]));
  const deductions = ded.map((c) => {
    let a = 0;
    if (c.calc === 'FLAT') a = Number(c.value);
    else if (c.calc === 'PCT_CTC') a = (ctc * Number(c.value)) / 100;
    else if (c.calc === 'PCT_OF') a = ((Number(finalEarn[c.basisCode]) || 0) * Number(c.value)) / 100;
    return { label: c.label || c.code, amount: r2(a) };
  });
  const gross = earnings.reduce((a, e) => a + e.amount, 0);
  const total = deductions.reduce((a, d) => a + d.amount, 0);
  return { earnings, deductions, gross, total, net: gross - total };
}

const blank = (kind) => ({
  id: null, code: '', label: '', kind, calc: kind === 'EARNING' ? 'FLAT' : 'FLAT',
  basisCode: null, value: 0, prorate: kind === 'EARNING', taxable: kind === 'EARNING',
  statutory: null, perEmployee: true, active: true,
});

export default function SalaryComponentsPage() {
  const [companies, setCompanies] = useState(null);
  const [companyId, setCompanyId] = useState('');
  const [saved, setSaved] = useState(null);
  const [rows, setRows] = useState([]);
  const [ctc, setCtc] = useState(50000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('company');

  // /meta/companies, not /admin/companies: the latter needs the COMPANIES
  // module, which HR deliberately does not have — asking for it left this page
  // spinning forever with no company id to load. /meta/companies is the
  // organisation-scoped lookup every staff role can read.
  useEffect(() => {
    api.get('/meta/companies').then((r) => {
      const list = Array.isArray(r) ? r : [];
      setCompanies(list);
      if (list[0]) setCompanyId(String(list[0].id));
      else setErr('No company is set up for this organisation yet — add one before defining components.');
    }).catch((e) => { setCompanies([]); setErr(e.message); });
  }, []);

  const load = (id) => {
    setSaved(null); setErr(''); setMsg('');
    api.get(`/admin/companies/${id}/salary-components`)
      .then((d) => { setSaved(d); setRows(d.components.map((c) => ({ ...c }))); })
      .catch((e) => { setErr(e.message); setSaved({ components: [] }); });
  };
  useEffect(() => { if (companyId) load(companyId); /* eslint-disable-next-line */ }, [companyId]);

  const key = (list) => JSON.stringify(list.map((c) => [c.id ?? null, c.code, c.label, c.kind, c.calc, c.basisCode || '', Number(c.value), c.prorate, c.taxable, c.statutory || '', c.perEmployee, c.active]));
  const dirty = useMemo(() => (saved ? key(saved.components) !== key(rows) : false), [saved, rows]);
  const earningCodes = useMemo(() => rows.filter((c) => c.kind === 'EARNING' && c.calc !== 'PCT_OF' && c.calc !== 'BALANCE').map((c) => c.code).filter(Boolean), [rows]);
  const pv = useMemo(() => preview(rows, Number(ctc) || 0), [rows, ctc]);

  const setRow = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => setRows((r) => {
    const n = [...r]; const j = i + d;
    if (j < 0 || j >= n.length || n[j].kind !== n[i].kind) return r;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.put(`/admin/companies/${companyId}/salary-components`, {
        components: rows.map((c, i) => ({ ...c, sortOrder: (i + 1) * 10 })),
      });
      setSaved(d); setRows(d.components.map((c) => ({ ...c })));
      setMsg('Components saved. Payslips generated from now on use them; already-generated slips keep their own lines.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const group = (kind) => rows.map((c, i) => ({ c, i })).filter((x) => x.c.kind === kind);

  const Table = ({ kind, title, note }) => {
    const list = group(kind);
    return (
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-canvas">
          <div>
            <div className="text-[12.5px] font-semibold text-ink-soft">{title}</div>
            <div className="text-[11.5px] text-ink-faint">{note}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRows((r) => [...r, blank(kind)])}>Add a line</Button>
        </div>
        {list.length === 0 ? <Empty title={`No ${kind.toLowerCase()} lines`} /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left w-32">Code</th>
                  <th className="text-left">Payslip label</th>
                  <th className="text-left w-48">How it is worked out</th>
                  <th className="text-left w-32">Of</th>
                  <th className="num w-28">Value</th>
                  <th className="text-left w-36">Flags</th>
                  <th className="text-right w-36"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map(({ c, i }) => (
                  <tr key={c.id ?? `new-${i}`} className={c.active === false ? 'opacity-50' : ''}>
                    <td className="px-4">
                      <Input value={c.code} onChange={(e) => setRow(i, { code: e.target.value.toUpperCase() })}
                        placeholder="CONVEY" className="font-mono" />
                    </td>
                    <td className="px-4">
                      <Input value={c.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="Conveyance" />
                    </td>
                    <td className="px-4">
                      <Select value={c.calc} onChange={(e) => setRow(i, {
                        calc: e.target.value,
                        basisCode: e.target.value === 'PCT_OF' ? (c.basisCode || earningCodes[0] || null) : null,
                        value: e.target.value === 'BALANCE' ? 0 : c.value,
                      })}>
                        {CALCS.filter((x) => kind === 'EARNING' || x.key !== 'BALANCE')
                          .map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </Select>
                    </td>
                    <td className="px-4">
                      {c.calc === 'PCT_OF' ? (
                        <Select value={c.basisCode || ''} onChange={(e) => setRow(i, { basisCode: e.target.value })}>
                          <option value="">— pick —</option>
                          {earningCodes.map((code) => <option key={code} value={code}>{code}</option>)}
                        </Select>
                      ) : <span className="text-ink-faint text-[12px]">—</span>}
                    </td>
                    <td className="num px-4">
                      {c.calc === 'BALANCE' ? <span className="text-ink-faint text-[12px]">auto</span> : (
                        <div className="flex items-center gap-1 justify-end">
                          <Input type="number" step="0.01" min="0" value={c.value}
                            onChange={(e) => setRow(i, { value: e.target.value })} className="w-24 text-right" />
                          <span className="text-ink-faint text-[12px] w-3">{unitOf(c.calc)}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4">
                      <div className="flex flex-col gap-1 text-[11.5px] text-ink-soft">
                        <label className="inline-flex items-center gap-1.5">
                          <input type="checkbox" checked={c.prorate !== false} onChange={(e) => setRow(i, { prorate: e.target.checked })} />
                          Prorates
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                          <input type="checkbox" checked={c.perEmployee !== false} disabled={c.calc === 'BALANCE'}
                            onChange={(e) => setRow(i, { perEmployee: e.target.checked })} />
                          Per employee
                        </label>
                        <Select value={c.statutory || ''} onChange={(e) => setRow(i, { statutory: e.target.value || null })}
                          className="!py-1 !text-[11.5px]">
                          {STATUTORY.map((k) => <option key={k || 'none'} value={k}>{k ? `Tag: ${k}` : 'No statutory tag'}</option>)}
                        </Select>
                      </div>
                    </td>
                    <td className="px-4 text-right whitespace-nowrap align-top pt-3">
                      <button onClick={() => move(i, -1)} className="text-brand-600 text-[12px] font-semibold hover:underline mr-2">Up</button>
                      <button onClick={() => move(i, 1)} className="text-brand-600 text-[12px] font-semibold hover:underline mr-2">Down</button>
                      <button onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                        className="text-neg text-[12px] font-semibold hover:underline">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payslip components"
        subtitle="What each company's payslip is made of. One client can run Basic / HRA / Conveyance / Food coupons and another Basic / HRA / Special with no LTA — same engine, different rows."
        action={
          <div className="flex items-end gap-2.5">
            {companies && companies.length > 1 && (
              <Field label="Company">
                <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            <Button disabled={busy || !dirty} onClick={save}>{busy ? <Spinner /> : 'Save components'}</Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {[['company', 'Company set'], ['employee', 'Per-employee overrides']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              tab === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-soft hover:border-slate-400'}`}>
            {label}
          </button>
        ))}
        {dirty && <span className="ml-1 self-center"><Badge tone="warn">Unsaved changes</Badge></span>}
      </div>

      {err && <p className="text-sm text-neg">{err}</p>}
      {msg && <p className="text-sm text-pos">{msg}</p>}

      {!companyId ? (
        <Card><Empty title="No company yet"
          subtitle="Payslip components belong to a company. Add one on the Companies screen first." /></Card>
      ) : saved === null ? <Card><div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div></Card>
        : tab === 'company' ? (
        <>
          <Table kind="EARNING" title="Earnings"
            note="One line must be “Balance of CTC” so gross always reconciles to the CTC." />
          <Table kind="DEDUCTION" title="Deductions"
            note="A deduction that is a % of a component reads the amount actually paid — PF on prorated Basic." />

          <section>
            <h2 className="mb-2.5">Preview</h2>
            <Card className="p-4">
              <div className="flex items-end gap-3 mb-3.5">
                <Field label="Try a monthly CTC">
                  <Input type="number" min="0" step="1000" value={ctc} onChange={(e) => setCtc(e.target.value)} className="w-40" />
                </Field>
                <p className="text-[11.5px] text-ink-faint mb-2.5">
                  Full month, no arrears or TDS. Computed by the same rules the payroll run uses.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint mb-1.5">Earnings</div>
                  {pv.earnings.map((e, i) => (
                    <div key={i} className="flex justify-between border-b border-line py-1.5 text-[13px]">
                      <span className="text-ink-soft">{e.label}</span><span className="text-ink tabular-nums">{inr(e.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1.5 text-[13px] font-semibold">
                    <span>Gross</span><span className="tabular-nums">{inr(pv.gross)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint mb-1.5">Deductions</div>
                  {pv.deductions.map((d, i) => (
                    <div key={i} className="flex justify-between border-b border-line py-1.5 text-[13px]">
                      <span className="text-ink-soft">{d.label}</span><span className="text-ink tabular-nums">{inr(d.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1.5 text-[13px] font-semibold">
                    <span>Net pay</span><span className="tabular-nums text-pos">{inr(pv.net)}</span>
                  </div>
                </div>
              </div>
              {Math.abs(pv.gross - Number(ctc)) > 2 && (
                <p className="text-[12.5px] text-crit mt-3">
                  Gross is {inr(pv.gross)} against a CTC of {inr(Number(ctc))}. Unless that is deliberate, add or fix a
                  balancing line so the two agree.
                </p>
              )}
            </Card>
          </section>
        </>
      ) : <EmployeeOverrides companyId={companyId} />}
    </div>
  );
}

/**
 * Per-employee overrides. A blank field means "inherit the company value" —
 * that is also how you take an override back off, so the empty state has to
 * mean something rather than being treated as zero.
 */
function EmployeeOverrides({ companyId }) {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/employees').then((r) => setEmployees(Array.isArray(r) ? r : [])).catch(() => setEmployees([]));
  }, []);

  const options = useMemo(() => employees.map((e) => ({
    id: e.id,
    label: `${e.first_name || ''} ${e.last_name || ''}`.trim() + (e.employee_code ? ` · ${e.employee_code}` : ''),
  })), [employees]);

  const load = (id) => {
    setData(null); setEdits({}); setErr(''); setMsg('');
    api.get(`/admin/employees/${id}/salary-components`).then(setData).catch((e) => { setErr(e.message); setData(false); });
  };
  useEffect(() => { if (employeeId) load(employeeId); /* eslint-disable-next-line */ }, [employeeId, companyId]);

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.put(`/admin/employees/${employeeId}/salary-components`, { values: edits });
      setData(d); setEdits({});
      setMsg('Saved. Regenerate this month’s payslip to see it applied.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const dirty = Object.keys(edits).length > 0;

  return (
    <>
      <Card className="p-3.5">
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-[280px]">
            <Field label="Employee" hint="Only components their company runs are shown.">
              <SearchPicker value={employeeId} onChange={setEmployeeId} options={options} getLabel={(o) => o.label} />
            </Field>
          </div>
          <Button disabled={!dirty || busy} onClick={save}>{busy ? <Spinner /> : 'Save overrides'}</Button>
          {dirty && <span className="mb-2"><Badge tone="warn">Unsaved</Badge></span>}
        </div>
      </Card>

      {err && <p className="text-sm text-neg">{err}</p>}
      {msg && <p className="text-sm text-pos">{msg}</p>}

      {!employeeId ? (
        <Card><Empty title="Pick an employee"
          subtitle="Their salary structure inherits the company component values until you set one here." /></Card>
      ) : data === null ? (
        <Card><div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div></Card>
      ) : data === false ? null : (
        <Card className="overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line bg-canvas text-[12.5px] text-ink-soft">
            <b className="text-ink">{data.employee.name}</b>
            <span className="font-mono text-[11.5px] text-ink-faint ml-2">{data.employee.code || '—'}</span>
            <span className="ml-3">Monthly CTC {inr(data.monthlyCtc)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Component</th>
                  <th className="text-left w-40">Basis</th>
                  <th className="num w-32">Company value</th>
                  <th className="num w-44">This employee</th>
                  <th className="text-left w-28">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.components.map((c) => {
                  const editable = c.perEmployee && c.calc !== 'BALANCE';
                  const pending = Object.prototype.hasOwnProperty.call(edits, c.code);
                  const shown = pending ? edits[c.code] : (c.employeeValue ?? '');
                  return (
                    <tr key={c.id}>
                      <td className="px-4">
                        <div className="text-ink font-medium">{c.label}</div>
                        <div className="text-[11.5px] text-ink-faint font-mono">
                          {c.code} · {c.kind === 'EARNING' ? 'earning' : 'deduction'}
                        </div>
                      </td>
                      <td className="px-4 text-[12.5px] text-ink-soft">
                        {CALCS.find((x) => x.key === c.calc)?.label}
                        {c.basisCode && <span className="font-mono text-[11.5px] text-ink-faint"> ({c.basisCode})</span>}
                      </td>
                      <td className="num px-4 tabular-nums text-ink-soft">
                        {c.calc === 'BALANCE' ? '—' : `${c.value}${unitOf(c.calc)}`}
                      </td>
                      <td className="num px-4">
                        {editable ? (
                          <div className="flex items-center gap-1 justify-end">
                            <Input type="number" step="0.01" min="0" value={shown}
                              placeholder="inherit"
                              onChange={(e) => setEdits((s) => ({ ...s, [c.code]: e.target.value === '' ? null : e.target.value }))}
                              className="w-28 text-right" />
                            <span className="text-ink-faint text-[12px] w-3">{unitOf(c.calc)}</span>
                          </div>
                        ) : <span className="text-ink-faint text-[12px]">fixed for the company</span>}
                      </td>
                      <td className="px-4">
                        {pending ? <Badge tone="warn">pending</Badge>
                          : c.employeeValue != null ? <Badge tone="brand">overridden</Badge>
                          : <span className="text-ink-faint text-[12px]">inherits</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-line text-[11.5px] text-ink-faint">
            Clear a field and save to drop the override — the employee goes back to the company value, and a later
            change to that value reaches them again.
          </div>
        </Card>
      )}
    </>
  );
}
