'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { Card, Button, Input, Select, Field, Modal, Textarea, Spinner, Empty, Badge, PageHeader, StatTile, SearchPicker, ErrorSummary, useConfirm } from '@/components/ui.jsx';
import { downloadCsv } from '@/lib/csv.js';
import { label, todayIso, fmtDate } from '@/lib/labels.js';
import { validator, toNumber, addYears } from '@/lib/validate.js';

const STATUSES = ['ALL', 'PROPOSED', 'APPROVED', 'APPLIED', 'CANCELLED'];
const TYPES = [
  { key: 'INCREMENT', label: 'Increment' },
  { key: 'PROMOTION', label: 'Promotion' },
  { key: 'CORRECTION', label: 'Correction' },
];
const TONE = { PROPOSED: 'warn', APPROVED: 'brand', APPLIED: 'ok', CANCELLED: 'neutral' };

const dmy = (iso) => fmtDate(iso ? String(iso).slice(0, 10) : null);
const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);

export default function IncrementsPage() {
  const [status, setStatus] = useState('ALL');
  const [rows, setRows] = useState(null);
  const [sum, setSum] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState('');
  const [propose, setPropose] = useState(false);
  const [applyRow, setApplyRow] = useState(null);
  const [issueLetter, setIssueLetter] = useState(true);
  const [cancelRow, setCancelRow] = useState(null);
  const [note, setNote] = useState('');
  const [confirm, confirmUi] = useConfirm();
  const BLANK = { employeeId: '', effectiveFrom: '', revisionType: 'INCREMENT', mode: 'ANNUAL', newMonthlyCtc: '', newAnnualCtc: '', hikePct: '', newDesignationId: '', reason: '', confirmBackdated: false };
  const [f, setF] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [cur, setCur] = useState(null);   // current pay of the chosen employee (H75)
  useEffect(() => {
    setCur(null);
    if (f.employeeId) api.get(`/admin/increments/current/${f.employeeId}`).then(setCur).catch(() => setCur(null));
  }, [f.employeeId]);

  const load = () => {
    setRows(null);
    api.get(`/admin/increments?status=${status}`).then(setRows).catch(() => setRows([]));
    api.get('/admin/increments/summary').then(setSum).catch(() => setSum(null));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);
  useEffect(() => {
    api.get('/employees').then((r) => setEmployees((Array.isArray(r) ? r : [])
      .filter((e) => (e.is_employee ?? (e.onboarding_status === 'ACTIVE' && e.employee_code))))).catch(() => setEmployees([]));
    api.get('/meta/designations').then((r) => setDesignations(Array.isArray(r) ? r : [])).catch(() => setDesignations([]));
  }, []);

  const empOptions = useMemo(() => employees.map((e) => ({
    id: e.id,
    label: `${e.first_name || e.firstName || ''} ${e.last_name || e.lastName || ''}`.trim()
      + (e.employee_code ? ` · ${e.employee_code}` : ''),
  })), [employees]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const [rowMsg, setRowMsg] = useState({});   // errors shown next to the row / inside the dialog
  async function act(id, path, body) {
    setBusy(id); setMsg(''); setRowMsg((m) => ({ ...m, [id]: '' }));
    try { await api.post(`/admin/increments/${id}/${path}`, body || {}); setApplyRow(null); setCancelRow(null); setNote(''); load(); }
    catch (e) { setRowMsg((m) => ({ ...m, [id]: e.message })); } finally { setBusy(0); }
  }
  async function approve(r) {
    if (!(await confirm({ title: `Approve ${r.employee?.name}'s revision?`, body: `${inr(r.newMonthlyCtc)} a month (${inr(r.newAnnualCtc)} a year) from ${dmy(r.effectiveFrom)}. The person who recorded it cannot approve it.`, confirmLabel: 'Approve' }))) return;
    act(r.id, 'approve');
  }

  const isCorrection = f.revisionType === 'CORRECTION';
  const mode = isCorrection ? 'AMOUNT' : f.mode;
  const today = todayIso();
  function validate() {
    const v = validator();
    v.require('employeeId', f.employeeId, 'Employee');
    v.date('effectiveFrom', f.effectiveFrom, 'Effective from', { required: true, min: cur?.dateOfJoining || undefined, max: addYears(today, 1), minMsg: 'Effective from cannot be before the joining date' });
    if (f.effectiveFrom && f.effectiveFrom < today && !f.confirmBackdated) v.add('effectiveFrom', `${dmy(f.effectiveFrom)} is in the past. Tick "This revision is back-dated" to record it anyway.`);
    if (mode === 'PCT') v.number('hikePct', f.hikePct, 'Hike %', { required: true, min: 0.01, max: 100 });
    else if (mode === 'ANNUAL') v.number('newAnnualCtc', f.newAnnualCtc, 'New annual CTC', { required: true, min: 12, max: 120000000 });
    else v.number('newMonthlyCtc', f.newMonthlyCtc, 'New monthly CTC', { required: true, min: 1, max: 10000000 });
    const newM = mode === 'ANNUAL' ? toNumber(f.newAnnualCtc) / 12 : mode === 'AMOUNT' ? toNumber(f.newMonthlyCtc) : null;
    if (!isCorrection && cur?.monthlyCtc && newM && newM < cur.monthlyCtc) v.add(mode === 'ANNUAL' ? 'newAnnualCtc' : 'newMonthlyCtc', 'That is a reduction, not an increment. Record it as a Correction if it is intentional.');
    if (f.revisionType === 'PROMOTION') v.require('newDesignationId', f.newDesignationId, 'New designation');
    return v;
  }
  async function submitPropose(e) {
    e.preventDefault();
    const v = validate();
    setErrors(v.fields);
    if (!v.ok) return;
    setBusy(-1);
    const body = {
      employeeId: f.employeeId, effectiveFrom: f.effectiveFrom, revisionType: f.revisionType, mode,
      reason: f.reason || undefined, confirmBackdated: f.confirmBackdated,
      newDesignationId: f.revisionType === 'PROMOTION' ? (f.newDesignationId || undefined) : undefined,
      ...(mode === 'PCT' ? { hikePct: f.hikePct } : mode === 'ANNUAL' ? { newAnnualCtc: f.newAnnualCtc } : { newMonthlyCtc: f.newMonthlyCtc }),
    };
    try {
      await api.post('/admin/increments', body);
      setPropose(false); setF(BLANK); setErrors({}); load();
    } catch (err) { setErrors(err.fields || { form: err.message }); } finally { setBusy(0); }
  }
  const preview = (() => {
    if (!cur?.monthlyCtc) return null;
    const m = mode === 'PCT' ? cur.monthlyCtc * (1 + (toNumber(f.hikePct) || 0) / 100) : mode === 'ANNUAL' ? (toNumber(f.newAnnualCtc) || 0) / 12 : (toNumber(f.newMonthlyCtc) || 0);
    return m > 0 ? m : null;
  })();

  return (
    <div className="space-y-5">
      {confirmUi}
      <PageHeader
        title="Increment management"
        subtitle="Salary revisions kept as a ledger. A revision is recorded, then approved, then applied — only an applied revision reaches payroll, so an April increment can be prepared in February."
        action={<Button onClick={() => { setPropose(true); setMsg(''); setErrors({}); }}>New revision</Button>}
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Awaiting approval" value={sum?.proposed ?? '—'} tone={sum?.proposed ? 'warn' : 'neutral'} />
        <StatTile label="Approved, not applied" value={sum?.approved ?? '—'} tone={sum?.approved ? 'brand' : 'neutral'}
          foot={sum?.dueToApply ? `${sum.dueToApply} already past its effective date` : null} footTone="warn" />
        <StatTile label="Applied" value={sum?.applied ?? '—'} tone="ok" />
        <StatTile label="Monthly payroll impact" value={sum ? inr(sum.appliedMonthlyDelta) : '—'} tone="neutral"
          caption="Sum of applied revisions" />
      </div>

      <Card className="p-3.5">
        <div className="flex flex-wrap items-end gap-2.5">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All' : label(s)}</option>)}
            </Select>
          </Field>
          <Button variant="outline" onClick={() => downloadCsv(`increments-${status.toLowerCase()}.csv`,
            (rows || []).map((r) => ({
              'Employee ID': r.employee?.code || '', Name: r.employee?.name || '',
              Type: label(r.revisionType), 'Effective from': (r.effectiveFrom || '').slice(0, 10),
              'Old monthly CTC': r.oldMonthlyCtc ?? '', 'New monthly CTC': r.newMonthlyCtc ?? '',
              'Hike %': r.hikePct ?? '', 'Old annual CTC': r.oldAnnualCtc ?? '', 'New annual CTC': r.newAnnualCtc ?? '',
              'New grade': r.newGrade || '', 'New designation': r.newDesignation || '',
              Reason: r.reason || '', Status: label(r.status), Applied: (r.appliedAt || '').slice(0, 10),
            })))}>
            Export CSV
          </Button>
        </div>
      </Card>

      {msg && <p className="text-sm text-neg">{msg}</p>}

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? (
            <Empty title={status === 'ALL' ? 'No revisions recorded yet' : `No ${label(status).toLowerCase()} revisions`}
              subtitle="Record a revision to keep the salary history — editing the structure directly overwrites it." />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Employee</th>
                  <th className="text-left">Type / effective</th>
                  <th className="num">Monthly CTC</th>
                  <th className="num">Hike</th>
                  <th className="text-left">Changes</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4">
                      <div className="text-ink font-medium">{r.employee?.name || `#${r.id}`}</div>
                      <div className="text-ink-faint text-[11.5px] font-mono">{r.employee?.code || '—'}</div>
                      <div className="text-ink-faint text-[11.5px]">{r.employee?.designation || '—'}</div>
                    </td>
                    <td className="px-4 whitespace-nowrap">
                      <Badge tone={TONE[r.status] || 'neutral'}>{label(r.status)}</Badge>
                      <div className="text-ink-soft text-[12.5px] mt-1">{TYPES.find((t) => t.key === r.revisionType)?.label || r.revisionType}</div>
                      <div className="text-ink-faint text-[11.5px]">w.e.f. {dmy(r.effectiveFrom)}</div>
                    </td>
                    <td className="num px-4 whitespace-nowrap">
                      <div className="text-ink font-medium tabular-nums">{inr(r.newMonthlyCtc)}</div>
                      <div className="text-ink-faint text-[11.5px] tabular-nums">from {inr(r.oldMonthlyCtc)}</div>
                      <div className="text-ink-faint text-[11.5px] tabular-nums">{inr(r.newAnnualCtc)} p.a.</div>
                    </td>
                    <td className="num px-4 whitespace-nowrap">
                      {r.hikePct == null ? <span className="text-ink-faint">—</span> : (
                        <>
                          <div className={`font-semibold tabular-nums ${r.hikePct >= 0 ? 'text-pos' : 'text-neg'}`}>{r.hikePct > 0 ? '+' : ''}{r.hikePct}%</div>
                          <div className="text-ink-faint text-[11.5px] tabular-nums">{inr(r.hikeAmount)}/mo</div>
                        </>
                      )}
                    </td>
                    <td className="px-4 max-w-[240px] text-[12.5px] text-ink-soft">
                      {r.newDesignation && <div>Designation → <b className="text-ink">{r.newDesignation}</b></div>}
                      {r.newGrade && <div>Grade → <b className="text-ink">{r.newGrade}</b></div>}
                      {r.reason && <div className="text-ink-faint text-[11.5px] mt-0.5">{r.reason}</div>}
                      {r.cancelNote && <div className="text-ink-faint text-[11.5px] mt-0.5">Cancelled: {r.cancelNote}</div>}
                      {!r.newDesignation && !r.newGrade && !r.reason && !r.cancelNote && <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="px-4 text-right whitespace-nowrap">
                      {r.status === 'PROPOSED' && (
                        <>
                          <button onClick={() => approve(r)} disabled={busy === r.id}
                            className="text-brand-600 text-[12px] font-semibold hover:underline mr-3 disabled:opacity-50">Approve</button>
                          <button onClick={() => { setCancelRow(r); setNote(''); }}
                            className="text-neg text-[12px] font-semibold hover:underline">Cancel</button>
                        </>
                      )}
                      {r.status === 'APPROVED' && (
                        <>
                          <button onClick={() => { setApplyRow(r); setIssueLetter(true); }}
                            className="text-pos text-[12px] font-semibold hover:underline mr-3">Apply</button>
                          <button onClick={() => { setCancelRow(r); setNote(''); }}
                            className="text-neg text-[12px] font-semibold hover:underline">Cancel</button>
                        </>
                      )}
                      {r.status === 'APPLIED' && (
                        r.letterId
                          ? <button onClick={() => downloadFile(`/admin/letters/${r.letterId}/pdf`, `revision-letter-${r.employee?.code || r.id}.pdf`)}
                              className="text-brand-600 text-[12px] font-semibold hover:underline">Letter</button>
                          : <span className="text-ink-faint text-[12px]">{dmy(r.appliedAt)}</span>
                      )}
                      {r.status === 'CANCELLED' && <span className="text-ink-faint text-[12px]">—</span>}
                      {r.status === 'APPROVED' && String(r.effectiveFrom).slice(0, 10) > today && <div className="text-[11px] text-ink-faint mt-1">Can be applied from {dmy(r.effectiveFrom)}</div>}
                      {rowMsg[r.id] && <div className="text-[11.5px] text-neg mt-1 max-w-[220px] ml-auto whitespace-normal">{rowMsg[r.id]}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={propose} onClose={() => setPropose(false)} title="Record a salary revision" size="lg"
        actions={
          <>
            <Button variant="ghost" onClick={() => setPropose(false)}>Cancel</Button>
            <Button form="incr-form" type="submit" disabled={busy === -1}>
              {busy === -1 ? <Spinner /> : 'Record revision'}
            </Button>
          </>
        }>
        <form id="incr-form" onSubmit={submitPropose} className="grid gap-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2"><ErrorSummary errors={errors} /></div>
          <div className="sm:col-span-2">
            <Field label="Employee" required error={errors.employeeId}>
              <SearchPicker value={f.employeeId} onChange={(v) => setF((s) => ({ ...s, employeeId: v }))} options={empOptions} getLabel={(o) => o.label} />
            </Field>
            {f.employeeId && (
              <div className="mt-2 rounded border border-line bg-canvas px-3 py-2 text-[12.5px] text-ink-soft">
                {!cur ? 'Reading current pay…' : cur.hasStructure
                  ? <>Current pay <b className="text-ink">{inr(cur.monthlyCtc)}</b> a month · <b className="text-ink">{inr(cur.annualCtc)}</b> a year{cur.grade ? <> · grade <b className="text-ink">{cur.grade}</b></> : null}{cur.designation ? <> · {cur.designation}</> : null}</>
                  : <>No salary structure yet{cur.annualCtc ? ` (offer CTC ${inr(cur.annualCtc)} a year)` : ''} — enter the new amount rather than a percentage.</>}
              </div>
            )}
          </div>
          <Field label="Revision type" required>
            <Select value={f.revisionType} onChange={set('revisionType')}>
              {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Effective from" required error={errors.effectiveFrom} hint="It can be applied to payroll from this date.">
            <Input type="date" value={f.effectiveFrom} min={cur?.dateOfJoining || undefined} max={addYears(today, 1)} onChange={set('effectiveFrom')} />
          </Field>
          {f.effectiveFrom && f.effectiveFrom < today && (
            <label className="sm:col-span-2 flex items-start gap-2 text-[12.5px] text-amber-800 bg-amber-50 rounded px-3 py-2 ring-1 ring-inset ring-amber-200">
              <input type="checkbox" className="mt-0.5" checked={f.confirmBackdated} onChange={(e) => setF((s) => ({ ...s, confirmBackdated: e.target.checked }))} />
              <span>This revision is back-dated ({dmy(f.effectiveFrom)}). Payslips already generated for the months since are not recalculated — add any difference as arrears.</span>
            </label>
          )}
          <Field label="Set the new pay by" hint={isCorrection ? 'A correction is entered as the corrected amount.' : null}>
            <Select value={mode} onChange={set('mode')} disabled={isCorrection}>
              <option value="ANNUAL">New annual CTC</option>
              <option value="AMOUNT">New monthly CTC</option>
              <option value="PCT">Percentage hike</option>
            </Select>
          </Field>
          {mode === 'PCT' && <Field label="Hike %" required error={errors.hikePct} hint="Rounded to the nearest rupee."><Input inputMode="decimal" value={f.hikePct} onChange={set('hikePct')} placeholder="e.g. 12.5" /></Field>}
          {mode === 'ANNUAL' && <Field label="New annual CTC (₹)" required error={errors.newAnnualCtc}><Input inputMode="decimal" value={f.newAnnualCtc} onChange={set('newAnnualCtc')} placeholder="e.g. 6,60,000" /></Field>}
          {mode === 'AMOUNT' && <Field label={isCorrection ? 'Corrected monthly CTC (₹)' : 'New monthly CTC (₹)'} required error={errors.newMonthlyCtc}><Input inputMode="decimal" value={f.newMonthlyCtc} onChange={set('newMonthlyCtc')} placeholder="e.g. 55,000" /></Field>}
          {preview && (
            <div className="sm:col-span-2 text-[12.5px] text-ink-soft">
              New pay: <b className="text-ink">{inr(preview)}</b> a month · <b className="text-ink">{inr(preview * 12)}</b> a year
              {cur?.monthlyCtc ? <> ({preview >= cur.monthlyCtc ? '+' : ''}{(((preview - cur.monthlyCtc) / cur.monthlyCtc) * 100).toFixed(2)}%)</> : null}
            </div>
          )}
          {f.revisionType === 'PROMOTION' && (
            <Field label="New designation" required error={errors.newDesignationId} hint="The grade follows the designation.">
              <Select value={f.newDesignationId} onChange={set('newDesignationId')}>
                <option value="">— choose —</option>
                {designations.map((d) => <option key={d.id} value={d.id}>{d.title || d.name}{d.grade ? ` (${d.grade})` : ''}</option>)}
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Reason / citation" error={errors.reason}>
              <Textarea rows={2} value={f.reason} onChange={set('reason')} placeholder="e.g. FY26 appraisal cycle, rating A" />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal open={!!applyRow} onClose={() => setApplyRow(null)} title="Apply revision to payroll"
        actions={
          <>
            <Button variant="ghost" onClick={() => setApplyRow(null)}>Not yet</Button>
            <Button disabled={busy === applyRow?.id} onClick={() => act(applyRow.id, 'apply', { issueLetter })}>
              {busy === applyRow?.id ? <Spinner /> : 'Apply now'}
            </Button>
          </>
        }>
        <p className="text-[13px] text-ink-soft">
          This writes <b className="text-ink">{inr(applyRow?.newMonthlyCtc)}</b> per month
          {applyRow?.oldMonthlyCtc != null && <> (from {inr(applyRow?.oldMonthlyCtc)})</>} onto
          {' '}<b className="text-ink">{applyRow?.employee?.name}</b>&apos;s salary structure, and updates the annual CTC used by the offer annexure.
          {applyRow?.newDesignation && <> The designation becomes <b className="text-ink">{applyRow.newDesignation}</b>.</>}
        </p>
        <p className="text-[12.5px] text-ink-faint mt-2">
          Payslips already generated are not recalculated — regenerate the month if it has been run.
        </p>
        {applyRow && String(applyRow.effectiveFrom).slice(0, 10) > today && (
          <p className="text-[12.5px] text-crit mt-2">This revision takes effect on {dmy(applyRow.effectiveFrom)}. It can only be applied on or after that date.</p>
        )}
        {applyRow && rowMsg[applyRow.id] && <p className="text-[12.5px] text-neg mt-2">{rowMsg[applyRow.id]}</p>}
        <label className="flex items-start gap-2.5 mt-3.5 text-[13px] text-ink-soft">
          <input type="checkbox" checked={issueLetter} onChange={(e) => setIssueLetter(e.target.checked)} className="mt-0.5" />
          <span>Issue the {applyRow?.revisionType === 'PROMOTION' ? 'promotion' : 'increment'} letter and file it under the employee&apos;s documents</span>
        </label>
      </Modal>

      <Modal open={!!cancelRow} onClose={() => setCancelRow(null)} title="Cancel this revision" tone="danger"
        actions={
          <>
            <Button variant="ghost" onClick={() => setCancelRow(null)}>Keep it</Button>
            <Button variant="danger" disabled={busy === cancelRow?.id} onClick={() => act(cancelRow.id, 'cancel', { note: note.trim() || undefined })}>
              {busy === cancelRow?.id ? <Spinner /> : 'Cancel revision'}
            </Button>
          </>
        }>
        <p className="text-[13px] text-ink-soft mb-3">
          The record stays in the ledger marked cancelled, so the trail survives. Nothing on the salary structure changes.
        </p>
        {cancelRow && rowMsg[cancelRow.id] && <p className="text-[12.5px] text-neg mb-2">{rowMsg[cancelRow.id]}</p>}
        <Field label="Note (optional)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. superseded by the revised appraisal budget" />
        </Field>
      </Modal>
    </div>
  );
}
