'use client';
import { useEffect, useState } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import {
  Card, Button, Input, Select, Textarea, Spinner, Empty, Field, Badge, Modal, SearchPicker, useConfirm,
} from '@/components/ui.jsx';

// Admin > Attendance (C41/E9): HR's view of daily attendance, one employee's
// month, and every pending leave / miss-punch / on-duty / comp-off request in
// the organisation — including those of employees with no reporting manager,
// which HR approves here.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KINDS = [['LEAVE', 'Leave'], ['MISS_PUNCH', 'Miss-punch'], ['ON_DUTY', 'On-duty'], ['COMP_OFF', 'Comp-off']];
const TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger', CANCELLED: 'neutral' };
const DAY_STATUS = {
  PRESENT: ['Present', 'ok'], ON_DUTY: ['On duty', 'ok'], REGULARISED: ['Regularised', 'ok'],
  IN: ['In (not out yet)', 'info'], MISSING_OUT: ['No punch-out', 'warn'], HOLIDAY: ['Holiday', 'grape'],
  WEEK_OFF: ['Week off', 'neutral'], LEAVE: ['On leave', 'info'], ABSENT: ['Absent', 'danger'],
  NOT_IN_YET: ['Not in yet', 'neutral'], NOT_JOINED: ['Not joined', 'neutral'],
};
const time = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');

// Deep links from the HR dashboard: ?tab=leave|misspunch|onduty|compoff (or
// daily|monthly) &status=PENDING. Read from window.location (no Suspense
// boundary needed, unlike useSearchParams).
const TAB_KIND = { leave: 'LEAVE', misspunch: 'MISS_PUNCH', 'miss-punch': 'MISS_PUNCH', onduty: 'ON_DUTY', 'on-duty': 'ON_DUTY', od: 'ON_DUTY', compoff: 'COMP_OFF', 'comp-off': 'COMP_OFF' };
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export default function AdminAttendancePage() {
  const [tab, setTab] = useState(0);
  const [init, setInit] = useState(null);
  useEffect(() => {
    const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const t = String(p.get('tab') || '').toLowerCase();
    const st = String(p.get('status') || '').toUpperCase();
    if (t === 'daily') setTab(1);
    else if (t === 'monthly') setTab(2);
    setInit({ kind: TAB_KIND[t] || 'LEAVE', status: STATUSES.includes(st) ? st : 'PENDING' });
  }, []);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-ink">Attendance</h1>
        <p className="text-ink-faint text-sm mt-0.5">
          Daily attendance, each employee&rsquo;s month, and approvals. Requests from employees without a reporting manager are approved here by HR.
        </p>
      </div>
      <div className="flex gap-1.5 border-b border-line overflow-x-auto">
        {['Approvals', 'Daily', 'Monthly'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && init && <Approvals key={`${init.kind}-${init.status}`} initialKind={init.kind} initialStatus={init.status} />}
      {tab === 1 && <Daily />}
      {tab === 2 && <Monthly />}
    </div>
  );
}

function Approvals({ initialKind = 'LEAVE', initialStatus = 'PENDING' }) {
  const [kind, setKind] = useState(initialKind);
  const [status, setStatus] = useState(initialStatus);
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState({});
  const [q, setQ] = useState('');
  const [onlyNoMgr, setOnlyNoMgr] = useState(false);
  const [msg, setMsg] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const [confirm, confirmUi] = useConfirm();

  const load = () => {
    setRows(null);
    api.get(`/admin/attendance/requests?kind=${kind}&status=${status}`).then(setRows).catch((e) => { setMsg(e.message); setRows([]); });
    api.get('/admin/attendance/summary').then(setSummary).catch(() => {});
  };
  useEffect(() => { load(); }, [kind, status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve(r) {
    const ok = await confirm({ title: 'Approve request?', confirmLabel: 'Approve',
      body: `${r.name} (${r.employeeCode}) — ${r.title}${r.noManager ? '' : `. Their manager (${r.approver}) has not acted yet; you are approving as HR.`}` });
    if (!ok) return;
    try { await api.post(`/admin/attendance/requests/${kind}/${r.id}/review`, { decision: 'APPROVED' }); setMsg('Approved.'); load(); }
    catch (e) { setMsg(e.message); }
  }
  async function reject() {
    if (!note.trim()) { setNoteErr('Give a reason for rejecting'); return; }
    try {
      await api.post(`/admin/attendance/requests/${kind}/${rejecting.id}/review`, { decision: 'REJECTED', note: note.trim() });
      setRejecting(null); setNote(''); setMsg('Rejected.'); load();
    } catch (e) { setNoteErr(e.fields?.note || e.message); }
  }

  const needle = q.trim().toLowerCase();
  const shown = (rows || []).filter((r) => (!onlyNoMgr || r.noManager)
    && (!needle || `${r.name} ${r.employeeCode}`.toLowerCase().includes(needle)));

  return (
    <div className="space-y-3">
      {confirmUi}
      <div className="flex flex-wrap gap-2">
        {KINDS.map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)}
            className={`px-3 py-1.5 text-xs rounded-full border ${kind === k ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-line text-ink-soft'}`}>
            {l}{summary[k]?.pending ? ` · ${summary[k].pending} pending` : ''}
            {summary[k]?.withoutManager ? <span className="text-neg"> ({summary[k].withoutManager} without manager)</span> : null}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or employee ID" className="w-64" />
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={onlyNoMgr} onChange={(e) => setOnlyNoMgr(e.target.checked)} /> Only employees without a manager
        </label>
      </div>
      {msg && <p className={`text-sm ${['Approved.', 'Rejected.'].includes(msg) ? 'text-pos' : 'text-neg'}`}>{msg}</p>}
      {!rows ? <Spinner /> : !shown.length ? (
        <Card><Empty title={rows.length ? 'No requests match your filters' : `No ${label(status).toLowerCase()} ${KINDS.find((x) => x[0] === kind)[1].toLowerCase()} requests`} /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Employee</th>
                <th className="text-left px-4 py-3 font-medium">Request</th>
                <th className="text-left px-4 py-3 font-medium">Dates</th>
                <th className="text-left px-4 py-3 font-medium">Approver</th>
                <th className="text-left px-4 py-3 font-medium">Applied</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/40 align-top">
                  <td className="px-4 py-2.5"><div className="font-medium text-ink">{r.name}</div><div className="text-[11px] text-ink-faint">{r.employeeCode}</div></td>
                  <td className="px-4 py-2.5">
                    <div className="text-ink">{r.title}</div>
                    {r.detail && <div className="text-[11.5px] text-ink-faint">{r.detail}</div>}
                    {r.hasCertificate && (
                      <button className="text-[11.5px] text-brand-700 hover:underline" onClick={() => openFile(`/admin/attendance/leave/${r.id}/certificate`).catch((e) => setMsg(e.message))}>View certificate</button>
                    )}
                    {r.reviewNote && <div className="text-[11.5px] text-ink-soft">“{r.reviewNote}”</div>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink-soft">{r.fromDate ? `${fmtDate(r.fromDate)}${r.toDate && r.toDate !== r.fromDate ? ` → ${fmtDate(r.toDate)}` : ''}` : '—'}</td>
                  <td className="px-4 py-2.5">{r.noManager ? <Badge tone="warn">HR</Badge> : <span className="text-ink-soft">{r.approver}</span>}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink-faint">{fmtDate(String(r.appliedAt || '').slice(0, 10))}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {r.status === 'PENDING' ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => approve(r)}>Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => { setRejecting(r); setNote(''); setNoteErr(''); }}>Reject</Button>
                      </div>
                    ) : <Badge tone={TONE[r.status] || 'neutral'}>{label(r.status)}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject request" tone="danger" size="sm"
        actions={<><Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" onClick={reject}>Reject</Button></>}>
        {rejecting && <p className="mb-2">{rejecting.name} — {rejecting.title}</p>}
        <Field label="Reason" required error={noteErr}>
          <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}

function Daily() {
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    setData(null);
    api.get(`/admin/attendance/daily?date=${date}`).then(setData).catch(() => setData({ rows: [] }));
  }, [date]);
  const needle = q.trim().toLowerCase();
  const rows = (data?.rows || []).filter((r) => !needle || `${r.name} ${r.employeeCode}`.toLowerCase().includes(needle));
  const count = (s) => (data?.rows || []).filter((r) => s.includes(r.status)).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" max={todayIso()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or employee ID" className="w-64" />
      </div>
      {data && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="ok">Present {count(['PRESENT', 'ON_DUTY', 'REGULARISED', 'IN'])}</Badge>
          <Badge tone="warn">No punch-out {count(['MISSING_OUT'])}</Badge>
          <Badge tone="info">On leave {count(['LEAVE'])}</Badge>
          <Badge tone="danger">Absent {count(['ABSENT'])}</Badge>
        </div>
      )}
      {!data ? <Spinner /> : !rows.length ? <Card><Empty title={data.rows.length ? 'No employee matches your search' : 'No active employees'} /></Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>{['Employee', 'Punch in', 'Punch out', 'Status'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const [txt, tone] = DAY_STATUS[r.status] || [label(r.status), 'neutral'];
                return (
                  <tr key={r.employeeId}>
                    <td className="px-4 py-2.5"><div className="font-medium text-ink">{r.name}</div><div className="text-[11px] text-ink-faint">{r.employeeCode}</div></td>
                    <td className="px-4 py-2.5">{time(r.punchIn)}</td>
                    <td className="px-4 py-2.5">{time(r.punchOut)}</td>
                    <td className="px-4 py-2.5"><Badge tone={tone}>{txt}</Badge>{r.detail && <span className="text-[11.5px] text-ink-faint ml-2">{r.detail}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

const CELL = {
  P: ['Present', 'bg-emerald-50 text-emerald-700 font-semibold'],
  A: ['Absent', 'bg-rose-50 text-rose-700 font-semibold'],
  L: ['Leave', 'bg-sky-50 text-sky-700'],
  H: ['Holiday', 'bg-violet-50 text-violet-600'],
  WO: ['Week off', 'bg-amber-50/60 text-amber-600'],
  NA: ['Not joined', 'bg-slate-50 text-ink-faint/60'],
};

function Monthly() {
  const t = todayIso();
  const [emps, setEmps] = useState([]);
  const [empId, setEmpId] = useState(null);
  const [year, setYear] = useState(Number(t.slice(0, 4)));
  const [month, setMonth] = useState(Number(t.slice(5, 7)));
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/admin/attendance/employees').then(setEmps).catch(() => {}); }, []);
  useEffect(() => {
    if (!empId) return;
    setData(null); setErr('');
    api.get(`/admin/attendance/monthly?employeeId=${empId}&year=${year}&month=${month}`).then(setData).catch((e) => setErr(e.message));
  }, [empId, year, month]);
  const key = (y, m) => y * 12 + m;
  const min = data?.minMonth;
  const canBack = !min || key(year, month) > key(min.year, min.month);
  const canFwd = key(year, month) < key(Number(t.slice(0, 4)), Number(t.slice(5, 7)));
  const shift = (d) => { let m = month + d, y = year; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } setMonth(m); setYear(y); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80">
          <Field label="Employee">
            <SearchPicker value={empId} onChange={(v) => setEmpId(v?.id ?? v)} options={emps}
              getLabel={(e) => `${e.name} (${e.employeeCode})`} />
          </Field>
        </div>
        <div className="flex items-center gap-3 pb-0.5">
          <Button size="sm" variant="outline" disabled={!canBack} onClick={() => shift(-1)} aria-label="Previous month">←</Button>
          <span className="text-sm font-semibold w-36 text-center">{MONTHS[month - 1]} {year}</span>
          <Button size="sm" variant="outline" disabled={!canFwd} onClick={() => shift(1)} aria-label="Next month">→</Button>
        </div>
      </div>
      {!empId ? <Card><Empty title="Choose an employee" subtitle="Their month shows punches, leave, holidays and week-offs." /></Card>
        : err ? <p className="text-sm text-neg">{err}</p>
        : !data ? <Spinner /> : (
          <Card className="p-4 space-y-3">
            <div className="text-sm text-ink-soft">
              {data.employee.name} ({data.employee.employeeCode}){data.joiningDate ? ` · joined ${fmtDate(data.joiningDate)}` : ''}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
              {Object.entries(CELL).map(([code, [lbl, cls]]) => (
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
                    {(d.punchIn || d.punchOut) && <div className="text-[9px] text-ink-faint">{time(d.punchIn)}–{time(d.punchOut)}</div>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
    </div>
  );
}
