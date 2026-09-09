'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Spinner, Badge, Modal, Field, ConfirmClick, Empty } from '@/components/ui.jsx';

const TABS = ['Holidays', 'State Entitlements', 'Leave Types'];

export default function LeaveConfigPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Leave Configuration</h1>
        <p className="text-ink-faint text-sm mt-0.5">Holidays and statutory entitlements, plus your organisation's own leave types.</p>
      </div>
      <div className="flex gap-1.5 border-b border-line">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 0 && <Holidays />}
      {tab === 1 && <Entitlements />}
      {tab === 2 && <LeaveTypes />}
    </div>
  );
}

function useStates() {
  const [states, setStates] = useState([]);
  useEffect(() => { api.get('/admin/entitlements').then((r) => setStates(r.map((e) => e.state))).catch(() => {}); }, []);
  return states;
}

/* ---------------- Holidays ---------------- */
function Holidays() {
  const states = useStates();
  const [rows, setRows] = useState(null);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/admin/holidays').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  async function add() {
    if (!date || !name) { setMsg('Date and name are required.'); return; }
    setBusy(true); setMsg('');
    try { await api.post('/admin/holidays', { date, name, state: state || null }); setDate(''); setName(''); setState(''); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function remove(id) { await api.del(`/admin/holidays/${id}`); load(); }

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
      <Card className="p-5">
        <h2 className="font-semibold text-ink mb-3">Add holiday</h2>
        <div className="space-y-3">
          <label className="block"><span className="block text-[13px] font-medium text-ink-soft mb-1.5">Date</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="block"><span className="block text-[13px] font-medium text-ink-soft mb-1.5">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Independence Day" /></label>
          <label className="block"><span className="block text-[13px] font-medium text-ink-soft mb-1.5">Applies to</span>
            <Select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">National (all states)</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select></label>
          {msg && <p className="text-sm text-rose-600">{msg}</p>}
          <Button onClick={add} disabled={busy} className="w-full">{busy ? <Spinner /> : 'Add holiday'}</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <p className="p-6 text-sm text-ink-faint">No holidays yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr><th className="text-left px-5 py-3 font-medium">Date</th><th className="text-left px-5 py-3 font-medium">Name</th><th className="text-left px-5 py-3 font-medium">Scope</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((h) => (
                <tr key={h.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3 whitespace-nowrap text-ink">{h.date}</td>
                  <td className="px-5 py-3 text-ink">{h.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{h.state || 'National'}</td>
                  <td className="px-5 py-3 text-right"><button onClick={() => remove(h.id)} className="text-rose-600 text-xs font-medium hover:underline">Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ---------------- State Entitlements ---------------- */
function Entitlements() {
  const [rows, setRows] = useState(null);
  const [savingState, setSavingState] = useState(null);
  const blank = { state: '', el: 0, cl: 0, sl: 0, elAccum: 0, clAccum: 0, slAccum: 0 };
  const [draft, setDraft] = useState(blank);

  const load = () => api.get('/admin/entitlements').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  async function save(row) {
    setSavingState(row.state);
    try { await api.put('/admin/entitlements', row); await load(); } finally { setSavingState(null); }
  }
  const setField = (idx, k, v) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, [k]: Number(v) } : r));

  if (rows === null) return <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  return (
    <div className="space-y-5">
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
            <tr>
              {['State', 'EL', 'CL', 'SL', 'EL accum', 'CL accum', 'SL accum', ''].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={r.state} className="hover:bg-slate-50/40">
                <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap">{r.state}</td>
                {['el', 'cl', 'sl', 'elAccum', 'clAccum', 'slAccum'].map((k) => (
                  <td key={k} className="px-2 py-2"><Input type="number" step="0.01" value={r[k]} onChange={(e) => setField(i, k, e.target.value)} className="w-20" /></td>
                ))}
                <td className="px-4 py-2.5"><Button size="sm" variant="soft" onClick={() => save(r)} disabled={savingState === r.state}>{savingState === r.state ? <Spinner /> : 'Save'}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-ink mb-3">Add / override a state</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="block text-xs text-ink-faint mb-1">State</span><Input value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} placeholder="e.g. Odisha" /></label>
          {['el', 'cl', 'sl', 'elAccum', 'clAccum', 'slAccum'].map((k) => (
            <label key={k} className="block"><span className="block text-xs text-ink-faint mb-1">{k}</span><Input type="number" step="0.01" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} className="w-20" /></label>
          ))}
          <Button onClick={() => save(draft).then(() => setDraft(blank))} disabled={!draft.state}>Save state</Button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Leave Types ---------------- */
//
// These belong to the organisation, not the deployment. Every tenant starts
// from the same nine and then goes its own way: some have Paternity, some call
// Casual Leave something else, some have none of it. So this screen adds,
// retires and reactivates as well as edits.
//
// "Retire" rather than "delete" whenever a type has been allocated or applied
// for — deleting it would orphan balances and rewrite people's leave history.
// The server decides which of the two happened and says so.

const BLANK = { code: '', name: '', annualQuota: 0, requiresBalance: true, allowHalfDay: false, singleDate: false, allowCertificate: false };
const FLAGS = [
  ['requiresBalance', 'Balance'],
  ['allowHalfDay', 'Half-day'],
  ['singleDate', 'Single date'],
  ['allowCertificate', 'Certificate'],
];

function LeaveTypes() {
  const [rows, setRows] = useState(null);
  const [saving, setSaving] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState([{ ...BLANK }]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => api.get('/admin/leave-types').then(setRows).catch((e) => { setErr(e.message); setRows([]); });
  useEffect(() => { load(); }, []);

  const setField = (idx, k, v) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, [k]: v } : r)));
  const setDraftField = (idx, k, v) => setDraft((ds) => ds.map((d, i) => (i === idx ? { ...d, [k]: v } : d)));

  async function save(r) {
    setSaving(r.code); setErr(''); setMsg('');
    try {
      await api.put(`/admin/leave-types/${r.code}`, {
        name: r.name, annualQuota: Number(r.annualQuota), requiresBalance: r.requiresBalance,
        allowHalfDay: r.allowHalfDay, singleDate: r.singleDate, allowCertificate: r.allowCertificate,
      });
      setMsg(`${r.code} saved.`);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(null); }
  }

  async function setActive(r, active) {
    setSaving(r.code); setErr(''); setMsg('');
    try {
      await api.put(`/admin/leave-types/${r.code}`, { active });
      setMsg(active ? `${r.name} is available again.` : `${r.name} retired.`);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(null); }
  }

  async function remove(r) {
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
    if (!filled.length) return;
    setSaving('__add'); setErr(''); setMsg('');
    try {
      const res = await api.post('/admin/leave-types/bulk', { types: filled });
      setMsg(`${res.added} leave ${res.added === 1 ? 'type' : 'types'} added.`);
      setDraft([{ ...BLANK }]);
      setAdding(false);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(null); }
  }

  if (rows === null) return <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] text-ink-faint max-w-2xl">
          Your organisation&rsquo;s own list — editing or retiring one here affects nobody else.
          A type that has balances or requests against it is retired rather than deleted, so past leave stays intact.
        </p>
        <Button size="sm" onClick={() => setAdding(true)}>Add leave types</Button>
      </div>

      {msg && <p className="text-[13px] text-pos">{msg}</p>}
      {err && <p className="text-[13px] text-neg">{err}</p>}

      {rows.length === 0 ? (
        <Card><Empty title="No leave types yet" subtitle="Add the ones your organisation grants — EL, CL, SL and anything else." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>
                {['Code', 'Name', 'Annual', ...FLAGS.map((f) => f[1]), 'In use', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={r.code} className={`hover:bg-slate-50/40 ${r.active === false ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2.5 font-semibold text-ink whitespace-nowrap">
                    {r.code}
                    {r.active === false && <Badge tone="neutral" className="ml-1.5">retired</Badge>}
                  </td>
                  <td className="px-2 py-2"><Input value={r.name} onChange={(e) => setField(i, 'name', e.target.value)} className="w-40" /></td>
                  <td className="px-2 py-2"><Input type="number" step="0.5" min="0" value={r.annualQuota} onChange={(e) => setField(i, 'annualQuota', Number(e.target.value))} className="w-20" /></td>
                  {FLAGS.map(([k]) => (
                    <td key={k} className="px-4 py-2.5">
                      <input type="checkbox" checked={!!r[k]} onChange={(e) => setField(i, k, e.target.checked)} className="h-4 w-4 accent-brand-600" />
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-[12px] text-ink-faint whitespace-nowrap">
                    {r.inUse ? `${r.inUse} record${r.inUse === 1 ? '' : 's'}` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Button size="sm" variant="soft" onClick={() => save(r)} disabled={saving === r.code}>
                        {saving === r.code ? <Spinner /> : 'Save'}
                      </Button>
                      {r.active === false ? (
                        <button className="text-[12px] font-semibold text-brand-700 hover:underline"
                          disabled={saving === r.code} onClick={() => setActive(r, true)}>
                          Reactivate
                        </button>
                      ) : r.protectedReason ? (
                        // Payroll and the statutory entitlement table read these
                        // four by code, so removing one would break something
                        // quietly. Say so where the button would have been.
                        <span className="text-[11.5px] text-ink-faint" title={r.protectedReason}>required</span>
                      ) : (
                        <ConfirmClick onConfirm={() => remove(r)} className="text-neg text-[12px] font-semibold">
                          {r.inUse ? 'Retire' : 'Delete'}
                        </ConfirmClick>
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
            <Button onClick={addAll} disabled={saving === '__add'}>
              {saving === '__add' ? <Spinner /> : 'Add all'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-faint">
            The code is what payroll and the mobile app match on, so keep it short and permanent —
            up to 10 characters, letters, digits and underscores, e.g. <span className="font-mono">BL</span>,{' '}
            <span className="font-mono">PAT_L</span>. The name is what employees see and can be changed later.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-ink-faint border-b border-line">
                <tr>
                  {['Code', 'Name', 'Annual', ...FLAGS.map((f) => f[1]), ''].map((h) => (
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
                      <Input value={d.name} placeholder="Bereavement Leave"
                        onChange={(e) => setDraftField(i, 'name', e.target.value)} className="w-52" />
                    </td>
                    <td className="px-2 py-2">
                      <Input type="number" step="0.5" min="0" value={d.annualQuota}
                        onChange={(e) => setDraftField(i, 'annualQuota', Number(e.target.value))} className="w-20" />
                    </td>
                    {FLAGS.map(([k]) => (
                      <td key={k} className="px-3 py-2">
                        <input type="checkbox" checked={!!d[k]}
                          onChange={(e) => setDraftField(i, k, e.target.checked)} className="h-4 w-4 accent-brand-600" />
                      </td>
                    ))}
                    <td className="px-2 py-2">
                      {draft.length > 1 && (
                        <button className="text-neg text-[12px] font-semibold hover:underline"
                          onClick={() => setDraft((ds) => ds.filter((_, j) => j !== i))}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" onClick={() => setDraft((ds) => [...ds, { ...BLANK }])}>
            Add another row
          </Button>
        </div>
      </Modal>
    </div>
  );
}
