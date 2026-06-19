'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Button, Input, Modal, Textarea, Spinner } from '@/components/ui.jsx';

const CATS = [['', 'All desks'], ['HR', 'HR'], ['IT', 'IT'], ['ADMIN', 'Admin']];
const STATUSES = [['', 'All'], ['PENDING', 'Pending'], ['RESOLVED', 'Resolved']];

function Badge({ status }) {
  const c = status === 'RESOLVED' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-sky-50 text-sky-700 ring-sky-200';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${c}`}>{status === 'RESOLVED' ? 'Resolved' : 'Pending'}</span>;
}

export default function SupportPortalPage() {
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [resolveT, setResolveT] = useState(null); // ticket being resolved
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    setRows(null);
    api.get(`/admin/support?${params.toString()}`).then(setRows).catch(() => setRows([]));
  }, [cat, status, q]);
  useEffect(() => { load(); }, [cat, status]); // q applied via the Search button

  async function viewAttachment(id) {
    const win = window.open('', '_blank');
    try {
      const auth = getStoredAuth();
      const res = await fetch(`/api/admin/support/${id}/attachment`, { headers: { Authorization: `Bearer ${auth?.token}` } });
      if (!res.ok) { win?.close(); return; }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location = url; else window.location.href = url;
    } catch { win?.close(); }
  }

  async function submitResolve(newStatus) {
    setBusy(true);
    try { await api.post(`/admin/support/${resolveT.id}/resolve`, { status: newStatus, note: note || null }); setResolveT(null); setNote(''); load(); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-bold text-ink tracking-tight">Support Desk</h1>
        <p className="text-ink-faint text-sm mt-0.5">HR, IT &amp; Admin tickets raised by employees.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CATS.map(([v, l]) => (
          <button key={v} onClick={() => setCat(v)} className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${cat === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-line text-ink-soft hover:border-brand-300'}`}>{l}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        {STATUSES.map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${status === v ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink-soft hover:border-slate-300'}`}>{l}</button>
        ))}
        <div className="flex-1" />
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, issue…" className="w-56" onKeyDown={(e) => e.key === 'Enter' && load()} />
          <Button variant="outline" onClick={load}>Search</Button>
        </div>
      </div>

      {rows === null ? <div className="p-12 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
        : rows.length === 0 ? <Card className="p-10 text-center text-ink-faint">No tickets match these filters.</Card>
        : (
        <div className="space-y-3">
          {rows.map((t) => (
            <Card key={t.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-ink">Ticket #{t.id}</span>
                    <span className="text-xs font-medium text-violet-700 bg-violet-50 rounded px-1.5 py-0.5">{t.category}</span>
                  </div>
                  <div className="text-sm text-ink-soft mt-0.5">{t.name} · {t.employeeCode}{t.phone ? ` · ${t.phone}` : ''}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-faint">{(t.appliedAt || '').slice(0, 10)}</span>
                  <Badge status={t.status} />
                </div>
              </div>
              <div className="mt-3 text-sm">
                <div className="text-ink"><span className="text-ink-faint">Issue:</span> {t.issueType}{t.issueDetail ? ` · ${t.issueDetail}` : ''}</div>
                {t.description && <div className="text-ink-soft mt-1">{t.description}</div>}
                {t.resolutionNote && <div className="text-emerald-700 mt-1.5"><span className="font-medium">Resolution:</span> {t.resolutionNote}</div>}
              </div>
              <div className="mt-3 flex items-center gap-3">
                {t.hasAttachment && <button onClick={() => viewAttachment(t.id)} className="text-brand-700 text-sm font-medium hover:underline">View attachment</button>}
                <div className="flex-1" />
                {t.status === 'PENDING'
                  ? <Button size="sm" onClick={() => { setResolveT(t); setNote(''); }}>Resolve</Button>
                  : <Button size="sm" variant="outline" onClick={() => { setResolveT(t); setNote(t.resolutionNote || ''); }}>Update</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!resolveT} onClose={() => setResolveT(null)} title={resolveT ? `Ticket #${resolveT.id} — ${resolveT.category}` : ''}
        actions={<>
          <Button variant="outline" onClick={() => submitResolve('PENDING')} disabled={busy}>Mark pending</Button>
          <Button onClick={() => submitResolve('RESOLVED')} disabled={busy}>{busy ? <Spinner /> : 'Mark resolved'}</Button>
        </>}>
        <div className="space-y-2">
          {resolveT && <p className="text-ink-soft">{resolveT.issueType}{resolveT.issueDetail ? ` · ${resolveT.issueDetail}` : ''}</p>}
          <Textarea rows={3} placeholder="Resolution note (visible to the employee)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
