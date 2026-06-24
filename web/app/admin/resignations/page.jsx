'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Select, Field, Modal, Textarea, Spinner, Empty } from '@/components/ui.jsx';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'];
const dmy = (iso) => { if (!iso) return '—'; const p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; };
const badge = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-600 ring-rose-200',
  WITHDRAWN: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export default function ResignationsPage() {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState('');
  const [reject, setReject] = useState(null); // row being rejected
  const [note, setNote] = useState('');

  const load = () => { setRows(null); api.get(`/admin/resignations?status=${status}`).then(setRows).catch(() => setRows([])); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function decide(id, decision, n) {
    setBusy(id); setMsg('');
    try { await api.post(`/admin/resignations/${id}/review`, { decision, note: n || null }); setReject(null); setNote(''); load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(0); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold text-ink tracking-tight">Resignations</h1>
          <p className="text-ink-faint text-sm mt-0.5">Review and act on employee resignation requests.</p>
        </div>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
          </Select>
        </Field>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <Empty title={`No ${status.toLowerCase()} resignations`} />
          : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Employee</th>
                  <th className="text-left px-5 py-3 font-medium">Resignation</th>
                  <th className="text-left px-5 py-3 font-medium">Last working</th>
                  <th className="text-left px-5 py-3 font-medium">Reason</th>
                  <th className="text-right px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-5 py-3">
                      <div className="text-ink font-medium">{r.name}</div>
                      <div className="text-ink-faint text-xs">{r.employeeCode} · {r.designation || '—'}</div>
                      <span className={`inline-flex mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${badge[r.status] || ''}`}>{r.status}</span>
                    </td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{dmy(r.resignationDate)}</td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{dmy(r.lastWorkingDate)}<div className="text-ink-faint text-xs">{r.noticePeriodDays}d notice</div></td>
                    <td className="px-5 py-3 text-ink-soft max-w-[280px]">{r.reason || '—'}{r.reviewNote && <div className="text-ink-faint text-xs mt-1">Remark: {r.reviewNote}</div>}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {r.status === 'PENDING' ? (
                        <>
                          <button onClick={() => decide(r.id, 'APPROVED')} disabled={busy === r.id} className="text-emerald-700 text-xs font-medium hover:underline mr-4">Approve</button>
                          <button onClick={() => { setReject(r); setNote(''); }} className="text-rose-600 text-xs font-medium hover:underline">Reject</button>
                        </>
                      ) : <span className="text-ink-faint text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!reject} onClose={() => setReject(null)} title={`Reject resignation — ${reject?.name || ''}`} tone="danger"
        actions={<><Button variant="ghost" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" onClick={() => decide(reject.id, 'REJECTED', note)} disabled={busy === reject?.id}>{busy === reject?.id ? <Spinner /> : 'Reject'}</Button></>}>
        <Field label="Remark (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Reason for rejection…" /></Field>
      </Modal>
    </div>
  );
}
