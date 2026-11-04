'use client';
import { useEffect, useState } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator, addDays } from '@/lib/validate.js';
import { useHasTeam } from '@/lib/perms.jsx';
import { Card, Button, Input, Textarea, Spinner, Empty, Field, ErrorSummary, Modal, useConfirm } from '@/components/ui.jsx';

const TONE = { PENDING: 'text-amber-700', APPROVED: 'text-emerald-700', REJECTED: 'text-rose-700', WITHDRAWN: 'text-ink-faint' };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

export default function ResignationPage() {
  const [tab, setTab] = useState(0);
  // The Team tab only for someone with a team (null = still loading → hidden).
  const hasTeam = useHasTeam() === true;
  return (
    <div className="space-y-4">
      <h1 className="page-title text-ink">Resignation</h1>
      <div className="flex gap-1.5 border-b border-line">
        {(hasTeam ? ['My Resignation', 'Team'] : ['My Resignation']).map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 1 && hasTeam ? <Team /> : <Mine />}
    </div>
  );
}

// Android-style section card: teal header strip + body (matches the app's Resignation screen).
function Section({ title, children }) {
  return (
    <Card className="overflow-hidden">
      <div className="bg-[#149A55] px-4 py-2.5 text-sm font-bold text-white">{title}</div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex py-1 text-sm">
      <span className="w-40 shrink-0 text-ink-faint">{k}</span>
      <span className="min-w-0 flex-1 font-medium text-ink">{v || '—'}</span>
    </div>
  );
}

const STAGE_PILL = {
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  BYPASSED: 'bg-slate-100 text-slate-500',
  CANCELLED: 'bg-slate-100 text-slate-500',
  PENDING: 'bg-amber-100 text-amber-700',
  WAITING: 'bg-slate-100 text-slate-500',
};

// Stage table: role → approver (code - name, email) → live status. Before
// applying it is a preview of who will approve; unassigned optional stages are
// skipped, unassigned required stages block submission.
function Approvals({ approvers }) {
  if (!approvers?.length) return null;
  return (
    <Section title="Approvals">
      <div className="divide-y divide-line">
        {approvers.map((a) => (
          <div key={a.seq} className="flex items-center gap-3 py-2.5">
            <span className="w-36 shrink-0 text-xs font-semibold text-ink-soft">{a.stage || 'Approver'}</span>
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-semibold ${a.name ? 'text-ink' : 'text-ink-faint'}`}>
                {[a.employeeCode, a.name].filter(Boolean).join(' - ')
                  || (a.assignment === 'MISSING' ? 'Not assigned — required, ask HR to assign'
                    : a.assignment === 'SKIPPED' ? 'Not assigned — this step will be skipped' : 'Not assigned')}
              </div>
              {a.email && <div className="truncate text-xs text-ink-soft">{a.email}</div>}
            </div>
            {a.status && (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STAGE_PILL[a.status] || 'bg-slate-100 text-slate-500'}`}>
                {label(a.status)}
              </span>
            )}
            {!a.status && a.assignment === 'MISSING' && (
              <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-red-100 text-red-700">Required</span>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

function Mine() {
  const [ctx, setCtx] = useState(null);
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ resignationDate: todayIso(), lastWorkingDate: '', reason: '', letter: null });
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, confirmUi] = useConfirm();

  const load = () => {
    api.get('/resignation/context').then((c) => {
      setCtx(c);
      if (c?.policy) {
        setF((x) => ({ ...x, resignationDate: x.resignationDate || c.policy.today,
          lastWorkingDate: x.lastWorkingDate || c.policy.suggestedLastWorkingDate }));
      }
    }).catch(() => setCtx(false));
    api.get('/resignation').then(setRows).catch(() => setRows([]));
  };
  useEffect(() => { load(); }, []);
  const active = (rows || []).find((r) => ['PENDING', 'APPROVED'].includes(r.status));
  const policy = ctx?.policy || {};
  const np = ctx?.employee?.noticePeriodDays ?? 30;
  const served = f.resignationDate && f.lastWorkingDate ? daysBetween(f.resignationDate, f.lastWorkingDate) : null;
  const shortfall = served != null && served >= 0 ? Math.max(0, np - served) : 0;

  function validate() {
    const v = validator();
    v.date('resignationDate', f.resignationDate, 'Resignation date', {
      required: true, min: policy.minResignationDate, max: policy.maxResignationDate,
      minMsg: `Resignation date cannot be before ${fmtDate(policy.minResignationDate)}`,
      maxMsg: `Resignation date cannot be after ${fmtDate(policy.maxResignationDate)}`,
    });
    v.date('lastWorkingDate', f.lastWorkingDate, 'Last working date', {
      required: true, min: f.resignationDate || undefined,
      max: f.resignationDate ? addDays(f.resignationDate, 180) : undefined,
      minMsg: 'Last working date cannot be before the resignation date',
      maxMsg: 'Last working date cannot be more than 180 days after the resignation date',
    });
    v.text('reason', f.reason, 'Reason', { required: true, min: 5, max: 1000 });
    if (f.letter && f.letter.size > 5 * 1024 * 1024) v.add('letter', 'The resignation letter is larger than 5MB');
    setErrors(v.fields);
    return v.ok;
  }

  async function apply() {
    setMsg(''); setSaving(true);
    try {
      const body = { resignationDate: f.resignationDate, lastWorkingDate: f.lastWorkingDate, reason: f.reason.trim() };
      if (f.letter) {
        body.letter = await readFile(f.letter); body.letterMime = f.letter.type; body.letterName = f.letter.name;
      }
      const r = await api.post('/resignation', body);
      setConfirming(false);
      setNotice(`Your resignation has been submitted. You keep full access until your last working day (${fmtDate(r.lastWorkingDate || f.lastWorkingDate)}).${
        r.noticeShortfallDays ? ` Notice shortfall of ${r.noticeShortfallDays} day(s) will be adjusted in your Full & Final settlement.` : ''}`);
      load();
    } catch (e) {
      setConfirming(false);
      setErrors(e.fields || {}); setMsg(e.message);
    } finally { setSaving(false); }
  }

  async function withdraw(r) {
    if (!(await confirm({ title: 'Withdraw your resignation?', body: 'Your resignation request will be cancelled and removed from every approver\'s queue.', confirmLabel: 'Withdraw', tone: 'danger' }))) return;
    try { await api.post(`/resignation/${r.id}/withdraw`); setNotice('Your resignation has been withdrawn.'); load(); } catch (e) { setMsg(e.message); }
  }

  const blocked = ctx && ctx.canSubmit === false;

  return (
    <div className="space-y-4">
      {confirmUi}
      {ctx && ctx !== false && (
        <Section title="Employee Details">
          <KV k="Employee Code" v={ctx.employee?.employeeCode} />
          <KV k="Full Name" v={ctx.employee?.name} />
          <KV k="Vertical" v={ctx.employee?.vertical} />
          <KV k="Department" v={ctx.employee?.department} />
          <KV k="Designation" v={ctx.employee?.designation} />
          <KV k="Office Location" v={ctx.employee?.location} />
          <KV k="Date of Joining" v={ctx.employee?.dateOfJoining ? fmtDate(ctx.employee.dateOfJoining) : null} />
          <KV k="Reporting Manager" v={ctx.employee?.reportingManager} />
          <KV k="Notice Period" v={ctx.employee?.noticePeriodDays != null ? `${ctx.employee.noticePeriodDays} days` : null} />
        </Section>
      )}
      {notice && <div className="rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 px-4 py-3 text-sm">{notice}</div>}
      {!active && rows && (
        <Card className="p-4 space-y-3 max-w-lg">
          <div className="font-semibold text-sm">Apply for resignation</div>
          {blocked && (
            <div className="rounded-lg bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 px-3 py-2 text-xs">
              You cannot submit a resignation yet: no {ctx.missingStages.join(', ')} approver is set up for you.
              Please ask HR to assign the approvers first.
            </div>
          )}
          <ErrorSummary errors={errors} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Resignation date" required error={errors.resignationDate}>
              <Input type="date" value={f.resignationDate} min={policy.minResignationDate} max={policy.maxResignationDate}
                onChange={(e) => setF({ ...f, resignationDate: e.target.value })} />
            </Field>
            <Field label="Last working date" required error={errors.lastWorkingDate}
              hint={f.resignationDate ? `As per ${np} days notice: ${fmtDate(addDays(f.resignationDate, np))}` : undefined}>
              <Input type="date" value={f.lastWorkingDate} min={f.resignationDate || undefined}
                onChange={(e) => setF({ ...f, lastWorkingDate: e.target.value })} />
            </Field>
          </div>
          {shortfall > 0 && !errors.lastWorkingDate && (
            <p className="text-xs text-amber-700">
              This is {shortfall} day(s) short of your {np}-day notice period. The shortfall is recorded and recovered in your Full &amp; Final settlement unless HR waives it.
            </p>
          )}
          <Field label="Reason" required error={errors.reason}>
            <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
          <Field label="Resignation letter (optional)" hint="PDF or image, up to 5MB" error={errors.letter}>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => setF({ ...f, letter: e.target.files?.[0] || null })} />
          </Field>
          {msg && !Object.keys(errors).length && <p className="text-sm text-red-600">{msg}</p>}
          {!confirming ? (
            <Button onClick={() => { setMsg(''); if (validate()) setConfirming(true); }} disabled={blocked || saving}>Submit Resignation</Button>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-2.5">
              <div className="text-sm font-semibold text-amber-800">Please confirm</div>
              <p className="text-xs text-amber-800 leading-relaxed">
                Your resignation will move through the approval chain shown below. You keep full access to the
                app and web portal during your notice period, and can withdraw the request until it is finally
                approved. Your login is closed automatically after your last working day
                (<b>{fmtDate(f.lastWorkingDate)}</b>) — download your payslips and documents before then.
              </p>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" onClick={apply} disabled={saving}>{saving ? <Spinner /> : 'Submit resignation'}</Button>
                <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </Card>
      )}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No resignation history" /> :
        rows.map((r) => (
          <Card key={r.id} className="p-3 text-sm">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <div className="font-medium">Resigned {fmtDate(r.resignationDate)} · last day {fmtDate(r.lastWorkingDate)}</div>
                <div className="text-xs text-ink-faint">
                  {r.reason || '—'}{r.reviewNote ? ` · “${r.reviewNote}”` : ''}
                  {r.noticeShortfallDays ? ` · notice shortfall ${r.noticeShortfallDays} day(s)` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {r.hasLetter && <Button size="sm" variant="ghost" onClick={() => openFile(`/resignation/${r.id}/letter`).catch((e) => setMsg(e.message))}>Letter</Button>}
                <span className={`text-xs font-semibold ${TONE[r.status] || ''}`}>{label(r.status)}</span>
                {r.status === 'PENDING' && <Button size="sm" variant="outline" onClick={() => withdraw(r)}>Withdraw</Button>}
              </div>
            </div>
          </Card>
        ))}
      {ctx && ctx !== false && <Approvals approvers={ctx.approvers} />}
    </div>
  );
}

function Team() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [remarksErr, setRemarksErr] = useState('');
  const [confirm, confirmUi] = useConfirm();
  const load = () => api.get('/resignation/team?status=PENDING').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function act(id, action, rm = '') {
    try { await api.post(`/resignation/${id}/act`, { action, remarks: rm }); setRejecting(null); load(); } catch (e) { setMsg(e.message); }
  }
  async function approve(r) {
    if (!(await confirm({ title: `Approve ${r.name}'s resignation?`, body: `Last working day ${fmtDate(r.lastWorkingDate)}. The request moves to the next approver.`, confirmLabel: 'Approve' }))) return;
    act(r.id, 'APPROVED');
  }
  return (
    <div className="space-y-3">
      {confirmUi}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <Spinner /> : !rows.length ? <Empty title="No pending team resignations" /> :
        rows.map((r) => (
          <Card key={r.id} className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
            <div>
              <div className="font-medium">{r.name} · last day {fmtDate(r.lastWorkingDate)}</div>
              <div className="text-xs text-ink-faint">{r.reason || '—'}{r.noticeShortfallDays ? ` · notice shortfall ${r.noticeShortfallDays} day(s)` : ''}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => approve(r)}>Approve</Button>
              <Button size="sm" variant="danger" onClick={() => { setRejecting(r); setRemarks(''); setRemarksErr(''); }}>Reject</Button>
            </div>
          </Card>
        ))}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject resignation — ${rejecting?.name || ''}`} tone="danger"
        actions={<>
          <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => {
            if (remarks.trim().length < 5) { setRemarksErr('Please give a reason of at least 5 characters'); return; }
            act(rejecting.id, 'REJECTED', remarks.trim());
          }}>Reject</Button>
        </>}>
        <Field label="Reason" required error={remarksErr}>
          <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
