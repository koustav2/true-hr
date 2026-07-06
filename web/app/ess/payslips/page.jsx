'use client';
import { useEffect, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { Card, Button, Spinner, Empty } from '@/components/ui.jsx';

export default function PayslipsPage() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get('/payslips').then(setRows).catch(() => setRows([])); }, []);
  const dl = (r) => downloadFile(`/payslips/${r.id}/pdf`, `payslip-${r.year}-${String(r.month).padStart(2, '0')}.pdf`).catch((e) => setMsg(e.message));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">Salary Slips</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No published payslips yet" /> : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">Month</th><th className="px-2 py-2.5">Year</th><th className="px-4 py-2.5 text-right">Download</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">{r.monthName}</td>
                  <td className="px-2 py-2.5">{r.year}</td>
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
