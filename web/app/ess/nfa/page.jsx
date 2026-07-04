'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Textarea, Spinner, Empty, Modal } from '@/components/ui.jsx';

const TONE = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  QUERY: 'bg-sky-50 text-sky-700 border-sky-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAYMENT_RELEASED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};
const fmtMoney = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const STAGE_TONE = { APPROVED: 'text-emerald-700', REJECTED: 'text-red-700', BYPASSED: 'text-slate-400', PENDING: 'text-amber-700', QUERY: 'text-sky-700', WAITING: 'text-slate-400' };

// GreenHR "NFA Report" — my NFAs with settlement actions.
export default function MyNfasPage() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = () => api.get(`/nfa${status ? `?status=${status}` : ''}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">My NFAs</h1>
        <Link href="/ess/nfa/create"><Button size="sm">Create NFA</Button></Link>
      </div>
      <div className="flex gap-2 flex-wrap">
        {['', 'PENDING', 'QUERY', 'APPROVED', 'PAYMENT_RELEASED', 'REJECTED'].map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 text-xs rounded-full border ${status === s ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-line text-ink-soft'}`}>
            {s === '' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>
      <Card className="p-0 overflow-x-auto">
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !rows.length ? <Empty title="No NFAs" subtitle="Create your first NFA to see it here." /> : (
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">NFA Code</th><th className="px-2 py-2.5">Project</th>
              <th className="px-2 py-2.5">Payment</th><th className="px-2 py-2.5 text-right">Grand Total</th>
              <th className="px-2 py-2.5">Status</th><th className="px-4 py-2.5">Settlement</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="border-b border-line last:border-0 hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-medium text-brand-700">{r.nfaCode}</td>
                  <td className="px-2 py-2.5">{r.project.name}</td>
                  <td className="px-2 py-2.5 text-xs">{r.paymentType.replace(/_/g, ' ')}</td>
                  <td className="px-2 py-2.5 text-right font-medium">{fmtMoney(r.totals.grand)}</td>
                  <td className="px-2 py-2.5"><span title={r.statusLabel} className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium ${TONE[r.status] || ''}`}>{r.status.replace('_', ' ')}</span></td>
                  <td className="px-4 py-2.5 text-xs text-ink-faint">{r.settlementStatus || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {openId && <NfaDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function NfaDetailModal({ id, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get(`/nfa/${id}`).then(setD).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resubmit() {
    if (!remarks.trim()) { setMsg('Enter a reply to the query first.'); return; }
    setBusy(true); setMsg('');
    try { setD(await api.post(`/nfa/${id}/resubmit`, { remarks })); setRemarks(''); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={d ? d.nfaCode : 'NFA'} size="lg">
      {!d ? <div className="p-6 flex justify-center"><Spinner /></div> : (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="flex justify-between items-center">
            <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium ${TONE[d.status] || ''}`}>{d.statusLabel}</span>
            <span className="text-lg font-semibold">{fmtMoney(d.totals.grand)}</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {[['Project', d.project.name], ['Category', d.expenseCategory.name], ['Location', d.location.name],
              ['Client/Vendor', d.clientVendor?.name || '—'], ['Payment type', d.paymentType.replace(/_/g, ' ')],
              ['Billable', d.billableType.replace(/_/g, ' ')], ['Settlement due', d.settlementDueDate?.slice(0, 10)],
              ['Purpose', d.purpose]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1">
                <span className="text-ink-faint">{k}</span><span className="text-right">{v}</span>
              </div>
            ))}
          </div>

          {d.approval && (
            <div className="space-y-1">
              <div className="font-semibold text-sm">Approval chain</div>
              {d.approval.chain.map((s) => (
                <div key={s.seq} className="flex justify-between text-xs border border-line rounded px-2.5 py-1.5">
                  <span>{s.seq}. {s.roleKey.replace(/_/g, ' ')} <span className="text-ink-soft ml-1">{s.approver?.name || '—'}</span>
                    {s.remarks && <span className="text-ink-faint ml-1">“{s.remarks}”</span>}</span>
                  <span className={`font-semibold ${STAGE_TONE[s.status] || ''}`}>{s.status}</span>
                </div>
              ))}
            </div>
          )}

          {d.status === 'QUERY' && (
            <div className="space-y-2 border-t border-line pt-3">
              <div className="font-semibold text-sm">Answer query & resubmit</div>
              <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Your reply…" />
              <Button size="sm" onClick={resubmit} disabled={busy}>{busy ? 'Resubmitting…' : 'Resubmit'}</Button>
            </div>
          )}

          {d.status === 'PAYMENT_RELEASED' && <SettlementBlock nfaId={id} settlementStatus={d.settlementStatus} onChanged={() => { load(); onChanged(); }} />}
          {msg && <p className="text-sm text-red-600">{msg}</p>}
        </div>
      )}
    </Modal>
  );
}

// GreenHR "Submit Your Settlement" / "Check Settlement".
function SettlementBlock({ nfaId, settlementStatus, onChanged }) {
  const [s, setS] = useState(null);
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get(`/nfa/${nfaId}/settlement`).then(setS).catch(() => setS(false));
  useEffect(() => { load(); }, [nfaId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true); setMsg('');
    try { await api.post(`/nfa/${nfaId}/settlement`, { amount: Number(amount), remarks }); load(); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  const canSubmit = ['PENDING', 'AUTO_REJECTED'].includes(settlementStatus) || s?.status === 'REJECTED';

  return (
    <div className="border-t border-line pt-3 space-y-2">
      <div className="font-semibold text-sm">Settlement <span className="text-xs font-normal text-ink-faint">({settlementStatus || '—'})</span></div>
      {settlementStatus === 'AUTO_REJECTED' && <p className="text-xs text-rose-600">Your settlement was auto-rejected by the system — please resubmit.</p>}
      {s && s !== false && s.status !== 'REJECTED' ? (
        <>
          <div className="text-sm flex justify-between"><span className="text-ink-faint">Settlement amount</span><span className="font-medium">{fmtMoney(s.amount)}</span></div>
          {s.approval?.chain.map((st) => (
            <div key={st.seq} className="flex justify-between text-xs border border-line rounded px-2.5 py-1">
              <span>{st.seq}. {st.roleKey.replace(/_/g, ' ')} <span className="text-ink-soft">{st.approver?.name || '—'}</span></span>
              <span className={`font-semibold ${STAGE_TONE[st.status] || ''}`}>{st.status}</span>
            </div>
          ))}
        </>
      ) : canSubmit ? (
        <div className="space-y-2">
          <Input type="number" placeholder="Settlement amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Textarea rows={1} placeholder="Remarks / expense proof notes" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <Button size="sm" onClick={submit} disabled={busy || !amount}>{busy ? 'Submitting…' : 'Submit Your Settlement'}</Button>
        </div>
      ) : <p className="text-xs text-ink-faint">No settlement yet.</p>}
    </div>
  );
}
