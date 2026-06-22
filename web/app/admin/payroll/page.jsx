'use client';
import { useEffect, useState } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Button, Input, Select, Field, Modal, Spinner } from '@/components/ui.jsx';

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

export default function PayrollPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [sheet, setSheet] = useState(null);
  const [msg, setMsg] = useState('');

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
    api.get(`/admin/payslips?year=${year}&month=${month}`).then((r) => setSheet(r.rows || [])).catch(() => setSheet([]));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year, month]);

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
    setGenFor(row); setGen({ daysPaid: daysInMonth(year, month), arrears: 0, bonus: 0, tds: 0 });
  }
  async function runGenerate() {
    setGenBusy(true);
    try {
      await api.post('/admin/payslips/generate', {
        employeeId: genFor.employeeId, year, month,
        daysPaid: Number(gen.daysPaid), arrears: Number(gen.arrears), bonus: Number(gen.bonus), tds: Number(gen.tds),
      });
      setGenFor(null); load();
    } catch (e) { setMsg(e.message); } finally { setGenBusy(false); }
  }
  async function publish(id) { await api.post(`/admin/payslips/${id}/publish`); load(); }
  async function removeSlip(id) { await api.del(`/admin/payslips/${id}`); load(); }

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
          <h1 className="text-[26px] font-bold text-ink tracking-tight">Payroll</h1>
          <p className="text-ink-faint text-sm mt-0.5">Set each employee's salary structure, then generate and publish monthly payslips.</p>
        </div>
        <Button variant="outline" onClick={openTemplate}>Company default</Button>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <Card className="p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="Month"><Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
          <Field label="Year"><Select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
          <Button variant="ghost" onClick={load}>Refresh</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {sheet === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : sheet.length === 0 ? <p className="p-6 text-sm text-ink-faint">No active employees.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Employee</th>
                <th className="text-left px-5 py-3 font-medium">Monthly CTC</th>
                <th className="text-left px-5 py-3 font-medium">{MONTHS[month - 1]} {year}</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sheet.map((r) => (
                <tr key={r.employeeId} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3"><div className="text-ink font-medium">{r.name}</div><div className="text-ink-faint text-xs">{r.employeeCode}</div></td>
                  <td className="px-5 py-3 text-ink-soft">{r.hasStructure ? inr(r.monthlyCtc) : <span className="text-amber-600">No structure</span>}</td>
                  <td className="px-5 py-3">
                    {r.status === 'PUBLISHED' ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Published · ₹{inr(r.netPay)}</span>
                      : r.status === 'DRAFT' ? <span className="inline-flex items-center gap-1.5 text-amber-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Draft · ₹{inr(r.netPay)}</span>
                      : <span className="text-ink-faint">Not generated</span>}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openStructure(r)} className="text-ink-soft text-xs font-medium hover:underline mr-3">Structure</button>
                    {r.hasStructure && <button onClick={() => openGenerate(r)} className="text-brand-700 text-xs font-medium hover:underline mr-3">{r.payslipId ? 'Re-generate' : 'Generate'}</button>}
                    {r.payslipId && <button onClick={() => viewPdf(r.payslipId)} className="text-brand-700 text-xs font-medium hover:underline mr-3">PDF</button>}
                    {r.status === 'DRAFT' && <button onClick={() => publish(r.payslipId)} className="text-emerald-700 text-xs font-medium hover:underline mr-3">Publish</button>}
                    {r.payslipId && <button onClick={() => removeSlip(r.payslipId)} className="text-rose-600 text-xs font-medium hover:underline">Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Structure editor */}
      <Modal open={!!structFor} onClose={() => setStructFor(null)} title={`Salary structure — ${structFor?.name || ''}`}
        actions={<><Button variant="ghost" onClick={() => setStructFor(null)}>Cancel</Button><Button onClick={saveStructure} disabled={structBusy || !struct}>{structBusy ? <Spinner /> : 'Save'}</Button></>}>
        {!struct ? <div className="py-6 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div> : (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Grade"><Input value={struct.grade} onChange={(e) => setStruct({ ...struct, grade: e.target.value })} /></Field>
            {STRUCT_FIELDS.map(([k, label]) => (
              <Field key={k} label={label}><Input type="number" value={struct[k]} onChange={(e) => setStruct({ ...struct, [k]: e.target.value })} /></Field>
            ))}
            <p className="sm:col-span-2 text-xs text-ink-faint">Basic = CTC × Basic%. HRA = Basic × HRA%. Provident Fund = Basic × PF%. Allowances are fixed monthly amounts and prorate by days paid.</p>
          </div>
        )}
      </Modal>

      {/* Company default template */}
      <Modal open={tplOpen} onClose={() => setTplOpen(false)} title="Company salary template"
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
          <Field label={`Days paid (of ${daysInMonth(year, month)})`}><Input type="number" value={gen.daysPaid} onChange={(e) => setGen({ ...gen, daysPaid: e.target.value })} /></Field>
          <Field label="Arrears"><Input type="number" value={gen.arrears} onChange={(e) => setGen({ ...gen, arrears: e.target.value })} /></Field>
          <Field label="Bonus / Incentive"><Input type="number" value={gen.bonus} onChange={(e) => setGen({ ...gen, bonus: e.target.value })} /></Field>
          <Field label="TDS"><Input type="number" value={gen.tds} onChange={(e) => setGen({ ...gen, tds: e.target.value })} /></Field>
          <p className="sm:col-span-2 text-xs text-ink-faint">Generates a draft for {MONTHS[month - 1]} {year}. Review the PDF, then Publish to make it visible to the employee.</p>
        </div>
      </Modal>
    </div>
  );
}
