'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import {
  Card, Button, Input, Modal, Textarea, Spinner, Select, Field, Badge, Empty, useConfirm,
} from '@/components/ui.jsx';

const CATS = [['', 'All desks'], ['HR', 'HR'], ['IT', 'IT'], ['ADMIN', 'Admin']];
const STATUSES = [['ACTIVE', 'Open & in progress'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['REOPENED', 'Reopened'],
  ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed'], ['CANCELLED', 'Cancelled'], ['', 'All']];
const MOVE_TO = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const TONE = { OPEN: 'warn', IN_PROGRESS: 'info', REOPENED: 'danger', RESOLVED: 'ok', CLOSED: 'neutral', CANCELLED: 'neutral' };
const NOTE_MAX = 2000;

const StatusChip = ({ status }) => <Badge tone={TONE[status] || 'neutral'} dot>{label(status)}</Badge>;
const catLabel = (c) => (c === 'ADMIN' ? 'Admin' : c);

export default function SupportPortalPage() {
  const [tab, setTab] = useState('tickets');
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-ink">Support Desk</h1>
        <p className="text-ink-faint text-sm mt-0.5">HR, IT &amp; Admin tickets raised by employees.</p>
      </div>
      <div className="flex gap-1.5 border-b border-line">
        {[['tickets', 'Tickets'], ['types', 'Issue types']].map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 'tickets' ? <Tickets /> : <IssueTypes />}
    </div>
  );
}

function Tickets() {
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    setRows(null);
    api.get(`/admin/support?${params.toString()}`).then(setRows).catch((e) => { setMsg(e.message); setRows([]); });
  }, [cat, status, q]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [cat, status]); // q applied via the Search button

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {CATS.map(([v, l]) => (
          <button key={v} onClick={() => setCat(v)} className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${cat === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-line text-ink-soft hover:border-brand-300'}`}>{l}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48" aria-label="Status">
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <div className="flex-1" />
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, #ticket, issue…" className="w-60" onKeyDown={(e) => e.key === 'Enter' && load()} />
          <Button variant="outline" onClick={load}>Search</Button>
        </div>
      </div>
      {msg && <p className="text-sm text-neg">{msg}</p>}

      {rows === null ? <div className="p-12 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
        : rows.length === 0 ? <Card><Empty title="No tickets found" subtitle="Nothing matches these filters." /></Card>
        : (
        <div className="space-y-3">
          {rows.map((t) => (
            <Card key={t.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-ink">Ticket #{t.ticketNo ?? t.id}</span>
                    <Badge tone="grape">{catLabel(t.category)}</Badge>
                    {t.possibleDuplicateOf && <Badge tone="warn">Possible duplicate of #{t.possibleDuplicateOf}</Badge>}
                  </div>
                  {t.subject && <div className="font-medium text-ink mt-1 break-words [overflow-wrap:anywhere]">{t.subject}</div>}
                  <div className="text-sm text-ink-soft mt-0.5">
                    {t.name} · {t.employeeCode}
                    {t.phone && <> · {t.phone}{t.phoneValid === false && <span className="text-neg"> (invalid number on record)</span>}</>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-faint">{fmtDate(t.appliedAt)}</span>
                  <StatusChip status={t.status} />
                </div>
              </div>
              <div className="mt-3 text-sm min-w-0">
                <div className="text-ink"><span className="text-ink-faint">Issue:</span> {t.issueType}{t.issueDetail ? ` · ${t.issueDetail}` : ''}</div>
                {t.description && <div className="text-ink-soft mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] line-clamp-3">{t.description}</div>}
                {t.resolutionNote && <div className="text-pos mt-1.5 break-words [overflow-wrap:anywhere]"><span className="font-medium">Resolution:</span> {t.resolutionNote}</div>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                {t.hasAttachment && <button onClick={() => openFile(`/admin/support/${t.id}/attachment`).catch((e) => setMsg(e.message))} className="text-brand-700 font-medium hover:underline">View attachment</button>}
                <span className="text-ink-faint">{t.assignedTo ? `Assigned to ${t.assignedTo.name}` : 'Unassigned'}</span>
                {t.commentCount > 0 && <span className="text-ink-faint">· {t.commentCount} {t.commentCount === 1 ? 'update' : 'updates'}</span>}
                <div className="flex-1" />
                <Button size="sm" variant={['OPEN', 'IN_PROGRESS', 'REOPENED'].includes(t.status) ? 'primary' : 'outline'} onClick={() => setOpenId(t.id)}>
                  {['OPEN', 'IN_PROGRESS', 'REOPENED'].includes(t.status) ? 'Open & respond' : 'View'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {openId && <TicketModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function Thread({ comments }) {
  if (!comments?.length) return <p className="text-ink-faint text-sm">No replies yet.</p>;
  return (
    <ul className="space-y-2">
      {comments.map((c) => (
        <li key={c.id} className={`rounded border border-line px-3 py-2 ${c.authorRole === 'STAFF' ? 'bg-brand-50/40' : 'bg-white'}`}>
          <div className="text-[11.5px] text-ink-faint flex flex-wrap gap-x-2">
            <span className="font-semibold text-ink-soft">{c.author}</span>
            <span>{c.authorRole === 'STAFF' ? 'Support desk' : 'Employee'}</span>
            <span>{fmtDate(c.at)} {c.at ? new Date(c.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
            {c.event && <span>· {label(c.event)}</span>}
          </div>
          <div className="text-sm text-ink whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{c.body}</div>
        </li>
      ))}
    </ul>
  );
}

function TicketModal({ id, onClose, onChanged }) {
  const [t, setT] = useState(null);
  const [staff, setStaff] = useState([]);
  const [reply, setReply] = useState('');
  const [next, setNext] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmUi] = useConfirm();

  const load = useCallback(() => api.get(`/admin/support/${id}`).then((d) => { setT(d); setNext(d.status === 'REOPENED' ? 'IN_PROGRESS' : d.status); })
    .catch((e) => setMsg(e.message)), [id]);
  useEffect(() => { load(); api.get('/admin/support/staff').then(setStaff).catch(() => setStaff([])); }, [load]);

  const closed = t && ['CANCELLED'].includes(t.status);

  async function sendReply() {
    const v = validator(); v.text('body', reply, 'Reply', { required: true, min: 2, max: NOTE_MAX });
    if (!v.ok) { setErrors(v.fields); return; }
    setBusy(true); setErrors({}); setMsg('');
    try { await api.post(`/admin/support/${id}/comments`, { body: reply.trim() }); setReply(''); await load(); onChanged(); }
    catch (e) { setErrors(e.fields || {}); setMsg(e.message); } finally { setBusy(false); }
  }

  async function saveStatus() {
    const v = validator();
    if (['RESOLVED', 'CLOSED'].includes(next)) v.text('note', note, 'Resolution note', { required: true, min: 5, max: NOTE_MAX });
    if (!v.ok) { setErrors(v.fields); return; }
    if (next === 'CLOSED' && !(await confirm({ title: `Close ticket #${t.ticketNo ?? t.id}?`, body: 'The employee will not be able to reopen a closed ticket.', confirmLabel: 'Close ticket', tone: 'danger' }))) return;
    setBusy(true); setErrors({}); setMsg('');
    try {
      await api.post(`/admin/support/${id}/resolve`, { status: next, note: note.trim() || null });
      setNote(''); await load(); onChanged();
    } catch (e) { setErrors(e.fields || {}); setMsg(e.message); } finally { setBusy(false); }
  }

  async function assign(userId) {
    setBusy(true); setMsg('');
    try { await api.post(`/admin/support/${id}/assign`, { userId: userId || null }); await load(); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t ? `Ticket #${t.ticketNo ?? t.id} — ${catLabel(t.category)}` : 'Ticket'}
      actions={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {t && !closed && <Button onClick={saveStatus} disabled={busy || next === t.status && !note.trim()}>{busy ? <Spinner /> : 'Save status'}</Button>}
      </>}>
      {!t ? (msg ? <p className="text-neg">{msg}</p> : <Spinner />) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2"><StatusChip status={t.status} /><span className="text-xs text-ink-faint">Raised {fmtDate(t.appliedAt)} by {t.name} ({t.employeeCode})</span></div>
            {t.subject && <div className="font-semibold text-ink break-words [overflow-wrap:anywhere]">{t.subject}</div>}
            <div className="text-ink-soft">{t.issueType}{t.issueDetail ? ` · ${t.issueDetail}` : ''}</div>
            {t.description && <div className="text-ink whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{t.description}</div>}
            {t.hasAttachment && <button onClick={() => openFile(`/admin/support/${t.id}/attachment`).catch((e) => setMsg(e.message))} className="text-brand-700 text-sm font-medium hover:underline">View attachment</button>}
          </div>

          <Field label="Assigned to">
            <Select value={t.assignedTo?.id || ''} onChange={(e) => assign(e.target.value)} disabled={busy || closed}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {label(s.role)}</option>)}
            </Select>
          </Field>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">Updates</div>
            <Thread comments={t.comments} />
          </div>

          {!closed && (
            <>
              <Field label="Reply to the employee" error={errors.body} hint={`${reply.length}/${NOTE_MAX}`}>
                <Textarea rows={2} maxLength={NOTE_MAX} value={reply} onChange={(e) => { setReply(e.target.value); setErrors({ ...errors, body: undefined }); }} />
              </Field>
              <div className="flex justify-end"><Button size="sm" variant="outline" onClick={sendReply} disabled={busy}>Send reply</Button></div>

              <div className="grid sm:grid-cols-2 gap-3 border-t border-line pt-3">
                <Field label="Change status to">
                  <Select value={next} onChange={(e) => { setNext(e.target.value); setErrors({ ...errors, note: undefined }); }}>
                    {[...new Set([t.status, ...MOVE_TO])].map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </Select>
                </Field>
                <Field label={['RESOLVED', 'CLOSED'].includes(next) ? 'Resolution note (shown to the employee)' : 'Note (optional)'}
                  required={['RESOLVED', 'CLOSED'].includes(next)} error={errors.note}>
                  <Textarea rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => { setNote(e.target.value); setErrors({ ...errors, note: undefined }); }} />
                </Field>
              </div>
            </>
          )}
          {closed && <p className="text-ink-faint text-sm">The employee cancelled this ticket.</p>}
          {msg && <p className="text-sm text-neg">{msg}</p>}
        </div>
      )}
      {confirmUi}
    </Modal>
  );
}

const EMPTY_TYPE = { category: 'HR', issueType: '', details: '', attachment: true };

function IssueTypes() {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null); // { id?, …form }
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmUi] = useConfirm();

  const load = useCallback(() => api.get('/admin/support/types').then(setRows).catch((e) => { setMsg(e.message); setRows([]); }), []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const v = validator();
    v.text('issueType', edit.issueType, 'Issue type', { required: true, min: 2, max: 80 });
    if (!v.ok) { setErrors(v.fields); return; }
    setBusy(true); setErrors({}); setMsg('');
    const body = { category: edit.category, issueType: edit.issueType.trim(), details: edit.details, attachment: edit.attachment };
    try {
      if (edit.id) await api.put(`/admin/support/types/${edit.id}`, body); else await api.post('/admin/support/types', body);
      setEdit(null); load();
    } catch (e) { setErrors(e.fields || {}); setMsg(e.message); } finally { setBusy(false); }
  }

  async function remove(r) {
    if (!(await confirm({ title: `Remove “${r.issueType}”?`, body: 'Employees will no longer see it when raising a ticket. Existing tickets keep their issue type.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    try { await api.del(`/admin/support/types/${r.id}`); load(); } catch (e) { setMsg(e.message); }
  }

  if (!rows) return <Spinner />;
  const active = rows.filter((r) => r.active);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-ink-faint flex-1">The issue types and details employees choose from when raising a ticket. Each organisation keeps its own list.</p>
        <Button onClick={() => { setEdit(EMPTY_TYPE); setErrors({}); setMsg(''); }}>Add issue type</Button>
      </div>
      {msg && !edit && <p className="text-sm text-neg">{msg}</p>}
      {['HR', 'IT', 'ADMIN'].map((c) => (
        <Card key={c} className="p-4">
          <div className="font-semibold text-ink mb-2">{catLabel(c)} desk</div>
          {!active.some((r) => r.category === c) ? <p className="text-sm text-ink-faint">No issue types yet.</p> : (
            <ul className="divide-y divide-line">
              {active.filter((r) => r.category === c).map((r) => (
                <li key={r.id} className="py-2 flex flex-wrap items-start gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ink">{r.issueType}</div>
                    {!!r.details.length && <div className="text-xs text-ink-faint break-words">{r.details.join(' · ')}</div>}
                  </div>
                  <span className="text-xs text-ink-faint">{r.attachment ? 'Attachment allowed' : 'No attachment'}</span>
                  <button className="text-brand-700 font-medium hover:underline" onClick={() => { setEdit({ ...r, details: r.details.join('\n') }); setErrors({}); setMsg(''); }}>Edit</button>
                  <button className="text-neg font-medium hover:underline" onClick={() => remove(r)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit issue type' : 'Add issue type'}
        actions={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save'}</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Desk" required error={errors.category}>
              <Select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                <option value="HR">HR</option><option value="IT">IT</option><option value="ADMIN">Admin</option>
              </Select>
            </Field>
            <Field label="Issue type" required error={errors.issueType}>
              <Input value={edit.issueType} maxLength={80} onChange={(e) => { setEdit({ ...edit, issueType: e.target.value }); setErrors({ ...errors, issueType: undefined }); }} />
            </Field>
            <Field label="Issue details (one per line, optional)" error={errors.details} hint="When given, the employee must pick one.">
              <Textarea rows={4} value={edit.details} onChange={(e) => setEdit({ ...edit, details: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.attachment} onChange={(e) => setEdit({ ...edit, attachment: e.target.checked })} />
              Allow an attachment
            </label>
            {msg && <p className="text-sm text-neg">{msg}</p>}
          </div>
        )}
      </Modal>
      {confirmUi}
    </div>
  );
}
