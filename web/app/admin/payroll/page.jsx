'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, downloadFile, openFile } from '@/lib/api.js';
import { downloadCsv } from '@/lib/csv.js';
import { label } from '@/lib/labels.js';
import { validator, toNumber } from '@/lib/validate.js';
import { Card, Button, Input, Select, Field, Modal, Spinner, Textarea, ErrorSummary, Badge, useConfirm } from '@/components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const inr = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const inr0 = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const MAX_AMOUNT = 10000000;
const UNIT = { PCT_CTC: '% of CTC', PCT_OF: '%', FLAT: '₹/mo', BALANCE: '' };

// The month has not closed yet (H68) — its attendance is still incomplete.
function monthOpen(y, m) {
  const now = new Date();
  return y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth() + 1);
}

function PreviewRow({ label: l, value, bold, tone }) {
  return (
    <div className={`flex justify-between py-1 text-[13px] ${bold ? 'font-bold' : ''} ${tone || 'text-ink-soft'}`}>
      <span>{l}</span><span className="tabular-nums">{value < 0 ? '−' : ''}{inr0(Math.abs(value))}</span>
    </div>
  );
}

// Breakup computed by the server — the same engine the payroll run uses (H78).
function ServerPreview({ pv, busy }) {
  if (!pv) return <div className="rounded-xl border border-line bg-slate-50/60 p-4 text-[12px] text-ink-faint">{busy ? 'Working out the breakup…' : 'Enter the monthly CTC to see the breakup.'}</div>;
  return (
    <div className="rounded-xl border border-line bg-slate-50/60 p-4">
      <div className="text-xs font-bold tracking-wide uppercase text-ink-faint mb-2">Monthly breakup (full month)</div>
      {pv.earnings.map((e) => <PreviewRow key={e.code} label={e.label} value={e.amount} />)}
      <div className="border-t border-line my-1.5" />
      <PreviewRow label="Gross earnings" value={pv.grossEarnings} bold tone="text-ink" />
      {pv.deductions.filter((d) => d.code !== 'TDS').map((d) => <PreviewRow key={d.code} label={d.label} value={-d.amount} tone="text-rose-600" />)}
      <div className="border-t border-line my-1.5" />
      <PreviewRow label="Net pay (before TDS)" value={pv.netPay} bold tone={pv.netPay < 0 ? 'text-rose-700' : 'text-emerald-700'} />
      {pv.pt?.state && <p className="mt-2 text-[11px] text-ink-faint">Professional Tax on the {pv.pt.state} slab for this gross.</p>}
      {(pv.warnings || []).map((w, i) => <p key={i} className="mt-2 text-[11px] text-rose-600">{w}</p>)}
    </div>
  );
}

export default function PayrollPage() {
  const now = new Date();
  const [confirm, confirmUi] = useConfirm();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [sheet, setSheet] = useState(null);
  const [summary, setSummary] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [runMsg, setRunMsg] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [allowEarly, setAllowEarly] = useState(false);

  const [structFor, setStructFor] = useState(null);
  const [struct, setStruct] = useState(null);          // server view
  const [sForm, setSForm] = useState({ monthlyCtc: '', overrides: {} });
  const [sErrors, setSErrors] = useState({});
  const [structBusy, setStructBusy] = useState(false);
  const [pv, setPv] = useState(null);
  const [pvBusy, setPvBusy] = useState(false);
  const pvTimer = useRef(null);

  const [genFor, setGenFor] = useState(null);
  const [gen, setGen] = useState({ daysPaid: '', arrears: '', bonus: '', tds: '' });
  const [genErrors, setGenErrors] = useState({});
  const [genBusy, setGenBusy] = useState(false);

  const [revertFor, setRevertFor] = useState(null);
  const [revertReason, setRevertReason] = useState('');
  const [revertErr, setRevertErr] = useState('');

  useEffect(() => { api.get('/meta/companies').then((r) => setCompanies(Array.isArray(r) ? r : [])).catch(() => setCompanies([])); }, []);

  const coQ = companyId ? `&companyId=${companyId}` : '';
  const load = () => {
    setSheet(null);
    api.get(`/admin/payslips?year=${year}&month=${month}${coQ}`)
      .then((r) => { setSheet(r.rows || []); setSummary(r.summary || null); setPolicy(r.policy || null); })
      .catch((e) => { setSheet([]); setSummary(null); setPolicy(null); setMsg(e.message); });
  };
  useEffect(() => { load(); setRunMsg(null); setAllowEarly(false); /* eslint-disable-next-line */ }, [year, month, companyId]);

  const isOpen = monthOpen(year, month);
  const coName = companies.length > 1 ? (companies.find((c) => String(c.id) === String(companyId))?.name || 'all companies') : 'this month';

  async function generateAll() {
    if (!(await confirm({ title: `Run payroll for ${MONTHS[month - 1]} ${year}?`, body: `Draft payslips are generated for ${coName}. Published payslips are skipped. TDS is worked out from each employee's projected salary and verified declarations.`, confirmLabel: 'Generate drafts' }))) return;
    setBulkBusy(true); setMsg(''); setRunMsg(null);
    try {
      const r = await api.post('/admin/payslips/generate-all', { year, month, ...(companyId ? { companyId: Number(companyId) } : {}) });
      setRunMsg(r); load();
    } catch (e) { setMsg(e.message); } finally { setBulkBusy(false); }
  }
  async function publishAll() {
    if (!(await confirm({ title: `Publish ${summary?.draft || 0} draft payslip(s)?`, body: 'Each employee is emailed that their payslip is ready. Published payslips are locked. Drafts with negative net pay are not published.', confirmLabel: 'Publish & notify', tone: 'danger' }))) return;
    setBulkBusy(true); setMsg('');
    try {
      const r = await api.post('/admin/payslips/publish-all', { year, month, allowBeforeMonthEnd: allowEarly, ...(companyId ? { companyId: Number(companyId) } : {}) });
      setRunMsg({ published: r.published }); load();
    } catch (e) { setMsg(e.message); } finally { setBulkBusy(false); }
  }
  async function downloadBankSheet() {
    const prefix = companies.find((c) => String(c.id) === String(companyId))?.codePrefix;
    try { await downloadFile(`/admin/payslips/export?year=${year}&month=${month}${coQ}`, `bank-advice-${prefix ? `${prefix}-` : ''}${year}-${String(month).padStart(2, '0')}.csv`); }
    catch (e) { setMsg(e.message); }
  }

  function openPolicy() {
    setPolicyForm({ attendanceBased: policy?.attendanceBased !== false, deductUnexplained: !!policy?.deductUnexplained, weekOffDays: policy?.weekOffDays?.length ? [...policy.weekOffDays] : [0] });
    setPolicyOpen(true);
  }
  async function savePolicy() {
    setPolicyBusy(true);
    try {
      await api.put('/admin/payroll-settings', { attendanceBased: policyForm.attendanceBased, deductUnexplained: policyForm.deductUnexplained, weekOffDays: policyForm.weekOffDays.length ? policyForm.weekOffDays : [0] });
      setPolicyOpen(false); load();
    } catch (e) { setMsg(e.message); } finally { setPolicyBusy(false); }
  }

  // ── Structure (D6: monthly CTC + overrides of the company's components) ──
  async function openStructure(row) {
    setStructFor(row); setStruct(null); setPv(null); setSErrors({});
    try {
      const s = await api.get(`/admin/salary-structure/${row.employeeId}`);
      setStruct(s);
      setSForm({
        monthlyCtc: s.monthlyCtc ?? s.suggestedMonthlyCtc ?? '',
        overrides: Object.fromEntries(s.components.filter((c) => c.employeeValue != null).map((c) => [c.code, String(c.employeeValue)])),
      });
    } catch (e) { setStructFor(null); setMsg(e.message); }
  }
  const sFormKey = JSON.stringify(sForm);
  useEffect(() => {
    if (!structFor || !struct) return undefined;
    clearTimeout(pvTimer.current);
    const ctc = toNumber(sForm.monthlyCtc);
    if (!ctc || Number.isNaN(ctc) || ctc <= 0) { setPv(null); return undefined; }
    pvTimer.current = setTimeout(async () => {
      setPvBusy(true);
      try { setPv(await api.post('/admin/payroll/preview', { employeeId: structFor.employeeId, monthlyCtc: ctc, overrides: cleanOverrides(), month })); }
      catch { setPv(null); } finally { setPvBusy(false); }
    }, 350);
    return () => clearTimeout(pvTimer.current);
    // eslint-disable-next-line
  }, [sFormKey, struct]);

  function cleanOverrides() {
    const out = {};
    for (const c of struct?.components || []) {
      if (!c.perEmployee) continue;
      const v = sForm.overrides[c.code];
      if (v === undefined) continue;
      out[c.code] = v === '' ? null : v;
    }
    return out;
  }
  function validateStructure() {
    const v = validator();
    v.number('monthlyCtc', sForm.monthlyCtc, 'Monthly CTC', { required: true, min: 1, max: MAX_AMOUNT });
    for (const c of struct.components) {
      const val = sForm.overrides[c.code];
      if (!c.perEmployee || val === undefined || val === '') continue;
      const pct = c.calc === 'PCT_CTC' || c.calc === 'PCT_OF';
      v.number(`overrides.${c.code}`, val, c.label, { min: 0, max: pct ? 100 : MAX_AMOUNT });
    }
    if (pv && pv.totalDeductions > pv.grossEarnings) v.add('deductions', 'Deductions are more than gross pay — net pay would be negative');
    return v;
  }
  async function saveStructure() {
    const v = validateStructure();
    setSErrors(v.fields);
    if (!v.ok) return;
    setStructBusy(true);
    try {
      await api.put(`/admin/salary-structure/${structFor.employeeId}`, { monthlyCtc: sForm.monthlyCtc, overrides: cleanOverrides() });
      setStructFor(null); load();
    } catch (e) { setSErrors({ ...(e.fields || {}), ...(e.fields ? {} : { form: e.message }) }); }
    finally { setStructBusy(false); }
  }

  // ── Generate (C21) ──
  function openGenerate(row) { setGenFor(row); setGen({ daysPaid: '', arrears: '', bonus: '', tds: '' }); setGenErrors({}); }
  async function runGenerate() {
    const dim = daysInMonth(year, month);
    const v = validator();
    v.number('daysPaid', gen.daysPaid, 'Days paid', { min: 0, max: dim });
    v.number('arrears', gen.arrears, 'Arrears', { min: 0, max: MAX_AMOUNT });
    v.number('bonus', gen.bonus, 'Bonus', { min: 0, max: MAX_AMOUNT });
    v.number('tds', gen.tds, 'TDS', { min: 0, max: MAX_AMOUNT });
    setGenErrors(v.fields);
    if (!v.ok) return;
    if (genFor.payslipId && !(await confirm({ title: 'Regenerate this draft?', body: 'The existing draft is replaced with freshly computed figures.', confirmLabel: 'Regenerate' }))) return;
    setGenBusy(true);
    try {
      await api.post('/admin/payslips/generate', {
        employeeId: genFor.employeeId, year, month,
        daysPaid: gen.daysPaid === '' ? null : gen.daysPaid, arrears: gen.arrears || 0, bonus: gen.bonus || 0,
        tds: gen.tds === '' ? null : gen.tds,
      });
      setGenFor(null); load();
    } catch (e) { setGenErrors(e.fields ? { ...e.fields } : { form: e.message }); }
    finally { setGenBusy(false); }
  }

  async function publish(row) {
    const negative = Number(row.netPay) < 0;
    if (negative) { setMsg(`${row.name}'s net pay is negative — regenerate the draft before publishing.`); return; }
    if (isOpen && !allowEarly) { setMsg(`${MONTHS[month - 1]} ${year} has not ended. Tick "Publish before the month ends" to publish anyway.`); return; }
    if (!(await confirm({ title: `Publish ${row.name}'s payslip?`, body: `Net pay ₹${inr(row.netPay)}. The employee is emailed and the payslip is locked.`, confirmLabel: 'Publish', tone: 'danger' }))) return;
    try { await api.post(`/admin/payslips/${row.payslipId}/publish`, { allowBeforeMonthEnd: allowEarly }); load(); }
    catch (e) { setMsg(e.message); }
  }
  async function removeSlip(row) {
    if (!(await confirm({ title: 'Delete this draft payslip?', body: `${row.name} — ${MONTHS[month - 1]} ${year}. This cannot be undone.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await api.del(`/admin/payslips/${row.payslipId}`); load(); } catch (e) { setMsg(e.message); }
  }
  async function revert() {
    const v = validator();
    v.text('reason', revertReason, 'Reason', { required: true, min: 5, max: 500 });
    if (!v.ok) { setRevertErr(v.fields.reason); return; }
    try { await api.post(`/admin/payslips/${revertFor.payslipId}/unpublish`, { reason: revertReason.trim() }); setRevertFor(null); load(); }
    catch (e) { setRevertErr(e.fields?.reason || e.message); }
  }
  const viewPdf = (id) => openFile(`/admin/payslips/${id}/pdf`).catch((e) => setMsg(e.message));

  // H72: current year ± what payroll actually needs (two back, one ahead).
  const years = useMemo(() => [now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2], []); // eslint-disable-line
  const term = q.trim().toLowerCase();
  const visible = (sheet || []).filter((r) => !term || `${r.name} ${r.employeeCode || ''}`.toLowerCase().includes(term));

  return (
    <div className="space-y-5">
      {confirmUi}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title text-ink">Payroll</h1>
          <p className="text-ink-faint text-sm mt-0.5">Set each employee&apos;s monthly CTC, then generate and publish monthly payslips. The payslip lines come from the company&apos;s <Link href="/admin/salary-components" className="text-brand-700 hover:underline">Payslip components</Link>.</p>
        </div>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg} <button className="ml-2 text-ink-faint underline" onClick={() => setMsg('')}>dismiss</button></p>}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            ['Employees', summary.employees, 'text-ink'],
            ['Structures set', summary.withStructure, summary.withStructure < summary.employees ? 'text-amber-600' : 'text-ink'],
            ['Generated', summary.generated, 'text-ink'],
            ['Published', summary.published, 'text-emerald-700'],
            ['Published net pay', `₹${inr(summary.publishedNetTotal)}`, 'text-emerald-700'],
            ...(summary.needingReview ? [['Needs attendance review', summary.needingReview, 'text-amber-600']] : []),
          ].map(([l, value, tone]) => (
            <Card key={l} className="p-4"><div className="text-xs text-ink-faint">{l}</div><div className={`text-xl font-extrabold tracking-tight mt-0.5 ${tone}`}>{value}</div></Card>
          ))}
        </div>
      )}

      {summary?.needingReview > 0 && (
        <div className="rounded-lg bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200 px-4 py-3 text-sm">
          <b>{summary.needingReview} employee{summary.needingReview === 1 ? '' : 's'}</b> have {summary.unexplainedDays} day{summary.unexplainedDays === 1 ? '' : 's'} with no punch and no approved leave.
          {policy?.deductUnexplained ? ' These days are being deducted as loss of pay.' : ' These days are not being deducted — check them before you publish.'}
        </div>
      )}
      {policy && (
        <p className="text-xs text-ink-faint">
          {policy.attendanceBased
            ? (policy.deductUnexplained ? 'Salary follows attendance. Days with no punch and no approved leave are deducted as loss of pay.' : 'Salary follows attendance. Days with no punch and no approved leave are flagged for review but not deducted.')
            : 'Salary is prorated by joining/exit dates and approved unpaid leave only — attendance is not used.'}
          {' '}<button onClick={openPolicy} className="font-semibold text-brand-700 hover:underline">Change</button>
        </p>
      )}

      <Card className="p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="Month"><Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
          <Field label="Year"><Select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
          {companies.length > 1 && (
            <Field label="Company" hint="Each entity is paid from its own account">
              <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">All companies</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.codePrefix})</option>)}
              </Select>
            </Field>
          )}
          <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or employee ID" /></Field>
          <Button variant="ghost" onClick={load}>Refresh</Button>
          <Button variant="outline" onClick={openPolicy}>Attendance rules</Button>
          <div className="flex-1" />
          <div className="flex items-end gap-2 flex-wrap">
            <Button onClick={generateAll} disabled={bulkBusy}>{bulkBusy ? <Spinner /> : 'Generate all'}</Button>
            {summary?.draft > 0 && <Button variant="soft" onClick={publishAll} disabled={bulkBusy || (isOpen && !allowEarly)}>Publish all + notify</Button>}
            {summary?.published > 0 && <Button variant="outline" onClick={downloadBankSheet}>Bank sheet (CSV)</Button>}
            {summary?.generated > 0 && (
              <Button variant="outline" onClick={() => downloadCsv(`payroll-register-${year}-${String(month).padStart(2, '0')}.csv`,
                (sheet || []).filter((r) => r.status).map((r) => ({ 'Employee ID': r.employeeCode || '', Name: r.name, 'Monthly CTC': r.monthlyCtc ?? '', Status: label(r.status), 'Net pay': r.netPay ?? '' })))}>
                Register (CSV)
              </Button>
            )}
          </div>
        </div>
        {isOpen && (
          <label className="mt-3 flex items-start gap-2 text-[12.5px] text-amber-800 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded-lg px-3 py-2">
            <input type="checkbox" className="mt-0.5" checked={allowEarly} onChange={(e) => setAllowEarly(e.target.checked)} />
            <span><b>Publish before the month ends.</b> {MONTHS[month - 1]} {year} closes on {String(daysInMonth(year, month)).padStart(2, '0')}-{String(month).padStart(2, '0')}-{year}; until then attendance is incomplete. Publishing is blocked unless you tick this.</span>
          </label>
        )}
        <p className="text-xs text-ink-faint mt-3">
          Generate prorates automatically — mid-month joiners and approved exits by date, and approved unpaid leave is deducted.
          TDS left blank is worked out from the tax engine. Published payslips are locked; HR can revert one to draft with a recorded reason.
        </p>
        {runMsg && (
          <div className="mt-3 text-sm rounded-xl bg-slate-50 border border-line px-4 py-3 space-y-1">
            {runMsg.generated != null && <div className="text-emerald-700 font-medium">Generated {runMsg.generated} payslip{runMsg.generated === 1 ? '' : 's'}.</div>}
            {runMsg.published != null && <div className="text-emerald-700 font-medium">Published {runMsg.published} payslip{runMsg.published === 1 ? '' : 's'} — employees notified by email.</div>}
            {runMsg.skipped?.length > 0 && <div className="text-ink-soft">Skipped {runMsg.skipped.length}: {runMsg.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}</div>}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        {sheet === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : visible.length === 0 ? <p className="p-6 text-sm text-ink-faint">{term ? `No employees match “${q.trim()}”.` : 'No active employees.'}</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Employee</th>
                <th className="text-right px-5 py-3 font-medium">Monthly CTC</th>
                <th className="text-left px-5 py-3 font-medium">Status — {MONTHS[month - 1]} {year}</th>
                <th className="text-left px-5 py-3 font-medium">Attendance</th>
                <th className="text-right px-5 py-3 font-medium">Net pay</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((r) => (
                <tr key={r.employeeId} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3"><div className="text-ink font-medium">{r.name}</div><div className="text-ink-faint text-xs">{r.employeeCode}</div></td>
                  <td className="px-5 py-3 text-right tabular-nums text-ink-soft">
                    {r.hasStructure ? `₹${inr(r.monthlyCtc)}` : <Button size="sm" variant="soft" onClick={() => openStructure(r)}>Set structure</Button>}
                  </td>
                  <td className="px-5 py-3">
                    {r.status ? <Badge tone={r.status === 'PUBLISHED' ? 'ok' : 'warn'} dot>{r.status === 'DRAFT' ? 'Draft — review & publish' : label(r.status)}</Badge>
                      : <span className="text-xs text-ink-faint">Not generated</span>}
                  </td>
                  <td className="px-5 py-3">
                    {r.status && r.attendanceBasis === 'ATTENDANCE' ? (
                      <div className="text-xs">
                        <div className="text-ink-soft tabular-nums"><span className="font-semibold text-ink">{r.daysPaid}</span>/{r.daysInMonth} days paid</div>
                        <div className="text-ink-faint tabular-nums">{[r.presentDays != null && `${r.presentDays}P`, r.leaveDays ? `${r.leaveDays}L` : null, r.lopDays ? `${r.lopDays} LOP` : null].filter(Boolean).join(' · ')}</div>
                        {r.needsReview && <Badge tone="warn">{r.unexplainedDays} day{r.unexplainedDays === 1 ? '' : 's'} unaccounted</Badge>}
                      </div>
                    ) : <span className="text-xs text-ink-faint">—</span>}
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums font-semibold ${Number(r.netPay) < 0 ? 'text-rose-600' : 'text-ink'}`}>{r.netPay != null ? `₹${inr(r.netPay)}` : '—'}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openStructure(r)} className="text-ink-soft text-xs font-medium hover:underline mr-3">Structure</button>
                    {r.payslipId && <button onClick={() => viewPdf(r.payslipId)} className="text-brand-700 text-xs font-medium hover:underline mr-3">PDF</button>}
                    {r.status === 'PUBLISHED' ? (
                      <button onClick={() => { setRevertFor(r); setRevertReason(''); setRevertErr(''); }} className="text-amber-700 text-xs font-medium hover:underline">Revert to draft</button>
                    ) : (
                      <>
                        {r.hasStructure && <button onClick={() => openGenerate(r)} className="text-brand-700 text-xs font-medium hover:underline mr-3">{r.payslipId ? 'Re-generate' : 'Generate'}</button>}
                        {r.status === 'DRAFT' && <button onClick={() => publish(r)} className="text-emerald-700 text-xs font-medium hover:underline mr-3">Publish</button>}
                        {r.payslipId && <button onClick={() => removeSlip(r)} className="text-rose-600 text-xs font-medium hover:underline">Delete</button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Structure: monthly CTC + overrides of the company's own components (D6) */}
      <Modal open={!!structFor} onClose={() => setStructFor(null)} title={`Salary structure — ${structFor?.name || ''}`} size="xl"
        actions={<><Button variant="ghost" onClick={() => setStructFor(null)}>Cancel</Button><Button onClick={saveStructure} disabled={structBusy || !struct}>{structBusy ? <Spinner /> : 'Save structure'}</Button></>}>
        {!struct ? <div className="py-6 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div> : (
          <div className="grid lg:grid-cols-[1fr_280px] gap-5">
            <div className="space-y-4">
              <ErrorSummary errors={sErrors} />
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Monthly CTC (₹)" required error={sErrors.monthlyCtc}
                  hint={struct.suggestedMonthlyCtc && !struct.saved ? `Pre-filled from the annual CTC ₹${Number(struct.suggestedMonthlyCtc * 12).toLocaleString('en-IN')}` : (toNumber(sForm.monthlyCtc) > 0 ? `${inr0(toNumber(sForm.monthlyCtc) * 12)} a year` : null)}>
                  <Input inputMode="decimal" value={sForm.monthlyCtc} onChange={(e) => setSForm({ ...sForm, monthlyCtc: e.target.value })} autoFocus />
                </Field>
                <Field label="Grade" hint="From the designation master"><Input value={struct.grade || '—'} disabled /></Field>
                <Field label="Designation"><Input value={struct.employee?.designation || '—'} disabled /></Field>
              </div>
              <div>
                <div className="text-xs font-bold tracking-wide uppercase text-ink-faint mb-2">Payslip components</div>
                <table className="w-full text-[12.5px]">
                  <thead className="text-ink-faint border-b border-line"><tr><th className="text-left py-1.5">Component</th><th className="text-right py-1.5">Company value</th><th className="text-right py-1.5 w-44">This employee</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {struct.components.map((c) => (
                      <tr key={c.code}>
                        <td className="py-1.5"><div className="text-ink">{c.label}</div><div className="text-ink-faint text-[11px]">{c.kind === 'EARNING' ? 'Earning' : 'Deduction'}{c.basisCode ? ` · of ${c.basisCode}` : ''}</div></td>
                        <td className="py-1.5 text-right tabular-nums">{c.calc === 'BALANCE' ? 'Balance of CTC' : `${c.companyValue} ${UNIT[c.calc]}`}</td>
                        <td className="py-1.5 text-right">
                          {c.perEmployee ? (
                            <div>
                              <Input className="w-28 text-right" inputMode="decimal" placeholder="inherit" value={sForm.overrides[c.code] ?? ''}
                                onChange={(e) => setSForm({ ...sForm, overrides: { ...sForm.overrides, [c.code]: e.target.value } })} />
                              {sErrors[`overrides.${c.code}`] && <div className="text-[11px] text-neg mt-1">{sErrors[`overrides.${c.code}`]}</div>}
                            </div>
                          ) : <span className="text-ink-faint text-[11.5px]">{c.calc === 'BALANCE' ? 'auto' : 'fixed for the company'}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-ink-faint mt-2">Leave a value blank to inherit the company&apos;s. Change the rules for everyone under <Link href="/admin/salary-components" className="text-brand-700 hover:underline">Payslip components</Link>.</p>
              </div>
            </div>
            <ServerPreview pv={pv} busy={pvBusy} />
          </div>
        )}
      </Modal>

      <Modal open={!!genFor} onClose={() => setGenFor(null)} title={`Generate payslip — ${genFor?.name || ''}`}
        actions={<><Button variant="ghost" onClick={() => setGenFor(null)}>Cancel</Button><Button onClick={runGenerate} disabled={genBusy}>{genBusy ? <Spinner /> : 'Generate draft'}</Button></>}>
        <div className="grid sm:grid-cols-2 gap-3">
          {genErrors.form && <div className="sm:col-span-2"><ErrorSummary errors={{ form: genErrors.form }} /></div>}
          <Field label={`Days paid (of ${daysInMonth(year, month)})`} error={genErrors.daysPaid}
            hint={policy?.attendanceBased ? 'Blank = from attendance, joining/exit dates and approved leave' : 'Blank = auto (joining/exit dates & unpaid leave)'}>
            <Input inputMode="decimal" value={gen.daysPaid} placeholder="Auto" onChange={(e) => setGen({ ...gen, daysPaid: e.target.value })} />
          </Field>
          {genFor?.attendanceBasis === 'ATTENDANCE' && (
            <div className="sm:col-span-2 rounded-xl border border-line bg-slate-50/60 px-4 py-3 text-xs">
              <div className="font-semibold text-ink mb-1">From attendance this month</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-soft tabular-nums">
                <span>Present <b className="text-ink">{genFor.presentDays ?? '—'}</b></span><span>Paid leave <b className="text-ink">{genFor.leaveDays ?? 0}</b></span>
                <span>Unpaid leave <b className="text-ink">{genFor.lopDays ?? 0}</b></span><span>Days paid <b className="text-ink">{genFor.daysPaid ?? '—'}</b></span>
              </div>
            </div>
          )}
          <Field label="Arrears (₹)" error={genErrors.arrears}><Input inputMode="decimal" value={gen.arrears} placeholder="0" onChange={(e) => setGen({ ...gen, arrears: e.target.value })} /></Field>
          <Field label="Bonus / Incentive (₹)" error={genErrors.bonus}><Input inputMode="decimal" value={gen.bonus} placeholder="0" onChange={(e) => setGen({ ...gen, bonus: e.target.value })} /></Field>
          <Field label="TDS (₹)" error={genErrors.tds} hint="Blank = worked out from the tax engine"><Input inputMode="decimal" value={gen.tds} placeholder="Auto" onChange={(e) => setGen({ ...gen, tds: e.target.value })} /></Field>
          <p className="sm:col-span-2 text-xs text-ink-faint">Generates a draft for {MONTHS[month - 1]} {year}. A draft whose net pay would be negative is refused.</p>
        </div>
      </Modal>

      <Modal open={!!revertFor} onClose={() => setRevertFor(null)} title={`Revert ${revertFor?.name || ''}'s payslip to draft`} tone="danger"
        actions={<><Button variant="ghost" onClick={() => setRevertFor(null)}>Keep it published</Button><Button variant="danger" onClick={revert}>Revert to draft</Button></>}>
        <p className="mb-3">The employee can no longer see this payslip until it is published again. Your name and the reason are recorded.</p>
        <Field label="Reason" required error={revertErr}><Textarea rows={3} value={revertReason} onChange={(e) => setRevertReason(e.target.value)} placeholder="e.g. Arrears were entered for the wrong month" /></Field>
      </Modal>

      <Modal open={policyOpen} onClose={() => setPolicyOpen(false)} title="Attendance rules for payroll"
        actions={<><Button variant="ghost" onClick={() => setPolicyOpen(false)}>Cancel</Button><Button onClick={savePolicy} disabled={policyBusy}>{policyBusy ? <Spinner /> : 'Save rules'}</Button></>}>
        {policyForm && (
          <div className="space-y-5">
            <label className="flex items-start gap-3 rounded-xl border border-line p-4 cursor-pointer hover:bg-slate-50/60">
              <input type="checkbox" checked={policyForm.attendanceBased} onChange={(ev) => setPolicyForm({ ...policyForm, attendanceBased: ev.target.checked })} className="mt-0.5 h-4 w-4 accent-brand-600" />
              <span><span className="block text-sm font-semibold text-ink">Work out salary from attendance</span>
                <span className="block text-xs text-ink-soft mt-0.5">Days paid comes from punches, approved on-duty, approved leave, holidays and weekly offs. Turn this off to prorate by joining/exit dates and unpaid leave only.</span></span>
            </label>
            <label className={`flex items-start gap-3 rounded-xl border border-line p-4 ${policyForm.attendanceBased ? 'cursor-pointer hover:bg-slate-50/60' : 'opacity-50'}`}>
              <input type="checkbox" checked={policyForm.deductUnexplained} disabled={!policyForm.attendanceBased} onChange={(ev) => setPolicyForm({ ...policyForm, deductUnexplained: ev.target.checked })} className="mt-0.5 h-4 w-4 accent-brand-600" />
              <span><span className="block text-sm font-semibold text-ink">Deduct days that attendance cannot explain</span>
                <span className="block text-xs text-ink-soft mt-0.5">A day with no punch and no approved leave becomes loss of pay. Leave this off and those days are flagged for review instead.</span></span>
            </label>
            <div>
              <div className="text-sm font-semibold text-ink mb-2">Weekly off</div>
              <div className="flex flex-wrap gap-2">
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, idx) => {
                  const on = policyForm.weekOffDays.includes(idx);
                  return (
                    <button key={d} type="button" onClick={() => setPolicyForm({ ...policyForm, weekOffDays: on ? policyForm.weekOffDays.filter((x) => x !== idx) : [...policyForm.weekOffDays, idx].sort((a, b) => a - b) })}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${on ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-white text-ink-soft ring-line hover:bg-slate-50'}`}>{d}</button>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-ink-faint border-t border-line pt-3">Changing these rules does not alter payslips already generated. Regenerate the month to apply them.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
