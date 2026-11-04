'use client';
import { useEffect, useRef, useState } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import {
  Card, Spinner, Button, Modal, Field, Input, Select, Textarea, Badge, Empty, PageHeader, useConfirm,
} from '@/components/ui.jsx';

// Policies are documents to read: PDF, DOC or DOCX only (H103).
const POLICY_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const extOf = (name) => String(name || '').split('.').pop().toLowerCase();
const mimeOf = (file) => (Object.values(POLICY_TYPES).includes(file.type) ? file.type : POLICY_TYPES[extOf(file.name)] || file.type || '');

const readB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = rej; r.readAsDataURL(file);
});

const SUB_TONE = { SUBMITTED: 'warn', ACCEPTED: 'ok', REJECTED: 'danger' };
const SUB_LABEL = { SUBMITTED: 'Awaiting review', ACCEPTED: 'Accepted', REJECTED: 'Rejected' };

export default function PoliciesAdminPage() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('POLICY');
  const [types, setTypes] = useState([]);
  const [msg, setMsg] = useState('');
  const [slotForm, setSlotForm] = useState(null);     // add / edit an entry
  const [upload, setUpload] = useState(null);         // upload a document
  const [acks, setAcks] = useState(null);
  const [confirm, confirmUi] = useConfirm();

  const load = () => api.get('/admin/policies')
    .then((r) => setData(r))
    .catch((e) => { setMsg(e.message); setData({ items: [] }); });
  useEffect(() => {
    load();
    api.get('/meta/org-masters?kind=POLICY_TYPE').then(setTypes).catch(() => setTypes([]));
  }, []);

  const items = data?.items || [];
  const shown = items.filter((i) => (i.kind || 'POLICY') === tab);

  async function removeFile(p) {
    if (!(await confirm({ title: 'Remove the uploaded file?', tone: 'danger', confirmLabel: 'Remove file',
      body: `Employees will no longer be able to open “${p.title}”. It stays on your list so you can upload a new file.` }))) return;
    try { await api.del(`/admin/policies/${p.id}`); setMsg(''); load(); } catch (e) { setMsg(e.message); }
  }
  async function removeSlot(p) {
    if (!(await confirm({ title: `Remove “${p.title}” from the list?`, tone: 'danger', confirmLabel: 'Remove',
      body: 'Its file, employee acknowledgements and any filled forms submitted against it are deleted too. This cannot be undone.' }))) return;
    try { await api.del(`/admin/policy-slots/${p.slotId}`); setMsg(''); load(); } catch (e) { setMsg(e.message); }
  }
  async function showAcks(p) {
    setAcks({ title: p.title, rows: null });
    try { const r = await api.get(`/admin/policies/${p.id}/acks`); setAcks({ title: p.title, rows: r.rows }); }
    catch (e) { setAcks(null); setMsg(e.message); }
  }

  const tabs = [
    ['POLICY', `Policies (${items.filter((i) => (i.kind || 'POLICY') === 'POLICY').length})`],
    ['FORMAT', `Formats (${items.filter((i) => i.kind === 'FORMAT').length})`],
    ['SUBMISSIONS', `Submitted forms${data?.pendingSubmissions ? ` (${data.pendingSubmissions} to review)` : ''}`],
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Policies & formats"
        subtitle="Your organisation's own list. Policies are documents employees read (and can be asked to acknowledge); formats are forms they download, fill in and upload back to HR. Files must be PDF, DOC or DOCX; uploading again replaces the current file."
        action={tab !== 'SUBMISSIONS' && (
          <Button onClick={() => setSlotForm({ title: '', kind: tab, description: '', policyTypeId: '', requiresAck: false })}>
            {tab === 'FORMAT' ? 'Add format' : 'Add policy'}
          </Button>
        )} />
      {msg && <p role="alert" className="text-sm text-rose-600">{msg}</p>}

      <div className="flex gap-1 border-b border-line">
        {tabs.map(([k, t]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-2 text-[13px] font-semibold -mb-px border-b-2 ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-faint hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'SUBMISSIONS' ? <Submissions items={items} onChange={load} /> : (
        <Card className="overflow-x-auto">
          {data === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
            : !shown.length ? (
              <Empty title={tab === 'FORMAT' ? 'No formats yet' : 'No policies yet'}
                subtitle={`Use “${tab === 'FORMAT' ? 'Add format' : 'Add policy'}” to start your organisation's list.`} />
            ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Document</th>
                  <th className="text-left px-5 py-3 font-medium">Version / effective</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-right px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((p) => (
                  <tr key={p.slotId ?? `f${p.id}`} className="hover:bg-slate-50/70 align-top">
                    <td className="px-5 py-3">
                      <div className="text-ink font-medium break-words">{p.title}</div>
                      <div className="text-xs text-ink-faint mt-0.5 break-words">
                        {[p.policyType, p.description].filter(Boolean).join(' · ') || ' '}
                      </div>
                      {p.requiresAck && <Badge tone="info" className="mt-1">Acknowledgement required</Badge>}
                    </td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                      {p.available ? <>{p.version || '—'}<div className="text-xs text-ink-faint">{p.effectiveDate ? `From ${fmtDate(p.effectiveDate)}` : ''}</div></> : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {p.available
                        ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Uploaded {fmtDate((p.uploadedAt || '').slice(0, 10))}</span>
                        : <span className="inline-flex items-center gap-1.5 text-ink-faint"><span className="h-1.5 w-1.5 rounded-full bg-slate-300" />Not uploaded</span>}
                      {p.available && p.requiresAck && (
                        <button type="button" onClick={() => showAcks(p)} className="block text-xs text-brand-700 hover:underline mt-1">
                          {p.ackCount} acknowledged
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap space-x-3">
                      {p.available && <button type="button" onClick={() => openFile(`/policies/${p.id}/file`).catch((e) => setMsg(e.message))} className="text-brand-700 text-xs font-medium hover:underline">View</button>}
                      <button type="button" onClick={() => setUpload({ p, version: p.version || '', effectiveDate: p.effectiveDate || '', file: null })}
                        className="text-brand-700 text-xs font-medium hover:underline">{p.available ? 'Replace' : 'Upload'}</button>
                      {p.slotId && <button type="button" onClick={() => setSlotForm({ id: p.slotId, title: p.title, kind: p.kind, description: p.description || '', policyTypeId: p.policyTypeId ?? '', requiresAck: !!p.requiresAck })}
                        className="text-brand-700 text-xs font-medium hover:underline">Edit</button>}
                      {p.available && <button type="button" onClick={() => removeFile(p)} className="text-rose-600 text-xs font-medium hover:underline">Remove file</button>}
                      {p.slotId && <button type="button" onClick={() => removeSlot(p)} className="text-rose-600 text-xs font-medium hover:underline">Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {slotForm && <SlotModal form={slotForm} types={types} onClose={() => setSlotForm(null)} onSaved={() => { setSlotForm(null); load(); }} />}
      {upload && <UploadModal state={upload} onClose={() => setUpload(null)} onSaved={() => { setUpload(null); load(); }} />}
      <Modal open={!!acks} onClose={() => setAcks(null)} title={acks ? `Acknowledged: ${acks.title}` : ''} size="lg">
        {!acks?.rows ? <Spinner /> : !acks.rows.length ? <p>No one has acknowledged this version yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-ink-faint"><th className="text-left py-1">Employee</th><th className="text-left py-1">ID</th><th className="text-left py-1">Acknowledged on</th></tr></thead>
            <tbody>{acks.rows.map((r) => (
              <tr key={r.employeeId} className="border-t border-line"><td className="py-1.5">{r.name}</td><td>{r.employeeCode}</td><td>{fmtDate(String(r.acknowledgedAt).slice(0, 10))}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Modal>
      {confirmUi}
    </div>
  );
}

function SlotModal({ form: initial, types, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save() {
    const v = validator();
    v.text('title', f.title, 'Title', { required: true, max: 120 });
    v.text('description', f.description, 'Description', { max: 500 });
    setErrors(v.fields);
    if (!v.ok) return;
    setSaving(true);
    try {
      const body = { title: f.title.trim(), kind: f.kind, description: f.description, policyTypeId: f.policyTypeId || null, requiresAck: !!f.requiresAck };
      if (f.id) await api.patch(`/admin/policy-slots/${f.id}`, body);
      else await api.post('/admin/policy-slots', body);
      onSaved();
    } catch (e) { setErrors(e.fields || { _: e.message }); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={f.id ? 'Edit entry' : (f.kind === 'FORMAT' ? 'Add format' : 'Add policy')}
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}>
      <div className="space-y-3">
        {errors._ && <p role="alert" className="text-neg text-sm">{errors._}</p>}
        <Field label="Title" required error={errors.title}><Input value={f.title} maxLength={120} onChange={set('title')} placeholder="e.g. Code of Conduct" /></Field>
        <Field label="Kind" error={errors.kind} hint="A format is a form employees fill in and upload back.">
          <Select value={f.kind} onChange={set('kind')}><option value="POLICY">Policy</option><option value="FORMAT">Format</option></Select>
        </Field>
        <Field label="Category" error={errors.policyTypeId} hint={types.length ? null : 'Add categories under Master data › Policy Type Master.'}>
          <Select value={f.policyTypeId ?? ''} onChange={set('policyTypeId')}>
            <option value="">— None —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Description" error={errors.description}><Textarea rows={2} maxLength={500} value={f.description} onChange={set('description')} /></Field>
        {f.kind !== 'FORMAT' && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.requiresAck} onChange={set('requiresAck')} />
            Employees must acknowledge “I have read and accept”</label>
        )}
      </div>
    </Modal>
  );
}

function UploadModal({ state, onClose, onSaved }) {
  const [f, setF] = useState(state);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const input = useRef(null);

  async function save() {
    const v = validator();
    if (!f.file) v.add('file', 'Choose a PDF, DOC or DOCX file to upload');
    else if (!Object.keys(POLICY_TYPES).includes(extOf(f.file.name))) v.add('file', 'Policies must be PDF, DOC or DOCX files');
    else if (f.file.size > 10 * 1024 * 1024) v.add('file', 'The file is larger than 10MB');
    v.text('version', f.version, 'Version', { max: 30 });
    v.date('effectiveDate', f.effectiveDate, 'Effective date', { min: '2000-01-01', max: '2100-12-31' });
    setErrors(v.fields);
    if (!v.ok) return;
    setSaving(true);
    try {
      await api.post('/admin/policies', {
        slotId: f.p.slotId ?? undefined, title: f.p.title, file: await readB64(f.file), mime: mimeOf(f.file),
        filename: f.file.name, version: f.version || null, effectiveDate: f.effectiveDate || null,
      });
      onSaved();
    } catch (e) { setErrors(e.fields || { _: e.message }); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Upload: ${f.p.title}`}
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Uploading…' : 'Upload'}</Button></>}>
      <div className="space-y-3">
        {errors._ && <p role="alert" className="text-neg text-sm">{errors._}</p>}
        {f.p.available && <p className="text-xs text-ink-faint">This replaces the current file. Employees who acknowledged the old file will be asked to acknowledge the new one.</p>}
        <Field label="File (PDF, DOC or DOCX, max 10MB)" required error={errors.file}>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" type="button" onClick={() => input.current?.click()}>Choose file</Button>
            <span className="text-xs text-ink-soft break-all">{f.file?.name || 'No file chosen'}</span>
            <input ref={input} type="file" accept={ACCEPT} className="hidden"
              onChange={(e) => { const file = e.target.files?.[0] || null; e.target.value = ''; setF({ ...f, file }); setErrors({ ...errors, file: undefined }); }} />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Version" error={errors.version}><Input value={f.version} maxLength={30} placeholder="e.g. 2.0" onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
          <Field label="Effective date" error={errors.effectiveDate}><Input type="date" min="2000-01-01" max="2100-12-31" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function Submissions({ items, onChange }) {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('SUBMITTED');
  const [slotId, setSlotId] = useState('');
  const [review, setReview] = useState(null);
  const [msg, setMsg] = useState('');
  const formats = items.filter((i) => i.kind === 'FORMAT' && i.slotId);

  const load = () => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (slotId) q.set('slotId', slotId);
    setRows(null);
    api.get(`/admin/policy-submissions?${q}`).then(setRows).catch((e) => { setMsg(e.message); setRows([]); });
  };
  useEffect(load, [status, slotId]);

  async function decide() {
    const v = validator();
    if (review.status === 'REJECTED') v.text('note', review.note, 'Reason', { required: true, max: 500 });
    else v.text('note', review.note, 'Note', { max: 500 });
    if (!v.ok) { setReview({ ...review, errors: v.fields }); return; }
    setReview({ ...review, saving: true });
    try {
      await api.post(`/admin/policy-submissions/${review.row.id}/review`, { status: review.status, note: review.note });
      setReview(null); load(); onChange();
    } catch (e) { setReview({ ...review, saving: false, errors: e.fields || { _: e.message } }); }
  }

  return (
    <Card className="overflow-x-auto">
      <div className="flex flex-wrap gap-3 p-4 border-b border-line">
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(SUB_LABEL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </Select>
        <Select className="w-64" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
          <option value="">All formats</option>
          {formats.map((f) => <option key={f.slotId} value={f.slotId}>{f.title}</option>)}
        </Select>
      </div>
      {msg && <p role="alert" className="text-sm text-rose-600 px-4 pt-3">{msg}</p>}
      {rows === null ? <div className="p-10 grid place-items-center"><Spinner /></div>
        : !rows.length ? <Empty title="No submitted forms found" subtitle="Filled formats employees upload from the employee portal appear here." /> : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Employee</th>
              <th className="text-left px-5 py-3 font-medium">Format</th>
              <th className="text-left px-5 py-3 font-medium">Submitted</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-right px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((s) => (
              <tr key={s.id} className="align-top">
                <td className="px-5 py-3">{s.name}<div className="text-xs text-ink-faint">{s.employeeCode}</div></td>
                <td className="px-5 py-3 break-words">{s.title}{s.note && <div className="text-xs text-ink-faint break-words">“{s.note}”</div>}</td>
                <td className="px-5 py-3 whitespace-nowrap">{fmtDate(String(s.submittedAt).slice(0, 10))}</td>
                <td className="px-5 py-3"><Badge tone={SUB_TONE[s.status]}>{SUB_LABEL[s.status] || label(s.status)}</Badge>
                  {s.reviewNote && <div className="text-xs text-ink-faint mt-1 break-words">{s.reviewNote}</div>}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap space-x-3">
                  <button type="button" className="text-brand-700 text-xs font-medium hover:underline" onClick={() => openFile(`/admin/policy-submissions/${s.id}/file`).catch((e) => setMsg(e.message))}>Open</button>
                  {s.status === 'SUBMITTED' && <>
                    <button type="button" className="text-emerald-700 text-xs font-medium hover:underline" onClick={() => setReview({ row: s, status: 'ACCEPTED', note: '' })}>Accept</button>
                    <button type="button" className="text-rose-600 text-xs font-medium hover:underline" onClick={() => setReview({ row: s, status: 'REJECTED', note: '' })}>Reject</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={!!review} onClose={() => setReview(null)} tone={review?.status === 'REJECTED' ? 'danger' : 'brand'}
        title={review ? `${review.status === 'REJECTED' ? 'Reject' : 'Accept'}: ${review.row.title}` : ''}
        actions={<><Button variant="ghost" onClick={() => setReview(null)}>Cancel</Button>
          <Button variant={review?.status === 'REJECTED' ? 'danger' : 'primary'} disabled={review?.saving} onClick={decide}>
            {review?.status === 'REJECTED' ? 'Reject' : 'Accept'}</Button></>}>
        {review && (
          <div className="space-y-2">
            {review.errors?._ && <p role="alert" className="text-neg text-sm">{review.errors._}</p>}
            <Field label={review.status === 'REJECTED' ? 'Reason (shown to the employee)' : 'Note (optional)'} required={review.status === 'REJECTED'} error={review.errors?.note}>
              <Textarea rows={3} maxLength={500} value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value, errors: {} })} />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}
