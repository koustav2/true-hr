'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Textarea, Spinner, Empty, Field } from '@/components/ui.jsx';

const TONE = { PENDING: 'text-amber-700', APPROVED: 'text-emerald-700', REJECTED: 'text-rose-700', WITHDRAWN: 'text-ink-faint' };
const STAGE_TONE = { APPROVED: 'text-emerald-700', REJECTED: 'text-red-700', BYPASSED: 'text-slate-400', PENDING: 'text-amber-700', WAITING: 'text-slate-400' };

export default function ResignationPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">Resignation</h1>
      <div className="flex gap-1.5 border-b border-line">
        {['My Resignation', 'Team'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 ? <Mine /> : <Team />}
    </div>
  );
}

function Chain({ id }) {
  const [inst, setInst] = useState(null);
  useEffect(() => { api.get(`/resignation/${id}/chain`).then(setInst).catch(() => setInst(false)); }, [id]);
  if (inst === null) return <Spinner />;
  if (!inst) return null;
  return (
    <div className="space-y-1 mt-2">
      {inst.chain.map((s) => (
        <div key={s.seq} className="flex justify-between text-xs border border-line rounded px-2.5 py-1">
          <span>{s.seq}. {s.roleKey.replace(/_/g, ' ')} <span className="text-ink-soft">{s.approver?.name || '—'}</span>
            {s.remarks && <span className="text-ink-faint"> “{s.remarks}”</span>}</span>
          <span className={`font-semibold ${STAGE_TONE[s.status] || ''}`}>{s.status}</span>
        </div>
      ))}
    </div>
  );
}

function Mine() {
  const [ctx, setCtx] = useState(null);
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ resignationDate: new Date().toISOString().slice(0, 10), lastWorkingDate: '', reason: '' });
  const [msg, setMsg] = useState('');
  const load = () => {
    api.get('/resignation/context').then(setCtx).catch(() => setCtx(false));
    api.get('/resignation').then(setRows).catch(() => setRows([]));
  };
  useEffect(() => { load(); }, []);
  const active = (rows || []).find((r) => ['PENDING', 'APPROVED'].includes(r.status));

  async function apply() {
    setMsg('');
    try { await api.post('/resignation', f); load(); } catch (e) { setMsg(e.message); }
  }
  async function withdraw(id) { try { await api.post(`/resignation/${id}/withdraw`); load(); } catch (e) { setMsg(e.message); } }

  return (
    <div className="space-y-4">
      {ctx && ctx !== false && (
        <Card className="p-3 text-xs text-ink-soft grid sm:grid-cols-3 gap-y-1">
          <span>Employee: <b>{ctx.employee?.name || `${ctx.firstName || ''}`}</b></span>
          <span>Notice period: <b>{ctx.noticePeriodDays ?? ctx.employee?.noticePeriodDays ?? 30} days</b></span>
          <span>Designation: <b>{ctx.designation || ctx.employee?.designation || '—'}</b></span>
        </Card>
      )}
      {!active && (
        <Card className="p-4 space-y-2.5 max-w-lg">
          <div className="font-semibold text-sm">Apply for resignation</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Resignation date" required><Input type="date" value={f.resignationDate} onChange={(e) => setF({ ...f, resignationDate: e.target.value })} /></Field>
            <Field label="Last working date" required><Input type="date" value={f.lastWorkingDate} onChange={(e) => setF({ ...f, lastWorkingDate: e.target.value })} /></Field>
          </div>
          <Field label="Reason"><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <Button onClick={apply} disabled={!f.lastWorkingDate}>Submit Resignation</Button>
        </Card>
      )}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No resignation history" /> :
        rows.map((r) => (
          <Card key={r.id} className="p-3 text-sm">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <div className="font-medium">Resigned {r.resignationDate?.slice(0, 10)} · last day {r.lastWorkingDate?.slice(0, 10)}</div>
                <div className="text-xs text-ink-faint">{r.reason || '—'}{r.reviewNote ? ` · “${r.reviewNote}”` : ''}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${TONE[r.status] || ''}`}>{r.status}</span>
                {r.status === 'PENDING' && <Button size="sm" variant="outline" onClick={() => withdraw(r.id)}>Withdraw</Button>}
              </div>
            </div>
            {r.status === 'PENDING' && <Chain id={r.id} />}
          </Card>
        ))}
    </div>
  );
}

function Team() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/resignation/team?status=PENDING').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function act(id, action) {
    try { await api.post(`/resignation/${id}/act`, { action, remarks: '' }); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="space-y-3">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No pending team resignations" /> :
        rows.map((r) => (
          <Card key={r.id} className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
            <div>
              <div className="font-medium">{r.name} · last day {r.lastWorkingDate?.slice(0, 10)}</div>
              <div className="text-xs text-ink-faint">{r.reason || '—'}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => act(r.id, 'APPROVED')}>Approve</Button>
              <Button size="sm" variant="danger" onClick={() => act(r.id, 'REJECTED')}>Reject</Button>
            </div>
          </Card>
        ))}
    </div>
  );
}
