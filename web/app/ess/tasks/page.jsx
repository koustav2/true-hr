'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Textarea, Spinner, Empty, Field } from '@/components/ui.jsx';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import { useHasTeam } from '@/lib/perms.jsx';

const TONE = { PENDING: 'text-amber-700', ONGOING: 'text-sky-700', CLOSED: 'text-emerald-700' };

export default function TasksPage() {
  const [tab, setTab] = useState(0);
  // E32: Assign Task / Team Tasks only for someone who has a team.
  const [team, setTeam] = useState(null);
  useEffect(() => { api.get('/tasks/team-members').then(setTeam).catch(() => setTeam({ canAssign: false, members: [] })); }, []);
  // Both signals must agree: the shared team check (null = loading → hidden)
  // and the task endpoint's active team members.
  const hasTeam = useHasTeam() === true;
  const canAssign = hasTeam && !!team?.canAssign;
  const tabs = canAssign ? ['My Tasks', 'Assign Task', 'Team Tasks'] : ['My Tasks'];
  return (
    <div className="space-y-4">
      <h1 className="page-title text-ink">Tasks</h1>
      <div className="flex gap-1.5 border-b border-line">
        {tabs.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <MyTasks />}
      {tab === 1 && canAssign && <AssignTask team={team.members} />}
      {tab === 2 && canAssign && <TeamTasks />}
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
                  {t.description || '—'} · from {t.assignedByName || '—'} · due {fmtDate(t.dueDate)}{t.aroundTime ? ` ${t.aroundTime}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${TONE[t.status] || ''}`}>{label(t.status)}</span>
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

function AssignTask({ team }) {
  const blankForm = { assignedTo: '', title: '', description: '', dueDate: '', aroundTime: '' };
  const [f, setF] = useState(blankForm);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function assign() {
    setMsg('');
    const v = validator();
    v.require('assignedTo', f.assignedTo, 'Assign to');
    v.text('title', f.title, 'Title', { required: true, min: 3, max: 150 });
    v.text('description', f.description, 'Description', { max: 2000 });
    v.date('dueDate', f.dueDate, 'Due date', { required: true, min: todayIso(), minMsg: 'Due date cannot be in the past' });
    setErrors(v.fields);
    if (!v.ok) return;
    setBusy(true);
    try {
      await api.post('/tasks', { ...f, title: f.title.trim(), assignedTo: Number(f.assignedTo), aroundTime: f.aroundTime || undefined });
      setMsg('Task assigned.'); setF(blankForm); setErrors({});
    } catch (e) { setErrors(e.fields || {}); setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Card className="p-4 space-y-2.5 max-w-lg">
      <Field label="Assign to" required error={errors.assignedTo}>
        <Select value={f.assignedTo} onChange={set('assignedTo')}>
          <option value="">Select team member</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.name}{m.employeeCode ? ` · ${m.employeeCode}` : ''}</option>)}
        </Select>
      </Field>
      <Field label="Title" required error={errors.title}><Input value={f.title} maxLength={150} onChange={set('title')} /></Field>
      <Field label="Description" error={errors.description}><Textarea rows={2} value={f.description} onChange={set('description')} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Due date" required error={errors.dueDate}><Input type="date" min={todayIso()} value={f.dueDate} onChange={set('dueDate')} /></Field>
        <Field label="Due time" hint="Optional" error={errors.aroundTime}><Input type="time" value={f.aroundTime} onChange={set('aroundTime')} /></Field>
      </div>
      {msg && <p className={`text-sm ${msg === 'Task assigned.' ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
      <Button onClick={assign} disabled={busy}>{busy ? 'Assigning…' : 'Assign Task'}</Button>
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
            <div className="text-xs text-ink-faint">{t.description || '—'} · due {fmtDate(t.dueDate)}{t.aroundTime ? ` ${t.aroundTime}` : ''}{t.remark ? ` · “${t.remark}”` : ''}</div>
          </div>
          <span className={`text-xs font-semibold ${TONE[t.status] || ''}`}>{label(t.status)}</span>
        </Card>
      ))}
    </div>
  );
}
