'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { Card, Button, Input, Select, Field, Modal, Textarea, Spinner, Empty, Badge, PageHeader, StatTile, SearchPicker } from '@/components/ui.jsx';
import { downloadCsv } from '@/lib/csv.js';

const STATUSES = ['ALL', 'PROPOSED', 'APPROVED', 'APPLIED', 'CANCELLED'];
const TYPES = [
  { key: 'INCREMENT', label: 'Increment' },
  { key: 'PROMOTION', label: 'Promotion' },
  { key: 'CORRECTION', label: 'Correction' },
];
const TONE = { PROPOSED: 'warn', APPROVED: 'brand', APPLIED: 'ok', CANCELLED: 'neutral' };

const dmy = (iso) => {
  if (!iso) return '—';
  const p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso);
};
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
  const BLANK = { employeeId: '', effectiveFrom: '', revisionType: 'INCREMENT', mode: 'AMOUNT', newMonthlyCtc: '', hikePct: '', newGrade: '', newDesignationId: '', reason: '' };
  const [f, setF] = useState(BLANK);

  const load = () => {
    setRows(null);
    api.get(`/admin/increments?status=${status}`).then(setRows).catch(() => setRows([]));
    api.get('/admin/increments/summary').then(setSum).catch(() => setSum(null));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);
  useEffect(() => {
    api.get('/employees').then((r) => setEmployees(Array.isArray(r) ? r : [])).catch(() => setEmployees([]));
    api.get('/meta/designations').then((r) => setDesignations(Array.isArray(r) ? r : [])).catch(() => setDesignations([]));
  }, []);

  const empOptions = useMemo(() => employees.map((e) => ({
    id: e.id,
    label: `${e.first_name || e.firstName || ''} ${e.last_name || e.lastName || ''}`.trim()
      + (e.employee_code ? ` · ${e.employee_code}` : ''),
  })), [employees]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function act(id, path, body) {
    setBusy(id); setMsg('');
    try { await api.post(`/admin/increments/${id}/${path}`, body || {}); setApplyRow(null); setCancelRow(null); setNote(''); load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(0); }
  }

  async function submitPropose(e) {
    e.preventDefault();
    setBusy(-1); setMsg('');
    const body = {
      employeeId: f.employeeId, effectiveFrom: f.effectiveFrom, revisionType: f.revisionType,
      newGrade: f.newGrade || undefined, reason: f.reason || undefined,
      newDesignationId: f.revisionType === 'PROMOTION' ? (f.newDesignationId || undefined) : undefined,
      ...(f.mode === 'PCT' ? { hikePct: f.hikePct } : { newMonthlyCtc: f.newMonthlyCtc }),
    };
    try {
      await api.post('/admin/increments', body);
      setPropose(false); setF(BLANK); load();
    } catch (err) { setMsg(err.message); } finally { setBusy(0); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Increment management"
        subtitle="Salary revisions kept as a ledger. A revision is recorded, then approved, then applied — only an applied revision reaches payroll, so an April increment can be prepared in February."
        action={<Button onClick={() => { setPropose(true); setMsg(''); }}>New revision</Button>}
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
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All' : s[0] + s.slice(1).toLowerCase()}</option>)}
            </Select>
          </Field>
          <Button variant="outline" onClick={() => downloadCsv(`increments-${status.toLowerCase()}.csv`,
            (rows || []).map((r) => ({
              'Employee ID': r.employee?.code || '', Name: r.employee?.name || '',
              Type: r.revisionType, 'Effective from': (r.effectiveFrom || '').slice(0, 10),
              'Old monthly CTC': r.oldMonthlyCtc ?? '', 'New monthly CTC': r.newMonthlyCtc ?? '',
              'Hike %': r.hikePct ?? '', 'Old annual CTC': r.oldAnnualCtc ?? '', 'New annual CTC': r.newAnnualCtc ?? '',
              'New grade': r.newGrade || '', 'New designation': r.newDesignation || '',
              Reason: r.reason || '', Status: r.status, Applied: (r.appliedAt || '').slice(0, 10),
            })))}>
            Export CSV
          </Button>
        </div>
      </Card>

      {msg && <p className="text-sm text-neg">{msg}</p>}

      <Card className="overflow-hidden">
        {rows === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : rows.length === 0 ? (
            <Empty title={status === 'ALL' ? 'No revisions recorded yet' : `No ${status.toLowerCase()} revisions`}
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
                      <Badge tone={TONE[r.status] || 'neutral'}>{r.status}</Badge>
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
                          <button onClick={() => act(r.id, 'approve')} disabled={busy === r.id}
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
            <Button form="incr-form" type="submit" disabled={busy === -1 || !f.employeeId || !f.effectiveFrom}>
              {busy === -1 ? <Spinner /> : 'Record revision'}
            </Button>
          </>
        }>
        <form id="incr-form" onSubmit={submitPropose} className="grid gap-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Employee" required hint="The current CTC is read from the employee's salary structure.">
              <SearchPicker value={f.employeeId} onChange={(v) => setF((s) => ({ ...s, employeeId: v }))}
                options={empOptions} getLabel={(o) => o.label} />
            </Field>
          </div>
          <Field label="Revision type" required>
            <Select value={f.revisionType} onChange={set('revisionType')}>
              {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Effective from" required hint="Payroll picks it up only once you apply the revision.">
            <Input type="date" value={f.effectiveFrom} onChange={set('effectiveFrom')} />
          </Field>
          <Field label="Set the new pay by">
            <Select value={f.mode} onChange={set('mode')}>
              <option value="AMOUNT">New monthly CTC</option>
              <option value="PCT">Percentage hike</option>
            </Select>
          </Field>
          {f.mode === 'AMOUNT'
            ? <Field label="New monthly CTC" required><Input type="number" min="1" step="1" value={f.newMonthlyCtc} onChange={set('newMonthlyCtc')} placeholder="e.g. 55000" /></Field>
            : <Field label="Hike %" required hint="Rounded to the nearest rupee."><Input type="number" step="0.01" value={f.hikePct} onChange={set('hikePct')} placeholder="e.g. 12.5" /></Field>}
          <Field label="New grade" hint="Leave blank to keep the current grade."><Input value={f.newGrade} onChange={set('newGrade')} placeholder="e.g. G3" /></Field>
          {f.revisionType === 'PROMOTION' && (
            <Field label="New designation">
              <Select value={f.newDesignationId} onChange={set('newDesignationId')}>
                <option value="">— keep current —</option>
                {designations.map((d) => <option key={d.id} value={d.id}>{d.title || d.name}</option>)}
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Reason / citation">
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
        <Field label="Note (optional)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. superseded by the revised appraisal budget" />
        </Field>
      </Modal>
    </div>
  );
}
