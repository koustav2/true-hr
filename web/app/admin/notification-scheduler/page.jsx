'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Field, Input, Textarea, Select, Modal, Spinner, Empty, ConfirmClick } from '@/components/ui.jsx';

export default function SchedulerPage() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', body: '', audience: 'ALL', cadence: 'ONCE', runAtHour: '9', dayOfWeek: '1', dayOfMonth: '1' });

  const load = () => api.get('/admin/notification-schedules').then((r) => setRows(r.schedules || [])).catch((e) => { setMsg(e.message); setRows([]); });
  useEffect(() => { load(); }, []);

  async function create() {
    if (!f.title || !f.body) { setMsg('Title and message are required.'); return; }
    try { await api.post('/admin/notification-schedules', f); setOpen(false); setMsg(''); load(); } catch (e) { setMsg(e.message); }
  }
  async function toggle(id) { await api.post(`/admin/notification-schedules/${id}/toggle`, {}); load(); }
  async function runNow(id) { const r = await api.post(`/admin/notification-schedules/${id}/run`, {}); setMsg(`Sent to ${r.recipients} people.`); load(); }
  async function del(id) { await api.del(`/admin/notification-schedules/${id}`); load(); }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Notification Scheduler</h1>
          <p className="text-ink-faint text-sm mt-0.5">Schedule recurring announcements to everyone, a company, or a department.</p>
        </div>
        <Button onClick={() => { setOpen(true); setMsg(''); }}>New schedule</Button>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <Empty title="No schedules yet" subtitle="Create one to send recurring notifications automatically." />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['Title', 'Audience', 'Cadence', 'Next run', 'State', 'Actions'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3"><div className="font-medium">{s.title}</div><div className="text-ink-faint text-xs truncate max-w-[280px]">{s.body}</div></td>
                  <td className="px-4 py-3">{s.audience}{s.company_name ? ` · ${s.company_name}` : ''}{s.department_name ? ` · ${s.department_name}` : ''}</td>
                  <td className="px-4 py-3">{s.cadence} @ {String(s.run_at_hour).padStart(2, '0')}:00</td>
                  <td className="px-4 py-3 text-ink-faint">{s.next_run_at ? String(s.next_run_at).slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-ink-faint'}`}>{s.active ? 'active' : 'paused'}</span></td>
                  <td className="px-4 py-3 space-x-3">
                    <button onClick={() => runNow(s.id)} className="text-brand-700 font-medium">Send now</button>
                    <button onClick={() => toggle(s.id)} className="text-ink-soft">{s.active ? 'Pause' : 'Resume'}</button>
                    <ConfirmClick onConfirm={() => del(s.id)} className="text-rose-600" confirmLabel="Delete?">Delete</ConfirmClick>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New scheduled notification" size="lg"
        actions={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create}>Create</Button></>}>
        <div className="space-y-4">
          <Field label="Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Message" required><Textarea rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Audience"><Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="ALL">Everyone</option><option value="COMPANY">A company</option><option value="DEPARTMENT">A department</option></Select></Field>
            <Field label="Cadence"><Select value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value })}>{['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Hour of day (0–23)"><Input type="number" min="0" max="23" value={f.runAtHour} onChange={(e) => setF({ ...f, runAtHour: e.target.value })} /></Field>
            {f.cadence === 'WEEKLY' && <Field label="Day of week (0=Sun)"><Input type="number" min="0" max="6" value={f.dayOfWeek} onChange={(e) => setF({ ...f, dayOfWeek: e.target.value })} /></Field>}
            {f.cadence === 'MONTHLY' && <Field label="Day of month (1–28)"><Input type="number" min="1" max="28" value={f.dayOfMonth} onChange={(e) => setF({ ...f, dayOfMonth: e.target.value })} /></Field>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
