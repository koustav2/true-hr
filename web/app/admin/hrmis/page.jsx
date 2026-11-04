'use client';
import { useEffect, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { Card, Button, Spinner, PageHeader, StatTile, Badge } from '@/components/ui.jsx';

const SHEETS = [
  ['People', 'Code, name, company, department, designation, grade (from the designation master), joining date, contact, all three manager lines, and the linked login with its last sign-in and a note on why a login is not usable.'],
  ['Compensation', 'Monthly CTC and annual CTC (monthly × 12), each payslip component from the company\'s set, and bank details with an IFSC format check. The account number itself is not exported.'],
  ['Statutory', 'UAN, PF and ESIC numbers with a format check, plus whether PAN and Aadhaar are on file.'],
  ['Leave balances', 'Allocated, used and remaining days per leave type — one row per employee per type.'],
  ['Assets', 'The asset register with the current holder, assignment date and acknowledgement.'],
  ['Exits', 'Resignations and terminations together: raised date, last working date, notice, reason, and a data check for impossible dates.'],
  ['Headcount', 'Headcount and monthly salary cost by company, department and status.'],
];

const GAPS = [
  ['no_structure', 'No salary structure', 'Payroll would value them at zero.'],
  ['no_bank', 'No bank details', 'They cannot be paid by transfer.'],
  ['no_uan', 'No UAN recorded', 'PF returns will be short.'],
  ['no_manager', 'No reporting manager', 'Leave and NFA approvals have nowhere to go.'],
  ['no_department', 'No department', 'They show under "(no department)" in the Headcount sheet.'],
  ['no_designation', 'No designation', 'No grade or level, and letters cannot be issued.'],
  ['no_doj', 'No date of joining', 'Payroll proration, leave and gratuity all need it.'],
  ['invalid_statutory', 'UAN / PF / ESIC in the wrong format', 'Shown as "Invalid" in the Statutory sheet — PF and ESIC returns will be rejected.'],
  ['invalid_ifsc', 'IFSC in the wrong format', 'Shown as "Invalid" in the Compensation sheet — bank transfers will bounce.'],
  ['login_disabled', 'Login disabled while employed', 'The People sheet\'s Login Note says why.'],
];

export default function HrmisPage() {
  const [sum, setSum] = useState(null);
  const [scope, setScope] = useState('ALL');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.get('/admin/reports/hrmis/summary').then(setSum).catch(() => setSum(false)); }, []);

  async function download() {
    setBusy(true); setErr('');
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadFile(`/admin/reports/hrmis?status=${scope}`, `hrmis-${scope.toLowerCase()}-${stamp}.xlsx`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const val = (k) => (sum === null ? '—' : sum === false ? '?' : sum[k]);
  const gapRows = sum && sum.gaps ? GAPS.filter(([k]) => (sum.gaps[k] || 0) > 0) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="HRMIS reports"
        subtitle="One workbook of everything HR holds — people, pay, statutory, leave, assets and exits — for finance, an auditor or a payroll handover."
        action={
          <div className="flex items-end gap-2">
            <select value={scope} onChange={(e) => setScope(e.target.value)}
              className="rounded border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none hover:border-slate-400 focus:border-brand-600">
              <option value="ALL">Everyone on record</option>
              <option value="ACTIVE">Active employees only</option>
            </select>
            <Button onClick={download} disabled={busy}>{busy ? <Spinner /> : 'Download workbook (.xlsx)'}</Button>
          </div>
        }
      />

      {err && <p className="text-[13px] text-neg">{err}</p>}

      <div className="grid gap-2.5 sm:grid-cols-3">
        <StatTile label="On record" value={val('total')} tone="neutral" />
        <StatTile label="Employees" value={val('employees')} tone="ok" caption="Active, joined, not past an approved exit" />
        <StatTile label="Not active" value={val('non_active')} tone="neutral" caption="Offer sent, in review, exited" />
      </div>

      {gapRows.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2.5">Worth fixing before you send this out</h2>
          <ul className="space-y-2">
            {gapRows.map(([k, label, why]) => (
              <li key={k} className="flex items-start gap-3 text-[13px]">
                <Badge tone="warn">{sum.gaps[k]}</Badge>
                <span><b className="text-ink">{label}</b> <span className="text-ink-faint">— {why}</span></span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-faint mt-3">Counted across active employees only. The workbook exports regardless. All dates in the workbook are real Excel dates (dd-mm-yyyy), so they sort and filter.</p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line bg-canvas text-[12.5px] font-semibold text-ink-soft">
          What is in the workbook
        </div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left">Sheet</th>
              <th className="text-left">Contents</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {SHEETS.map(([name, what]) => (
              <tr key={name}>
                <td className="px-4 font-medium text-ink whitespace-nowrap">{name}</td>
                <td className="px-4 text-[12.5px] text-ink-soft">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <p className="text-[12.5px] text-ink-faint">
          PAN and Aadhaar are stored encrypted and are deliberately not decrypted into this file — the Statutory sheet
          reports only whether each is on file. Anyone who needs the number reads it on that employee&apos;s own screen,
          where the access is recorded against them rather than in a bulk download. Every export here is written to the audit log.
        </p>
      </Card>
    </div>
  );
}
