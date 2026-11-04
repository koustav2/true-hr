'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator, addDays } from '@/lib/validate.js';
import { Card, Button, Input, Select, Textarea, Spinner, Empty, Field, ErrorSummary, Badge, useConfirm } from '@/components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger', CANCELLED: 'neutral' };
const iso = (v) => (v ? String(v).slice(0, 10) : '');

export default function AttendancePage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-ink">Attendance</h1>
      <p className="text-xs text-ink-faint">Punch in/out needs camera + GPS, so punching stays in the mobile app — everything else works here.</p>
      <div className="flex gap-1.5 border-b border-line overflow-x-auto">
        {['Monthly', 'Daily punches', 'Miss-Punch', 'On-Duty'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Monthly />}
      {tab === 1 && <Daily />}
      {tab === 2 && <MissPunch />}
      {tab === 3 && <OnDuty />}
    </div>
  );
}

// Month navigation that never goes past the current month or before `min`
// (the joining month, once the calendar has told us).
function useMonthNav(min) {
  const t = todayIso();
  const maxY = Number(t.slice(0, 4)); const maxM = Number(t.slice(5, 7));
  const [year, setYear] = useState(maxY);
  const [month, setMonth] = useState(maxM);
  const key = (y, m) => y * 12 + m;
  const canBack = !min || key(year, month) > key(min.year, min.month);
  const canFwd = key(year, month) < key(maxY, maxM);
  const shift = (d) => {
    let m = month + d, y = year;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    setMonth(m); setYear(y);
  };
  const bar = (
    <div className="flex items-center gap-3">
      <Button size="sm" variant="outline" disabled={!canBack} onClick={() => shift(-1)} aria-label="Previous month">←</Button>
      <span className="text-sm font-semibold w-36 text-center">{MONTHS[month - 1]} {year}</span>
      <Button size="sm" variant="outline" disabled={!canFwd} onClick={() => shift(1)} aria-label="Next month">→</Button>
      {!canBack && min && <span className="text-[11px] text-ink-faint">Joining month</span>}
    </div>
  );
  return { year, month, bar };
}

const CELL = {
  P: ['Present', 'bg-emerald-50 text-emerald-700 font-semibold'],
  A: ['Absent', 'bg-rose-50 text-rose-700 font-semibold'],
  L: ['Leave', 'bg-sky-50 text-sky-700'],
  H: ['Holiday', 'bg-violet-50 text-violet-600'],
  WO: ['Week off', 'bg-amber-50/60 text-amber-600'],
  NA: ['Not joined', 'bg-slate-50 text-ink-faint/60'],
};

function MonthCalendar({ data, year, month }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        {[['Present', 'P', 'bg-emerald-50 text-emerald-700'],
          ['Absent', 'A', 'bg-rose-50 text-rose-700'],
          ['Leave', 'L', 'bg-sky-50 text-sky-700'],
          ['Holiday', 'H', 'bg-violet-50 text-violet-700'],
          ['Week off', 'WO', 'bg-amber-50 text-amber-700'],
          ['Not applicable', 'NA', 'bg-slate-50 text-ink-faint']].map(([lbl, code, cls]) => (
          <div key={code} className={`rounded-xl py-2 ${cls}`}>
            <div className="text-base font-bold">{data.days.filter((d) => d.status === code).length}</div>
            <div className="text-[10px] text-ink-soft">{lbl}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div key={d} className="text-ink-faint font-semibold py-1">{d}</div>)}
        {Array.from({ length: new Date(year, month - 1, 1).getDay() }).map((_, i) => <div key={`b${i}`} />)}
        {data.days.map((d) => {
          const [txt, cls] = CELL[d.status] || ['—', 'bg-slate-50 text-ink-faint'];
          return (
            <div key={d.day} title={d.holiday || txt} className={`rounded-lg py-2 ${cls}`}>
              <div>{d.day}</div>
              <div className="text-[9px] truncate px-0.5">{d.status === 'H' && d.holiday ? d.holiday : txt}</div>
              {(d.punchIn || d.punchOut) && (
                <div className="text-[9px] text-ink-faint">
                  {d.punchIn ? new Date(d.punchIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--'}
                  –{d.punchOut ? new Date(d.punchOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--'}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data.holidays?.length > 0 && (
        <div className="text-xs text-ink-soft">
          <span className="font-semibold">Holidays this month: </span>
          {data.holidays.map((h) => `${h.day} ${MONTHS[month - 1].slice(0, 3)} — ${h.name}`).join(' · ')}
        </div>
      )}
    </Card>
  );
}

function Monthly() {
  const [min, setMin] = useState(null);
  const { year, month, bar } = useMonthNav(min);
  const [data, setData] = useState(null);
  const [today, setToday] = useState(null);
  useEffect(() => {
    setData(null);
    api.get(`/attendance/monthly?year=${year}&month=${month}`).then((d) => { setData(d); if (d.minMonth) setMin(d.minMonth); }).catch(() => setData(false));
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
      {data?.joiningDate && <p className="text-[11px] text-ink-faint">Date of joining: {fmtDate(data.joiningDate)}. Days before it are shown as Not applicable.</p>}
      {data === null ? <Spinner /> : data === false ? <Empty title="Could not load" /> : <MonthCalendar data={data} year={year} month={month} />}
    </div>
  );
}

function Daily() {
  const { year, month, bar } = useMonthNav(null);
  const [rows, setRows] = useState(null);
  useEffect(() => {
    setRows(null);
    api.get(`/attendance/daily?year=${year}&month=${month}`).then(setRows).catch(() => setRows([]));
  }, [year, month]);
  return (
    <div className="space-y-4">
      {bar}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No punches this month" /> : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2">Time</th><th className="px-2 py-2">Type</th><th className="px-4 py-2">Location</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{new Date(r.captured_at || r.capturedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                  <td className={`px-2 py-2 font-semibold ${r.type === 'IN' ? 'text-emerald-700' : 'text-rose-700'}`}>{r.type === 'IN' ? 'In' : 'Out'}</td>
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

const Chips = ({ value, onChange, options }) => (
  <div className="flex gap-2 flex-wrap">
    {options.map((s) => (
      <button key={s} onClick={() => onChange(s)}
        className={`px-3 py-1.5 text-xs rounded-full border ${value === s ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-line text-ink-soft'}`}>{label(s)}</button>
    ))}
  </div>
);

function MissPunch() {
  const t = todayIso();
  const thisY = Number(t.slice(0, 4));
  const [f, setF] = useState({ days: '', month: String(Number(t.slice(5, 7))), year: String(thisY), inTime: '', outTime: '', remarks: '' });
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmUi] = useConfirm();
  const load = () => api.get(`/misspunch?status=${status}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { setRows(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  function check() {
    const v = validator();
    const tokens = f.days.split(',').map((s) => s.trim()).filter(Boolean);
    const dim = new Date(Number(f.year), Number(f.month), 0).getDate();
    if (!tokens.length) v.add('days', 'Enter at least one day of the month (e.g. 3 or 3,5)');
    const bad = tokens.filter((x) => !/^\d{1,2}$/.test(x) || Number(x) < 1 || Number(x) > dim);
    if (bad.length) v.add('days', `${bad.join(', ')} ${bad.length === 1 ? 'is not a day' : 'are not days'} of ${MONTHS[Number(f.month) - 1]} ${f.year} (1–${dim})`);
    const future = tokens.filter((x) => !bad.includes(x)).map((d) => `${f.year}-${String(f.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`).filter((d) => d >= t);
    if (future.length) v.add('days', 'Miss-punch is only for past days');
    if (!f.inTime) v.add('inTime', 'In time is required');
    if (!f.outTime) v.add('outTime', 'Out time is required');
    if (f.inTime && f.outTime && f.outTime <= f.inTime) v.add('outTime', 'Out time must be after In time');
    v.text('remarks', f.remarks, 'Remarks', { required: true, min: 3, max: 500 });
    return v.fields;
  }

  async function apply() {
    const errs = check();
    setErrors(errs); setMsg('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('/misspunch', { days: f.days, month: Number(f.month), year: Number(f.year), inTime: f.inTime, outTime: f.outTime, remarks: f.remarks.trim() });
      setF({ ...f, days: '', inTime: '', outTime: '', remarks: '' }); setMsg('Applied.'); load();
    } catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); }
    finally { setBusy(false); }
  }
  async function cancel(r) {
    if (!(await confirm({ title: 'Cancel this miss-punch request?', tone: 'danger', confirmLabel: 'Cancel request', cancelLabel: 'Keep it',
      body: `Day(s) ${r.days} of ${r.month} ${r.year} will be withdrawn.` }))) return;
    try { await api.post(`/misspunch/${r.id}/cancel`); setMsg('Request cancelled.'); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
      {confirmUi}
      <Card className="p-4 space-y-2.5">
        <div className="font-semibold text-sm">Apply Miss-Punch</div>
        <ErrorSummary errors={errors} />
        <Field label="Day(s) of month (e.g. 1,5,10)" required error={errors.days}>
          <Input value={f.days} inputMode="numeric" onChange={(e) => setF({ ...f, days: e.target.value.replace(/[^\d,\s]/g, '') })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Month" required error={errors.month}><Select value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
          <Field label="Year" required error={errors.year}><Select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}>
            {[thisY - 1, thisY].map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="In time" required error={errors.inTime}><Input type="time" value={f.inTime} onChange={(e) => setF({ ...f, inTime: e.target.value })} /></Field>
          <Field label="Out time" required error={errors.outTime}><Input type="time" value={f.outTime} onChange={(e) => setF({ ...f, outTime: e.target.value })} /></Field>
        </div>
        <Field label="Remarks" required error={errors.remarks}><Textarea rows={2} maxLength={500} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        {msg && <p className={`text-sm ${['Applied.', 'Request cancelled.'].includes(msg) ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
        <Button onClick={apply} disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</Button>
        <p className="text-[11px] text-ink-faint">Only past days within the allowed window (usually the last 30 days) can be regularised.</p>
      </Card>
      <div className="space-y-3">
        <Chips value={status} onChange={setStatus} options={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']} />
        {!rows ? <Spinner /> : !rows.length ? <Empty title={`No ${label(status).toLowerCase()} requests`} /> :
          rows.map((r) => (
            <Card key={r.id} className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
              <div>
                <div className="font-medium">Day(s) {r.days} · {r.month} {r.year}{r.inTime ? ` · ${r.inTime}–${r.outTime}` : ''}</div>
                <div className="text-xs text-ink-faint">{r.remarks || '—'}{r.reviewNote ? ` · “${r.reviewNote}”` : ''}</div>
                {r.status === 'PENDING' && r.pendingWith && <div className="text-xs text-ink-soft">Pending with: <b>{r.pendingWith}</b></div>}
                {r.reviewedBy && r.status !== 'PENDING' && <div className="text-xs text-ink-soft">{label(r.status)} by {r.reviewedBy}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={TONE[r.status] || 'neutral'}>{label(r.status)}</Badge>
                {r.status === 'PENDING' && <Button size="sm" variant="outline" onClick={() => cancel(r)}>Cancel</Button>}
              </div>
            </Card>
          ))}
      </div>
    </div>
  );
}

function OnDuty() {
  const t = todayIso();
  const BLANK = { fromDate: t, toDate: t, dayType: 'FULL', place: '', reason: '' };
  const [f, setF] = useState(BLANK);
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/onduty?status=${status}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { setRows(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const min = addDays(t, -30); const max = addDays(t, 90);

  async function apply() {
    const v = validator();
    v.date('fromDate', f.fromDate, 'From date', { required: true, min, max });
    v.date('toDate', f.toDate, 'To date', { required: true, min, max });
    if (f.fromDate && f.toDate && f.toDate < f.fromDate) v.add('toDate', 'To date cannot be before From date');
    if (f.dayType === 'HALF' && f.fromDate !== f.toDate) v.add('dayType', 'Half day OD is for a single date');
    v.text('place', f.place, 'Place of duty', { required: true, min: 2, max: 200 });
    v.text('reason', f.reason, 'Purpose', { required: true, min: 3, max: 500 });
    setErrors(v.fields); setMsg('');
    if (!v.ok) return;
    setBusy(true);
    try { await api.post('/onduty', { ...f, place: f.place.trim(), reason: f.reason.trim() }); setF(BLANK); setMsg('On-duty applied.'); load(); }
    catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <div className="font-semibold text-sm">Apply On-Duty (OD)</div>
        <p className="text-xs text-ink-faint">For work away from office. An approved OD counts as present and earns a comp-off credit (Leave &gt; Comp-Off).</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From" required error={errors.fromDate}><Input type="date" min={min} max={max} value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field>
          <Field label="To" required error={errors.toDate}><Input type="date" min={f.fromDate || min} max={max} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
        </div>
        <Field label="Day type" error={errors.dayType}>
          <Select value={f.dayType} onChange={(e) => setF({ ...f, dayType: e.target.value })}>
            <option value="FULL">Full day</option><option value="HALF">Half day</option>
          </Select>
        </Field>
        <Field label="Place of duty" required error={errors.place}><Input maxLength={200} value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} /></Field>
        <Field label="Purpose" required error={errors.reason}><Textarea rows={2} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        {msg && <p className={`text-sm ${msg === 'On-duty applied.' ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
        <Button onClick={apply} disabled={busy}>{busy ? 'Submitting…' : 'Apply OD'}</Button>
      </Card>
      <div className="space-y-3">
        <Chips value={status} onChange={setStatus} options={['PENDING', 'APPROVED', 'REJECTED']} />
        {!rows ? <Spinner /> : !rows.length ? <Empty title={`No ${label(status).toLowerCase()} on-duty requests`} /> :
          rows.map((r) => (
            <Card key={r.id} className="p-3 text-sm flex justify-between items-center gap-2">
              <div>
                <div className="font-medium">{fmtDate(iso(r.fromDate))} → {fmtDate(iso(r.toDate))}{r.dayType === 'HALF' ? ' (half day)' : ''} · {r.place || '—'}</div>
                <div className="text-xs text-ink-faint">{r.reason || '—'}{r.reviewNote ? ` · “${r.reviewNote}”` : ''}</div>
              </div>
              <Badge tone={TONE[r.status] || 'neutral'}>{label(r.status)}</Badge>
            </Card>
          ))}
      </div>
    </div>
  );
}
