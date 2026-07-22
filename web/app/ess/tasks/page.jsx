'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Textarea, Spinner, Empty, Field } from '@/components/ui.jsx';

const TONE = { PENDING: 'text-amber-700', ONGOING: 'text-sky-700', CLOSED: 'text-emerald-700' };

export default function TasksPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">Tasks</h1>
      <div className="flex gap-1.5 border-b border-line">
        {['My Tasks', 'Assign Task', 'Team Tasks'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <MyTasks />}
      {tab === 1 && <AssignTask />}
      {tab === 2 && <TeamTasks />}
    </div>
  );
}

function MyTasks() {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => {
    api.get('/tasks/summary').then(setSummary).catch(() => {});
    api.get('/tasks').then(setRows).catch(() => setRows([]));
  };
  useEffect(() => { load(); }, []);
  async function setStatus(id, status) {
    try { await api.post(`/tasks/${id}/status`, { status }); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          {[['Total', summary.total], ['Pending', summary.pending], ['Ongoing', summary.ongoing], ['Closed', summary.closed]].map(([l, v]) => (
            <Card key={l} className="p-3 text-center"><div className="text-xl font-bold">{v}</div><div className="text-xs text-ink-faint">{l}</div></Card>
          ))}
        </div>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No tasks assigned to you" /> :
        rows.map((t) => (
          <Card key={t.id} className="p-3 text-sm">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <div className="font-medium">{t.title}</div>
                <div className="text-xs text-ink-faint">
                  {t.description || '—'} · from {t.assignedByName || '—'} · due {t.dueDate?.slice(0, 10) || '—'}{t.aroundTime ? ` ${t.aroundTime}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${TONE[t.status] || ''}`}>{t.status}</span>
                {t.status !== 'CLOSED' && <>
                  {t.status === 'PENDING' && <Button size="sm" variant="outline" onClick={() => setStatus(t.id, 'ONGOING')}>Start</Button>}
                  <Button size="sm" onClick={() => setStatus(t.id, 'CLOSED')}>Close</Button>
                </>}
              </div>
            </div>
          </Card>
        ))}
    </div>
  );
}

function AssignTask() {
  const [team, setTeam] = useState([]);
  const [f, setF] = useState({ assignedTo: '', title: '', description: '', dueDate: '', aroundTime: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/me/team').then(setTeam).catch(() => {}); }, []);
  async function assign() {
    setBusy(true); setMsg('');
    try {
      await api.post('/tasks', { ...f, assignedTo: Number(f.assignedTo) });
      setMsg('Task assigned.'); setF({ assignedTo: '', title: '', description: '', dueDate: '', aroundTime: '' });
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Card className="p-4 space-y-2.5 max-w-lg">
      <Field label="Assign to" required>
        <Select value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}>
          <option value="">Select team member</option>
          {team.map((m) => <option key={m.id} value={m.id}>{`${m.firstName || m.first_name || ''} ${m.lastName || m.last_name || ''}`.trim() || m.name || m.employeeCode}</option>)}
        </Select>
      </Field>
      <Field label="Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Around time"><Input type="time" value={f.aroundTime} onChange={(e) => setF({ ...f, aroundTime: e.target.value })} /></Field>
      </div>
      {msg && <p className={`text-sm ${msg === 'Task assigned.' ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
      <Button onClick={assign} disabled={busy || !f.assignedTo || !f.title}>{busy ? 'Assigning…' : 'Assign Task'}</Button>
    </Card>
  );
}

function TeamTasks() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/tasks/team').then(setRows).catch(() => setRows([])); }, []);
  return !rows ? <Spinner /> : !rows.length ? <Empty title="No team tasks" subtitle="Tasks you assigned to your reports appear here." /> : (
    <div className="space-y-3">
      {rows.map((t) => (
        <Card key={t.id} className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
          <div>
            <div className="font-medium">{t.title} <span className="text-xs text-ink-faint">→ {t.assignedToName}</span></div>
            <div className="text-xs text-ink-faint">{t.description || '—'} · due {t.dueDate?.slice(0, 10) || '—'}{t.remark ? ` · “${t.remark}”` : ''}</div>
          </div>
          <span className={`text-xs font-semibold ${TONE[t.status] || ''}`}>{t.status}</span>
        </Card>
      ))}
    </div>
  );
}
