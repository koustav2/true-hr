'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Select, Textarea, Spinner, Empty, Field } from '@/components/ui.jsx';

const TONE = { OPEN: 'text-amber-700', RESOLVED: 'text-emerald-700' };

export default function SupportPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">Support Desk</h1>
      <div className="flex gap-1.5 border-b border-line">
        {['Create Ticket', 'My Tickets'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 ? <CreateTicket /> : <MyTickets />}
    </div>
  );
}

function CreateTicket() {
  const [catalog, setCatalog] = useState(null);
  const [f, setF] = useState({ category: 'HR', issueType: '', issueDetail: '', description: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/support/catalog').then(setCatalog).catch(() => setCatalog(false)); }, []);
  if (catalog === null) return <Spinner />;
  if (!catalog) return <Empty title="Could not load catalog" />;

  const cat = catalog[f.category] || {};
  const types = cat.types || [];
  const details = (cat.details || {})[f.issueType] || [];

  async function submit() {
    setBusy(true); setMsg('');
    try {
      await api.post('/support', f);
      setMsg('Ticket created.'); setF({ ...f, issueType: '', issueDetail: '', description: '' });
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <Card className="p-4 space-y-2.5 max-w-lg">
      <Field label="Category" required>
        <Select value={f.category} onChange={(e) => setF({ category: e.target.value, issueType: '', issueDetail: '', description: f.description })}>
          {Object.keys(catalog).map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Issue type" required>
        <Select value={f.issueType} onChange={(e) => setF({ ...f, issueType: e.target.value, issueDetail: '' })}>
          <option value="">Select</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </Field>
      {!!details.length && (
        <Field label="Issue detail" required>
          <Select value={f.issueDetail} onChange={(e) => setF({ ...f, issueDetail: e.target.value })}>
            <option value="">Select</option>
            {details.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Description"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      {msg && <p className={`text-sm ${msg === 'Ticket created.' ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
      <Button onClick={submit} disabled={busy || !f.issueType}>{busy ? 'Creating…' : 'Create Ticket'}</Button>
    </Card>
  );
}

function MyTickets() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/support').then(setRows).catch(() => setRows([])); }, []);
  return !rows ? <Spinner /> : !rows.length ? <Empty title="No tickets yet" /> : (
    <div className="space-y-3">
      {rows.map((t) => (
        <Card key={t.id} className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
          <div>
            <div className="font-medium">{t.category} · {t.issueType}{t.issueDetail ? ` — ${t.issueDetail}` : ''}</div>
            <div className="text-xs text-ink-faint">{t.description || '—'}{t.resolutionNote ? ` · Resolution: “${t.resolutionNote}”` : ''}</div>
          </div>
          <span className={`text-xs font-semibold ${TONE[t.status] || 'text-ink-soft'}`}>{t.status}</span>
        </Card>
      ))}
    </div>
  );
}
