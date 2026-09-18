'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Field, Textarea, Select, Input, Spinner, Empty, Badge, PageHeader, StatTile, Modal } from '@/components/ui.jsx';

// Master ticket inbox — every tenant's tickets, in one queue. Only the platform
// owner reaches this route.

const STATUS = {
  OPEN: { label: 'Open', tone: 'warn' },
  IN_PROGRESS: { label: 'In progress', tone: 'brand' },
  RESOLVED: { label: 'Resolved', tone: 'ok' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

const stamp = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dmy = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  return `${dmy} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function PlatformTicketsPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('OPEN_ONLY');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(null);      // ticket being answered
  const [reply, setReply] = useState('');
  const [newStatus, setNewStatus] = useState('RESOLVED');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (term) p.set('q', term);
    api.get(`/admin/platform-tickets?${p}`).then(setData).catch(() => setData({ tickets: [], counts: {} }));
  }, [status, term]);

  useEffect(() => { load(); }, [load]);

  function answer(t) {
    setOpen(t);
    setReply(t.reply || '');
    setNewStatus(t.status === 'OPEN' ? 'IN_PROGRESS' : t.status);
    setMsg('');
  }

  async function send() {
    setBusy(true); setMsg('');
    try {
      await api.post(`/admin/platform-tickets/${open.id}/reply`, { status: newStatus, reply });
      setOpen(null);
      load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function download(id) {
    try {
      const auth = JSON.parse(localStorage.getItem('truehr_auth') || 'null');
      const res = await fetch(`/api/platform-tickets/${id}/screenshot`, {
        headers: { Authorization: `Bearer ${auth?.token}` },
      });
      if (!res.ok) throw new Error('Could not fetch the attachment');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `ticket-${id}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setMsg(e.message); }
  }

  const c = data?.counts || {};
  const tickets = data?.tickets || [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master tickets"
        subtitle="Raised by people inside the tenants, visible only here. Their own admins never see them."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Needs a reply" value={(c.OPEN ?? 0) + (c.IN_PROGRESS ?? 0)} tone="warn" caption="Open + in progress" />
        <StatTile label="Open" value={c.OPEN ?? 0} tone="brand" caption="Not yet picked up" />
        <StatTile label="In progress" value={c.IN_PROGRESS ?? 0} tone="brand" caption="Being worked on" />
        <StatTile label="Resolved" value={(c.RESOLVED ?? 0) + (c.CLOSED ?? 0)} tone="ok" caption="Closed out" />
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <Field label="Show">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="OPEN_ONLY">Needs a reply</option>
              <option value="">Everything</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </Select>
          </Field>
          <Field label="Search">
            <Input value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setTerm(q)}
              placeholder="Subject, code, person or organisation" />
          </Field>
          <Button variant="secondary" onClick={() => setTerm(q)}>Search</Button>
          {term && <Button variant="ghost" onClick={() => { setQ(''); setTerm(''); }}>Clear</Button>}
        </div>

        {msg && <p className="px-4 pt-3 text-[13px] font-medium text-neg">{msg}</p>}

        {data === null ? (
          <div className="py-16 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
        ) : tickets.length === 0 ? (
          <div className="p-10">
            <Empty title="Nothing waiting" subtitle="Tickets raised from any organisation land here." />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {tickets.map((t) => {
              const s = STATUS[t.status] || STATUS.OPEN;
              return (
                <li key={t.id} className="p-4 hover:bg-slate-50/60">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-sm font-semibold text-ink">{t.subject}</span>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </div>
                      <div className="mt-1 text-[11.5px] text-ink-faint">
                        <span className="font-mono">{t.code}</span>
                        {' · '}<span className="font-semibold text-ink-soft">{t.organisation || 'No organisation'}</span>
                        {' · '}{t.raisedBy}{t.raiserRole ? ` (${t.raiserRole})` : ''}
                        {' · '}{stamp(t.createdAt)}
                      </div>
                      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft whitespace-pre-wrap max-w-[75ch]">
                        {t.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                        {t.contactEmail && <a href={`mailto:${t.contactEmail}`} className="font-medium text-brand-700 hover:underline">{t.contactEmail}</a>}
                        {t.contactPhone && <a href={`tel:${t.contactPhone}`} className="font-medium text-brand-700 hover:underline">{t.contactPhone}</a>}
                        {t.hasScreenshot && (
                          <button onClick={() => download(t.id)} className="font-medium text-brand-700 hover:underline">
                            Download attachment
                          </button>
                        )}
                      </div>
                      {t.reply && (
                        <div className="mt-2.5 rounded-lg bg-slate-50 border border-line px-3 py-2.5 max-w-[75ch]">
                          <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-faint mb-1">
                            Our reply · {stamp(t.repliedAt)}
                          </div>
                          <p className="text-[13px] leading-relaxed text-ink-soft whitespace-pre-wrap">{t.reply}</p>
                        </div>
                      )}
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => answer(t)} className="shrink-0">
                      {t.reply ? 'Update' : 'Reply'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={!!open} onClose={() => setOpen(null)}
        title={open ? `Reply · ${open.code}` : ''}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
            <Button onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send reply'}</Button>
          </>
        }
      >
        {open && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-ink-soft">
              <div className="font-semibold text-ink">{open.subject}</div>
              <div className="mt-0.5 text-ink-faint">
                {open.organisation || 'No organisation'} · {open.raisedBy}
              </div>
              <div className="mt-1">
                Replying to {open.contactEmail || open.contactPhone}
                {open.contactEmail ? ' by email' : ' — no email on file, so call them'}
              </div>
            </div>
            <Field label="Status">
              <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                <option value="IN_PROGRESS">In progress — we are on it</option>
                <option value="RESOLVED">Resolved — fixed or answered</option>
                <option value="CLOSED">Closed — no action needed</option>
                <option value="OPEN">Open — put it back in the queue</option>
              </Select>
            </Field>
            <Field label="Reply" hint="Shown to the raiser in their portal, and emailed if they left an address.">
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={6} maxLength={4000}
                placeholder="What we found, what we changed, and anything they need to do." />
            </Field>
            {msg && <p className="text-[13px] font-medium text-neg">{msg}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
