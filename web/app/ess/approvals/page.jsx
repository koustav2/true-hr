'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Textarea, Spinner, Empty } from '@/components/ui.jsx';

const fmtMoney = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

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
      <h1 className="text-xl font-bold text-ink">Approvals waiting on me</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">NFAs</h2>
        {!nfas ? <Spinner /> : !nfas.length ? <Empty title="Nothing pending" subtitle="No NFAs are waiting for your approval." /> :
          nfas.map((r) => <ApprovalCard key={r.id} title={`${r.nfaCode} — ${r.employee.name}`} sub={`${r.project.name} · ${r.expenseCategory.name} · ${r.paymentType.replace(/_/g, ' ')}`}
            amount={r.totals.grand} stage={r.pendingStage?.roleKey}
            act={(action, remarks) => api.post(`/nfa/${r.id}/act`, { action, remarks })} onDone={load} />)}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">Settlements</h2>
        {!settlements ? <Spinner /> : !settlements.length ? <Empty title="Nothing pending" subtitle="No settlements are waiting for your approval." /> :
          settlements.map((s) => <ApprovalCard key={s.id} title={`Settlement — ${s.nfaCode || s.id}`} sub={s.employee?.name || ''}
            amount={s.amount} stage={s.pendingStage?.roleKey}
            act={(action, remarks) => api.post(`/settlements/${s.id}/act`, { action, remarks })} onDone={load} />)}
      </section>
    </div>
  );
}

function ApprovalCard({ title, sub, amount, stage, act, onDone }) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function run(action) {
    if (action !== 'APPROVED' && !remarks.trim()) { setMsg('Remarks are required for query / reject.'); return; }
    setBusy(true); setMsg('');
    try { await act(action, remarks); onDone(); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-ink">{title}</div>
          <div className="text-xs text-ink-faint">{sub}</div>
          {stage && <div className="text-[11px] text-amber-700 font-semibold mt-1">Waiting on you as {stage.replace(/_/g, ' ')}</div>}
        </div>
        <div className="text-right font-semibold">{fmtMoney(amount)}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Textarea rows={1} className="flex-1 min-w-[200px]" placeholder="Remarks (required for query / reject)…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        <Button size="sm" onClick={() => run('APPROVED')} disabled={busy}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => run('QUERY_HOLD')} disabled={busy}>Query / Hold</Button>
        <Button size="sm" variant="danger" onClick={() => run('REJECTED')} disabled={busy}>Reject</Button>
      </div>
      {msg && <p className="text-sm text-red-600 mt-2">{msg}</p>}
    </Card>
  );
}
