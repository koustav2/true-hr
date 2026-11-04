'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, downloadFile, openFile } from '@/lib/api.js';
import { Card, Button, Spinner, Empty, Field, Select } from '@/components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
// Indian financial years (April–March), current one first.
function fyList(n = 4) {
  const d = new Date();
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return Array.from({ length: n }, (_, i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, '0')}`);
}

export default function PayslipsPage() {
  const [rows, setRows] = useState(null);
  const [ctc, setCtc] = useState(null);
  const [msg, setMsg] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [fy, setFy] = useState(fyList()[0]);
  useEffect(() => {
    api.get('/payslips').then(setRows).catch((e) => { setRows([]); setMsg(e.message); });
    api.get('/me/salary-structure').then(setCtc).catch(() => setCtc({ saved: false }));
  }, []);
  const years = useMemo(() => [...new Set((rows || []).map((r) => r.year))].sort((a, b) => b - a), [rows]);
  const shown = (rows || []).filter((r) => (!year || String(r.year) === year) && (!month || String(r.month) === month));
  const dl = (r) => downloadFile(`/payslips/${r.id}/pdf`, `payslip-${r.year}-${String(r.month).padStart(2, '0')}.pdf`).catch((e) => setMsg(e.message));
  const form16 = () => openFile(`/me/form16?fy=${fy}`).catch((e) => setMsg(e.message));

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="page-title text-ink">Salary Slips</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <Card className="p-4">
        <div className="text-xs font-bold tracking-wide uppercase text-ink-faint mb-2">My salary</div>
        {!ctc ? <Spinner /> : !ctc.saved ? <p className="text-sm text-ink-faint">Your salary structure has not been set up yet.</p> : (
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="flex justify-between"><span className="text-ink-soft">Monthly CTC</span><b>{inr(ctc.monthlyCtc)}</b></div>
              <div className="flex justify-between"><span className="text-ink-soft">Annual CTC</span><b>{inr(ctc.annualCtc)}</b></div>
              {ctc.grade && <div className="flex justify-between"><span className="text-ink-soft">Grade</span><span>{ctc.grade}</span></div>}
            </div>
            <div className="text-[12.5px]">
              {ctc.earnings.map((e) => <div key={e.code} className="flex justify-between"><span className="text-ink-soft">{e.label}</span><span>{inr(e.amount)}</span></div>)}
              {ctc.deductions.map((d) => <div key={d.code} className="flex justify-between text-rose-600"><span>{d.label}</span><span>−{inr(d.amount)}</span></div>)}
              <p className="text-ink-faint mt-1">A full month, before income tax.</p>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 flex flex-wrap items-end gap-3">
        <Field label="Form 16 — financial year"><Select value={fy} onChange={(e) => setFy(e.target.value)}>{fyList().map((f) => <option key={f} value={f}>FY {f}</option>)}</Select></Field>
        <Button variant="outline" onClick={form16}>Download Form 16</Button>
        <p className="text-[12px] text-ink-faint">An estimate from your salary and verified declarations; the final Form 16 follows year-end TDS filing.</p>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Year"><Select value={year} onChange={(e) => setYear(e.target.value)}><option value="">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
        <Field label="Month"><Select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">All months</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
      </div>
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No published payslips yet" subtitle="Your payslip appears here once HR publishes it." />
        : !shown.length ? <Empty title="No payslips found" subtitle="Nothing matches that year and month." /> : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line"><th className="px-4 py-2.5">Month</th><th className="px-2 py-2.5">Year</th><th className="px-4 py-2.5 text-right">Download</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">{r.monthName}</td><td className="px-2 py-2.5">{r.year}</td>
                  <td className="px-4 py-2.5 text-right"><Button size="sm" variant="outline" onClick={() => dl(r)}>PDF</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
