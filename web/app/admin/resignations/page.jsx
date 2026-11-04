'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api.js';
import { Card, Button, Select, Field, Modal, Textarea, Spinner, Empty, useConfirm } from '@/components/ui.jsx';
import { downloadCsv } from '@/lib/csv.js';
import { label, fmtDate } from '@/lib/labels.js';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'];
const dmy = fmtDate;
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const badge = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-600 ring-rose-200',
  WITHDRAWN: 'bg-slate-100 text-slate-500 ring-slate-200',
};


// The HR dashboard deep-links here with ?status= (and ?tab=); useSearchParams
// needs a Suspense boundary on a client page.
export default function ResignationsPage() {
  return <Suspense fallback={null}><ResignationsInner /></Suspense>;
}

// Nearest filter for ?status= from a link (unknown → Pending).
function statusFrom(v) {
  const s = String(v || '').toUpperCase();
  if (STATUSES.includes(s)) return s;
  if (['CANCELLED'].includes(s)) return 'WITHDRAWN';
  if (['EXITED', 'CLOSED'].includes(s)) return 'APPROVED';
  return 'PENDING';
}

function ResignationsInner() {
  const sp = useSearchParams();
  const [status, setStatus] = useState(() => statusFrom(sp.get('status')));
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState('');
  const [reject, setReject] = useState(null); // row being rejected
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const [confirm, confirmUi] = useConfirm();

  const load = () => { setRows(null); api.get(`/admin/resignations?status=${status}`).then(setRows).catch(() => setRows([])); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function decide(id, decision, n) {
    setBusy(id); setMsg('');
    try { await api.post(`/admin/resignations/${id}/review`, { decision, note: n || null }); setReject(null); setNote(''); load(); }
    catch (e) { if (e.fields?.note) setNoteErr(e.fields.note); else setMsg(e.message); } finally { setBusy(0); }
  }
  async function approve(r) {
    const adv = r.openAdvance > 0 ? ` ${r.name} still has ${inr(r.openAdvance)} of NFA advance unsettled (${(r.openAdvanceNfas || []).join(', ')}) — recover it in the Full & Final.` : '';
    if (!(await confirm({
      title: `Approve ${r.name}'s resignation?`,
      body: `This approves it on behalf of every remaining approver. Last working day ${dmy(r.lastWorkingDate)}; the login closes automatically after that day.${adv}`,
      confirmLabel: 'Approve',
    }))) return;
    decide(r.id, 'APPROVED');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title text-ink">Resignations</h1>
          <p className="text-ink-faint text-sm mt-0.5">Review and act on employee resignation requests.</p>
        </div>
        <div className="flex items-end gap-2.5">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          </Field>
          <Button variant="outline" onClick={() => downloadCsv(`resignations-${status.toLowerCase()}.csv`,
            (rows || []).map((r) => ({
              'Employee ID': r.employeeCode || '', Name: r.name || '',
              'Resignation date': (r.resignationDate || '').slice(0, 10),
              'Last working date': (r.lastWorkingDate || '').slice(0, 10),
              Reason: r.reason || '', Status: label(r.status), 'Review note': r.reviewNote || '',
              'Notice shortfall (days)': r.noticeShortfallDays || 0, 'Open NFA advance': r.openAdvance || 0,
            })))}>
            Export CSV
          </Button>
        </div>
      </div>
      {confirmUi}
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <Empty title={`No ${label(status).toLowerCase()} resignations`} />
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
                      <span className={`inline-flex mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${badge[r.status] || ''}`}>{label(r.status)}</span>
                      {r.exitedAt && <div className="text-ink-faint text-[11px] mt-1">Exited · login closed {dmy(r.exitedAt)}</div>}
                    </td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{dmy(r.resignationDate)}</td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{dmy(r.lastWorkingDate)}<div className="text-ink-faint text-xs">{r.noticePeriodDays} days notice</div>
                      {r.noticeShortfallDays > 0 && <div className="text-amber-700 text-xs">Shortfall {r.noticeShortfallDays} day(s) — recover in F&amp;F</div>}
                      {r.openAdvance > 0 && <div className="text-rose-600 text-xs">Open NFA advance {inr(r.openAdvance)}</div>}</td>
                    <td className="px-5 py-3 text-ink-soft max-w-[280px]">{r.reason || '—'}{r.reviewNote && <div className="text-ink-faint text-xs mt-1">Remark: {r.reviewNote}</div>}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {r.status === 'PENDING' ? (
                        <>
                          <button onClick={() => approve(r)} disabled={busy === r.id} className="text-emerald-700 text-xs font-medium hover:underline mr-4">Approve</button>
                          <button onClick={() => { setReject(r); setNote(''); setNoteErr(''); }} className="text-rose-600 text-xs font-medium hover:underline">Reject</button>
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
        actions={<><Button variant="ghost" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" onClick={() => { if (note.trim().length < 5) { setNoteErr('Please give a reason of at least 5 characters — the employee sees it'); return; } decide(reject.id, 'REJECTED', note.trim()); }} disabled={busy === reject?.id}>{busy === reject?.id ? <Spinner /> : 'Reject'}</Button></>}>
        <Field label="Reason for rejection" required error={noteErr}><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Reason for rejection…" /></Field>
      </Modal>
    </div>
  );
}
