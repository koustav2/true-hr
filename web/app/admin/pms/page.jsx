'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Textarea, Spinner, Empty, Modal, Select } from '@/components/ui.jsx';

const TABS = ['Rating queue', 'Team KPI approvals', 'Grade system'];

export default function PmsAdminPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">PMS / KPI</h1>
        <p className="text-ink-faint text-sm mt-0.5">Monthly KPI approvals, PMS rating chain and the grade ladder.</p>
      </div>
      <div className="flex gap-1.5 border-b border-line">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <RatingQueue />}
      {tab === 1 && <TeamKpi />}
      {tab === 2 && <Grades />}
    </div>
  );
}

function RatingQueue() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null); // {submissionId, roleKey}
  const load = () => api.get('/pms/pending').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  return (
    <>
      <Card className="p-0">
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !rows.length ? <Empty title="Nothing waiting on you" subtitle="PMS submissions appear here when your rating stage is reached." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">Employee</th><th className="px-2 py-2.5">Month</th>
              <th className="px-2 py-2.5">Self rating</th><th className="px-2 py-2.5">Your stage</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.submissionId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{r.employee?.name} <span className="text-ink-faint text-xs">{r.employee?.employeeCode}</span></td>
                  <td className="px-2 py-2.5">{r.month}/{r.year}</td>
                  <td className="px-2 py-2.5">{r.selfRating ?? '—'}</td>
                  <td className="px-2 py-2.5 text-xs">{r.stage.roleKey.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2.5 text-right"><Button size="sm" onClick={() => setOpen(r)}>Rate</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {open && <RateModal item={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); }} />}
    </>
  );
}

function RateModal({ item, onClose, onDone }) {
  const [pliRating, setPliRating] = useState('3');
  const [pliPct, setPliPct] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit() {
    if (!pliPct) { setMsg('PLI % is required.'); return; }
    setBusy(true); setMsg('');
    try { await api.post(`/pms/${item.submissionId}/rate`, { pliRating: Number(pliRating), pliPct: Number(pliPct), remarks }); onDone(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Rate — ${item.employee?.name} (${item.month}/${item.year})`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-ink-faint">PLI rating (1–5)</label>
            <Select value={pliRating} onChange={(e) => setPliRating(e.target.value)}>
              {[5, 4, 3, 2, 1].map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-xs text-ink-faint">PLI %</label>
            <Input type="number" value={pliPct} onChange={(e) => setPliPct(e.target.value)} placeholder="e.g. 95" />
          </div>
        </div>
        <Textarea rows={2} placeholder="Remarks…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Submit rating'}</Button>
      </div>
    </Modal>
  );
}

function TeamKpi() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/kpi/team-pending').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function review(id, action) {
    try { await api.post(`/kpi/${id}/review`, { action }); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <Card className="p-0">
      {msg && <p className="p-3 text-sm text-red-600">{msg}</p>}
      {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
        !rows.length ? <Empty title="No pending KPIs" subtitle="Team KPI submissions awaiting approval appear here." /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
            <th className="px-4 py-2.5">Employee</th><th className="px-2 py-2.5">Month</th>
            <th className="px-2 py-2.5">Status</th><th className="px-2 py-2.5">Submitted</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">{r.employee.name} <span className="text-ink-faint text-xs">{r.employee.designation || ''}</span></td>
                <td className="px-2 py-2.5">{r.month}/{r.year}</td>
                <td className="px-2 py-2.5 text-xs">{r.status}</td>
                <td className="px-2 py-2.5 text-ink-faint text-xs">{new Date(r.submittedAt).toLocaleDateString('en-IN')}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <Button size="sm" onClick={() => review(r.id, 'APPROVE')}>Approve</Button>
                  <Button size="sm" variant="outline" className="ml-2" onClick={() => review(r.id, 'DISCUSS')}>Discuss</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Grades() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/pms/grades').then(setRows).catch(() => setRows([])); }, []);
  return (
    <Card className="p-0">
      {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
            <th className="px-4 py-2.5">Grade</th><th className="px-2 py-2.5">Code</th>
            <th className="px-2 py-2.5">Label</th><th className="px-4 py-2.5">Performance range</th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.grade} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-semibold">{g.grade}</td>
                <td className="px-2 py-2.5">{g.code}</td>
                <td className="px-2 py-2.5">{g.label}</td>
                <td className="px-4 py-2.5 text-ink-soft">{g.maxPct ? `${g.minPct}% – ${g.maxPct}%` : `${g.minPct}% and above`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
