'use client';
import { useEffect, useState } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { Card, Button, Textarea, Spinner, Empty, useConfirm } from '@/components/ui.jsx';
import { fmtMoney, LinesTable, DocList, ChainList } from '../nfa/NfaParts.jsx';

// GreenHR "NFA Details (Reporting Manager)" + settlement approvals — everything
// waiting on me, actionable from the web.
export default function ApprovalsPage() {
  const [nfas, setNfas] = useState(null);
  const [settlements, setSettlements] = useState(null);
  const load = () => {
    api.get('/nfa/pending').then(setNfas).catch(() => setNfas([]));
    api.get('/settlements/pending').then(setSettlements).catch(() => setSettlements([]));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <h1 className="page-title text-ink">Approvals waiting on me</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">NFAs</h2>
        {!nfas ? <Spinner /> : !nfas.length ? <Empty title="Nothing pending" subtitle="No NFAs are waiting for your approval." /> :
          nfas.map((r) => <ApprovalCard key={r.id} title={`${r.nfaCode} — ${r.employee.name}`} sub={`${r.project.name} · ${r.expenseCategory.name} · ${label(r.paymentType)} · raised ${fmtDate(r.createdAt)}`}
            amount={r.totals.grand} stage={r.pendingStage?.roleKey}
            act={(action, remarks) => api.post(`/nfa/${r.id}/act`, { action, remarks })} onDone={load}>
            <NfaDetails id={r.id} />
          </ApprovalCard>)}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">Settlements</h2>
        {!settlements ? <Spinner /> : !settlements.length ? <Empty title="Nothing pending" subtitle="No settlements are waiting for your approval." /> :
          settlements.map((s) => (
            <ApprovalCard key={s.id} title={`Settlement — ${s.nfaCode || s.id}`} sub={s.employee?.name || ''}
              amount={s.amount} stage={s.pendingStage?.roleKey}
              act={(action, remarks) => api.post(`/settlements/${s.id}/act`, { action, remarks })} onDone={load}>
              <SettlementDetails s={s} />
            </ApprovalCard>
          ))}
      </section>
    </div>
  );
}

// Expense lines, attachments and the chain so far, on demand (E24).
function NfaDetails({ id }) {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (open && !d) api.get(`/nfa/${id}`).then(setD).catch((e) => setMsg(e.message)); }, [open, id, d]);
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-brand-700 font-medium hover:underline">
        {open ? 'Hide details' : 'View expense lines, attachments and chain'}
      </button>
      {open && (!d ? <div className="py-2">{msg ? <p className="text-xs text-red-600">{msg}</p> : <Spinner />}</div> : (
        <div className="mt-2 space-y-3 rounded-xl bg-slate-50/70 border border-line p-3">
          <p className="text-xs text-ink-soft">Purpose: <b className="text-ink">{d.purpose}</b> · Settlement date {fmtDate(d.settlementDueDate)}</p>
          <LinesTable d={d} />
          <DocList nfaId={d.id} docs={d.documents} onError={setMsg} />
          <ChainList approval={d.approval} />
          {msg && <p className="text-xs text-red-600">{msg}</p>}
        </div>
      ))}
    </div>
  );
}

// NFA context + uploaded bills, shown to the settlement approver (client req #3).
function SettlementDetails({ s }) {
  const [docs, setDocs] = useState(null);
  useEffect(() => { api.get(`/settlements/${s.id}/documents`).then(setDocs).catch(() => setDocs([])); }, [s.id]);
  const [err, setErr] = useState('');
  const openDoc = (docId) => openFile(`/settlements/${s.id}/documents/${docId}`).catch((e) => setErr(e.message));
  return (
    <div className="mt-3 rounded-xl bg-slate-50/70 border border-line p-3 text-xs space-y-2">
      <div className="grid sm:grid-cols-4 gap-x-4 gap-y-1 text-ink-soft">
        <span>NFA: <b className="text-ink">{s.nfaCode || '—'}</b></span>
        <span>Project: <b className="text-ink">{s.project?.name || '—'}</b></span>
        <span>Advance received: <b className="text-ink">{fmtMoney(s.nfaGrandTotal)}</b></span>
        <span>Settling: <b className="text-ink">{fmtMoney(s.amount)}</b></span>
        {s.settlementDueDate && <span>Due: <b className="text-ink">{fmtDate(s.settlementDueDate)}</b></span>}
        {s.remarks && <span className="sm:col-span-3">Remarks: <b className="text-ink">{s.remarks}</b></span>}
      </div>
      <div>
        <span className="text-ink-faint font-semibold">Bills / supporting documents:</span>{' '}
        {docs === null ? <Spinner className="inline h-3 w-3" /> : !docs.length ? <span className="text-amber-700">none uploaded</span> : (
          docs.map((d) => (
            <button key={d.id} onClick={() => openDoc(d.id)}
              className="inline-flex items-center gap-1 text-brand-700 font-medium hover:underline mr-3">
              📄 {d.filename || `Document ${d.id}`}
            </button>
          ))
        )}
        {err && <span className="text-red-600 ml-2">{err}</span>}
      </div>
    </div>
  );
}

function ApprovalCard({ title, sub, amount, stage, act, onDone, children }) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirm, confirmUi] = useConfirm();
  async function run(action) {
    if (action !== 'APPROVED' && !remarks.trim()) { setMsg('Remarks are required to raise a query or reject.'); return; }
    const verb = { APPROVED: 'Approve', REJECTED: 'Reject', QUERY_HOLD: 'Raise a query on' }[action];
    if (!(await confirm({ title: `${verb} ${title}?`, confirmLabel: verb, tone: action === 'REJECTED' ? 'danger' : 'brand',
      body: action === 'APPROVED' ? `${fmtMoney(amount)} moves to the next stage of the chain.` : action === 'REJECTED' ? 'The request is closed and the employee is told your reason.' : 'The request goes back to the employee to answer your query.' }))) return;
    setBusy(true); setMsg('');
    try { await act(action, remarks.trim()); onDone(); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Card className="p-4">
      {confirmUi}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-ink">{title}</div>
          <div className="text-xs text-ink-faint">{sub}</div>
          {stage && <div className="text-[11px] text-amber-700 font-semibold mt-1">Waiting on you as {label(stage)}</div>}
        </div>
        <div className="text-right font-semibold">{fmtMoney(amount)}</div>
      </div>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Textarea rows={1} className="flex-1 min-w-[200px]" placeholder="Remarks (required for query / reject)…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        <Button size="sm" onClick={() => run('APPROVED')} disabled={busy}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => run('QUERY_HOLD')} disabled={busy}>Raise query</Button>
        <Button size="sm" variant="danger" onClick={() => run('REJECTED')} disabled={busy}>Reject</Button>
      </div>
      {msg && <p className="text-sm text-red-600 mt-2">{msg}</p>}
    </Card>
  );
}
