'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import {
  Card, Button, Field, Input, Textarea, Select, Modal, Spinner, Empty, ErrorSummary, useConfirm,
} from '@/components/ui.jsx';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CADENCES = ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'];
const EMPTY = { title: '', body: '', audience: 'ALL', companyId: '', departmentId: '', cadence: 'ONCE', time: '09:00', runOnDate: '', dayOfWeek: '1', dayOfMonth: '1' };
const pad = (n) => String(n).padStart(2, '0');

function when(s) {
  const t = s.run_time || `${pad(s.run_at_hour)}:${pad(s.run_at_minute || 0)}`;
  if (s.cadence === 'ONCE') return s.run_on_date ? `One time · ${fmtDate(String(s.run_on_date).slice(0, 10))} at ${t}` : `One time at ${t}`;
  if (s.cadence === 'WEEKLY') return `Every ${DAYS[s.day_of_week] ?? 'week'} at ${t}`;
  if (s.cadence === 'MONTHLY') return `Monthly on day ${s.day_of_month ?? 1} at ${t}`;
  return `Daily at ${t}`;
}
// next_run_at shown in India time, dd-mm-yyyy hh:mm.
function fmtIst(v) {
  if (!v) return '—';
  const d = new Date(new Date(v).getTime() + 330 * 60000);
  return `${fmtDate(d.toISOString().slice(0, 10))} ${d.toISOString().slice(11, 16)}`;
}

export default function SchedulerPage() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [f, setF] = useState(EMPTY);
  const [companies, setCompanies] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [confirm, confirmUi] = useConfirm();

  const load = () => api.get('/admin/notification-schedules').then((r) => setRows(r.schedules || [])).catch((e) => { setErr(e.message); setRows([]); });
  useEffect(() => {
    load();
    api.get('/meta/companies').then((r) => setCompanies(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/meta/departments').then((r) => setDepartments(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  function check() {
    const v = validator();
    v.text('title', f.title, 'Title', { required: true, max: 120 });
    v.text('body', f.body, 'Message', { required: true, max: 1000 });
    if (!/^\d{2}:\d{2}$/.test(f.time || '')) v.add('time', 'Time is required');
    if (f.cadence === 'ONCE') {
      v.date('runOnDate', f.runOnDate, 'Date', { required: true, min: todayIso(), minMsg: 'Date cannot be in the past' });
      if (!v.fields.runOnDate && f.runOnDate === todayIso() && /^\d{2}:\d{2}$/.test(f.time)) {
        const now = new Date();
        if (f.time <= `${pad(now.getHours())}:${pad(now.getMinutes())}`) v.add('time', 'That time today has already passed — choose a later time');
      }
    }
    if (f.audience === 'COMPANY' && !f.companyId) v.add('companyId', 'Choose the company');
    if (f.audience === 'DEPARTMENT' && !f.departmentId) v.add('departmentId', 'Choose the department');
    setErrors(v.fields);
    return v.ok;
  }

  async function create() {
    if (!check()) return;
    setSaving(true);
    try {
      const body = { title: f.title.trim(), body: f.body.trim(), audience: f.audience, cadence: f.cadence, time: f.time };
      if (f.audience === 'COMPANY') body.companyId = Number(f.companyId);
      if (f.audience === 'DEPARTMENT') body.departmentId = Number(f.departmentId);
      if (f.cadence === 'ONCE') body.runOnDate = f.runOnDate;
      if (f.cadence === 'WEEKLY') body.dayOfWeek = Number(f.dayOfWeek);
      if (f.cadence === 'MONTHLY') body.dayOfMonth = Number(f.dayOfMonth);
      const r = await api.post('/admin/notification-schedules', body);
      setOpen(false); setF(EMPTY); setErrors({}); setErr('');
      setMsg(r.warnings?.length ? `Schedule created. Heads-up: ${r.warnings.join('; ')}.` : 'Schedule created.');
      load();
    } catch (e) {
      // Keep the form open with the user's input; show every field error.
      setErrors(e.fields || { _: e.message });
    } finally { setSaving(false); }
  }
  async function toggle(s) {
    try { await api.post(`/admin/notification-schedules/${s.id}/toggle`, {}); setErr(''); load(); } catch (e) { setErr(e.message); }
  }
  async function runNow(s) {
    if (!(await confirm({ title: 'Send now?', body: `"${s.title}" will be sent to ${label(s.audience).toLowerCase()} right away.`, confirmLabel: 'Send now' }))) return;
    try { const r = await api.post(`/admin/notification-schedules/${s.id}/run`, {}); setMsg(`Sent to ${r.recipients} people.`); load(); } catch (e) { setErr(e.message); }
  }
  async function del(s) {
    if (!(await confirm({ title: 'Delete schedule?', body: `"${s.title}" will stop and be removed.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await api.del(`/admin/notification-schedules/${s.id}`); load(); } catch (e) { setErr(e.message); }
  }

  return (
    <div className="space-y-5">
      {confirmUi}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-ink">Notification Scheduler</h1>
          <p className="text-ink-faint text-sm mt-0.5">Schedule one-time or recurring announcements to everyone, a company, or a department. Times are India time (IST).</p>
        </div>
        <Button onClick={() => { setOpen(true); setMsg(''); setErrors({}); }}>New schedule</Button>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}

      <Card className="overflow-x-auto">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? <Empty title="No schedules yet" subtitle="Create one to send announcements automatically." />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['Title', 'Audience', 'When', 'Next run (IST)', 'State', 'Actions'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3"><div className="font-medium break-words">{s.title}</div><div className="text-ink-faint text-xs truncate max-w-[280px]">{s.body}</div></td>
                  <td className="px-4 py-3">{label(s.audience)}{s.company_name ? ` · ${s.company_name}` : ''}{s.department_name ? ` · ${s.department_name}` : ''}</td>
                  <td className="px-4 py-3">{when(s)}</td>
                  <td className="px-4 py-3 text-ink-faint">{s.active ? fmtIst(s.next_run_at) : '—'}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-ink-faint'}`}>{s.active ? 'Active' : (s.cadence === 'ONCE' && s.last_run_at ? 'Sent' : 'Paused')}</span></td>
                  <td className="px-4 py-3 space-x-3 whitespace-nowrap">
                    <button onClick={() => runNow(s)} className="text-brand-700 font-medium">Send now</button>
                    <button onClick={() => toggle(s)} className="text-ink-soft">{s.active ? 'Pause' : 'Resume'}</button>
                    <button onClick={() => del(s)} className="text-rose-600">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New scheduled notification" size="lg"
        actions={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button></>}>
        <div className="space-y-4">
          <ErrorSummary errors={errors} />
          <Field label="Title" required error={errors.title}><Input value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="Message" required error={errors.body}><Textarea rows={3} maxLength={1000} value={f.body} onChange={(e) => set('body', e.target.value)} /></Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Audience" error={errors.audience}>
              <Select value={f.audience} onChange={(e) => set('audience', e.target.value)}>
                <option value="ALL">Everyone</option><option value="COMPANY">A company</option><option value="DEPARTMENT">A department</option>
              </Select>
            </Field>
            {f.audience === 'COMPANY' && (
              <Field label="Company" required error={errors.companyId}>
                <Select value={f.companyId} onChange={(e) => set('companyId', e.target.value)}>
                  <option value="">Select…</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            {f.audience === 'DEPARTMENT' && (
              <Field label="Department" required error={errors.departmentId}>
                <Select value={f.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
                  <option value="">Select…</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Repeats" error={errors.cadence}>
              <Select value={f.cadence} onChange={(e) => set('cadence', e.target.value)}>{CADENCES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
            </Field>
            <Field label="Time (IST)" required error={errors.time} hint="Hours and minutes, 24-hour clock">
              <Input type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
            </Field>
            {f.cadence === 'ONCE' && (
              <Field label="Date" required error={errors.runOnDate}>
                <Input type="date" min={todayIso()} value={f.runOnDate} onChange={(e) => set('runOnDate', e.target.value)} />
              </Field>
            )}
            {f.cadence === 'WEEKLY' && (
              <Field label="Day of week" required error={errors.dayOfWeek}>
                <Select value={f.dayOfWeek} onChange={(e) => set('dayOfWeek', e.target.value)}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
              </Field>
            )}
            {f.cadence === 'MONTHLY' && (
              <Field label="Day of month" required error={errors.dayOfMonth} hint="1 to 28, so it runs every month">
                <Select value={f.dayOfMonth} onChange={(e) => set('dayOfMonth', e.target.value)}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select>
              </Field>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
