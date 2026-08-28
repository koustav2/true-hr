'use client';
import { useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { Card, Button, Empty } from '@/components/ui.jsx';

export default function BulkSalaryPage() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [results, setResults] = useState(null);

  async function upload(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setMsg('File too large (max 10MB).'); return; }
    setBusy(true); setMsg(''); setResults(null);
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
      const r = await api.post('/admin/bulk/salary', { file: b64 });
      setResults(r); setMsg(`${r.updated} of ${r.total} rows updated.`);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Bulk Salary Upload</h1>
        <p className="text-ink-faint text-sm mt-0.5">Download the template, fill the “New Monthly CTC” column, and re-upload to update everyone at once.</p>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}

      <Card className="p-5 space-y-4">
        <div className="flex gap-3 flex-wrap items-center">
          <Button variant="outline" onClick={() => downloadFile('/admin/bulk/salary/template', 'bulk-salary-template.xlsx').catch((e) => setMsg(e.message))}>Download template (.xlsx)</Button>
          <label className="inline-flex">
            <input type="file" accept=".xlsx" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            <span className={`inline-flex items-center px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer ${busy ? 'bg-slate-100 text-ink-faint' : 'text-white bg-brand-gradient'}`}>{busy ? 'Uploading…' : 'Upload filled file'}</span>
          </label>
        </div>
        <p className="text-xs text-ink-faint">Rows without a valid new CTC are skipped. Employee codes not found are reported below.</p>
      </Card>

      {results && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr><th className="text-left px-4 py-3 font-medium">Employee Code</th><th className="text-left px-4 py-3 font-medium">Result</th></tr></thead>
            <tbody className="divide-y divide-line">
              {results.results.map((r, i) => (
                <tr key={i}><td className="px-4 py-2.5 font-mono text-[13px]">{r.code}</td>
                  <td className={`px-4 py-2.5 ${r.status.startsWith('updated') ? 'text-brand-700' : 'text-ink-faint'}`}>{r.status}</td></tr>
              ))}
            </tbody>
          </table>
          {results.results.length === 0 && <Empty title="No rows read" />}
        </Card>
      )}
    </div>
  );
}
