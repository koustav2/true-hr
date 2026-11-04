'use client';
import { useEffect, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { Card, Button, Field, Input, Textarea, Modal, Spinner, Empty, Badge, ErrorSummary, useConfirm } from '@/components/ui.jsx';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');
const STATUSES = ['submitted', 'verified', 'rejected', 'draft'];
const TONE = { submitted: 'warn', verified: 'ok', rejected: 'danger', draft: 'neutral' };
// "rejected" is what the API calls a declaration sent back to the employee.
const statusLabel = (s) => (s === 'rejected' ? 'Sent back' : label(s));
const day = (v) => fmtDate(v ? String(v).slice(0, 10) : null);

export default function TaxDeclarationsPage() {
  const [confirm, confirmUi] = useConfirm();
  const [rows, setRows] = useState(null);
  const [statusF, setStatusF] = useState(null);
  const [msg, setMsg] = useState('');
  const [detail, setDetail] = useState(null);
  const [approved, setApproved] = useState({});
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState({});

  // The HR dashboard links here with ?status=<code>.
  useEffect(() => {
    let s = 'submitted';
    try { const q = new URLSearchParams(window.location.search).get('status'); if (q && STATUSES.includes(q.toLowerCase())) s = q.toLowerCase(); } catch { /* default */ }
    setStatusF(s);
  }, []);
  const load = () => { if (!statusF) return; setRows(null); api.get(`/admin/tax-declarations?status=${statusF}`).then((r) => setRows(r.declarations || [])).catch((e) => { setMsg(e.message); setRows([]); }); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusF]);

  async function openDetail(id) {
    setErrors({});
    try {
      const r = await api.get(`/admin/tax-declarations/${id}`);
      setDetail(r); setRemarks(r.declaration?.remarks || '');
      setApproved(Object.fromEntries((r.items || []).map((i) => [i.id, i.approved_amount ?? i.declared_amount])));
    } catch (e) { setMsg(e.message); }
  }
  async function verify(reject) {
    const errs = {};
    for (const it of detail.items) {
      const v = Number(String(approved[it.id] ?? '').replace(/,/g, ''));
      if (!reject && (Number.isNaN(v) || v < 0 || v > Number(it.declared_amount))) errs[`approvals.${it.id}`] = `${it.section}: approved amount must be between 0 and the declared ₹${inr(it.declared_amount)}`;
    }
    if (reject && remarks.trim().length < 5) errs.remarks = 'Tell the employee what to change (at least 5 characters)';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const ok = await confirm(reject
      ? { title: 'Send this declaration back?', body: 'The employee can edit and resubmit it. Your remarks are shown to them.', confirmLabel: 'Send back', tone: 'danger' }
      : { title: 'Verify & lock this declaration?', body: 'The approved amounts are saved and used for TDS. The employee can no longer change it.', confirmLabel: 'Verify & lock' });
    if (!ok) return;
    const approvals = detail.items.map((i) => ({ itemId: i.id, approvedAmount: approved[i.id] }));
    try { await api.post(`/admin/tax-declarations/${detail.declaration.id}/verify`, { approvals, remarks, reject }); setDetail(null); load(); }
    catch (e) { setErrors(e.fields || { form: e.message }); }
  }
  const locked = detail && detail.declaration?.status !== 'submitted';

  return (
    <div className="space-y-5">
      {confirmUi}
      <div>
        <h1 className="page-title text-ink">Investment Declarations</h1>
        <p className="text-ink-faint text-sm mt-0.5">Employee income-tax declarations — review the proofs, adjust approved amounts, verify or send back.</p>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatusF(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusF === s ? 'bg-brand-600 text-white' : 'bg-white border border-line text-ink-soft'}`}>{statusLabel(s)}</button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <Empty title="No declarations found" subtitle={`No ${statusLabel(statusF).toLowerCase()} declarations.`} />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['FY', 'Regime', 'Employee', 'Declared', 'Approved', 'Submitted', 'Status', ''].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">{d.financial_year}</td>
                  <td className="px-4 py-3">{d.regime === 'old' ? 'Old' : 'New'}</td>
                  <td className="px-4 py-3">{`${d.first_name || ''} ${d.last_name || ''}`} <span className="text-ink-faint">{d.employee_code}</span></td>
                  <td className="px-4 py-3 tabular-nums">₹{inr(d.declared_total)}</td>
                  <td className="px-4 py-3 tabular-nums">{d.approved_total != null ? `₹${inr(d.approved_total)}` : '—'}</td>
                  <td className="px-4 py-3 text-ink-faint">{day(d.submitted_at)}</td>
                  <td className="px-4 py-3"><Badge tone={TONE[d.status]}>{statusLabel(d.status)}</Badge></td>
                  <td className="px-4 py-3"><button onClick={() => openDetail(d.id)} className="text-brand-700 font-medium">{d.status === 'submitted' ? 'Review' : 'View'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Review declaration" size="xl"
        actions={!locked ? (
          <><Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            <Button variant="danger" onClick={() => verify(true)}>Send back</Button>
            <Button onClick={() => verify(false)}>Verify &amp; lock</Button></>
        ) : <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>}>
        {detail && (
          <div className="space-y-4">
            <ErrorSummary errors={errors} />
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-ink-faint text-xs">Gross for the FY</div><div className="font-semibold">₹{inr(detail.grossAnnual)}</div>{detail.projection && detail.projection.months < 12 && <div className="text-[11px] text-ink-faint">{detail.projection.months} months after joining</div>}</div>
              <div><div className="text-ink-faint text-xs">Old-regime tax</div><div className="font-semibold">₹{inr(detail.estimate?.old?.totalTax)}</div></div>
              <div><div className="text-ink-faint text-xs">New-regime tax</div><div className="font-semibold">₹{inr(detail.estimate?.new?.totalTax)} <span className="text-brand-600">({detail.estimate?.recommended === 'old' ? 'old' : 'new'} is lower)</span></div></div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-ink-faint border-b border-line"><tr>{['Section', 'Description', 'Declared', 'Proof', 'Approved'].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {(detail.items || []).map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2 font-mono">{it.section}</td>
                    <td className="px-3 py-2">{it.description || '—'}</td>
                    <td className="px-3 py-2">₹{inr(it.declared_amount)}</td>
                    <td className="px-3 py-2">{it.proof
                      ? <button className="text-brand-700 hover:underline" onClick={() => downloadFile(`/admin/tax-declarations/${detail.declaration.id}/items/${it.id}/proof`, it.proof.name).catch((e) => setErrors({ form: e.message }))}>{it.proof.name}</button>
                      : <span className="text-ink-faint">No proof</span>}</td>
                    <td className="px-3 py-2">
                      {locked ? (it.approved_amount != null ? `₹${inr(it.approved_amount)}` : '—') : (
                        <>
                          <Input inputMode="decimal" className="w-32" value={approved[it.id] ?? ''} onChange={(e) => setApproved({ ...approved, [it.id]: e.target.value })} />
                          {errors[`approvals.${it.id}`] && <div className="text-[11px] text-neg mt-1">{errors[`approvals.${it.id}`]}</div>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {locked
              ? <p className="text-[12.5px] text-ink-soft">Status: <b>{statusLabel(detail.declaration.status)}</b>{detail.declaration.remarks ? ` — ${detail.declaration.remarks}` : ''}</p>
              : <Field label="Remarks" error={errors.remarks} hint="Required when sending back"><Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>}
          </div>
        )}
      </Modal>
    </div>
  );
}
