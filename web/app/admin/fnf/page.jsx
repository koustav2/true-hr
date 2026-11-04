'use client';
import { useEffect, useState } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator, addYears } from '@/lib/validate.js';
import { Card, Button, Field, Input, Modal, Spinner, Empty, Badge, SearchPicker, ErrorSummary, useConfirm } from '@/components/ui.jsx';

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const TONE = { draft: 'warn', finalised: 'brand', paid: 'ok', cancelled: 'neutral' };
const BLANK = { lastWorkingDate: '', leaveBalanceDays: '', noticeShortfallDays: '', arrears: '', bonus: '', otherEarnings: '', tds: '', advances: '', assetRecovery: '', otherDeductions: '' };
const AMOUNTS = [['arrears', 'Arrears'], ['bonus', 'Bonus'], ['otherEarnings', 'Other earnings'], ['tds', 'TDS'], ['advances', 'Advances / loans'], ['assetRecovery', 'Asset recovery'], ['otherDeductions', 'Other deductions']];

export default function FnfPage() {
  const [confirm, confirmUi] = useConfirm();
  const [rows, setRows] = useState(null);
  const [emps, setEmps] = useState([]);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [empId, setEmpId] = useState('');
  const [inp, setInp] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [pre, setPre] = useState(null);       // prefill: exit, assets, open advances
  const [computed, setComputed] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/admin/fnf').then((r) => setRows(r.settlements || [])).catch((e) => { setMsg(e.message); setRows([]); });
    // H91: only employees with an approved resignation or termination.
    api.get('/admin/fnf/eligible').then((r) => setEmps(Array.isArray(r) ? r : [])).catch(() => setEmps([]));
  };
  useEffect(() => { load(); }, []);
  const empLabel = (e) => `${e.name} (${e.code}) — LWD ${fmtDate(e.lastWorkingDate)}${e.settlementStatus ? ` · ${label(e.settlementStatus)}` : ''}`;

  async function pick(id, existing = null) {
    setEmpId(id); setComputed(null); setErrors({}); setPre(null);
    if (!id) { setInp(BLANK); return; }
    try {
      const p = await api.get(`/admin/fnf/prefill/${id}`);
      setPre(p);
      const base = { ...BLANK, ...Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, v == null ? '' : String(v)])) };
      setInp(existing ? { ...base, ...Object.fromEntries(Object.keys(BLANK).map((k) => [k, existing[k] == null || existing[k] === 0 ? (base[k] || '') : String(existing[k])])) } : base);
    } catch (e) { setErrors({ form: e.message }); }
  }
  function startNew() { setOpen(true); setEmpId(''); setInp(BLANK); setPre(null); setComputed(null); setErrors({}); setMsg(''); }
  async function edit(s) {
    setOpen(true); setMsg('');
    try { const d = await api.get(`/admin/fnf/${s.id}`); await pick(String(s.employee_id), d.settlement.inputs || {}); }
    catch (e) { setErrors({ form: e.message }); }
  }

  function validate() {
    const v = validator();
    v.require('employeeId', empId, 'Employee');
    v.date('lastWorkingDate', inp.lastWorkingDate, 'Last working date', { required: true, min: pre?.dateOfJoining || undefined, max: addYears(todayIso(), 1), minMsg: 'Last working date cannot be before the joining date' });
    v.number('leaveBalanceDays', inp.leaveBalanceDays, 'Leave balance', { min: 0, max: 365 });
    v.number('noticeShortfallDays', inp.noticeShortfallDays, 'Notice shortfall', { min: 0, max: 365, integer: true });
    for (const [k, l] of AMOUNTS) v.number(k, inp[k], l, { min: 0, max: 100000000 });
    setErrors(v.fields);
    return v.ok;
  }
  async function doPreview() {
    if (!validate()) return;
    setBusy(true);
    try { const r = await api.post(`/admin/fnf/preview/${empId}`, inp); setComputed(r.computed); } catch (e) { setErrors(e.fields || { form: e.message }); } finally { setBusy(false); }
  }
  async function doSave() {
    if (!validate()) return;
    setBusy(true);
    try { const r = await api.post(`/admin/fnf/${empId}`, inp); setComputed(r.computed); setOpen(false); setMsg('Draft saved.'); load(); }
    catch (e) { setErrors(e.fields || { form: e.message }); } finally { setBusy(false); }
  }
  async function act(s, path, title, body) {
    if (!(await confirm({ title, body, confirmLabel: title.replace('?', ''), tone: 'danger' }))) return;
    try { await api.post(`/admin/fnf/${s.id}/${path}`, {}); load(); } catch (e) { setMsg(e.message); }
  }
  async function remove(s) {
    if (!(await confirm({ title: 'Delete this draft?', body: `${s.first_name} ${s.last_name}'s draft settlement is removed. This cannot be undone.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await api.del(`/admin/fnf/${s.id}`); load(); } catch (e) { setMsg(e.message); }
  }
  const pdf = (id) => openFile(`/admin/fnf/${id}/pdf`).catch((e) => setMsg(e.message));
  const nfield = (k, l, hint) => <Field label={l} error={errors[k]} hint={hint}><Input inputMode="decimal" value={inp[k]} onChange={(e) => setInp({ ...inp, [k]: e.target.value })} /></Field>;
  const lines = computed ? (computed.allLines || computed.lines || []) : [];

  return (
    <div className="space-y-5">
      {confirmUi}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-ink">Full &amp; Final Settlement</h1>
          <p className="text-ink-faint text-sm mt-0.5">Exit pay — final salary, leave encashment, gratuity, notice and asset recovery — for employees whose resignation or termination has been approved.</p>
        </div>
        <Button onClick={startNew}>New settlement</Button>
      </div>
      {msg && <p className="text-sm text-ink">{msg}</p>}

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <Empty title="No settlements yet" subtitle="Create a settlement for an employee whose exit has been approved." />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['Employee', 'Last working date', 'Net', 'Payable', 'Status', 'Actions'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">{`${s.first_name || ''} ${s.last_name || ''}`} <span className="text-ink-faint">{s.employee_code}</span></td>
                  <td className="px-4 py-3">{fmtDate(s.last_working_date)}</td>
                  <td className="px-4 py-3 font-semibold">₹{inr(Math.abs(s.net_amount))}</td>
                  <td className="px-4 py-3">{s.payable_by === 'employee' ? <span className="text-rose-600">Employee owes</span> : 'Company pays'}</td>
                  <td className="px-4 py-3"><Badge tone={TONE[s.status]}>{label(s.status)}</Badge></td>
                  <td className="px-4 py-3 space-x-3 whitespace-nowrap">
                    <button onClick={() => pdf(s.id)} className="text-brand-700 font-medium">PDF</button>
                    {s.status === 'draft' && <button onClick={() => edit(s)} className="text-brand-700 font-medium">Edit</button>}
                    {s.status === 'draft' && <button onClick={() => act(s, 'finalise', 'Finalise?', 'A finalised settlement can no longer be edited or deleted.')} className="text-brand-700 font-medium">Finalise</button>}
                    {s.status === 'draft' && <button onClick={() => remove(s)} className="text-rose-600 font-medium">Delete</button>}
                    {s.status === 'finalised' && <button onClick={() => act(s, 'paid', 'Mark paid?', `Record that ₹${inr(Math.abs(s.net_amount))} has been settled.`)} className="text-brand-700 font-medium">Mark paid</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Settlement" size="xl"
        actions={<><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button><Button variant="outline" onClick={doPreview} disabled={busy}>Preview</Button><Button onClick={doSave} disabled={busy}>{busy ? <Spinner /> : 'Save draft'}</Button></>}>
        <div className="space-y-4">
          <ErrorSummary errors={errors} />
          <Field label="Employee" required error={errors.employeeId} hint={emps.length ? 'Employees with an approved resignation or termination' : 'No employee has an approved exit yet'}>
            <SearchPicker value={empId} onChange={(v) => pick(v)} options={emps} getLabel={empLabel} />
          </Field>
          {pre && (
            <div className="rounded border border-line bg-canvas px-3 py-2 text-[12.5px] text-ink-soft space-y-1">
              <div>{label(pre.exit.kind)} approved · last working date <b className="text-ink">{fmtDate(pre.exit.lastWorkingDate)}</b> · joined {fmtDate(pre.dateOfJoining)}{pre.monthlyCtc ? ` · monthly CTC ₹${inr(pre.monthlyCtc)}` : ''}</div>
              {pre.assets?.length > 0 && <div className="text-crit">Assets still with the employee: {pre.assets.map((a) => `${a.tag} ${a.description}${a.cost ? ` (₹${inr(a.cost)})` : ''}`).join('; ')} — enter a recovery amount if they are not returned.</div>}
              {pre.openAdvances?.length > 0 && <div className="text-crit">Open NFA advances: {pre.openAdvances.map((n) => `${n.code} ₹${inr(n.outstanding)}`).join('; ')} — pre-filled under Advances.</div>}
            </div>
          )}
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Last working date" required error={errors.lastWorkingDate}><Input type="date" min={pre?.dateOfJoining || undefined} value={inp.lastWorkingDate} onChange={(e) => setInp({ ...inp, lastWorkingDate: e.target.value })} /></Field>
            {nfield('leaveBalanceDays', 'Leave balance (days)', 'Earned leave not yet taken')}
            {nfield('noticeShortfallDays', 'Notice shortfall (days)')}
            {AMOUNTS.map(([k, l]) => <div key={k}>{nfield(k, `${l} (₹)`)}</div>)}
          </div>
          {computed && (
            <div className="rounded-xl border border-line bg-slate-50 p-4 text-sm">
              {lines.map((l, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-ink-soft">{l.label}{l.note ? <span className="text-ink-faint text-[11.5px]"> — {l.note}</span> : null}</span>
                  <span className={l.type === 'deduction' ? 'text-rose-600' : ''}>{l.type === 'deduction' ? '−' : ''}₹{inr(l.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-line mt-2 pt-2 font-bold">
                <span>Net {computed.net >= 0 ? 'payable to employee' : 'recoverable from employee'}</span><span>₹{inr(Math.abs(computed.net))}</span>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
