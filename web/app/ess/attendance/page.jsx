'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Textarea, Spinner, Empty, Field } from '@/components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TONE = { PENDING: 'text-amber-700', APPROVED: 'text-emerald-700', REJECTED: 'text-rose-700' };

export default function AttendancePage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">Attendance</h1>
      <p className="text-xs text-ink-faint">Punch in/out needs camera + GPS, so punching stays in the mobile app — everything else works here.</p>
      <div className="flex gap-1.5 border-b border-line">
        {['Monthly', 'Daily punches', 'Miss-Punch'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Monthly />}
      {tab === 1 && <Daily />}
      {tab === 2 && <MissPunch />}
    </div>
  );
}

function useMonthNav() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const shift = (d) => {
    let m = month + d, y = year;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    setMonth(m); setYear(y);
  };
  const bar = (
    <div className="flex items-center gap-3">
      <Button size="sm" variant="outline" onClick={() => shift(-1)}>←</Button>
      <span className="text-sm font-semibold w-36 text-center">{MONTHS[month - 1]} {year}</span>
      <Button size="sm" variant="outline" onClick={() => shift(1)}>→</Button>
    </div>
  );
  return { year, month, bar };
}

function Monthly() {
  const { year, month, bar } = useMonthNav();
  const [data, setData] = useState(null);
  const [today, setToday] = useState(null);
  useEffect(() => {
    setData(null);
    api.get(`/attendance/monthly?year=${year}&month=${month}`).then(setData).catch(() => setData(false));
  }, [year, month]);
  useEffect(() => { api.get('/attendance/today').then(setToday).catch(() => {}); }, []);

  return (
    <div className="space-y-4">
      {today && (
        <Card className="p-3 text-sm flex items-center justify-between">
          <span className="text-ink-soft">Today</span>
          <span className={`font-semibold ${today.completed ? 'text-emerald-700' : today.punchedIn ? 'text-amber-700' : 'text-ink-faint'}`}>
            {today.completed ? 'Punched in & out' : today.punchedIn ? 'Punched in — not yet out' : 'Not punched in (use the app)'}
          </span>
        </Card>
      )}
      {bar}
      {data === null ? <Spinner /> : data === false ? <Empty title="Could not load" /> : (
        <Card className="p-4">
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div key={d} className="text-ink-faint font-semibold py-1">{d}</div>)}
            {Array.from({ length: new Date(year, month - 1, 1).getDay() }).map((_, i) => <div key={`b${i}`} />)}
            {data.days.map((d) => (
              <div key={d.day} className={`rounded-lg py-2 ${
                d.status === 'P' ? 'bg-emerald-50 text-emerald-700 font-semibold' :
                d.status === 'WO' ? 'bg-amber-50/60 text-amber-600' : 'bg-slate-50 text-ink-faint'}`}>
                <div>{d.day}</div>
                <div className="text-[9px]">{d.status === 'P' ? 'Present' : d.status === 'WO' ? 'Week off' : '—'}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Daily() {
  const { year, month, bar } = useMonthNav();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    setRows(null);
    api.get(`/attendance/daily?year=${year}&month=${month}`).then(setRows).catch(() => setRows([]));
  }, [year, month]);
  return (
    <div className="space-y-4">
      {bar}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No punches this month" /> : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2">Time</th><th className="px-2 py-2">Type</th><th className="px-4 py-2">Location</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{new Date(r.captured_at || r.capturedAt).toLocaleString('en-IN')}</td>
                  <td className={`px-2 py-2 font-semibold ${r.type === 'IN' ? 'text-emerald-700' : 'text-rose-700'}`}>{r.type}</td>
                  <td className="px-4 py-2 text-xs text-ink-faint">{r.address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function MissPunch() {
  const now = new Date();
  const [days, setDays] = useState('');
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [remarks, setRemarks] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/misspunch?status=${status}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    setBusy(true); setMsg('');
    try { await api.post('/misspunch', { days, month: Number(month), year: Number(year), remarks }); setDays(''); setRemarks(''); setMsg('Applied.'); load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <div className="font-semibold text-sm">Apply Miss-Punch</div>
        <Field label="Day(s) of month (e.g. 1,5,10)" required><Input value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Month"><Select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
          <Field label="Year"><Input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>
        </div>
        <Field label="Remarks"><Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        {msg && <p className={`text-sm ${msg === 'Applied.' ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
        <Button onClick={apply} disabled={busy || !days}>{busy ? 'Submitting…' : 'Submit'}</Button>
      </Card>
      <div className="space-y-3">
        <div className="flex gap-2">
          {['PENDING', 'APPROVED', 'REJECTED'].map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 text-xs rounded-full border ${status === s ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-line text-ink-soft'}`}>{s}</button>
          ))}
        </div>
        {!rows ? <Spinner /> : !rows.length ? <Empty title={`No ${status.toLowerCase()} requests`} /> :
          rows.map((r) => (
            <Card key={r.id} className="p-3 text-sm flex justify-between items-center">
              <div>
                <div className="font-medium">{r.days} · {r.month} {r.year}</div>
                <div className="text-xs text-ink-faint">{r.remarks || '—'}{r.reviewNote ? ` · “${r.reviewNote}”` : ''}</div>
              </div>
              <span className={`text-xs font-semibold ${TONE[r.status] || ''}`}>{r.status}</span>
            </Card>
          ))}
      </div>
    </div>
  );
}
