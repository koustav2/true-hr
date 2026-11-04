'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Textarea, Spinner, Empty, Modal, Select, Field, ErrorSummary, useConfirm } from '@/components/ui.jsx';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';

const TABS = ['Overview', 'Rating queue', 'KPI approvals', 'Grade system'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATES = {
  NOT_SUBMITTED: 'KPI not submitted', RM_PENDING: 'KPI awaiting approval', DISCUSS: 'KPI sent back',
  LOCKED: 'KPI approved — PMS not submitted', PMS_PENDING: 'PMS rating in progress', RATED: 'Rated',
};


// The HR dashboard deep-links here with ?status= (and ?tab=); useSearchParams
// needs a Suspense boundary on a client page.
export default function PmsAdminPage() {
  return <Suspense fallback={null}><PmsAdmin /></Suspense>;
}

// Deep links: ?status=RM_PENDING → KPI approvals; ?status=APPROVAL_PENDING (a
// PMS rating in progress) → Rating queue; any other overview state → Overview
// filtered to it; ?tab=grades → Grade system.
function linkTarget(sp) {
  const s = String(sp.get('status') || '').toUpperCase();
  const t = String(sp.get('tab') || '').toLowerCase();
  if (t.startsWith('grade')) return { tab: 3, status: '' };
  if (['RM_PENDING', 'KPI_PENDING', 'PENDING'].includes(s) || t.startsWith('kpi')) return { tab: 2, status: '' };
  if (['APPROVAL_PENDING', 'PMS_PENDING', 'RATING_PENDING'].includes(s) || t.startsWith('rating')) return { tab: 1, status: '' };
  if (STATES[s]) return { tab: 0, status: s };
  if (s === 'FUNCTIONAL_APPROVED') return { tab: 0, status: 'RATED' };
  return { tab: 0, status: '' };
}

function PmsAdmin() {
  const sp = useSearchParams();
  const [initial] = useState(() => linkTarget(sp));
  const [tab, setTab] = useState(initial.tab);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-ink">PMS / KPI</h1>
        <p className="text-ink-faint text-sm mt-0.5">Every employee&rsquo;s KPI / PMS status, approvals, the rating chain and your grade ladder.</p>
      </div>
      <div className="flex gap-1.5 border-b border-line">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Overview initialStatus={initial.status} />}
      {tab === 1 && <RatingQueue />}
      {tab === 2 && <TeamKpi />}
      {tab === 3 && <Grades />}
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
          !rows.length ? <Empty title="Nothing waiting on you" subtitle="PMS submissions appear here when your rating stage is reached, or when a stage has nobody assigned." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">Employee</th><th className="px-2 py-2.5">Month</th>
              <th className="px-2 py-2.5">Self rating</th><th className="px-2 py-2.5">Your stage</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.submissionId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{r.employee?.name} <span className="text-ink-faint text-xs">{r.employee?.employeeCode}</span></td>
                  <td className="px-2 py-2.5">{MONTHS[r.month - 1]} {r.year}</td>
                  <td className="px-2 py-2.5">{r.selfRating ?? '—'}</td>
                  <td className="px-2 py-2.5 text-xs">{label(r.stage.roleKey)}{r.unassigned ? <span className="text-amber-700"> · nobody assigned — HR rates</span> : null}</td>
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

/**
 * The rating step, with the per-KRA grid GreenHR shows beside the self rating.
 *
 * The point of the grid here is provenance: a self rating derived from the
 * KRA's measurement band shows the achievement % it came from, so a rater can
 * see "3 because 96% of target" rather than a bare number somebody chose.
 */
function RateModal({ item, onClose, onDone }) {
  const [d, setD] = useState(null);
  const [pliRating, setPliRating] = useState('3');
  const [pliPct, setPliPct] = useState('');
  const [remarks, setRemarks] = useState('');
  const [kra, setKra] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!item.kpiId) return;
    api.get(`/kpi/${item.kpiId}`).then(setD).catch(() => setD(false));
  }, [item.kpiId]);

  async function submit() {
    if (!pliPct) { setMsg('PLI % is required.'); return; }
    setBusy(true); setMsg('');
    try {
      await api.post(`/pms/${item.submissionId}/rate`, {
        pliRating: Number(pliRating), pliPct: Number(pliPct), remarks,
        kraScores: Object.entries(kra)
          .filter(([, v]) => v.mgrRating !== undefined && v.mgrRating !== '')
          .map(([kraId, v]) => ({ kraId: Number(kraId), mgrRating: Number(v.mgrRating), mgrRemarks: v.mgrRemarks || null })),
      });
      onDone();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  const scoreFor = (kraId) => d?.pms?.scores?.find((x) => x.kraId === kraId);

  return (
    <Modal open onClose={onClose} title={`Rate — ${item.employee?.name} (${MONTHS[item.month - 1]} ${item.year})`} size="lg">
      <div className="space-y-3.5 max-h-[70vh] overflow-y-auto pr-1">
        <p className="text-[12.5px] text-ink-soft">
          Overall self rating <b className="text-ink">{item.selfRating ?? '—'}</b> — the weighted average of the
          per-KRA ratings below.
        </p>

        {d === null ? <div className="p-6 flex justify-center"><Spinner /></div>
          : d === false ? <p className="text-[12.5px] text-ink-faint">Could not load the KRA detail.</p>
          : (
          <div className="space-y-2">
            {(d.kras || []).map((k) => {
              const sc = scoreFor(k.id);
              const mine = kra[k.id] || {};
              const setK = (key) => (e) => setKra((x) => ({ ...x, [k.id]: { ...x[k.id], [key]: e.target.value } }));
              return (
                <Card key={k.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-ink">KRA {k.seq} — {k.weightage}%</div>
                      <p className="text-[12.5px] text-ink-soft">{k.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-ink-faint">Self</div>
                      <div className="text-[18px] font-semibold leading-none text-ink tabular-nums">{sc?.selfRating ?? '—'}</div>
                    </div>
                  </div>
                  <div className="text-[11.5px] text-ink-faint">
                    Target {sc?.mtdTarget || '—'} · Actual {sc?.mtdAchieved || '—'}
                    {sc?.achievementPct != null && <> · <b className="text-ink-soft">{sc.achievementPct}% of target</b></>}
                    {sc?.ratingSource === 'BAND' && ' · scored from the band'}
                    {sc?.ratingSource === 'ENTERED' && ' · entered by the employee (not measurable)'}
                  </div>
                  {sc?.selfRemarks && <p className="text-[11.5px] text-ink-soft">&ldquo;{sc.selfRemarks}&rdquo;</p>}
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Select value={mine.mgrRating ?? (sc?.mgrRating ?? '')} onChange={setK('mgrRating')}>
                      <option value="">Manager rating — leave to agree with self</option>
                      {[['5', '5 — OAT'], ['4', '4 — SAT'], ['3', '3 — AT'], ['2', '2 — BT'], ['1', '1 — SBT']]
                        .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <Input placeholder="Manager remarks" value={mine.mgrRemarks ?? (sc?.mgrRemarks || '')} onChange={setK('mgrRemarks')} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}

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
        <p className="text-[11.5px] text-ink-faint">
          If yours is the last stage in the chain, this PLI % sets the final grade on your organisation&rsquo;s grade ladder.
        </p>
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
  const [confirm, confirmUi] = useConfirm();
  const load = () => api.get('/kpi/team-pending').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function review(r, action) {
    const ok = await confirm(action === 'APPROVE'
      ? { title: 'Approve this KPI?', body: `${r.employee.name}'s KPI for ${MONTHS[r.month - 1]} ${r.year} is locked and they can submit their PMS.`, confirmLabel: 'Approve' }
      : { title: 'Send back for discussion?', body: `${r.employee.name} will be asked to edit and resubmit the KPI.`, confirmLabel: 'Send back' });
    if (!ok) return;
    setMsg('');
    try { await api.post(`/kpi/${r.id}/review`, { action }); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <Card className="p-0">
      {confirmUi}
      {msg && <p className="p-3 text-sm text-red-600">{msg}</p>}
      {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
        !rows.length ? <Empty title="No pending KPIs" subtitle="KPIs from your team, and from employees with no reporting manager, appear here." /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
            <th className="px-4 py-2.5">Employee</th><th className="px-2 py-2.5">Month</th>
            <th className="px-2 py-2.5">Status</th><th className="px-2 py-2.5">Submitted</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">{r.employee.name} <span className="text-ink-faint text-xs">{r.employee.designation || ''}</span></td>
                <td className="px-2 py-2.5">{MONTHS[r.month - 1]} {r.year}</td>
                <td className="px-2 py-2.5 text-xs">{label(r.status)}{r.routedToHr ? <span className="text-amber-700"> · no reporting manager — HR approves</span> : null}</td>
                <td className="px-2 py-2.5 text-ink-faint text-xs">{fmtDate(r.submittedAt)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <Button size="sm" onClick={() => review(r, 'APPROVE')}>Approve</Button>
                  <Button size="sm" variant="outline" className="ml-2" onClick={() => review(r, 'DISCUSS')}>Discuss</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// H120: one view of every active employee's KPI / PMS state for a month, plus
// opening a month ("start cycle") so employees can submit for it.
function Overview({ initialStatus = '' }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [status, setStatus] = useState(initialStatus);
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [cycleOpen, setCycleOpen] = useState(false);
  const load = () => {
    setD(null);
    const qs = new URLSearchParams({ year, month, ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
    api.get(`/admin/pms/overview?${qs}`).then(setD).catch((e) => setD({ error: e.message }));
  };
  useEffect(() => { load(); }, [year, month, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const years = [now.getFullYear() - 1, now.getFullYear()];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Month"><Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-36">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
        <Field label="Year"><Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-56">
          <option value="">All statuses</option>
          {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="Name or employee ID" className="w-48" /></Field>
        <Button variant="outline" onClick={load}>Search</Button>
        <div className="flex-1" />
        <Button onClick={() => setCycleOpen(true)}>Start KPI cycle</Button>
      </div>
      {d?.cycle && <p className="text-xs text-emerald-700">The {MONTHS[month - 1]} {year} cycle is open{d.cycle.closesOn ? ` until ${fmtDate(d.cycle.closesOn)}` : ''}.</p>}
      {d && !d.error && (
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(STATES).map(([k, v]) => (
            <span key={k} className="rounded border border-line bg-white px-2 py-1">{v}: <b>{d.counts?.[k] || 0}</b></span>
          ))}
        </div>
      )}
      <Card className="p-0 overflow-x-auto">
        {!d ? <div className="p-8 flex justify-center"><Spinner /></div>
          : d.error ? <p className="p-4 text-sm text-red-600">{d.error}</p>
          : !d.rows.length ? <Empty title={status || q ? 'No employees match these filters' : 'No active employees'} /> : (
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">Employee</th><th className="px-2 py-2.5">Reporting manager</th>
              <th className="px-2 py-2.5">Status</th><th className="px-2 py-2.5">Submitted</th>
              <th className="px-2 py-2.5">Self rating</th><th className="px-4 py-2.5">Grade</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.employee.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{r.employee.name} <span className="text-ink-faint text-xs">{r.employee.employeeCode}</span></td>
                  <td className="px-2 py-2.5 text-xs">{r.reportingManager || <span className="text-amber-700">None — HR approves</span>}</td>
                  <td className="px-2 py-2.5 text-xs">{STATES[r.state] || label(r.state)}</td>
                  <td className="px-2 py-2.5 text-xs text-ink-faint">{fmtDate(r.submittedAt)}</td>
                  <td className="px-2 py-2.5">{r.selfRating ?? '—'}</td>
                  <td className="px-4 py-2.5 font-semibold">{r.finalGrade || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {cycleOpen && <StartCycleModal year={year} month={month} onClose={() => setCycleOpen(false)} onDone={() => { setCycleOpen(false); load(); }} />}
    </div>
  );
}

function StartCycleModal({ year, month, onClose, onDone }) {
  const [confirm, confirmUi] = useConfirm();
  const [f, setF] = useState({ year: String(year), month: String(month), closesOn: '' });
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    const v = validator();
    v.require('month', f.month, 'Month');
    v.date('closesOn', f.closesOn, 'Closing date', { min: todayIso(), minMsg: 'Closing date cannot be in the past' });
    setErrors(v.fields);
    if (!v.ok) return;
    if (!(await confirm({ title: 'Start this KPI cycle?', body: `Every active employee will be notified to submit their KPI for ${MONTHS[Number(f.month) - 1]} ${f.year}.`, confirmLabel: 'Start cycle' }))) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.post('/admin/pms/cycles', { year: Number(f.year), month: Number(f.month), closesOn: f.closesOn || undefined });
      window.alert(`Cycle started — ${r.notified} employee(s) notified.`);
      onDone();
    } catch (e) { setErrors(e.fields || {}); setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Start KPI cycle" size="md"
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? 'Starting…' : 'Start cycle'}</Button></>}>
      {confirmUi}
      <div className="space-y-3">
        <p className="text-xs text-ink-faint">Opening a month lets employees submit a KPI for it (the current month is always open) and notifies them.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Month" required error={errors.month}><Select value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
          <Field label="Year" required error={errors.year}><Input type="number" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></Field>
        </div>
        <Field label="Closes on" hint="Optional" error={errors.closesOn}><Input type="date" min={todayIso()} value={f.closesOn} onChange={(e) => setF({ ...f, closesOn: e.target.value })} /></Field>
        {msg && !Object.keys(errors).length && <p className="text-sm text-red-600">{msg}</p>}
      </div>
    </Modal>
  );
}

// C36/H120: the organisation's own grade ladder. A grade runs from its "from %"
// up to (not including) the next grade's — so the ladder never has gaps.
function Grades() {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmUi] = useConfirm();
  const load = () => api.get('/pms/grades').then((r) => setD(Array.isArray(r) ? { custom: false, grades: r } : r)).catch(() => setD({ grades: [] }));
  useEffect(() => { load(); }, []);

  function startEdit() {
    setErrors({}); setMsg('');
    setEdit(d.grades.map((g) => ({ grade: String(g.grade), code: g.code, label: g.label, minPct: String(g.minPct) })));
  }
  const setRow = (i, k) => (e) => setEdit((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  async function save() {
    const v = validator();
    edit.forEach((g, i) => {
      v.number(`grades.${i}.grade`, g.grade, 'Grade', { required: true, integer: true, min: 1, max: 10 });
      v.require(`grades.${i}.code`, g.code, 'Code');
      v.require(`grades.${i}.label`, g.label, 'Label');
      v.number(`grades.${i}.minPct`, g.minPct, 'From %', { required: true, min: 0, max: 1000, decimals: 2 });
    });
    setErrors(v.fields);
    if (!v.ok) return;
    if (!(await confirm({ title: 'Save the grade ladder?', body: 'Ratings completed from now on are graded on this ladder. Grades already given do not change.', confirmLabel: 'Save' }))) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.put('/admin/pms/grades', {
        grades: edit.map((g) => ({ grade: Number(g.grade), code: g.code.trim(), label: g.label.trim(), minPct: Number(g.minPct) })),
      });
      setD(r); setEdit(null);
    } catch (e) { setErrors(e.fields || {}); setMsg(e.message); } finally { setBusy(false); }
  }
  async function reset() {
    if (!(await confirm({ title: 'Go back to the default ladder?', body: 'Your organisation’s custom grades are removed.', confirmLabel: 'Reset', tone: 'danger' }))) return;
    try { setD(await api.del('/admin/pms/grades')); } catch (e) { setMsg(e.message); }
  }

  if (!d) return <Card className="p-8 flex justify-center"><Spinner /></Card>;
  if (edit) {
    return (
      <Card className="p-4 space-y-3">
        {confirmUi}
        <p className="text-xs text-ink-faint">Each grade covers its &ldquo;from %&rdquo; up to, but not including, the next grade&rsquo;s. The lowest grade must start at 0%; the highest has no upper limit.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-ink-faint"><th className="py-1.5 pr-2">Grade (1-10)</th><th className="pr-2">Code</th><th className="pr-2">Label</th><th className="pr-2">From %</th><th /></tr></thead>
          <tbody>
            {edit.map((g, i) => (
              <tr key={i} className="align-top">
                <td className="py-1 pr-2 w-24"><Input type="number" value={g.grade} onChange={setRow(i, 'grade')} />{errors[`grades.${i}.grade`] && <p className="text-[11px] text-neg">{errors[`grades.${i}.grade`]}</p>}</td>
                <td className="py-1 pr-2 w-28"><Input value={g.code} maxLength={10} onChange={setRow(i, 'code')} />{errors[`grades.${i}.code`] && <p className="text-[11px] text-neg">{errors[`grades.${i}.code`]}</p>}</td>
                <td className="py-1 pr-2"><Input value={g.label} maxLength={80} onChange={setRow(i, 'label')} />{errors[`grades.${i}.label`] && <p className="text-[11px] text-neg">{errors[`grades.${i}.label`]}</p>}</td>
                <td className="py-1 pr-2 w-28"><Input type="number" step="0.01" value={g.minPct} onChange={setRow(i, 'minPct')} />{errors[`grades.${i}.minPct`] && <p className="text-[11px] text-neg">{errors[`grades.${i}.minPct`]}</p>}</td>
                <td className="py-1"><button type="button" className="text-xs text-red-600 mt-2" onClick={() => setEdit((rows) => rows.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {errors.grades && <p className="text-sm text-neg">{errors.grades}</p>}
        {Object.keys(errors).length > 3 && <ErrorSummary errors={errors} />}
        {msg && !Object.keys(errors).length && <p className="text-sm text-red-600">{msg}</p>}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={edit.length >= 10} onClick={() => setEdit((rows) => [...rows, { grade: '', code: '', label: '', minPct: '' }])}>+ Add grade</Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save ladder'}</Button>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-0">
      {confirmUi}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
        <span className="text-xs text-ink-faint">{d.custom ? 'Your organisation’s own grade ladder.' : 'The standard ladder — edit it to set your organisation’s own grades and ranges.'}</span>
        <div className="flex gap-2">
          {d.custom && <Button size="sm" variant="ghost" onClick={reset}>Reset to default</Button>}
          <Button size="sm" onClick={startEdit}>Edit grades</Button>
        </div>
      </div>
      {msg && <p className="p-3 text-sm text-red-600">{msg}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
          <th className="px-4 py-2.5">Grade</th><th className="px-2 py-2.5">Code</th>
          <th className="px-2 py-2.5">Label</th><th className="px-4 py-2.5">Performance range</th></tr></thead>
        <tbody>
          {d.grades.map((g) => (
            <tr key={g.grade} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 font-semibold">{g.grade}</td>
              <td className="px-2 py-2.5">{g.code}</td>
              <td className="px-2 py-2.5">{g.label}</td>
              <td className="px-4 py-2.5 text-ink-soft">{g.rangeLabel || (g.maxPct ? `${g.minPct}% – ${g.maxPct}%` : `${g.minPct}% and above`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
