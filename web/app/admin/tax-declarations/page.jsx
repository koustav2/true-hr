'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Field, Input, Textarea, Modal, Spinner, Empty } from '@/components/ui.jsx';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

export default function TaxDeclarationsPage() {
  const [rows, setRows] = useState(null);
  const [statusF, setStatusF] = useState('submitted');
  const [msg, setMsg] = useState('');
  const [detail, setDetail] = useState(null); // {declaration, items, grossAnnual, estimate}
  const [remarks, setRemarks] = useState('');

  const load = () => api.get(`/admin/tax-declarations?status=${statusF}`).then((r) => setRows(r.declarations || [])).catch((e) => { setMsg(e.message); setRows([]); });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusF]);

  async function openDetail(id) {
    try { const r = await api.get(`/admin/tax-declarations/${id}`); setDetail(r); setRemarks(r.declaration?.remarks || ''); } catch (e) { setMsg(e.message); }
  }
  async function verify(reject) {
    const approvals = (detail.items || []).map((i) => ({ itemId: i.id, approvedAmount: i.approved_amount ?? i.declared_amount }));
    try { await api.post(`/admin/tax-declarations/${detail.declaration.id}/verify`, { approvals, remarks, reject }); setDetail(null); load(); }
    catch (e) { setMsg(e.message); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Investment Declarations</h1>
        <p className="text-ink-faint text-sm mt-0.5">Employee income-tax declarations — review the proofs, adjust approved amounts, verify or send back.</p>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <div className="flex gap-2">
        {['submitted', 'verified', 'rejected', 'draft'].map((s) => (
          <button key={s} onClick={() => setStatusF(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusF === s ? 'bg-brand-600 text-white' : 'bg-white border border-line text-ink-soft'}`}>{s}</button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <Empty title="Nothing here" subtitle={`No ${statusF} declarations.`} />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['FY', 'Regime', 'Employee', 'Submitted', 'Status', ''].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">{d.financial_year}</td>
                  <td className="px-4 py-3 uppercase">{d.regime}</td>
                  <td className="px-4 py-3">{`${d.first_name || ''} ${d.last_name || ''} (${d.employee_code || ''})`}</td>
                  <td className="px-4 py-3 text-ink-faint">{d.submitted_at ? String(d.submitted_at).slice(0, 10) : '—'}</td>
                  <td className="px-4 py-3">{d.status}</td>
                  <td className="px-4 py-3"><button onClick={() => openDetail(d.id)} className="text-brand-700 font-medium">Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Review declaration" size="xl"
        actions={detail?.declaration?.status !== 'verified' ? (
          <><Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            <Button variant="danger" onClick={() => verify(true)}>Send back</Button>
            <Button onClick={() => verify(false)}>Verify &amp; lock</Button></>
        ) : <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-ink-faint text-xs">Gross annual</div><div className="font-semibold">₹{inr(detail.grossAnnual)}</div></div>
              <div><div className="text-ink-faint text-xs">Old-regime tax</div><div className="font-semibold">₹{inr(detail.estimate?.old?.totalTax)}</div></div>
              <div><div className="text-ink-faint text-xs">New-regime tax</div><div className="font-semibold">₹{inr(detail.estimate?.new?.totalTax)} <span className="text-brand-600">({detail.estimate?.recommended} better)</span></div></div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-ink-faint border-b border-line"><tr>{['Section', 'Description', 'Declared', 'Approved'].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {(detail.items || []).map((it, idx) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2 font-mono">{it.section}</td>
                    <td className="px-3 py-2">{it.description || '—'}</td>
                    <td className="px-3 py-2">₹{inr(it.declared_amount)}</td>
                    <td className="px-3 py-2">
                      <Input type="number" className="w-32" defaultValue={it.approved_amount ?? it.declared_amount}
                        onChange={(e) => { const items = [...detail.items]; items[idx] = { ...it, approved_amount: e.target.value }; setDetail({ ...detail, items }); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Field label="Remarks"><Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
