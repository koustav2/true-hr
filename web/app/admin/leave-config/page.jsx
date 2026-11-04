'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { fmtDate, todayIso, label } from '@/lib/labels.js';
import { validator, INDIAN_STATES } from '@/lib/validate.js';
import {
  Card, Button, Input, Select, Spinner, Badge, Modal, Field, Empty, ErrorSummary, useConfirm,
} from '@/components/ui.jsx';

const TABS = ['Holidays', 'State-wise quota', 'Leave Types', 'Policy'];

export default function LeaveConfigPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-ink">Leave Configuration</h1>
        <p className="text-ink-faint text-sm mt-0.5">
          Your organisation&rsquo;s holidays, leave types and quotas. Nothing here is shared with any other organisation.
        </p>
      </div>
      <div className="flex gap-1.5 border-b border-line overflow-x-auto">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 0 && <Holidays />}
      {tab === 1 && <StateQuotas />}
      {tab === 2 && <LeaveTypes />}
      {tab === 3 && <Policy />}
    </div>
  );
}

/* ---------------- Holidays ---------------- */
const KIND_LABEL = { PUBLIC: 'Holiday', RESTRICTED: 'Restricted holiday (RH)' };
const BLANK_H = { date: '', name: '', state: '', location: '', kind: 'PUBLIC' };

function Holidays() {
  const thisYear = Number(todayIso().slice(0, 4));
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState({ states: INDIAN_STATES, locations: [] });
  const [year, setYear] = useState(String(thisYear));
  const [f, setF] = useState(BLANK_H);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmUi] = useConfirm();

  const load = () => api.get(`/admin/holidays${year ? `?year=${year}` : ''}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/admin/holidays/meta').then(setMeta).catch(() => {}); }, []);

  const minDate = `${thisYear - 1}-01-01`;
  const maxDate = `${thisYear + 2}-12-31`;

  function check() {
    const v = validator();
    v.date('date', f.date, 'Date', { required: true, min: minDate, max: maxDate,
      minMsg: `Date must be in ${thisYear - 1} or later`, maxMsg: `Date must be no later than 31-12-${thisYear + 2}` });
    v.text('name', f.name, 'Occasion', { required: true, min: 2, max: 100 });
    if (f.location) v.text('location', f.location, 'Office location', { max: 80 });
    return v.fields;
  }

  async function save() {
    const errs = check();
    setErrors(errs); setMsg('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { date: f.date, occasion: f.name.trim(), state: f.state || null, location: f.location.trim() || null, kind: f.kind };
    try {
      if (editing) await api.put(`/admin/holidays/${editing}`, body);
      else await api.post('/admin/holidays', body);
      setMsg(editing ? 'Holiday updated.' : 'Holiday added.');
      setF(BLANK_H); setEditing(null);
      await load();
    } catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); }
    finally { setBusy(false); }
  }

  function edit(h) {
    setEditing(h.id); setErrors({}); setMsg('');
    setF({ date: h.date, name: h.name, state: h.state || '', location: h.location || '', kind: h.kind || 'PUBLIC' });
  }

  async function remove(h) {
    const ok = await confirm({
      title: 'Delete holiday?', tone: 'danger', confirmLabel: 'Delete',
      body: `${h.name} on ${fmtDate(h.date)} will be removed from every employee's calendar and leave counts.`,
    });
    if (!ok) return;
    try { await api.del(`/admin/holidays/${h.id}`); setMsg('Holiday deleted.'); if (editing === h.id) { setEditing(null); setF(BLANK_H); } load(); }
    catch (e) { setMsg(e.message); }
  }

  const scope = (h) => [h.state || 'National (all states)', h.location ? `${h.location} office` : null].filter(Boolean).join(' · ');

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
      {confirmUi}
      <Card className="p-5">
        <h2 className="font-semibold text-ink mb-3">{editing ? 'Edit holiday' : 'Add holiday'}</h2>
        <div className="space-y-3">
          <Field label="Date" required error={errors.date}>
            <Input type="date" min={minDate} max={maxDate} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Occasion" required error={errors.name}>
            <Input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Independence Day" />
          </Field>
          <Field label="Type" error={errors.kind} hint="A restricted holiday is optional: employees take it as Restricted Holiday (RH) leave.">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Applies to state" error={errors.state}>
            <Select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
              <option value="">National (all states)</option>
              {(meta.states || INDIAN_STATES).map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Office location (optional)" error={errors.location} hint="Only employees whose office location matches get this holiday.">
            <Input list="holiday-locations" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="All locations" />
            <datalist id="holiday-locations">{(meta.locations || []).map((l) => <option key={l} value={l} />)}</datalist>
          </Field>
          {msg && <p className={`text-sm ${/added|updated|deleted/.test(msg) ? 'text-pos' : 'text-neg'}`}>{msg}</p>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy} className="flex-1">{busy ? <Spinner /> : editing ? 'Save changes' : 'Add holiday'}</Button>
            {editing && <Button variant="outline" onClick={() => { setEditing(null); setF(BLANK_H); setErrors({}); }}>Cancel</Button>}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line">
          <span className="text-sm font-semibold text-ink">Holiday list</span>
          <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-32">
            <option value="">All years</option>
            {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <Empty title={year ? `No holidays in ${year}` : 'No holidays yet'} subtitle="Add your organisation's holidays on the left." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Date</th>
                  <th className="text-left px-5 py-3 font-medium">Occasion</th>
                  <th className="text-left px-5 py-3 font-medium">Type</th>
                  <th className="text-left px-5 py-3 font-medium">Applies to</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((h) => (
                  <tr key={h.id} className={`hover:bg-slate-50/70 ${editing === h.id ? 'bg-brand-50/50' : ''}`}>
                    <td className="px-5 py-3 whitespace-nowrap text-ink">{fmtDate(h.date)}</td>
                    <td className="px-5 py-3 text-ink">{h.name}</td>
                    <td className="px-5 py-3">{h.kind === 'RESTRICTED' ? <Badge tone="grape">RH</Badge> : <Badge tone="info">Holiday</Badge>}</td>
                    <td className="px-5 py-3 text-ink-soft">{scope(h)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {h.editable ? (
                        <div className="flex justify-end gap-3">
                          <button onClick={() => edit(h)} className="text-brand-700 text-xs font-medium hover:underline">Edit</button>
                          <button onClick={() => remove(h)} className="text-rose-600 text-xs font-medium hover:underline">Delete</button>
                        </div>
                      ) : <span className="text-[11px] text-ink-faint">Platform holiday</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- State-wise quota ---------------- */
function StateQuotas() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');

  const load = () => api.get('/admin/leave-states').then((d) => {
    setData(d);
    const m = {};
    d.states.forEach((s) => { m[s.state] = Object.fromEntries(d.types.map((t) => [t.code, s.overrides[t.code] ?? ''])); });
    setDraft(m);
  }).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  async function save(state) {
    const v = validator();
    for (const t of data.types) {
      const val = draft[state][t.code];
      if (val !== '' && val !== null) v.number(`${state}.${t.code}`, val, `${t.name} for ${state}`, { min: 0, max: 366 });
    }
    setErrors(v.fields); setMsg('');
    if (!v.ok) return;
    setSaving(state);
    try {
      await api.put('/admin/leave-states', {
        state, quotas: Object.fromEntries(data.types.map((t) => [t.code, draft[state][t.code] === '' ? null : Number(draft[state][t.code])])),
      });
      setMsg(`${state} saved. Balances of employees in ${state} were updated.`);
      await load();
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.fields || {}).map(([k, m]) => [`${state}.${k}`, m])));
      setMsg(e.fields ? '' : e.message);
    } finally { setSaving(null); }
  }

  const shown = useMemo(() => (data?.states || []).filter((s) => !q.trim() || s.state.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);
  if (!data) return msg ? <p className="text-sm text-neg">{msg}</p> : <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;

  return (
    <div className="space-y-4">
      <Card className="p-4 text-[13px] text-ink-soft space-y-1">
        <div className="font-semibold text-ink">Which quota applies?</div>
        <ol className="list-decimal pl-5 space-y-0.5">
          <li>The <b>Leave Types</b> annual quota is the default for everyone.</li>
          <li>A figure entered here for a state <b>overrides</b> it for employees whose posting / address state is that state. Leave a box blank to use the default.</li>
          <li>Someone who joins during the year gets it <b>prorated</b> from the date of joining (the joining month counts if they joined by the 15th).</li>
        </ol>
        <p className="text-[12px] text-ink-faint">The grey figure under a box is the statutory minimum on record for that state, for reference only.</p>
      </Card>
      <ErrorSummary errors={errors} />
      {msg && <p className="text-[13px] text-pos">{msg}</p>}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search state" className="w-64" />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
            <tr>
              <th className="text-left px-4 py-3 font-medium">State</th>
              {data.types.map((t) => (
                <th key={t.code} className="text-left px-2 py-3 font-medium whitespace-nowrap">
                  {t.name}<div className="text-[11px] font-normal">default {t.annualQuota} days/year</div>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.length === 0 && <tr><td colSpan={data.types.length + 2}><Empty title="No state matches your search" /></td></tr>}
            {shown.map((s) => (
              <tr key={s.state} className="hover:bg-slate-50/40">
                <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap">
                  {s.state}
                  {Object.keys(s.overrides).length > 0 && <Badge tone="brand" className="ml-1.5">override</Badge>}
                </td>
                {data.types.map((t) => (
                  <td key={t.code} className="px-2 py-2 align-top">
                    <Input type="number" min="0" max="366" step="0.5" value={draft[s.state]?.[t.code] ?? ''}
                      placeholder={String(t.annualQuota)} className="w-20"
                      onChange={(e) => setDraft((d) => ({ ...d, [s.state]: { ...d[s.state], [t.code]: e.target.value } }))} />
                    {s.statutory && s.statutory[t.code] != null && (
                      <div className="text-[10.5px] text-ink-faint mt-0.5">statutory {s.statutory[t.code]}</div>
                    )}
                    {errors[`${s.state}.${t.code}`] && <div className="text-[11px] text-neg mt-0.5">{errors[`${s.state}.${t.code}`]}</div>}
                  </td>
                ))}
                <td className="px-4 py-2.5 align-top">
                  <Button size="sm" variant="soft" onClick={() => save(s.state)} disabled={saving === s.state}>
                    {saving === s.state ? <Spinner /> : 'Save'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ---------------- Leave Types ---------------- */
//
// These belong to the organisation, not the deployment. "Retire" rather than
// "delete" whenever a type has been allocated or applied for — the server
// decides which of the two happened and says so.

const BLANK = {
  code: '', name: '', annualQuota: 0, requiresBalance: true, allowHalfDay: false, singleDate: false,
  allowCertificate: false, eligibility: 'ALL', certificateAfterDays: '',
};
const FLAGS = [
  ['requiresBalance', 'Deducts balance'],
  ['allowHalfDay', 'Half day allowed'],
  ['singleDate', 'Single date only'],
  ['allowCertificate', 'Certificate upload'],
];
const ELIG = { ALL: 'Everyone', FEMALE: 'Female only', MALE: 'Male only' };

function checkType(t, prefix = '') {
  const v = validator();
  v.text(`${prefix}name`, t.name, 'Name', { required: true, min: 2, max: 60 });
  v.number(`${prefix}annualQuota`, t.annualQuota, 'Annual quota', { min: 0, max: 366 });
  if (t.certificateAfterDays !== '' && t.certificateAfterDays !== null && t.certificateAfterDays !== undefined) {
    v.number(`${prefix}certificateAfterDays`, t.certificateAfterDays, 'Certificate needed after', { min: 0, max: 366 });
  }
  return v.fields;
}

function LeaveTypes() {
  const [rows, setRows] = useState(null);
  const [saving, setSaving] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState([{ ...BLANK }]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [errors, setErrors] = useState({});
  const [addErrors, setAddErrors] = useState({});
  const [confirm, confirmUi] = useConfirm();

  const load = () => api.get('/admin/leave-types').then((rs) => setRows(rs.map((r) => ({
    ...r, certificateAfterDays: r.certificateAfterDays ?? '', eligibility: r.eligibility || 'ALL',
  })))).catch((e) => { setErr(e.message); setRows([]); });
  useEffect(() => { load(); }, []);

  const setField = (idx, k, v) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, [k]: v } : r)));
  const setDraftField = (idx, k, v) => setDraft((ds) => ds.map((d, i) => (i === idx ? { ...d, [k]: v } : d)));

  async function save(r) {
    const fe = checkType(r, `${r.code}.`);
    setErrors(fe); setErr(''); setMsg('');
    if (Object.keys(fe).length) return;
    setSaving(r.code);
    try {
      await api.put(`/admin/leave-types/${r.code}`, {
        name: r.name.trim(), annualQuota: Number(r.annualQuota), requiresBalance: r.requiresBalance,
        allowHalfDay: r.allowHalfDay, singleDate: r.singleDate, allowCertificate: r.allowCertificate,
        eligibility: r.eligibility, certificateAfterDays: r.certificateAfterDays === '' ? null : Number(r.certificateAfterDays),
      });
      setMsg(`${r.name} saved. System-allocated balances follow the new settings.`);
      await load();
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.fields || {}).map(([k, m]) => [`${r.code}.${k}`, m])));
      setErr(e.fields ? '' : e.message);
    } finally { setSaving(null); }
  }

  async function setActive(r, active) {
    if (!active && !(await confirm({ title: `Retire ${r.name}?`, tone: 'danger', confirmLabel: 'Retire', body: 'Nobody will be able to apply for it. Past records stay intact and you can reactivate it later.' }))) return;
    setSaving(r.code); setErr(''); setMsg('');
    try {
      await api.put(`/admin/leave-types/${r.code}`, { active });
      setMsg(active ? `${r.name} is available again.` : `${r.name} retired.`);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(null); }
  }

  async function remove(r) {
    const ok = await confirm({
      title: `${r.inUse ? 'Retire' : 'Delete'} ${r.name}?`, tone: 'danger', confirmLabel: r.inUse ? 'Retire' : 'Delete',
      body: r.inUse ? 'It is in use, so it will be retired: nobody can apply for it any more and past records stay intact.' : 'It has never been used and will be removed.',
    });
    if (!ok) return;
    setSaving(r.code); setErr(''); setMsg('');
    try {
      const res = await api.del(`/admin/leave-types/${r.code}`);
      setMsg(res.message || 'Done.');
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(null); }
  }

  async function addAll() {
    const filled = draft.filter((d) => d.code.trim() || d.name.trim());
    if (!filled.length) { setAddErrors({ _: 'Fill in at least one row' }); return; }
    const fe = {};
    filled.forEach((d, i) => {
      if (!/^[A-Z][A-Z0-9_]{0,9}$/.test(d.code.trim())) fe[`${i}.code`] = `Row ${i + 1}: code must be 1–10 characters, start with a letter, using A–Z, 0–9 and _`;
      Object.entries(checkType(d, `${i}.`)).forEach(([k, m]) => { fe[k] = `Row ${i + 1}: ${m}`; });
    });
    setAddErrors(fe);
    if (Object.keys(fe).length) return;
    setSaving('__add'); setErr(''); setMsg('');
    try {
      const res = await api.post('/admin/leave-types/bulk', {
        types: filled.map((d) => ({ ...d, certificateAfterDays: d.certificateAfterDays === '' ? null : Number(d.certificateAfterDays) })),
      });
      setMsg(`${res.added} leave ${res.added === 1 ? 'type' : 'types'} added.`);
      setDraft([{ ...BLANK }]);
      setAdding(false);
      setAddErrors({});
      await load();
    } catch (e) { setAddErrors(e.fields || { _: e.message }); }
    finally { setSaving(null); }
  }

  if (rows === null) return <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;

  return (
    <div className="space-y-3">
      {confirmUi}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] text-ink-faint max-w-2xl">
          The annual quota here is the default every employee gets (a State-wise quota can override it for one state).
          Eligibility limits a type to one gender; a certificate becomes mandatory when a request is longer than
          &ldquo;Certificate needed after&rdquo; days (0 = always, blank = optional upload).
        </p>
        <Button size="sm" onClick={() => { setAdding(true); setAddErrors({}); }}>Add leave types</Button>
      </div>

      {msg && <p className="text-[13px] text-pos">{msg}</p>}
      {err && <p className="text-[13px] text-neg">{err}</p>}
      <ErrorSummary errors={errors} />

      {rows.length === 0 ? (
        <Card><Empty title="No leave types yet" subtitle="Add the ones your organisation grants — EL, CL, SL and anything else." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>
                {['Code', 'Name', 'Annual quota (days)', 'Eligibility', ...FLAGS.map((x) => x[1]), 'Certificate needed after (days)', 'In use', ''].map((h) => (
                  <th key={h} className="text-left px-3 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={r.code} className={`hover:bg-slate-50/40 ${r.active === false ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2.5 font-semibold text-ink whitespace-nowrap">
                    {r.code}
                    {r.active === false && <Badge tone="neutral" className="ml-1.5">retired</Badge>}
                  </td>
                  <td className="px-2 py-2"><Input value={r.name} onChange={(e) => setField(i, 'name', e.target.value)} className="w-40" /></td>
                  <td className="px-2 py-2"><Input type="number" step="0.5" min="0" max="366" value={r.annualQuota} onChange={(e) => setField(i, 'annualQuota', e.target.value)} className="w-20" /></td>
                  <td className="px-2 py-2">
                    <Select value={r.eligibility} onChange={(e) => setField(i, 'eligibility', e.target.value)} className="w-32">
                      {Object.entries(ELIG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                  </td>
                  {FLAGS.map(([k]) => (
                    <td key={k} className="px-3 py-2.5">
                      <input type="checkbox" aria-label={k} checked={!!r[k]} onChange={(e) => setField(i, k, e.target.checked)} className="h-4 w-4 accent-brand-600" />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <Input type="number" min="0" step="0.5" disabled={!r.allowCertificate} value={r.certificateAfterDays}
                      placeholder="optional" onChange={(e) => setField(i, 'certificateAfterDays', e.target.value)} className="w-24" />
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-ink-faint whitespace-nowrap">
                    {r.inUse ? `${r.inUse} record${r.inUse === 1 ? '' : 's'}` : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Button size="sm" variant="soft" onClick={() => save(r)} disabled={saving === r.code}>
                        {saving === r.code ? <Spinner /> : 'Save'}
                      </Button>
                      {r.active === false ? (
                        <button className="text-[12px] font-semibold text-brand-700 hover:underline"
                          disabled={saving === r.code} onClick={() => setActive(r, true)}>Reactivate</button>
                      ) : r.protectedReason ? (
                        <span className="text-[11.5px] text-ink-faint" title={r.protectedReason}>required</span>
                      ) : (
                        <button className="text-neg text-[12px] font-semibold hover:underline" onClick={() => remove(r)}>
                          {r.inUse ? 'Retire' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add leave types"
        size="xl"
        actions={
          <>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={addAll} disabled={saving === '__add'}>{saving === '__add' ? <Spinner /> : 'Add all'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-faint">
            The code is what payroll and the mobile app match on, so keep it short and permanent —
            up to 10 characters, letters, digits and underscores, e.g. <span className="font-mono">BL</span>,{' '}
            <span className="font-mono">PAT_L</span>. The name is what employees see; two types cannot share a name.
          </p>
          <ErrorSummary errors={addErrors} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-ink-faint border-b border-line">
                <tr>
                  {['Code', 'Name', 'Annual quota', 'Eligibility', ...FLAGS.map((x) => x[1]), 'Certificate after (days)', ''].map((h) => (
                    <th key={h} className="text-left px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {draft.map((d, i) => (
                  <tr key={i}>
                    <td className="px-2 py-2">
                      <Input value={d.code} maxLength={10} placeholder="BL"
                        onChange={(e) => setDraftField(i, 'code', e.target.value.toUpperCase())} className="w-24 font-mono" />
                    </td>
                    <td className="px-2 py-2">
                      <Input value={d.name} placeholder="Bereavement Leave" onChange={(e) => setDraftField(i, 'name', e.target.value)} className="w-48" />
                    </td>
                    <td className="px-2 py-2">
                      <Input type="number" step="0.5" min="0" max="366" value={d.annualQuota}
                        onChange={(e) => setDraftField(i, 'annualQuota', e.target.value)} className="w-20" />
                    </td>
                    <td className="px-2 py-2">
                      <Select value={d.eligibility} onChange={(e) => setDraftField(i, 'eligibility', e.target.value)} className="w-32">
                        {Object.entries(ELIG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </Select>
                    </td>
                    {FLAGS.map(([k]) => (
                      <td key={k} className="px-3 py-2">
                        <input type="checkbox" aria-label={k} checked={!!d[k]} onChange={(e) => setDraftField(i, k, e.target.checked)} className="h-4 w-4 accent-brand-600" />
                      </td>
                    ))}
                    <td className="px-2 py-2">
                      <Input type="number" min="0" step="0.5" disabled={!d.allowCertificate} value={d.certificateAfterDays}
                        placeholder="optional" onChange={(e) => setDraftField(i, 'certificateAfterDays', e.target.value)} className="w-20" />
                    </td>
                    <td className="px-2 py-2">
                      {draft.length > 1 && (
                        <button className="text-neg text-[12px] font-semibold hover:underline"
                          onClick={() => setDraft((ds) => ds.filter((_, j) => j !== i))}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" onClick={() => setDraft((ds) => [...ds, { ...BLANK }])}>Add another row</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------- Policy ---------------- */
const SAT = {
  NONE: 'Every Saturday is a working day',
  ALL: 'Every Saturday is a week-off',
  SECOND_FOURTH: '2nd and 4th Saturdays are week-offs',
  FIRST_THIRD: '1st, 3rd and 5th Saturdays are week-offs',
};
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Policy() {
  const [s, setS] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmUi] = useConfirm();
  useEffect(() => { api.get('/admin/leave-settings').then(setS).catch((e) => setMsg(e.message)); }, []);

  async function save() {
    const v = validator();
    v.number('maxBackdateDays', s.maxBackdateDays, 'Back-dated leave limit', { required: true, min: 0, max: 365, integer: true });
    v.number('missPunchDays', s.missPunchDays, 'Miss-punch window', { required: true, min: 1, max: 365, integer: true });
    setErrors(v.fields); setMsg('');
    if (!v.ok) return;
    setBusy(true);
    try {
      await api.put('/admin/leave-settings', {
        saturdayRule: s.saturdayRule, sandwichRule: s.sandwichRule,
        maxBackdateDays: Number(s.maxBackdateDays), missPunchDays: Number(s.missPunchDays),
      });
      setMsg('Policy saved.');
    } catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); }
    finally { setBusy(false); }
  }

  async function allocate() {
    if (!(await confirm({ title: 'Allocate leave balances now?', confirmLabel: 'Allocate',
      body: 'Every active employee without balances gets them now (prorated for this year’s joiners). Balances HR set by hand or bulk upload are not changed.' }))) return;
    try { const r = await api.post('/admin/leave-balances/allocate'); setMsg(`Balances checked for ${r.employees} active employee(s).`); }
    catch (e) { setMsg(e.message); }
  }

  if (!s) return msg ? <p className="text-sm text-neg">{msg}</p> : <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      {confirmUi}
      <Card className="p-5 space-y-3">
        <h2 className="font-semibold text-ink">Week-offs and leave rules</h2>
        <p className="text-[12.5px] text-ink-faint">
          Weekly off: {(s.weekOffDays || [0]).map((d) => DAY[d]).join(', ')} (from payroll settings). The Saturday rule below applies on top of it,
          to the attendance calendar, leave day counts and payroll.
        </p>
        <Field label="Saturday rule" error={errors.saturdayRule}>
          <Select value={s.saturdayRule} onChange={(e) => setS({ ...s, saturdayRule: e.target.value })}>
            {Object.entries(SAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={!!s.sandwichRule} onChange={(e) => setS({ ...s, sandwichRule: e.target.checked })} />
          <span>
            <b>Sandwich rule</b> — week-offs and holidays that fall between two leave days (in one request, or between two
            back-to-back requests) are counted as leave. Leaves on adjacent days are always allowed.
          </span>
        </label>
        <Field label="Back-dated leave limit (days)" error={errors.maxBackdateDays} hint="Leave may start at most this many days before today.">
          <Input type="number" min="0" max="365" value={s.maxBackdateDays} onChange={(e) => setS({ ...s, maxBackdateDays: e.target.value })} />
        </Field>
        <Field label="Miss-punch window (days)" error={errors.missPunchDays} hint="Miss-punch can be applied only for past days within this window.">
          <Input type="number" min="1" max="365" value={s.missPunchDays} onChange={(e) => setS({ ...s, missPunchDays: e.target.value })} />
        </Field>
        {msg && <p className={`text-sm ${/saved|checked/.test(msg) ? 'text-pos' : 'text-neg'}`}>{msg}</p>}
        <Button onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save policy'}</Button>
      </Card>
      <Card className="p-5 space-y-2">
        <h2 className="font-semibold text-ink">Leave balances</h2>
        <p className="text-[12.5px] text-ink-soft">
          Balances are allocated automatically for every active employee from the Leave Types quota (or the State-wise quota),
          prorated from the date of joining, and only for the leave types the employee is eligible for. Use this if a report shows
          someone without balances.
        </p>
        <Button variant="soft" onClick={allocate}>Allocate balances now</Button>
        <p className="text-[11.5px] text-ink-faint">{label('ACTIVE')} employees only.</p>
      </Card>
    </div>
  );
}
