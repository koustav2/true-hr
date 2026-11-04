'use client';
import { useEffect, useRef, useState } from 'react';
import { api, downloadFile, openFile } from '@/lib/api.js';
import { fmtDate } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import {
  Card, Button, Spinner, Empty, Badge, Modal, Field, Textarea, useConfirm,
} from '@/components/ui.jsx';

const SUB_TONE = { SUBMITTED: 'warn', ACCEPTED: 'ok', REJECTED: 'danger' };
const SUB_LABEL = { SUBMITTED: 'Awaiting HR review', ACCEPTED: 'Accepted', REJECTED: 'Rejected' };
const FORM_EXT = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
const FORM_MIME = { pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const extOf = (n) => String(n || '').split('.').pop().toLowerCase();
const readB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = rej; r.readAsDataURL(file);
});

export default function PoliciesPage() {
  const [rows, setRows] = useState(null);
  const [subs, setSubs] = useState([]);
  const [tab, setTab] = useState('POLICY');
  const [msg, setMsg] = useState('');
  const [submit, setSubmit] = useState(null);
  const [confirm, confirmUi] = useConfirm();

  const load = () => {
    api.get('/policies').then(setRows).catch((e) => { setMsg(e.message); setRows([]); });
    api.get('/me/policy-submissions').then(setSubs).catch(() => setSubs([]));
  };
  useEffect(load, []);

  const all = rows || [];
  // Policies are listed once a file is uploaded; formats always, so the
  // employee can still hand a filled form back.
  const policies = all.filter((p) => (p.kind || 'POLICY') === 'POLICY' && p.id != null);
  const formats = all.filter((p) => p.kind === 'FORMAT');

  async function ack(p) {
    if (!(await confirm({ title: 'I have read and accept', confirmLabel: 'I accept',
      body: `By confirming, you acknowledge that you have read “${p.title}”${p.version ? ` (version ${p.version})` : ''} and accept it.` }))) return;
    try { await api.post(`/policies/${p.id}/ack`, {}); load(); } catch (e) { setMsg(e.message); }
  }
  const view = (p) => openFile(`/policies/${p.id}/file`).catch((e) => setMsg(e.message));
  const download = (p) => downloadFile(`/policies/${p.id}/file`, p.filename || `${p.title}.pdf`).catch((e) => setMsg(e.message));

  const tabs = [['POLICY', `Policies (${policies.length})`], ['FORMAT', `Formats (${formats.length})`], ['MINE', `My submitted forms (${subs.length})`]];

  return (
    <div className="space-y-4">
      <h1 className="page-title text-ink">Policies & Formats</h1>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {tabs.map(([k, t]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-2 text-[13px] font-semibold -mb-px border-b-2 whitespace-nowrap ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-faint hover:text-ink'}`}>{t}</button>
        ))}
      </div>

      {!rows ? <Spinner /> : tab === 'POLICY' ? (
        !policies.length ? <Empty title="No policies published yet" /> : (
          <div className="grid sm:grid-cols-2 gap-3">
            {policies.map((p) => (
              <Card key={p.slotId ?? p.id} className="p-3 text-sm space-y-2">
                <div className="min-w-0">
                  <div className="font-medium break-words">{p.title}</div>
                  <div className="text-xs text-ink-faint break-words">
                    {[p.policyType, p.version && `Version ${p.version}`, p.effectiveDate && `Effective ${fmtDate(p.effectiveDate)}`].filter(Boolean).join(' · ')}
                  </div>
                  {p.description && <div className="text-xs text-ink-soft mt-1 break-words">{p.description}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="soft" onClick={() => view(p)}>View</Button>
                  <Button size="sm" variant="outline" onClick={() => download(p)}>Download</Button>
                  {p.requiresAck && (p.acknowledged
                    ? <Badge tone="ok">Acknowledged</Badge>
                    : <Button size="sm" onClick={() => ack(p)}>I have read and accept</Button>)}
                </div>
              </Card>
            ))}
          </div>
        )
      ) : tab === 'FORMAT' ? (
        !formats.length ? <Empty title="No formats published yet" /> : (
          <div className="grid sm:grid-cols-2 gap-3">
            {formats.map((p) => (
              <Card key={p.slotId ?? p.id} className="p-3 text-sm space-y-2">
                <div className="min-w-0">
                  <div className="font-medium break-words">{p.title}</div>
                  <div className="text-xs text-ink-faint">{p.id == null ? 'Blank form not uploaded yet' : [p.version && `Version ${p.version}`, p.effectiveDate && `Effective ${fmtDate(p.effectiveDate)}`].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.id != null && <Button size="sm" variant="outline" onClick={() => download(p)}>Download blank form</Button>}
                  {p.slotId != null && <Button size="sm" onClick={() => setSubmit({ p, file: null, note: '' })}>Upload filled form</Button>}
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        !subs.length ? <Empty title="You have not submitted any forms" /> : (
          <div className="space-y-2">
            {subs.map((s) => (
              <Card key={s.id} className="p-3 text-sm flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium break-words">{s.title}</div>
                  <div className="text-xs text-ink-faint">Submitted {fmtDate(String(s.submittedAt).slice(0, 10))}{s.filename ? ` · ${s.filename}` : ''}</div>
                  {s.reviewNote && <div className="text-xs text-ink-soft mt-1 break-words">HR: {s.reviewNote}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={SUB_TONE[s.status]}>{SUB_LABEL[s.status] || s.status}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => openFile(`/me/policy-submissions/${s.id}/file`).catch((e) => setMsg(e.message))}>Open</Button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {submit && <SubmitModal state={submit} onClose={() => setSubmit(null)} onDone={() => { setSubmit(null); setTab('MINE'); load(); }} />}
      {confirmUi}
    </div>
  );
}

function SubmitModal({ state, onClose, onDone }) {
  const [f, setF] = useState(state);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const input = useRef(null);

  async function save() {
    const v = validator();
    if (!f.file) v.add('file', 'Choose the filled form to upload (PDF, DOC, DOCX or an image)');
    else if (!FORM_EXT.includes(extOf(f.file.name))) v.add('file', 'The filled form must be a PDF, DOC, DOCX, JPG or PNG file');
    else if (f.file.size > 5 * 1024 * 1024) v.add('file', 'The file is larger than 5MB');
    v.text('note', f.note, 'Note', { max: 500 });
    setErrors(v.fields);
    if (!v.ok) return;
    setSaving(true);
    try {
      await api.post(`/policies/slots/${f.p.slotId}/submissions`, {
        file: await readB64(f.file), mime: FORM_MIME[extOf(f.file.name)] || f.file.type, filename: f.file.name, note: f.note || null,
      });
      onDone();
    } catch (e) { setErrors(e.fields || { _: e.message }); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Upload filled form: ${f.p.title}`}
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={save}>{saving ? 'Uploading…' : 'Submit to HR'}</Button></>}>
      <div className="space-y-3">
        {errors._ && <p role="alert" className="text-neg text-sm">{errors._}</p>}
        <Field label="Filled form (PDF, DOC, DOCX, JPG or PNG, max 5MB)" required error={errors.file}>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" type="button" onClick={() => input.current?.click()}>Choose file</Button>
            <span className="text-xs text-ink-soft break-all">{f.file?.name || 'No file chosen'}</span>
            <input ref={input} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden"
              onChange={(e) => { const file = e.target.files?.[0] || null; e.target.value = ''; setF({ ...f, file }); }} />
          </div>
        </Field>
        <Field label="Note for HR" error={errors.note} hint={`${(f.note || '').length}/500`}>
          <Textarea rows={3} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
