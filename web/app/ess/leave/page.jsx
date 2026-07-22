'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Textarea, Spinner, Empty, Field } from '@/components/ui.jsx';

const TONE = { PENDING: 'text-amber-700', APPROVED: 'text-emerald-700', REJECTED: 'text-rose-700', CANCELLED: 'text-ink-faint' };
const StatusChips = ({ value, onChange, options = ['PENDING', 'APPROVED', 'REJECTED'] }) => (
  <div className="flex gap-2">
    {options.map((s) => (
      <button key={s} onClick={() => onChange(s)}
        className={`px-3 py-1.5 text-xs rounded-full border ${value === s ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-line text-ink-soft'}`}>{s}</button>
    ))}
  </div>
);

export default function LeavePage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">Leave Management</h1>
      <div className="flex gap-1.5 border-b border-line overflow-x-auto">
        {['Apply Leave', 'My Leaves', 'Comp-Off', 'Team Approvals'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Apply />}
      {tab === 1 && <MyLeaves />}
      {tab === 2 && <CompOff />}
      {tab === 3 && <Team />}
    </div>
  );
}

function Apply() {
  const [types, setTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [f, setF] = useState({ leaveCode: '', fromDate: '', toDate: '', halfDay: false, reason: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/leave/types').then(setTypes).catch(() => {});
    api.get('/leave/balances').then(setBalances).catch(() => {});
  }, []);
  const sel = types.find((t) => t.code === f.leaveCode);
  const bal = balances.find((b) => b.code === f.leaveCode);

  async function apply() {
    setBusy(true); setMsg('');
    try {
      await api.post('/leave', { ...f, toDate: sel?.singleDate ? f.fromDate : f.toDate });
      setMsg('Leave applied.'); setF({ leaveCode: '', fromDate: '', toDate: '', halfDay: false, reason: '' });
      api.get('/leave/balances').then(setBalances).catch(() => {});
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <Field label="Leave type" required>
          <Select value={f.leaveCode} onChange={(e) => setF({ ...f, leaveCode: e.target.value })}>
            <option value="">Select</option>
            {types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </Select>
        </Field>
        {sel && <p className="text-xs text-ink-faint">{sel.requiresBalance ? `Available: ${bal?.remaining ?? 0} day(s)` : 'Balance not applicable'}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="From" required><Input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field>
          {!sel?.singleDate && <Field label="To" required><Input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>}
        </div>
        {sel?.allowHalfDay && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked })} /> Half day
          </label>
        )}
        <Field label="Reason"><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        {msg && <p className={`text-sm ${msg === 'Leave applied.' ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
        <Button onClick={apply} disabled={busy || !f.leaveCode || !f.fromDate}>{busy ? 'Applying…' : 'Apply Leave'}</Button>
      </Card>
      <Card className="p-4">
        <div className="font-semibold text-sm mb-2">My Balances</div>
        {!balances.length ? <p className="text-xs text-ink-faint">No balances yet.</p> : (
          <div className="grid sm:grid-cols-2 gap-2">
            {balances.map((b) => (
              <div key={b.code} className="flex justify-between text-sm border border-line rounded-lg px-3 py-2">
                <span className="text-ink-soft">{b.name}</span>
                <span className="font-semibold">{b.remaining} / {b.allocated}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function MyLeaves() {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.get(`/leave?status=${status}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function cancel(id) { try { await api.post(`/leave/${id}/cancel`); load(); } catch (e) { setMsg(e.message); } }
  return (
    <div className="space-y-3">
      <StatusChips value={status} onChange={setStatus} options={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']} />
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <Spinner /> : !rows.length ? <Empty title={`No ${status.toLowerCase()} leaves`} /> :
        rows.map((r) => (
          <Card key={r.id} className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
            <div>
              <div className="font-medium">{r.leaveType} · {r.fromDate?.slice(0, 10)} → {r.toDate?.slice(0, 10)} ({r.days}d{r.halfDay ? ', half' : ''})</div>
              <div className="text-xs text-ink-faint">{r.reason || '—'}{r.reviewNote ? ` · “${r.reviewNote}”` : ''}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold ${TONE[r.status] || ''}`}>{r.status}</span>
              {r.status === 'PENDING' && <Button size="sm" variant="outline" onClick={() => cancel(r.id)}>Cancel</Button>}
            </div>
          </Card>
        ))}
    </div>
  );
}

function CompOff() {
  const [credits, setCredits] = useState(null);
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ onDutyId: '', leaveDate: '', remark: '' });
  const [msg, setMsg] = useState('');
  const load = () => {
    api.get('/compoff/credits').then(setCredits).catch(() => setCredits([]));
    api.get('/compoff?status=PENDING').then(setRows).catch(() => setRows([]));
  };
  useEffect(() => { load(); }, []);
  async function avail() {
    try { await api.post('/compoff', { onDutyId: Number(f.onDutyId), leaveDate: f.leaveDate, remark: f.remark }); setMsg('Comp-off applied.'); setF({ onDutyId: '', leaveDate: '', remark: '' }); load(); }
    catch (e) { setMsg(e.message); }
  }
  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <div className="font-semibold text-sm">Avail Comp-Off</div>
        <Field label="Earned from OD" required>
          <Select value={f.onDutyId} onChange={(e) => setF({ ...f, onDutyId: e.target.value })}>
            <option value="">Select credit</option>
            {(credits || []).map((c) => <option key={c.onDutyId} value={c.onDutyId}>{c.workedFrom?.slice(0, 10)} — {c.place || c.location || 'OD'} (expires {c.expiryDate?.slice(0, 10)})</option>)}
          </Select>
        </Field>
        <Field label="Leave date" required><Input type="date" value={f.leaveDate} onChange={(e) => setF({ ...f, leaveDate: e.target.value })} /></Field>
        <Field label="Remark"><Input value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
        {msg && <p className={`text-sm ${msg.includes('applied') ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
        <Button onClick={avail} disabled={!f.onDutyId || !f.leaveDate}>Apply</Button>
      </Card>
      <div className="space-y-3">
        <div className="font-semibold text-sm">Pending comp-off requests</div>
        {!rows ? <Spinner /> : !rows.length ? <Empty title="No pending comp-off" /> :
          rows.map((r) => (
            <Card key={r.id} className="p-3 text-sm flex justify-between">
              <span>Leave on {r.leaveDate?.slice(0, 10)} · earned {r.workedFrom?.slice(0, 10)}</span>
              <span className={`text-xs font-semibold ${TONE[r.status] || ''}`}>{r.status}</span>
            </Card>
          ))}
      </div>
    </div>
  );
}

function Team() {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.get(`/leave/team?status=${status}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function review(id, action) {
    try { await api.post(`/leave/${id}/review`, { decision: action, note: '' }); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="space-y-3">
      <StatusChips value={status} onChange={setStatus} />
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="Nothing here" subtitle="Team leave requests appear here." /> :
        rows.map((r) => (
          <Card key={r.id} className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
            <div>
              <div className="font-medium">{r.name} · {r.leaveType} · {r.fromDate?.slice(0, 10)} → {r.toDate?.slice(0, 10)} ({r.days}d)</div>
              <div className="text-xs text-ink-faint">{r.reason || '—'}</div>
            </div>
            {r.status === 'PENDING' ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => review(r.id, 'APPROVED')}>Approve</Button>
                <Button size="sm" variant="danger" onClick={() => review(r.id, 'REJECTED')}>Reject</Button>
              </div>
            ) : <span className={`text-xs font-semibold ${TONE[r.status] || ''}`}>{r.status}</span>}
          </Card>
        ))}
    </div>
  );
}
