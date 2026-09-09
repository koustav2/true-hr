'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { Card, Button, Spinner, Empty, Badge, PageHeader, StatTile } from '@/components/ui.jsx';
import { downloadCsv } from '@/lib/csv.js';

// Fallback list if /admin/bulk/kinds is unreachable — the screen still works.
const FALLBACK = [
  { key: 'salary', label: 'Salary (monthly CTC)' },
  { key: 'info', label: 'Contact & employment details' },
  { key: 'managers', label: 'Reporting lines' },
  { key: 'transfer', label: 'Department & designation transfer' },
  { key: 'leave-balance', label: 'Leave balances' },
];
const BLURB = {
  salary: 'Sets the monthly CTC on each salary structure and refreshes the annual CTC used by the offer annexure.',
  info: 'Phone, personal email, location and employment type.',
  managers: 'Reporting, functional and operational managers, matched by the manager’s own employee code. Type NONE to clear a line.',
  transfer: 'Moves people between departments and designations. Both must already exist in that company.',
  'leave-balance': 'Allocated days per leave type. Used days are never touched.',
};
const TONE = { updated: 'ok', 'would change': 'brand', skipped: 'neutral', error: 'danger' };

export default function BulkPage() {
  const [kinds, setKinds] = useState(FALLBACK);
  const [kind, setKind] = useState('salary');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [res, setRes] = useState(null);
  const [file, setFile] = useState(null);

  useEffect(() => {
    api.get('/admin/bulk/kinds').then((r) => { if (Array.isArray(r) && r.length) setKinds(r); }).catch(() => {});
  }, []);

  const current = useMemo(() => kinds.find((k) => k.key === kind) || kinds[0], [kinds, kind]);

  async function run(dryRun) {
    if (!file) { setErr('Choose the filled-in file first.'); return; }
    if (file.size > 10 * 1024 * 1024) { setErr('That file is over 10MB — split it.'); return; }
    setBusy(dryRun ? 'preview' : 'apply'); setErr(''); setMsg(''); setRes(null);
    try {
      const b64 = await new Promise((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1]);
        r.onerror = no;
        r.readAsDataURL(file);
      });
      const out = await api.post(`/admin/bulk/${kind}`, { file: b64, dryRun });
      setRes(out);
      setMsg(dryRun
        ? `Preview only — nothing written. ${out.changed} row${out.changed === 1 ? '' : 's'} would change, ${out.skipped} skipped, ${out.failed} with errors.`
        : `${out.changed} row${out.changed === 1 ? '' : 's'} updated, ${out.skipped} skipped, ${out.failed} with errors.`);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bulk utilities"
        subtitle="Download a sheet already filled in with what the system holds, edit only the “New …” columns, upload it back. Preview first — it reports every change without writing anything."
      />

      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button key={k.key} onClick={() => { setKind(k.key); setRes(null); setMsg(''); setErr(''); setFile(null); }}
            className={`rounded border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              kind === k.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-soft hover:border-slate-400'}`}>
            {k.label}
          </button>
        ))}
      </div>

      <Card className="p-4 space-y-4">
        <p className="text-[13px] text-ink-soft">{BLURB[kind] || current?.label}</p>

        <ol className="grid gap-3 sm:grid-cols-3 text-[12.5px]">
          <li className="rounded border border-line bg-canvas p-3">
            <div className="font-semibold text-ink mb-1.5">1 · Download</div>
            <Button variant="outline" size="sm"
              onClick={() => downloadFile(`/admin/bulk/${kind}/template`, `bulk-${kind}-template.xlsx`).catch((e) => setErr(e.message))}>
              Template (.xlsx)
            </Button>
            <p className="text-ink-faint mt-2">Active employees only, current values pre-filled.</p>
          </li>
          <li className="rounded border border-line bg-canvas p-3">
            <div className="font-semibold text-ink mb-1.5">2 · Choose the filled file</div>
            <label className="inline-flex">
              <input type="file" accept=".xlsx" className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); setMsg(''); setErr(''); }} />
              <span className="inline-flex items-center rounded border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft cursor-pointer hover:border-brand-600 hover:text-brand-600">
                {file ? 'Change file' : 'Choose file'}
              </span>
            </label>
            <p className="text-ink-faint mt-2 truncate">{file ? file.name : 'No file chosen'}</p>
          </li>
          <li className="rounded border border-line bg-canvas p-3">
            <div className="font-semibold text-ink mb-1.5">3 · Preview, then apply</div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!file || !!busy} onClick={() => run(true)}>
                {busy === 'preview' ? <Spinner /> : 'Preview only'}
              </Button>
              <Button size="sm" disabled={!file || !!busy} onClick={() => run(false)}>
                {busy === 'apply' ? <Spinner /> : 'Apply changes'}
              </Button>
            </div>
            <p className="text-ink-faint mt-2">A blank cell leaves that value unchanged.</p>
          </li>
        </ol>

        {err && <p className="text-[13px] text-neg">{err}</p>}
        {msg && <p className="text-[13px] text-ink">{msg}</p>}
      </Card>

      {res && (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={res.dryRun ? 'Would change' : 'Updated'} value={res.changed} tone={res.dryRun ? 'brand' : 'ok'} />
            <StatTile label="Skipped" value={res.skipped} tone="neutral" caption="Nothing filled in" />
            <StatTile label="Errors" value={res.failed} tone={res.failed ? 'danger' : 'neutral'} />
            <StatTile label="Rows read" value={res.total} tone="neutral" />
          </div>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-canvas">
              <span className="text-[12.5px] font-semibold text-ink-soft">
                {res.dryRun ? 'Preview — nothing has been written' : 'Applied'}
              </span>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(`bulk-${kind}-${res.dryRun ? 'preview' : 'result'}.csv`,
                res.results.map((r) => ({ 'Employee Code': r.code, Result: r.status, Detail: r.detail || '' })))}>
                Export result
              </Button>
            </div>
            {res.results.length === 0 ? <Empty title="No rows read" subtitle="The sheet had no Employee Code values below the header." /> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Employee Code</th>
                      <th className="text-left">Result</th>
                      <th className="text-left">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {res.results.map((r, i) => (
                      <tr key={`${r.code}-${i}`}>
                        <td className="px-4 font-mono text-[12.5px] text-ink">{r.code}</td>
                        <td className="px-4 whitespace-nowrap"><Badge tone={TONE[r.status] || 'neutral'}>{r.status}</Badge></td>
                        <td className="px-4 text-[12.5px] text-ink-soft">{r.detail || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
