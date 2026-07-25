'use client';
import { useEffect, useState } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { downloadCsv } from '@/lib/csv.js';
import { Card, Button, Input, Select, Field, Modal, Spinner, ConfirmClick } from '@/components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const inr = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const STRUCT_FIELDS = [
  ['monthlyCtc', 'Monthly CTC'], ['basicPct', 'Basic % of CTC'], ['hraPctOfBasic', 'HRA % of Basic'],
  ['employeePfPct', 'Employee PF %'], ['professionalTax', 'Professional Tax'], ['welfareTrust', 'Welfare Trust'],
  ['lta', 'Leave Travel Allowance'], ['personalAllowance', 'Personal Allowance'], ['miscellaneous', 'Miscellaneous'],
  ['cityAllowance', 'City Allowance'], ['performancePay', 'Performance Pay'],
];
// Company-wide default (no per-person Grade / CTC).
const TEMPLATE_FIELDS = STRUCT_FIELDS.filter(([k]) => k !== 'monthlyCtc');

// Mirrors the backend computePayslip for a full month — powers the live preview.
function breakup(s) {
  const n = (v) => Number(v) || 0;
  const ctc = n(s.monthlyCtc);
  const basic = (ctc * n(s.basicPct)) / 100;
  const hra = (basic * n(s.hraPctOfBasic)) / 100;
  const fixed = n(s.lta) + n(s.personalAllowance) + n(s.miscellaneous) + n(s.cityAllowance) + n(s.performancePay);
  const special = Math.max(0, ctc - basic - hra - fixed);
  const pf = (basic * n(s.employeePfPct)) / 100;
  const pt = n(s.professionalTax);
  const welfare = n(s.welfareTrust);
  const gross = basic + hra + special + fixed;
  const deductions = pf + pt + welfare;
  return { ctc, basic, hra, special, fixed, gross, pf, pt, welfare, deductions, net: gross - deductions, overAllocated: basic + hra + fixed > ctc && ctc > 0 };
}

function PreviewRow({ label, value, bold, tone }) {
  return (
    <div className={`flex justify-between py-1 text-[13px] ${bold ? 'font-bold' : ''} ${tone || 'text-ink-soft'}`}>
      <span>{label}</span><span className="tabular-nums">₹{inr(Math.round(value))}</span>
    </div>
  );
}

// Live salary breakup shown beside the structure form (full-month view).
function StructurePreview({ s }) {
  const b = breakup(s);
  return (
    <div className="rounded-xl border border-line bg-slate-50/60 p-4">
      <div className="text-xs font-bold tracking-wide uppercase text-ink-faint mb-2">Monthly breakup (full month)</div>
      <PreviewRow label="Basic Salary" value={b.basic} />
      <PreviewRow label="House Rent Allowance" value={b.hra} />
      <PreviewRow label="Special Allowance (auto-balance)" value={b.special} />
      {b.fixed > 0 && <PreviewRow label="Other allowances" value={b.fixed} />}
      <div className="border-t border-line my-1.5" />
      <PreviewRow label="Gross earnings" value={b.gross} bold tone="text-ink" />
      <PreviewRow label="Provident Fund" value={-b.pf} tone="text-rose-600" />
      <PreviewRow label="Professional Tax" value={-b.pt} tone="text-rose-600" />
      {b.welfare > 0 && <PreviewRow label="Welfare Trust" value={-b.welfare} tone="text-rose-600" />}
      <div className="border-t border-line my-1.5" />
      <PreviewRow label="Net pay in hand" value={b.net} bold tone="text-emerald-700" />
      {b.overAllocated && (
        <p className="mt-2 text-[11px] text-rose-600">
          Basic + HRA + allowances exceed the CTC — reduce a component.
        </p>
      )}
      {!b.ctc && <p className="mt-2 text-[11px] text-ink-faint">Enter the Monthly CTC to see the breakup.</p>}
    </div>
  );
}

export default function PayrollPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [sheet, setSheet] = useState(null);
  const [summary, setSummary] = useState(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [runMsg, setRunMsg] = useState(null); // { generated, skipped } after Generate all
  const [bulkBusy, setBulkBusy] = useState(false);

  const [structFor, setStructFor] = useState(null); // {employeeId, name}
  const [struct, setStruct] = useState(null);
  const [structBusy, setStructBusy] = useState(false);

  const [genFor, setGenFor] = useState(null); // row
  const [gen, setGen] = useState({ daysPaid: '', arrears: 0, bonus: 0, tds: 0 });
  const [genBusy, setGenBusy] = useState(false);

  const [tplOpen, setTplOpen] = useState(false);
  const [tpl, setTpl] = useState(null);
  const [tplBusy, setTplBusy] = useState(false);
  async function openTemplate() {
    setTplOpen(true); setTpl(null);
    const t = await api.get('/admin/salary-template');
    setTpl(Object.fromEntries(TEMPLATE_FIELDS.map(([k]) => [k, t[k] ?? 0])));
  }
  async function saveTemplate() {
    setTplBusy(true);
    try { await api.put('/admin/salary-template', tpl); setTplOpen(false); }
    catch (e) { setMsg(e.message); } finally { setTplBusy(false); }
  }

  const load = () => {
    setSheet(null);
    api.get(`/admin/payslips?year=${year}&month=${month}`)
      .then((r) => { setSheet(r.rows || []); setSummary(r.summary || null); })
      .catch(() => { setSheet([]); setSummary(null); });
  };
  useEffect(() => { load(); setRunMsg(null); /* eslint-disable-next-line */ }, [year, month]);

  // ── Bulk run actions ──
  async function generateAll() {
    setBulkBusy(true); setMsg(''); setRunMsg(null);
    try {
      const r = await api.post('/admin/payslips/generate-all', { year, month });
      setRunMsg(r);
      load();
    } catch (e) { setMsg(e.message); } finally { setBulkBusy(false); }
  }
  async function publishAll() {
    setBulkBusy(true); setMsg('');
    try {
      const r = await api.post('/admin/payslips/publish-all', { year, month });
      setRunMsg({ published: r.published });
      load();
    } catch (e) { setMsg(e.message); } finally { setBulkBusy(false); }
  }
  async function downloadBankSheet() {
    try {
      const auth = getStoredAuth();
      const res = await fetch(`/api/admin/payslips/export?year=${year}&month=${month}`,
        { headers: { Authorization: `Bearer ${auth?.token}` } });
      if (!res.ok) throw new Error('Export failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `bank-advice-${year}-${String(month).padStart(2, '0')}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { setMsg(e.message); }
  }

  async function openStructure(row) {
    setStructFor(row); setStruct(null);
    const s = await api.get(`/admin/salary-structure/${row.employeeId}`);
    setStruct({ grade: s.grade || '', ...Object.fromEntries(STRUCT_FIELDS.map(([k]) => [k, s[k] ?? 0])) });
  }
  async function saveStructure() {
    setStructBusy(true);
    try { await api.put(`/admin/salary-structure/${structFor.employeeId}`, struct); setStructFor(null); load(); }
    catch (e) { setMsg(e.message); } finally { setStructBusy(false); }
  }

  function openGenerate(row) {
    setGenFor(row); setGen({ daysPaid: '', arrears: 0, bonus: 0, tds: 0 }); // blank = auto proration
  }
  async function runGenerate() {
    setGenBusy(true);
    try {
      await api.post('/admin/payslips/generate', {
        employeeId: genFor.employeeId, year, month,
        daysPaid: gen.daysPaid === '' ? null : Number(gen.daysPaid),
        arrears: Number(gen.arrears), bonus: Number(gen.bonus), tds: Number(gen.tds),
      });
      setGenFor(null); load();
    } catch (e) { setMsg(e.message); } finally { setGenBusy(false); }
  }
  async function publish(id) { await api.post(`/admin/payslips/${id}/publish`); load(); }
  async function unpublish(id) { await api.post(`/admin/payslips/${id}/unpublish`); load(); }
  async function removeSlip(id) { try { await api.del(`/admin/payslips/${id}`); load(); } catch (e) { setMsg(e.message); } }

  async function viewPdf(id) {
    const win = window.open('', '_blank');
    try {
      const auth = getStoredAuth();
      const res = await fetch(`/api/admin/payslips/${id}/pdf`, { headers: { Authorization: `Bearer ${auth?.token}` } });
      if (!res.ok) { win?.close(); return; }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location = url; else window.location.href = url;
    } catch { win?.close(); }
  }

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Payroll</h1>
          <p className="text-ink-faint text-sm mt-0.5">Set each employee's salary structure, then generate and publish monthly payslips.</p>
        </div>
        <Button variant="outline" onClick={openTemplate}>Company default</Button>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      {/* Run summary */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            ['Employees', summary.employees, 'text-ink'],
            ['Structures set', summary.withStructure, summary.withStructure < summary.employees ? 'text-amber-600' : 'text-ink'],
            ['Generated', summary.generated, 'text-ink'],
            ['Published', summary.published, 'text-emerald-700'],
            ['Published net pay', `₹${inr(summary.publishedNetTotal)}`, 'text-emerald-700'],
          ].map(([label, value, tone]) => (
            <Card key={label} className="p-4">
              <div className="text-xs text-ink-faint">{label}</div>
              <div className={`text-xl font-extrabold tracking-tight mt-0.5 ${tone}`}>{value}</div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="Month"><Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
          <Field label="Year"><Select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
          <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or employee ID" /></Field>
          <Button variant="ghost" onClick={load}>Refresh</Button>
          <div className="flex-1" />
          <div className="flex items-end gap-2 flex-wrap">
            <ConfirmClick onConfirm={generateAll} confirmLabel="Run payroll for the whole month?"
              className="rounded-xl bg-brand-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-brand-700 disabled:opacity-50">
              {bulkBusy ? 'Working…' : 'Generate all'}
            </ConfirmClick>
            {summary?.draft > 0 && (
              <ConfirmClick onConfirm={publishAll} confirmLabel={`Publish ${summary.draft} draft(s) & email employees?`}
                className="rounded-xl bg-emerald-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-emerald-700 disabled:opacity-50">
                Publish all + notify
              </ConfirmClick>
            )}
            {summary?.published > 0 && (
              <Button variant="outline" onClick={downloadBankSheet}>Bank sheet (CSV)</Button>
            )}
            {summary?.generated > 0 && (
              <Button variant="outline" onClick={() => downloadCsv(`payroll-register-${year}-${String(month).padStart(2, '0')}.csv`,
                (sheet || []).filter((r) => r.status).map((r) => ({
                  'Employee ID': r.employeeCode || '', Name: r.name,
                  'Monthly CTC': r.monthlyCtc ?? '', Status: r.status, 'Net pay': r.netPay ?? '',
                })))}>
                Register (CSV)
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-ink-faint mt-3">
          Generate all prorates automatically — mid-month joiners and approved exits by date, and approved
          Leave-Without-Pay days are deducted. Published payslips are locked and skipped. Publishing emails
          each employee that their payslip is ready.
        </p>
        {runMsg && (
          <div className="mt-3 text-sm rounded-xl bg-slate-50 border border-line px-4 py-3 space-y-1">
            {runMsg.generated != null && <div className="text-emerald-700 font-medium">Generated {runMsg.generated} payslip{runMsg.generated === 1 ? '' : 's'}.</div>}
            {runMsg.published != null && <div className="text-emerald-700 font-medium">Published {runMsg.published} payslip{runMsg.published === 1 ? '' : 's'} — employees notified by email.</div>}
            {runMsg.skipped?.length > 0 && (
              <div className="text-ink-soft">
                Skipped {runMsg.skipped.length}:{' '}
                {runMsg.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        {sheet === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : sheet.length === 0 ? <p className="p-6 text-sm text-ink-faint">No active employees.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Employee</th>
                <th className="text-right px-5 py-3 font-medium">Monthly CTC</th>
                <th className="text-left px-5 py-3 font-medium">Status — {MONTHS[month - 1]} {year}</th>
                <th className="text-right px-5 py-3 font-medium">Net pay</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sheet.filter((r) => !q || `${r.name} ${r.employeeCode || ''}`.toLowerCase().includes(q.toLowerCase())).map((r) => (
                <tr key={r.employeeId} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid place-items-center h-8 w-8 rounded-full bg-gradient-to-br from-brand-500 to-emerald-600 text-white text-[11px] font-bold shrink-0">
                        {(r.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                      </span>
                      <div>
                        <div className="text-ink font-medium">{r.name}</div>
                        <div className="text-ink-faint text-xs">{r.employeeCode}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-ink-soft">
                    {r.hasStructure ? `₹${inr(r.monthlyCtc)}` : (
                      <button onClick={() => openStructure(r)}
                        className="text-xs font-semibold text-amber-700 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded-full px-2.5 py-1 hover:bg-amber-100">
                        Set structure
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {r.status === 'PUBLISHED' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-inset ring-emerald-200 rounded-full px-2.5 py-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Published
                      </span>
                    ) : r.status === 'DRAFT' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded-full px-2.5 py-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Draft — review & publish
                      </span>
                    ) : (
                      <span className="text-xs text-ink-faint">Not generated</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold text-ink">
                    {r.netPay != null ? `₹${inr(r.netPay)}` : <span className="text-ink-faint font-normal">—</span>}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openStructure(r)} className="text-ink-soft text-xs font-medium hover:underline mr-3">Structure</button>
                    {r.payslipId && <button onClick={() => viewPdf(r.payslipId)} className="text-brand-700 text-xs font-medium hover:underline mr-3">PDF</button>}
                    {r.status === 'PUBLISHED' ? (
                      <button onClick={() => unpublish(r.payslipId)} className="text-amber-600 text-xs font-medium hover:underline">Unpublish</button>
                    ) : (
                      <>
                        {r.hasStructure && <button onClick={() => openGenerate(r)} className="text-brand-700 text-xs font-medium hover:underline mr-3">{r.payslipId ? 'Re-generate' : 'Generate'}</button>}
                        {r.status === 'DRAFT' && <button onClick={() => publish(r.payslipId)} className="text-emerald-700 text-xs font-medium hover:underline mr-3">Publish</button>}
                        {r.payslipId && <button onClick={() => removeSlip(r.payslipId)} className="text-rose-600 text-xs font-medium hover:underline">Delete</button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Structure editor with live breakup preview */}
      <Modal open={!!structFor} onClose={() => setStructFor(null)} title={`Salary structure — ${structFor?.name || ''}`} size="lg"
        actions={<><Button variant="ghost" onClick={() => setStructFor(null)}>Cancel</Button><Button onClick={saveStructure} disabled={structBusy || !struct || !Number(struct?.monthlyCtc)}>{structBusy ? <Spinner /> : 'Save structure'}</Button></>}>
        {!struct ? <div className="py-6 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div> : (
          <div className="grid lg:grid-cols-[1fr_260px] gap-5">
            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold tracking-wide uppercase text-ink-faint mb-2">Pay</div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Monthly CTC" required><Input type="number" value={struct.monthlyCtc} onChange={(e) => setStruct({ ...struct, monthlyCtc: e.target.value })} autoFocus /></Field>
                  <Field label="Grade"><Input value={struct.grade} onChange={(e) => setStruct({ ...struct, grade: e.target.value })} placeholder="e.g. L3" /></Field>
                </div>
              </div>
              <div>
                <div className="text-xs font-bold tracking-wide uppercase text-ink-faint mb-2">Earning components</div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Basic (% of CTC)"><Input type="number" value={struct.basicPct} onChange={(e) => setStruct({ ...struct, basicPct: e.target.value })} /></Field>
                  <Field label="HRA (% of Basic)"><Input type="number" value={struct.hraPctOfBasic} onChange={(e) => setStruct({ ...struct, hraPctOfBasic: e.target.value })} /></Field>
                  {[['lta', 'Leave Travel Allowance'], ['personalAllowance', 'Personal Allowance'], ['miscellaneous', 'Miscellaneous'], ['cityAllowance', 'City Allowance'], ['performancePay', 'Performance Pay']].map(([k, label]) => (
                    <Field key={k} label={`${label} (₹/mo)`}><Input type="number" value={struct[k]} onChange={(e) => setStruct({ ...struct, [k]: e.target.value })} /></Field>
                  ))}
                </div>
                <p className="text-xs text-ink-faint mt-2">Whatever is left of the CTC after Basic, HRA and allowances is paid as <b>Special Allowance</b> automatically — gross always equals CTC.</p>
              </div>
              <div>
                <div className="text-xs font-bold tracking-wide uppercase text-ink-faint mb-2">Deductions</div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="PF (% of Basic)"><Input type="number" value={struct.employeePfPct} onChange={(e) => setStruct({ ...struct, employeePfPct: e.target.value })} /></Field>
                  <Field label="Professional Tax (₹)"><Input type="number" value={struct.professionalTax} onChange={(e) => setStruct({ ...struct, professionalTax: e.target.value })} /></Field>
                  <Field label="Welfare Trust (₹)"><Input type="number" value={struct.welfareTrust} onChange={(e) => setStruct({ ...struct, welfareTrust: e.target.value })} /></Field>
                </div>
              </div>
            </div>
            <StructurePreview s={struct} />
          </div>
        )}
      </Modal>

      {/* Company default template */}
      <Modal open={tplOpen} onClose={() => setTplOpen(false)} title="Company salary template" size="lg"
        actions={<><Button variant="ghost" onClick={() => setTplOpen(false)}>Cancel</Button><Button onClick={saveTemplate} disabled={tplBusy || !tpl}>{tplBusy ? <Spinner /> : 'Save default'}</Button></>}>
        {!tpl ? <div className="py-6 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div> : (
          <div className="grid sm:grid-cols-2 gap-3">
            {TEMPLATE_FIELDS.map(([k, label]) => (
              <Field key={k} label={label}><Input type="number" value={tpl[k]} onChange={(e) => setTpl({ ...tpl, [k]: e.target.value })} /></Field>
            ))}
            <p className="sm:col-span-2 text-xs text-ink-faint">These defaults pre-fill every new employee's structure for this company. Editing them does not change payslips already generated, or structures already saved per employee.</p>
          </div>
        )}
      </Modal>

      {/* Generate */}
      <Modal open={!!genFor} onClose={() => setGenFor(null)} title={`Generate payslip — ${genFor?.name || ''}`}
        actions={<><Button variant="ghost" onClick={() => setGenFor(null)}>Cancel</Button><Button onClick={runGenerate} disabled={genBusy}>{genBusy ? <Spinner /> : 'Generate draft'}</Button></>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={`Days paid (of ${daysInMonth(year, month)})`} hint="Blank = auto (joining/exit dates & LWP)">
            <Input type="number" value={gen.daysPaid} placeholder="Auto" onChange={(e) => setGen({ ...gen, daysPaid: e.target.value })} />
          </Field>
          <Field label="Arrears"><Input type="number" value={gen.arrears} onChange={(e) => setGen({ ...gen, arrears: e.target.value })} /></Field>
          <Field label="Bonus / Incentive"><Input type="number" value={gen.bonus} onChange={(e) => setGen({ ...gen, bonus: e.target.value })} /></Field>
          <Field label="TDS"><Input type="number" value={gen.tds} onChange={(e) => setGen({ ...gen, tds: e.target.value })} /></Field>
          <p className="sm:col-span-2 text-xs text-ink-faint">Generates a draft for {MONTHS[month - 1]} {year}. Review the PDF, then Publish to make it visible to the employee.</p>
        </div>
      </Modal>
    </div>
  );
}
