'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Field, Input, Textarea, Spinner, Empty, Badge, PageHeader } from '@/components/ui.jsx';

// Raise a ticket with the people who build TrueHR. Deliberately separate from
// the in-house Support Desk: this one goes past your own HR/IT to us, for when
// the product itself is the problem.

const MAX_SHOT = 5 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

const STATUS = {
  OPEN: { label: 'Open', tone: 'warn' },
  IN_PROGRESS: { label: 'In progress', tone: 'brand' },
  RESOLVED: { label: 'Resolved', tone: 'ok' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

const when = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export default function MasterTicket() {
  const [form, setForm] = useState({ subject: '', description: '', contactEmail: '', contactPhone: '' });
  const [shot, setShot] = useState(null);       // { name, mime, b64, size }
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState('');
  const fileRef = useRef(null);

  const load = () => api.get('/platform-tickets').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));

  useEffect(() => {
    load();
    // Pre-fill the contact from the signed-in account — most people would just
    // retype the same address.
    api.get('/me').then((m) => {
      if (m?.email) setForm((f) => (f.contactEmail ? f : { ...f, contactEmail: m.email }));
    }).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function pickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg('');
    if (!TYPES.includes(file.type)) {
      setMsg('Attach a PNG, JPG, WEBP, GIF or PDF.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_SHOT) {
      setMsg('That file is larger than 5MB.');
      e.target.value = '';
      return;
    }
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      setShot({ name: file.name, mime: file.type, b64, size: file.size });
    } catch {
      setMsg('Could not read that file. Try another one.');
    }
  }

  function clearFile() {
    setShot(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function submit(e) {
    e.preventDefault();
    setMsg(''); setOk('');
    if (!form.subject.trim()) return setMsg('Give the issue a short subject.');
    if (!form.description.trim()) return setMsg('Describe what went wrong.');
    if (!form.contactEmail.trim() && !form.contactPhone.trim()) {
      return setMsg('Leave an email or a phone number so we can reach you.');
    }
    setBusy(true);
    try {
      const created = await api.post('/platform-tickets', {
        ...form,
        screenshot: shot?.b64 || undefined,
        screenshotMime: shot?.mime || undefined,
        screenshotName: shot?.name || undefined,
      });
      setOk(`Sent. Your reference is ${created.code} — we will reply to the contact you gave.`);
      setForm((f) => ({ subject: '', description: '', contactEmail: f.contactEmail, contactPhone: f.contactPhone }));
      clearFile();
      load();
    } catch (e2) {
      setMsg(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function openShot(id) {
    try {
      const auth = JSON.parse(localStorage.getItem('truehr_auth') || 'null');
      const res = await fetch(`/api/platform-tickets/${id}/screenshot`, {
        headers: { Authorization: `Bearer ${auth?.token}` },
      });
      if (!res.ok) throw new Error('Could not fetch the file');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'screenshot';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contact TrueHR"
        subtitle="A direct line to the team that builds this product. Your organisation's HR and IT admins cannot see these tickets."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Subject" required>
              <Input
                value={form.subject} onChange={set('subject')} maxLength={160}
                placeholder="Payslip PDF opens blank for one employee"
              />
            </Field>

            <Field label="What happened" hint="What you did, what you expected, and what happened instead." required>
              <Textarea
                value={form.description} onChange={set('description')} rows={7} maxLength={5000}
                placeholder="Steps to reproduce, the employee code or screen involved, and anything you already tried."
              />
            </Field>

            <Field label="Screenshot" hint="PNG, JPG, WEBP, GIF or PDF, up to 5MB. Optional, but it usually saves a round trip.">
              {shot ? (
                <div className="flex items-center gap-3 rounded-lg border border-line bg-slate-50 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{shot.name}</span>
                    <span className="block text-[11.5px] text-ink-faint">{(shot.size / 1024).toFixed(0)} KB</span>
                  </span>
                  <button type="button" onClick={clearFile}
                    className="text-[12.5px] font-semibold text-neg hover:underline shrink-0">
                    Remove
                  </button>
                </div>
              ) : (
                <input
                  ref={fileRef} type="file" onChange={pickFile}
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                  className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3.5 file:py-2 file:text-[13px] file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
                />
              )}
            </Field>

            <div className="rounded-lg border border-line p-3.5">
              <div className="text-[12px] font-semibold text-ink mb-0.5">How should we reach you?</div>
              <p className="text-[12px] text-ink-faint mb-3">Give at least one. We reply here, not through your HR.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email">
                  <Input type="email" value={form.contactEmail} onChange={set('contactEmail')}
                    maxLength={160} placeholder="you@company.com" />
                </Field>
                <Field label="Phone">
                  <Input type="tel" value={form.contactPhone} onChange={set('contactPhone')}
                    maxLength={24} placeholder="+91 98765 43210" />
                </Field>
              </div>
            </div>

            {msg && <p className="text-[13px] font-medium text-neg">{msg}</p>}
            {ok && <p className="text-[13px] font-medium text-pos">{ok}</p>}

            <Button type="submit" disabled={busy}>
              {busy ? <><Spinner className="h-4 w-4" /> Sending…</> : 'Send to TrueHR'}
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <div className="text-[13px] font-semibold text-ink mb-0.5">Your requests</div>
          <p className="text-[12px] text-ink-faint mb-4">Everything you have sent us, newest first.</p>

          {rows === null ? (
            <div className="py-8 grid place-items-center"><Spinner className="text-brand-600 h-5 w-5" /></div>
          ) : rows.length === 0 ? (
            <Empty title="Nothing sent yet" subtitle="Requests you raise will show here with our reply." />
          ) : (
            <ul className="divide-y divide-line -mx-1">
              {rows.map((t) => {
                const s = STATUS[t.status] || STATUS.OPEN;
                return (
                  <li key={t.id} className="px-1 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink truncate">{t.subject}</div>
                        <div className="mt-0.5 text-[11.5px] text-ink-faint font-mono">
                          {t.code} · {when(t.createdAt)}
                        </div>
                      </div>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    {t.hasScreenshot && (
                      <button onClick={() => openShot(t.id)}
                        className="mt-1.5 text-[12px] font-medium text-brand-700 hover:underline">
                        Download attachment
                      </button>
                    )}
                    {t.reply && (
                      <div className="mt-2.5 rounded-lg bg-brand-50 px-3 py-2.5">
                        <div className="text-[10.5px] font-bold uppercase tracking-wider text-brand-700 mb-1">
                          TrueHR replied · {when(t.repliedAt)}
                        </div>
                        <p className="text-[13px] leading-relaxed text-ink-soft whitespace-pre-wrap">{t.reply}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
