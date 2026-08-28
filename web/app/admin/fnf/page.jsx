'use client';
import { useEffect, useState } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Button, Field, Input, Modal, Spinner, Empty, SearchPicker } from '@/components/ui.jsx';

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function FnfPage() {
  const [rows, setRows] = useState(null);
  const [emps, setEmps] = useState([]);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [empId, setEmpId] = useState('');
  const [inp, setInp] = useState({ lastWorkingDate: '', leaveBalanceDays: '', noticeShortfallDays: '', arrears: '', bonus: '', tds: '', advances: '', assetRecovery: '' });
  const [computed, setComputed] = useState(null);
  const [savedId, setSavedId] = useState(null);

  const load = () => api.get('/admin/fnf').then((r) => setRows(r.settlements || [])).catch((e) => { setMsg(e.message); setRows([]); });
  useEffect(() => { load(); }, []);
  useEffect(() => { api.get('/employees').then((r) => setEmps(Array.isArray(r) ? r : [])).catch(() => {}); }, []);
  const empLabel = (e) => `${e.first_name || ''} ${e.last_name || ''} (${e.employee_code || e.id})`.trim();

  async function doPreview() {
    if (!empId) { setMsg('Pick an employee.'); return; }
    try { const r = await api.post(`/admin/fnf/preview/${empId}`, inp); setComputed(r.computed); setSavedId(null); } catch (e) { setMsg(e.message); }
  }
  async function doSave() {
    try { const r = await api.post(`/admin/fnf/${empId}`, inp); setComputed(r.computed); setSavedId(r.settlement?.id); load(); } catch (e) { setMsg(e.message); }
  }
  async function finalise(id) { await api.post(`/admin/fnf/${id}/finalise`, {}); load(); }
  async function markPaid(id) { await api.post(`/admin/fnf/${id}/paid`, {}); load(); }
  function pdf(id) {
    const auth = getStoredAuth();
    fetch(`/api/admin/fnf/${id}/pdf`, { headers: { Authorization: `Bearer ${auth?.token}` } }).then((r) => r.ok && r.blob()).then((b) => b && window.open(URL.createObjectURL(b), '_blank'));
  }
  const nfield = (k, label) => <Field label={label}><Input type="number" value={inp[k]} onChange={(e) => setInp({ ...inp, [k]: e.target.value })} /></Field>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Full &amp; Final Settlement</h1>
          <p className="text-ink-faint text-sm mt-0.5">Compute exit pay — final salary, leave encashment, gratuity, notice recovery — for a resigning employee.</p>
        </div>
        <Button onClick={() => { setOpen(true); setComputed(null); setSavedId(null); setMsg(''); }}>New settlement</Button>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <Empty title="No settlements yet" subtitle="Create a settlement for an exiting employee." />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['Employee', 'LWD', 'Net', 'Payable', 'Status', 'Actions'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">{`${s.first_name || ''} ${s.last_name || ''} (${s.employee_code || ''})`}</td>
                  <td className="px-4 py-3">{s.last_working_date ? String(s.last_working_date).slice(0, 10) : '—'}</td>
                  <td className="px-4 py-3 font-semibold">₹{inr(Math.abs(s.net_amount))}</td>
                  <td className="px-4 py-3">{s.payable_by === 'employee' ? <span className="text-rose-600">employee owes</span> : 'company pays'}</td>
                  <td className="px-4 py-3">{s.status}</td>
                  <td className="px-4 py-3 space-x-3">
                    <button onClick={() => pdf(s.id)} className="text-brand-700 font-medium">PDF</button>
                    {s.status === 'draft' && <button onClick={() => finalise(s.id)} className="text-brand-700 font-medium">Finalise</button>}
                    {s.status === 'finalised' && <button onClick={() => markPaid(s.id)} className="text-brand-700 font-medium">Mark paid</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New settlement" size="xl"
        actions={<><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button><Button variant="outline" onClick={doPreview}>Preview</Button><Button onClick={doSave}>Save draft</Button></>}>
        <div className="space-y-4">
          <Field label="Employee"><SearchPicker value={empId} onChange={setEmpId} options={emps} getLabel={empLabel} /></Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Last working date"><Input type="date" value={inp.lastWorkingDate} onChange={(e) => setInp({ ...inp, lastWorkingDate: e.target.value })} /></Field>
            {nfield('leaveBalanceDays', 'Leave balance (days)')}
            {nfield('noticeShortfallDays', 'Notice shortfall (days)')}
            {nfield('arrears', 'Arrears')}
            {nfield('bonus', 'Bonus')}
            {nfield('tds', 'TDS')}
            {nfield('advances', 'Advances / loans')}
            {nfield('assetRecovery', 'Asset recovery')}
          </div>
          {computed && (
            <div className="rounded-xl border border-line bg-slate-50 p-4 text-sm">
              <div className="grid grid-cols-2 gap-y-1">
                {(computed.lines || []).map((l, i) => (
                  <div key={i} className="flex justify-between col-span-2">
                    <span className="text-ink-soft">{l.label}</span>
                    <span className={l.type === 'deduction' ? 'text-rose-600' : ''}>{l.type === 'deduction' ? '−' : ''}₹{inr(l.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between border-t border-line mt-2 pt-2 font-bold">
                <span>Net {computed.net >= 0 ? 'payable to employee' : 'recoverable'}</span><span>₹{inr(Math.abs(computed.net))}</span>
              </div>
              {savedId && <div className="mt-3"><Button size="sm" onClick={() => pdf(savedId)}>Download PDF</Button></div>}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
