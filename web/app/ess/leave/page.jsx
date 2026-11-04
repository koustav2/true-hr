'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { useHasTeam } from '@/lib/perms.jsx';
import { validator, addDays } from '@/lib/validate.js';
import {
  Card, Button, Input, Select, Textarea, Spinner, Empty, Field, ErrorSummary, Badge, Modal, useConfirm,
} from '@/components/ui.jsx';

const TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger', CANCELLED: 'neutral' };
const StatusChips = ({ value, onChange, options = ['PENDING', 'APPROVED', 'REJECTED'] }) => (
  <div className="flex gap-2 flex-wrap">
    {options.map((s) => (
      <button key={s} onClick={() => onChange(s)}
        className={`px-3 py-1.5 text-xs rounded-full border ${value === s ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-line text-ink-soft'}`}>{label(s)}</button>
    ))}
  </div>
);
const iso = (v) => (v ? String(v).slice(0, 10) : '');
const MAX_MB = 5;

const TABS = ['Apply Leave', 'My Leaves', 'Holidays', 'Comp-Off', 'Team Approvals'];

export default function LeavePage() {
  const [tab, setTab] = useState(0);
  // E2: Team Approvals only for people who have someone reporting to them.
  const hasTeam = useHasTeam();
  const tabs = hasTeam ? TABS : TABS.slice(0, 4);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-ink">Leave Management</h1>
      <div className="flex gap-1.5 border-b border-line overflow-x-auto">
        {tabs.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Apply />}
      {tab === 1 && <MyLeaves />}
      {tab === 2 && <HolidayList />}
      {tab === 3 && <CompOff />}
      {tab === 4 && hasTeam && <Team />}
    </div>
  );
}

const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split('base64,')[1] || '');
  r.onerror = () => reject(new Error('Could not read the file'));
  r.readAsDataURL(file);
});

const BLANK = { leaveCode: '', fromDate: '', toDate: '', halfDay: false, halfDaySession: '', reason: '' };

function Apply() {
  const [types, setTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [rh, setRh] = useState([]);
  const [f, setF] = useState(BLANK);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const today = todayIso();
  const loadBal = () => api.get('/leave/balances').then(setBalances).catch(() => {});
  useEffect(() => {
    api.get('/leave/types').then(setTypes).catch(() => {});
    loadBal();
    const y = Number(today.slice(0, 4));
    Promise.all([y, y + 1].map((yy) => api.get(`/leave/holidays?year=${yy}`).catch(() => [])))
      .then((all) => setRh(all.flat().filter((h) => h.kind === 'RESTRICTED' && h.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = types.find((t) => t.code === f.leaveCode);
  const bal = balances.find((b) => b.code === f.leaveCode);
  const single = sel?.singleDate || f.leaveCode === 'RH';
  const toDate = single ? f.fromDate : f.toDate;
  const sameDay = f.fromDate && toDate && f.fromDate === toDate;
  const certRule = sel?.allowCertificate
    ? (sel.certificateAfterDays == null ? 'optional' : sel.certificateAfterDays > 0 ? `required for more than ${sel.certificateAfterDays} day(s)` : 'required')
    : null;

  function check() {
    const v = validator();
    v.require('leaveCode', f.leaveCode, 'Leave type');
    v.date('fromDate', f.fromDate, 'From date', { required: true, max: addDays(today, 366) });
    if (!single) v.date('toDate', f.toDate, 'To date', { required: true, max: addDays(today, 366) });
    if (f.fromDate && toDate && toDate < f.fromDate) v.add('toDate', 'To date cannot be before From date');
    if (f.halfDay && !sameDay) v.add('halfDay', 'Half day is allowed only when From and To are the same date');
    if (f.halfDay && !f.halfDaySession) v.add('halfDaySession', 'Choose First half or Second half');
    v.text('reason', f.reason, 'Reason', { required: true, min: 3, max: 500 });
    if (sel && sel.requiresBalance && bal && bal.available <= 0) v.add('leaveCode', `No ${sel.name} balance available`);
    if (sel && !sel.requiresBalance && sel.code !== 'LWP' && bal && !bal.allocated) v.add('leaveCode', `${sel.name} is not allocated to you (0 days)`);
    if (file && file.size > MAX_MB * 1024 * 1024) v.add('certificate', `The certificate is larger than ${MAX_MB}MB`);
    if (sel?.allowCertificate && sel.certificateAfterDays === 0 && !file) v.add('certificate', `A certificate is required for ${sel.name}`);
    return v.fields;
  }

  async function apply() {
    const errs = check();
    setErrors(errs); setMsg('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body = { leaveCode: f.leaveCode, fromDate: f.fromDate, toDate, reason: f.reason.trim(), halfDay: f.halfDay,
        halfDaySession: f.halfDay ? f.halfDaySession : undefined };
      if (file) Object.assign(body, { certificate: await readFile(file), certificateMime: file.type, certificateName: file.name });
      const r = await api.post('/leave', body);
      setMsg(`Leave applied for ${r.days} day(s)${r.sandwichDays ? ` (includes ${r.sandwichDays} sandwiched week-off/holiday day(s))` : ''}. Waiting for ${r.approver || 'approval'}.`);
      setF(BLANK); setFile(null);
      loadBal();
    } catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid lg:grid-cols-[400px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <ErrorSummary errors={errors} />
        <Field label="Leave type" required error={errors.leaveCode}>
          <Select value={f.leaveCode} onChange={(e) => { setF({ ...f, leaveCode: e.target.value, halfDay: false, halfDaySession: '' }); setErrors({}); }}>
            <option value="">Select</option>
            {types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </Select>
        </Field>
        {sel && (
          <p className="text-xs text-ink-faint">
            {sel.requiresBalance
              ? `Available: ${bal?.available ?? 0} day(s)${bal?.pending ? ` (${bal.pending} pending)` : ''}`
              : sel.code === 'LWP' ? 'Unpaid leave — no balance needed' : `Allowance: ${bal?.allocated ?? 0} day(s) a year, ${bal?.available ?? 0} left`}
          </p>
        )}
        {f.leaveCode === 'RH' ? (
          <Field label="Restricted holiday" required error={errors.fromDate}>
            <Select value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })}>
              <option value="">{rh.length ? 'Select a listed restricted holiday' : 'No restricted holidays listed'}</option>
              {rh.map((h) => <option key={h.date} value={h.date}>{fmtDate(h.date)} — {h.name}</option>)}
            </Select>
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From" required error={errors.fromDate}>
              <Input type="date" max={addDays(today, 366)} value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} />
            </Field>
            {!single && (
              <Field label="To" required error={errors.toDate}>
                <Input type="date" min={f.fromDate || undefined} max={addDays(today, 366)} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />
              </Field>
            )}
          </div>
        )}
        {sel?.allowHalfDay && sameDay && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked, halfDaySession: e.target.checked ? f.halfDaySession : '' })} /> Half day
            </label>
            {f.halfDay && (
              <div className="flex gap-4 text-sm pl-6">
                {[['FIRST', 'First half'], ['SECOND', 'Second half']].map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="radio" name="session" checked={f.halfDaySession === k} onChange={() => setF({ ...f, halfDaySession: k })} /> {l}
                  </label>
                ))}
              </div>
            )}
            {errors.halfDaySession && <p className="text-[11.5px] text-neg pl-6">{errors.halfDaySession}</p>}
            {errors.halfDay && <p className="text-[11.5px] text-neg pl-6">{errors.halfDay}</p>}
          </div>
        )}
        <Field label="Reason" required error={errors.reason}>
          <Textarea rows={2} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
        {certRule && (
          <Field label={`Certificate (${certRule})`} error={errors.certificate} hint="PDF or image, up to 5MB.">
            <Input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
        )}
        {msg && <p className={`text-sm ${msg.startsWith('Leave applied') ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
        <Button onClick={apply} disabled={busy}>{busy ? 'Applying…' : 'Apply Leave'}</Button>
        <p className="text-[11px] text-ink-faint">
          Leaves on adjacent days are allowed. Week-offs and holidays between two leave days may be counted as leave (sandwich rule).
        </p>
      </Card>
      <Card className="p-4">
        <div className="font-semibold text-sm mb-2">My Balances</div>
        {!balances.length ? <p className="text-xs text-ink-faint">No balances yet.</p> : (
          <div className="grid sm:grid-cols-2 gap-2">
            {balances.map((b) => (
              <div key={b.code} className="border border-line rounded-lg px-3 py-2">
                <div className="flex justify-between text-sm">
                  <span className="text-ink-soft">{b.name}</span>
                  <span className="font-semibold">
                    {b.requiresBalance ? `${b.available} / ${b.allocated}` : b.code === 'LWP' ? 'No limit' : `${b.available ?? 0} / ${b.allocated}`}
                  </span>
                </div>
                <div className="text-[11px] text-ink-faint">
                  {b.requiresBalance ? `Available after ${b.pending || 0} pending · ${b.used} used` : b.code === 'LWP' ? 'Unpaid' : 'Allowance per year'}
                </div>
                {b.basis && <div className="text-[10.5px] text-ink-faint mt-0.5">{b.basis}</div>}
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
  const [confirm, confirmUi] = useConfirm();
  const load = () => api.get(`/leave?status=${status}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { setRows(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function cancel(r) {
    const ok = await confirm({ title: 'Cancel this leave?', tone: 'danger', confirmLabel: 'Cancel leave', cancelLabel: 'Keep it',
      body: `${r.leaveType}, ${fmtDate(iso(r.fromIso || r.fromDate))} to ${fmtDate(iso(r.toIso || r.toDate))} (${r.days} day(s)) will be withdrawn.` });
    if (!ok) return;
    try { await api.post(`/leave/${r.id}/cancel`); setMsg('Leave cancelled.'); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="space-y-3">
      {confirmUi}
      <StatusChips value={status} onChange={setStatus} options={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']} />
      {msg && <p className={`text-sm ${msg === 'Leave cancelled.' ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
      {!rows ? <Spinner /> : !rows.length ? <Empty title={`No ${label(status).toLowerCase()} leaves`} /> :
        rows.map((r) => (
          <Card key={r.id} className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
            <div className="space-y-0.5">
              <div className="font-medium">
                {r.leaveType} · {fmtDate(iso(r.fromIso || r.fromDate))} → {fmtDate(iso(r.toIso || r.toDate))} ({r.days} day{r.days === 1 ? '' : 's'}
                {r.halfDay ? `, ${r.halfDaySession === 'SECOND' ? 'second' : 'first'} half` : ''}{r.sandwichDays ? `, incl. ${r.sandwichDays} sandwiched` : ''})
              </div>
              <div className="text-xs text-ink-faint">{r.reason || '—'}{r.reviewNote ? ` · “${r.reviewNote}”` : ''}</div>
              {r.status === 'PENDING' && r.pendingWith && <div className="text-xs text-ink-soft">Pending with: <b>{r.pendingWith}</b></div>}
              {['APPROVED', 'REJECTED'].includes(r.status) && r.reviewedBy && (
                <div className="text-xs text-ink-soft">{label(r.status)} by {r.reviewedBy}{r.reviewedAt ? ` on ${fmtDate(iso(r.reviewedAt))}` : ''}</div>
              )}
              {r.status === 'CANCELLED' && (
                <div className="text-xs text-ink-soft">Cancelled{r.cancelledAt ? ` on ${new Date(r.cancelledAt).toLocaleString('en-IN')}` : ''}{r.cancelledBy ? ` by ${r.cancelledBy}` : ''}</div>
              )}
              {r.hasCertificate && (
                <button className="text-xs text-brand-700 hover:underline" onClick={() => openFile(`/leave/${r.id}/certificate`).catch((e) => setMsg(e.message))}>View certificate</button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={TONE[r.status] || 'neutral'}>{label(r.status)}</Badge>
              {r.status === 'PENDING' && <Button size="sm" variant="outline" onClick={() => cancel(r)}>Cancel</Button>}
            </div>
          </Card>
        ))}
    </div>
  );
}

function HolidayList() {
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); api.get(`/leave/holidays?year=${year}`).then(setRows).catch(() => setRows([])); }, [year]);
  const sorted = useMemo(() => (rows || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1)), [rows]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-32">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <span className="text-xs text-ink-faint">Holidays that apply to you. Restricted holidays (RH) are optional — apply for them as Restricted Holiday leave.</span>
      </div>
      {!rows ? <Spinner /> : !sorted.length ? <Empty title={`No holidays listed for ${year}`} /> : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2">Date</th><th className="px-4 py-2">Occasion</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Applies to</th></tr></thead>
            <tbody>
              {sorted.map((h) => (
                <tr key={`${h.date}-${h.name}`} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(h.date)}</td>
                  <td className="px-4 py-2">{h.name}</td>
                  <td className="px-4 py-2">{h.kind === 'RESTRICTED' ? <Badge tone="grape">RH</Badge> : <Badge tone="info">Holiday</Badge>}</td>
                  <td className="px-4 py-2 text-xs text-ink-faint">{[h.state || 'National', h.location].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function CompOff() {
  const [credits, setCredits] = useState(null);
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ onDutyId: '', leaveDate: '', remark: '' });
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const today = todayIso();
  const load = () => {
    api.get('/compoff/credits').then(setCredits).catch(() => setCredits([]));
    api.get('/compoff?status=PENDING').then(setRows).catch(() => setRows([]));
  };
  useEffect(() => { load(); }, []);
  const credit = (credits || []).find((c) => String(c.onDutyId) === String(f.onDutyId));
  async function avail() {
    const v = validator();
    if (!f.onDutyId) v.add('onDutyId', credits?.length ? 'Choose the comp-off credit to use' : 'You have no comp-off credit to use');
    v.date('leaveDate', f.leaveDate, 'Leave date', { required: true, min: today, max: credit ? iso(credit.expiryDate) : undefined,
      minMsg: 'Leave date cannot be in the past', maxMsg: 'Leave date is past the credit’s expiry' });
    setErrors(v.fields); setMsg('');
    if (!v.ok) return;
    try { await api.post('/compoff', { onDutyId: Number(f.onDutyId), leaveDate: f.leaveDate, remark: f.remark.trim() }); setMsg('Comp-off applied.'); setF({ onDutyId: '', leaveDate: '', remark: '' }); load(); }
    catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); }
  }
  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <div className="font-semibold text-sm">Avail Comp-Off</div>
        <p className="text-xs text-ink-faint">
          Each approved On-Duty (OD) earns one comp-off credit, usable within 30 days of the duty date.
          Apply for OD under Attendance &gt; On-Duty; once approved it appears here.
        </p>
        <Field label="Comp-off credit" required error={errors.onDutyId}>
          <Select value={f.onDutyId} onChange={(e) => setF({ ...f, onDutyId: e.target.value })}>
            <option value="">{credits === null ? 'Loading…' : credits.length ? 'Select credit' : 'No credits available'}</option>
            {(credits || []).map((c) => <option key={c.onDutyId} value={c.onDutyId}>OD on {fmtDate(iso(c.workedFrom))} — {c.location || 'On-duty'} (use by {fmtDate(iso(c.expiryDate))})</option>)}
          </Select>
        </Field>
        <Field label="Leave date" required error={errors.leaveDate}>
          <Input type="date" min={today} max={credit ? iso(credit.expiryDate) : undefined} value={f.leaveDate} onChange={(e) => setF({ ...f, leaveDate: e.target.value })} />
        </Field>
        <Field label="Remark" error={errors.remark}><Input maxLength={300} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
        {msg && <p className={`text-sm ${msg.includes('applied') ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
        <Button onClick={avail}>Apply</Button>
      </Card>
      <div className="space-y-3">
        <div className="font-semibold text-sm">Available credits</div>
        {credits === null ? <Spinner /> : !credits.length ? (
          <Empty title="No comp-off credits" subtitle="Credits come from approved On-Duty requests in the last 30 days." />
        ) : credits.map((c) => (
          <Card key={c.onDutyId} className="p-3 text-sm flex justify-between">
            <span>OD on {fmtDate(iso(c.workedFrom))}{c.location ? ` · ${c.location}` : ''}</span>
            <span className="text-xs text-ink-faint">use by {fmtDate(iso(c.expiryDate))}</span>
          </Card>
        ))}
        <div className="font-semibold text-sm pt-2">Pending comp-off requests</div>
        {!rows ? <Spinner /> : !rows.length ? <Empty title="No pending comp-off" /> :
          rows.map((r) => (
            <Card key={r.id} className="p-3 text-sm flex justify-between">
              <span>Leave on {fmtDate(iso(r.leaveDate))} · earned {fmtDate(iso(r.workedFrom))}</span>
              <Badge tone={TONE[r.status] || 'neutral'}>{label(r.status)}</Badge>
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
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const [confirm, confirmUi] = useConfirm();
  const load = () => api.get(`/leave/team?status=${status}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { setRows(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function approve(r) {
    if (!(await confirm({ title: 'Approve leave?', confirmLabel: 'Approve', body: `${r.name}: ${r.leaveType}, ${r.days} day(s).` }))) return;
    try { await api.post(`/leave/${r.id}/review`, { decision: 'APPROVED', note: '' }); setMsg(''); load(); } catch (e) { setMsg(e.message); }
  }
  async function reject() {
    if (!note.trim()) { setMsg('Give a reason for rejecting'); return; }
    try { await api.post(`/leave/${rejecting.id}/review`, { decision: 'REJECTED', note: note.trim() }); setRejecting(null); setNote(''); setMsg(''); load(); }
    catch (e) { setMsg(e.message); }
  }
  return (
    <div className="space-y-3">
      {confirmUi}
      <StatusChips value={status} onChange={setStatus} />
      {msg && !rejecting && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="Nothing here" subtitle="Team leave requests appear here." /> :
        rows.map((r) => (
          <Card key={r.id} className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
            <div>
              <div className="font-medium">{r.name} · {r.leaveType} · {fmtDate(iso(r.fromIso || r.fromDate))} → {fmtDate(iso(r.toIso || r.toDate))} ({r.days}d)</div>
              <div className="text-xs text-ink-faint">{r.reason || '—'}</div>
              {r.hasCertificate && (
                <button className="text-xs text-brand-700 hover:underline" onClick={() => openFile(`/leave/${r.id}/certificate`).catch((e) => setMsg(e.message))}>View certificate</button>
              )}
            </div>
            {r.status === 'PENDING' ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => approve(r)}>Approve</Button>
                <Button size="sm" variant="danger" onClick={() => { setRejecting(r); setNote(''); setMsg(''); }}>Reject</Button>
              </div>
            ) : <Badge tone={TONE[r.status] || 'neutral'}>{label(r.status)}</Badge>}
          </Card>
        ))}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject leave" tone="danger" size="sm"
        actions={<><Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" onClick={reject}>Reject</Button></>}>
        <Field label="Reason" required error={msg && rejecting ? msg : undefined}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
