'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import {
  Card, Button, Field, Input, Textarea, Modal, Spinner, Empty, ErrorSummary, useConfirm,
} from '@/components/ui.jsx';

const KIND = { REQUEST: 'New asset request', ISSUE: 'Issue reported', RETURN: 'Return request' };
const iso = (v) => (v ? String(v).slice(0, 10) : '');

export default function EssAssetsPage() {
  const [rows, setRows] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [form, setForm] = useState(null); // { kind, assignmentId?, assetTag?, category, details }
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, confirmUi] = useConfirm();

  const load = () => {
    api.get('/me/assets').then((r) => setRows(r.assets || [])).catch(() => setRows([]));
    api.get('/me/asset-requests').then((r) => setReqs(r.requests || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  async function ack(id) { try { await api.post(`/me/assets/${id}/acknowledge`, {}); load(); } catch (e) { setErr(e.message); } }

  function open(kind, a = null) { setForm({ kind, assignmentId: a?.assignment_id || null, assetTag: a?.asset_tag || '', category: '', details: '' }); setErrors({}); }
  async function submit() {
    const v = validator();
    if (form.kind === 'REQUEST') v.text('category', form.category, 'Asset type', { required: true, max: 80 });
    v.text('details', form.details, form.kind === 'REQUEST' ? 'Reason' : 'Details', { required: true, min: 5, max: 1000 });
    setErrors(v.fields);
    if (!v.ok) return;
    setSaving(true);
    try {
      await api.post('/me/asset-requests', { kind: form.kind, assignmentId: form.assignmentId, category: form.category.trim(), details: form.details.trim() });
      setMsg(`${KIND[form.kind]} sent to HR.`); setForm(null); load();
    } catch (e) { setErrors(e.fields || { _: e.message }); } finally { setSaving(false); }
  }
  async function cancel(r) {
    if (!(await confirm({ title: 'Cancel this request?', body: `${KIND[r.kind]}: ${r.details}`, confirmLabel: 'Cancel request', cancelLabel: 'Keep it', tone: 'danger' }))) return;
    try { await api.post(`/me/asset-requests/${r.id}/cancel`, {}); load(); } catch (e) { setErr(e.message); }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {confirmUi}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title text-ink">My Assets</h1>
          <p className="text-ink-faint text-sm">Company assets assigned to you. Request a new one, or report a problem or a return on one you hold.</p>
        </div>
        <Button onClick={() => open('REQUEST')}>Request an asset</Button>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {!rows ? <Spinner className="text-brand-600 h-6 w-6" /> : !rows.length ? <Empty title="No assets assigned" subtitle="Use Request an asset if you need one." /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map((a) => (
            <Card key={a.assignment_id} className="p-4 text-sm">
              <div className="font-mono text-[13px]">{a.asset_tag}</div>
              <div className="text-ink-soft">{[a.brand, a.model].filter(Boolean).join(' ') || a.category}</div>
              <div className="text-xs text-ink-faint mt-1">Since {fmtDate(iso(a.assigned_on || a.assigned_at))}{a.assigned_condition ? ` · ${label(a.assigned_condition)} condition` : ''}</div>
              {a.acknowledged ? <span className="inline-block mt-2 text-xs text-brand-700">✓ Acknowledged</span>
                : <button onClick={() => ack(a.assignment_id)} className="mt-2 text-xs text-brand-700 font-medium underline">Acknowledge receipt</button>}
              {a.open_request
                ? <div className="mt-2 text-xs text-amber-700">{KIND[a.open_request.split(':')[0]]} — {label(a.open_request.split(':')[1])}</div>
                : (
                  <div className="mt-2 flex gap-3 text-xs">
                    <button onClick={() => open('ISSUE', a)} className="text-ink-soft underline">Report an issue</button>
                    <button onClick={() => open('RETURN', a)} className="text-ink-soft underline">Request return</button>
                  </div>
                )}
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-[15px] font-semibold text-ink">My requests</h2>
        {!reqs.length ? <p className="text-sm text-ink-faint">No requests yet.</p> : (
          <Card className="divide-y divide-line">
            {reqs.map((r) => (
              <div key={r.id} className="p-3 text-sm flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{KIND[r.kind]}{r.assetTag ? ` · ${r.assetTag}` : r.category ? ` · ${r.category}` : ''}</div>
                  <div className="text-ink-soft break-words">{r.details}</div>
                  <div className="text-xs text-ink-faint mt-0.5">Raised {fmtDate(iso(r.createdAt))}{r.hrNote ? ` · HR: ${r.hrNote}` : ''}</div>
                </div>
                <div className="text-right shrink-0">
                  <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-ink-soft">{r.status === 'OPEN' ? 'Open' : label(r.status)}</span>
                  {r.status === 'OPEN' && <div><button onClick={() => cancel(r)} className="text-xs text-rose-600 mt-1">Cancel</button></div>}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form ? (form.kind === 'REQUEST' ? 'Request an asset' : `${form.kind === 'ISSUE' ? 'Report an issue with' : 'Request return of'} ${form.assetTag}`) : ''}
        actions={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Sending…' : 'Send to HR'}</Button></>}>
        {form && (
          <div className="space-y-4">
            <ErrorSummary errors={errors} />
            {form.kind === 'REQUEST' && (
              <Field label="Asset type" required error={errors.category}><Input value={form.category} maxLength={80} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Laptop, monitor, headset…" /></Field>
            )}
            <Field label={form.kind === 'REQUEST' ? 'Reason' : 'Details'} required error={errors.details} hint={`${form.details.length}/1000`}>
              <Textarea rows={4} maxLength={1000} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })}
                placeholder={form.kind === 'ISSUE' ? 'What is wrong with it?' : form.kind === 'RETURN' ? 'Why are you returning it?' : 'What do you need it for?'} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
