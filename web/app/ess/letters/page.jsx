'use client';
import { useEffect, useState } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { Card, Spinner, Empty, Button, Modal, Field, Select, Textarea, Badge, useConfirm } from '@/components/ui.jsx';

const day = (v) => fmtDate(v ? String(v).slice(0, 10) : null);
const TONE = { PENDING: 'warn', ISSUED: 'ok', REJECTED: 'danger', CANCELLED: 'neutral' };

export default function EssLettersPage() {
  const [confirm, confirmUi] = useConfirm();
  const [rows, setRows] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [types, setTypes] = useState({});
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ typeCode: '', purpose: '' });
  const [errors, setErrors] = useState({});

  const load = () => {
    api.get('/me/letters').then((r) => setRows(r.letters || [])).catch(() => setRows([]));
    api.get('/me/letter-requests').then((r) => { setReqs(r.requests || []); setTypes(r.types || {}); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const pdf = (id) => openFile(`/me/letters/${id}/pdf`).catch((e) => setMsg(e.message));

  async function submit() {
    const e = {};
    if (!form.typeCode) e.typeCode = 'Letter type is required';
    if (form.purpose.trim().length < 5) e.purpose = 'Tell HR what it is for (at least 5 characters)';
    setErrors(e);
    if (Object.keys(e).length) return;
    try { await api.post('/me/letter-requests', { typeCode: form.typeCode, purpose: form.purpose.trim() }); setOpen(false); setMsg('Request sent to HR.'); load(); }
    catch (err) { setErrors(err.fields || { form: err.message }); }
  }
  async function cancel(r) {
    if (!(await confirm({ title: 'Withdraw this request?', body: `${r.typeLabel} — ${r.purpose}`, confirmLabel: 'Withdraw', tone: 'danger' }))) return;
    try { await api.post(`/me/letter-requests/${r.id}/cancel`, {}); load(); } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {confirmUi}
      <div className="flex items-start justify-between gap-3">
        <h1 className="page-title text-ink">My Letters</h1>
        <Button onClick={() => { setForm({ typeCode: '', purpose: '' }); setErrors({}); setOpen(true); }}>Request a letter</Button>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}
      {!rows ? <Spinner className="text-brand-600 h-6 w-6" /> : !rows.length ? <Empty title="No letters yet" subtitle="Letters issued to you by HR will appear here." /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map((l) => (
            <Card key={l.id} className="p-4 flex items-center justify-between text-sm">
              <div><div className="font-medium">{l.title} {l.status === 'REVOKED' && <Badge tone="danger">Revoked</Badge>}</div><div className="text-xs text-ink-faint">{l.ref_no} · {day(l.issued_at)}</div></div>
              <button onClick={() => pdf(l.id)} className="text-brand-700 font-medium">PDF</button>
            </Card>
          ))}
        </div>
      )}

      {reqs.length > 0 && (
        <Card className="p-0">
          <div className="px-4 py-2.5 border-b border-line text-[12.5px] font-semibold text-ink-soft">My requests</div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {reqs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5"><div className="font-medium">{r.typeLabel}</div><div className="text-xs text-ink-faint">{r.purpose}</div></td>
                  <td className="px-4 py-2.5 text-ink-faint text-xs">{day(r.created_at)}</td>
                  <td className="px-4 py-2.5"><Badge tone={TONE[r.status]}>{label(r.status)}</Badge>{r.hr_note && <div className="text-xs text-ink-faint mt-1">{r.hr_note}</div>}{r.ref_no && <div className="text-xs text-ink-faint font-mono">{r.ref_no}</div>}</td>
                  <td className="px-4 py-2.5 text-right">{r.status === 'PENDING' && <button onClick={() => cancel(r)} className="text-rose-600 text-xs font-medium">Withdraw</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Request a letter"
        actions={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit}>Send to HR</Button></>}>
        <div className="space-y-3">
          {errors.form && <p className="text-sm text-neg">{errors.form}</p>}
          <Field label="Letter" required error={errors.typeCode}>
            <Select value={form.typeCode} onChange={(e) => setForm({ ...form, typeCode: e.target.value })}>
              <option value="">— choose —</option>
              {Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Purpose" required error={errors.purpose} hint="e.g. Home loan application, visa, address proof for a bank"><Textarea rows={3} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
