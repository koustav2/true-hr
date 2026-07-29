'use client';
import { useEffect, useState } from 'react';
import { api, storeAuth, setToken } from '@/lib/api.js';
import { Card, Button, Input, Textarea, Spinner, Empty, Field } from '@/components/ui.jsx';

const TONE = { PENDING: 'text-amber-700', APPROVED: 'text-emerald-700', REJECTED: 'text-rose-700', WITHDRAWN: 'text-ink-faint' };

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

// Android-style section card: teal header strip + body (matches the app's Resignation screen).
function Section({ title, children }) {
  return (
    <Card className="overflow-hidden">
      <div className="bg-[#149A55] px-4 py-2.5 text-sm font-bold text-white">{title}</div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex py-1 text-sm">
      <span className="w-40 shrink-0 text-ink-faint">{k}</span>
      <span className="min-w-0 flex-1 font-medium text-ink">{v || '—'}</span>
    </div>
  );
}

// Same stage-status pill colours as the Android approvals table.
const STAGE_PILL = {
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  BYPASSED: 'bg-slate-100 text-slate-500',
  PENDING: 'bg-amber-100 text-amber-700',
  WAITING: 'bg-slate-100 text-slate-500',
};

// GreenHR-style stage table: role → approver (code - name, email) → live status.
// Shown even before applying (the backend previews who will approve).
function Approvals({ approvers }) {
  if (!approvers?.length) return null;
  return (
    <Section title="Approvals">
      <div className="divide-y divide-line">
        {approvers.map((a) => (
          <div key={a.seq} className="flex items-center gap-3 py-2.5">
            <span className="w-36 shrink-0 text-xs font-semibold text-ink-soft">{a.stage || 'Approver'}</span>
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-semibold ${a.name ? 'text-ink' : 'text-ink-faint'}`}>
                {[a.employeeCode, a.name].filter(Boolean).join(' - ') || 'Not assigned'}
              </div>
              {a.email && <div className="truncate text-xs text-ink-soft">{a.email}</div>}
            </div>
            {a.status && (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STAGE_PILL[a.status] || 'bg-slate-100 text-slate-500'}`}>
                {a.status.charAt(0) + a.status.slice(1).toLowerCase()}
              </span>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Mine() {
  const [ctx, setCtx] = useState(null);
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ resignationDate: new Date().toISOString().slice(0, 10), lastWorkingDate: '', reason: '' });
  const [msg, setMsg] = useState('');
  const [confirming, setConfirming] = useState(false);
  const load = () => {
    api.get('/resignation/context').then(setCtx).catch(() => setCtx(false));
    api.get('/resignation').then(setRows).catch(() => setRows([]));
  };
  useEffect(() => { load(); }, []);
  const active = (rows || []).find((r) => ['PENDING', 'APPROVED'].includes(r.status));

  async function apply() {
    setMsg(''); setConfirming(false);
    try {
      const r = await api.post('/resignation', f);
      if (r.accountBlocked) {
        // The account is disabled from this moment — end the session cleanly.
        alert('Your resignation has been submitted. As per policy, your account is now blocked; contact HR if you need access restored.');
        setToken(null); storeAuth(null);
        window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/login`);
        return;
      }
      load();
    } catch (e) { setMsg(e.message); }
  }
  async function withdraw(id) { try { await api.post(`/resignation/${id}/withdraw`); load(); } catch (e) { setMsg(e.message); } }

  return (
    <div className="space-y-4">
      {ctx && ctx !== false && (
        <Section title="Employee Details">
          <KV k="Employee Code" v={ctx.employee?.employeeCode} />
          <KV k="Full Name" v={ctx.employee?.name} />
          <KV k="Vertical" v={ctx.employee?.vertical} />
          <KV k="Office Location" v={ctx.employee?.location} />
          <KV k="Designation" v={ctx.employee?.designation} />
          <KV k="Notice Period" v={ctx.employee?.noticePeriodDays != null ? `${ctx.employee.noticePeriodDays} Days` : null} />
        </Section>
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
          {!confirming ? (
            <Button onClick={() => setConfirming(true)} disabled={!f.lastWorkingDate}>Submit Resignation</Button>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-2.5">
              <div className="text-sm font-semibold text-amber-800">Please read before submitting</div>
              <p className="text-xs text-amber-800 leading-relaxed">
                The moment you submit your resignation, your account is <b>blocked from the entire system</b> —
                app and web — and only HR can restore access. Before submitting, please download everything
                you need: <b>salary slips, offer letter, and personal documents</b>. Your resignation will then
                move through the approval chain shown below.
              </p>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" onClick={apply}>I understand — submit</Button>
                <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
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
          </Card>
        ))}
      {/* Android-parity approvals table: who approves, in order, with live status. */}
      {ctx && ctx !== false && <Approvals approvers={ctx.approvers} />}
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
