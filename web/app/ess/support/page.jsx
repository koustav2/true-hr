'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import {
  Card, Button, Select, Textarea, Input, Spinner, Empty, Field, Badge, Modal, ErrorSummary, useConfirm,
} from '@/components/ui.jsx';

const DESC_MIN = 10;
const DESC_MAX = 2000;
const SUBJECT_MAX = 120;
const TONE = { OPEN: 'warn', IN_PROGRESS: 'info', REOPENED: 'danger', RESOLVED: 'ok', CLOSED: 'neutral', CANCELLED: 'neutral' };
const CAT_LABEL = { HR: 'HR', IT: 'IT', ADMIN: 'Admin' };
const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const wrap = 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]';

const StatusChip = ({ status }) => <Badge tone={TONE[status] || 'neutral'} dot>{label(status)}</Badge>;

export default function SupportPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4 min-w-0">
      <h1 className="page-title text-ink">Support Desk</h1>
      <div className="flex gap-1.5 border-b border-line">
        {['Create Ticket', 'My Tickets'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 ? <CreateTicket onCreated={() => setTab(1)} /> : <MyTickets />}
    </div>
  );
}

const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split('base64,')[1] || '');
  r.onerror = () => reject(new Error('Could not read the file'));
  r.readAsDataURL(file);
});

const BLANK = { issueType: '', issueDetail: '', subject: '', description: '' };

function CreateTicket({ onCreated }) {
  const [catalog, setCatalog] = useState(null);
  const [f, setF] = useState({ category: 'HR', ...BLANK });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [dup, setDup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => { api.get('/support/catalog').then(setCatalog).catch(() => setCatalog(false)); }, []);
  if (catalog === null) return <Spinner />;
  if (!catalog) return <Empty title="Could not load the issue types" subtitle="Please refresh the page." />;

  const cat = catalog[f.category] || {};
  const types = cat.types || [];
  const details = (cat.details || {})[f.issueType] || [];
  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); setDone(null); };

  function check() {
    const v = validator();
    if (!f.issueType) v.add('issueType', 'Please select an issue type');
    if (details.length && !f.issueDetail) v.add('issueDetail', 'Please select an issue detail');
    v.text('subject', f.subject, 'Subject', { required: true, min: 3, max: SUBJECT_MAX });
    v.text('description', f.description, 'Description', { required: true, min: DESC_MIN, max: DESC_MAX });
    if (file && !FILE_TYPES.includes(file.type)) v.add('attachment', 'The attachment must be a PNG, JPG, WEBP, GIF or PDF file');
    else if (file && file.size > 5 * 1024 * 1024) v.add('attachment', 'The attachment is larger than 5MB');
    setErrors(v.fields);
    return v.ok;
  }

  async function submit(confirmDuplicate = false) {
    setMsg(''); setDup(null);
    if (!check()) return;
    setBusy(true);
    try {
      const body = { ...f, subject: f.subject.trim(), description: f.description.trim(), confirmDuplicate };
      if (file) Object.assign(body, { attachment: await readFile(file), attachmentMime: file.type, attachmentName: file.name });
      const r = await api.post('/support', body);
      setDone(r.ticketNo ?? r.id);
      setF({ category: f.category, ...BLANK }); setFile(null);
    } catch (e) {
      if (e.status === 409) setDup(e.message);
      else { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); }
    } finally { setBusy(false); }
  }

  return (
    <Card className="p-4 space-y-3 max-w-lg">
      <ErrorSummary errors={errors} />
      <Field label="Category" required>
        <Select value={f.category} onChange={(e) => { setF({ ...f, category: e.target.value, issueType: '', issueDetail: '' }); setErrors({}); }}>
          {Object.keys(catalog).map((c) => <option key={c} value={c}>{CAT_LABEL[c] || c}</option>)}
        </Select>
      </Field>
      <Field label="Issue type" required error={errors.issueType}>
        <Select value={f.issueType} onChange={(e) => { set('issueType', e.target.value); setF((p) => ({ ...p, issueDetail: '' })); }}>
          <option value="">Select</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </Field>
      {!!details.length && (
        <Field label="Issue detail" required error={errors.issueDetail}>
          <Select value={f.issueDetail} onChange={(e) => set('issueDetail', e.target.value)}>
            <option value="">Select</option>
            {details.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Subject" required error={errors.subject}>
        <Input value={f.subject} maxLength={SUBJECT_MAX} onChange={(e) => set('subject', e.target.value)} placeholder="A short summary" />
      </Field>
      <Field label="Description" required error={errors.description} hint={`${f.description.length}/${DESC_MAX} characters (at least ${DESC_MIN})`}>
        <Textarea rows={4} maxLength={DESC_MAX} value={f.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label="Attachment (optional)" error={errors.attachment} hint="PNG, JPG, WEBP, GIF or PDF, up to 5MB">
        <input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.pdf" className="text-sm"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setErrors((x) => ({ ...x, attachment: undefined })); }} />
      </Field>
      {dup && (
        <div className="rounded border border-crit/40 bg-crit-bg px-3 py-2 text-sm text-crit space-y-2">
          <div>{dup}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDup(null)}>Don’t raise it</Button>
            <Button size="sm" onClick={() => submit(true)} disabled={busy}>Raise anyway</Button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-neg">{msg}</p>}
      {done != null && (
        <p className="text-sm text-pos">Ticket #{done} created. <button className="underline" onClick={onCreated}>See my tickets</button></p>
      )}
      <Button onClick={() => submit(false)} disabled={busy}>{busy ? 'Creating…' : 'Create Ticket'}</Button>
    </Card>
  );
}

function MyTickets() {
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const load = useCallback(() => api.get('/support').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  return !rows ? <Spinner /> : !rows.length ? <Empty title="No tickets yet" subtitle="Tickets you raise will appear here." /> : (
    <div className="space-y-3 min-w-0">
      {rows.map((t) => (
        <Card key={t.id} className="p-3 text-sm min-w-0">
          <div className="flex flex-wrap justify-between items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">#{t.ticketNo ?? t.id}</span>
                <span className="text-xs text-ink-faint">{fmtDate(t.appliedAt)}</span>
                <StatusChip status={t.status} />
              </div>
              {t.subject && <div className={`font-medium mt-1 ${wrap}`}>{t.subject}</div>}
              <div className="text-xs text-ink-soft">{CAT_LABEL[t.category] || t.category} · {t.issueType}{t.issueDetail ? ` — ${t.issueDetail}` : ''}</div>
              {t.description && <div className={`text-xs text-ink-faint mt-1 line-clamp-2 ${wrap}`}>{t.description}</div>}
              {t.resolutionNote && <div className={`text-xs text-pos mt-1 ${wrap}`}>Resolution: {t.resolutionNote}</div>}
            </div>
            <Button size="sm" variant="outline" onClick={() => setOpenId(t.id)}>
              {t.commentCount ? `View (${t.commentCount})` : 'View'}
            </Button>
          </div>
        </Card>
      ))}
      {openId && <TicketDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function TicketDetail({ id, onClose, onChanged }) {
  const [t, setT] = useState(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmUi] = useConfirm();
  const load = useCallback(() => api.get(`/support/${id}`).then(setT).catch((e) => setMsg(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function act(path, body, field) {
    setBusy(true); setMsg(''); setErrors({});
    try { await api.post(path, body); setText(''); await load(); onChanged(); }
    catch (e) { setErrors(e.fields ? { [field]: Object.values(e.fields)[0] } : {}); if (!e.fields) setMsg(e.message); }
    finally { setBusy(false); }
  }
  const need = (field, lbl) => {
    const v = validator(); v.text(field, text, lbl, { required: true, min: 2, max: DESC_MAX });
    if (!v.ok) setErrors(v.fields);
    return v.ok;
  };

  async function cancelTicket() {
    if (!(await confirm({ title: `Cancel ticket #${t.ticketNo ?? t.id}?`, body: 'The support desk will stop working on it.', confirmLabel: 'Cancel ticket', cancelLabel: 'Keep it', tone: 'danger' }))) return;
    act(`/support/${id}/cancel`, { reason: text.trim() || undefined }, 'body');
  }

  const closed = t && ['CLOSED', 'CANCELLED'].includes(t.status);
  return (
    <Modal open onClose={onClose} size="lg" title={t ? `Ticket #${t.ticketNo ?? t.id}` : 'Ticket'}
      actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {!t ? (msg ? <p className="text-neg">{msg}</p> : <Spinner />) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={t.status} />
              <span className="text-xs text-ink-faint">Raised {fmtDate(t.appliedAt)}</span>
              {t.assignedTo && <span className="text-xs text-ink-faint">· With {t.assignedTo.name}</span>}
            </div>
            {t.subject && <div className={`font-semibold text-ink ${wrap}`}>{t.subject}</div>}
            <div className="text-ink-soft">{CAT_LABEL[t.category] || t.category} · {t.issueType}{t.issueDetail ? ` — ${t.issueDetail}` : ''}</div>
            {t.description && <div className={`text-ink ${wrap}`}>{t.description}</div>}
            {t.hasAttachment && <button onClick={() => openFile(`/support/${t.id}/attachment`).catch((e) => setMsg(e.message))} className="text-brand-700 text-sm font-medium hover:underline">View attachment</button>}
            {t.resolutionNote && <div className={`text-pos ${wrap}`}><span className="font-medium">Resolution:</span> {t.resolutionNote}</div>}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">Updates</div>
            {!t.comments?.length ? <p className="text-ink-faint text-sm">No updates yet.</p> : (
              <ul className="space-y-2">
                {t.comments.map((c) => (
                  <li key={c.id} className={`rounded border border-line px-3 py-2 ${c.authorRole === 'STAFF' ? 'bg-brand-50/40' : 'bg-white'}`}>
                    <div className="text-[11.5px] text-ink-faint">
                      <span className="font-semibold text-ink-soft">{c.authorRole === 'STAFF' ? c.author : 'You'}</span> · {fmtDate(c.at)}{c.event ? ` · ${label(c.event)}` : ''}
                    </div>
                    <div className={`text-sm text-ink ${wrap}`}>{c.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!closed && (
            <Field label={t.canReopen ? 'Still not fixed? Tell us why' : 'Add a reply'} error={errors.body || errors.reason} hint={`${text.length}/${DESC_MAX}`}>
              <Textarea rows={2} maxLength={DESC_MAX} value={text} onChange={(e) => { setText(e.target.value); setErrors({}); }} />
            </Field>
          )}
          {msg && <p className="text-sm text-neg">{msg}</p>}
          {!closed && (
            <div className="flex flex-wrap justify-end gap-2">
              {t.canCancel && <Button variant="outline" onClick={cancelTicket} disabled={busy}>Cancel ticket</Button>}
              {t.canReopen && <Button variant="outline" disabled={busy} onClick={() => need('reason', 'Reason for reopening') && act(`/support/${id}/reopen`, { reason: text.trim() }, 'reason')}>Reopen</Button>}
              <Button disabled={busy} onClick={() => need('body', 'Reply') && act(`/support/${id}/comments`, { body: text.trim() }, 'body')}>Send reply</Button>
            </div>
          )}
        </div>
      )}
      {confirmUi}
    </Modal>
  );
}
