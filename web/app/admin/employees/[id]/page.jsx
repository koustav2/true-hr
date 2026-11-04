'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { api, fetchBlob } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator, toNumber, INDIAN_STATES } from '@/lib/validate.js';
import { Card, Button, Spinner, Textarea, Modal, Input, Select, Field, Badge, ErrorSummary, useConfirm } from '@/components/ui.jsx';
import { MasterText, MasterSelect } from '@/components/MasterPicker.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { IconArrowLeft, IconCheck, IconFile, IconExit } from '@/components/icons.jsx';
import { checkEmployee, dateBounds, m10 } from '../rules.js';
import { bankForIfsc } from '@/app/onboarding/ifsc.js';

const DOC_LABELS = {
  PHOTO: 'Photograph', SIGNATURE_IMAGE: 'Signature image',
  CERT_10: '10th marksheet', CERT_12: '12th marksheet', CERT_GRAD: 'Graduation marksheet',
  CERT_PG: 'Post-graduation marksheet', CERT_OTHER: 'Other certificate',
  RELIEVING_LAST: 'Relieving letter (last)', RELIEVING_PREV: 'Relieving letter (previous)',
  ID_AADHAAR: 'Aadhaar card', ID_PAN: 'PAN card', ID_BANK: 'Bank passbook / cheque',
  ID_DL_FRONT: 'Driving licence (front)', ID_DL_REAR: 'Driving licence (rear)',
};
const DOC_TONE = { VERIFIED: 'ok', REJECTED: 'danger', PENDING: 'warn' };
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed', 'Other'];
const ADDR_LABEL = { CURRENT: 'Present address', PERMANENT: 'Permanent address' };
const HISTORY_LABEL = {
  OFFER_SENT: 'Offer sent', OFFER_ACCEPTED: 'Offer accepted', DETAILS_SUBMITTED: 'E-joining submitted', SENT_BACK: 'Sent back',
  APPROVED: 'Approved — account created', DECLINED: 'Offer declined', DID_NOT_JOIN: 'Did not join', ON_HOLD: 'Put on hold',
  RESUMED: 'Resumed', DEACTIVATED: 'Deactivated', ACTIVATED: 'Re-activated', OFFER_REGENERATED: 'Offer letter regenerated',
  OFFER_EXPIRED: 'Offer expired',
};
const inr = (n) => (n == null || n === '' || Number(n) === 0 ? null : `₹${Number(n).toLocaleString('en-IN')}`);
const day = (v) => (v ? String(v).slice(0, 10) : '');

function Row({ label: l, value }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm text-ink-faint">{l}</span>
      <span className="text-sm font-medium text-ink text-right break-all">{value || '—'}</span>
    </div>
  );
}
const person = (f, l, c) => (f ? `${f} ${l || ''}${c ? ` · ${c}` : ''}`.trim() : null);

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const params = useSearchParams();
  const [confirm, confirmUi] = useConfirm();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(params.get('created') ? 'Offer email queued to the employee’s personal email.' : '');
  const [notes, setNotes] = useState('');
  const [notesErr, setNotesErr] = useState('');
  const [showSendBack, setShowSendBack] = useState(false);
  const [preview, setPreview] = useState(null); // { url, mime, label }
  const [resetInfo, setResetInfo] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [editErrors, setEditErrors] = useState({});
  const [meta, setMeta] = useState(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [docAction, setDocAction] = useState(null);   // { doc, remark, error }
  const [cand, setCand] = useState(null);             // { action, reason, error }

  const load = () => api.get(`/employees/${id}`).then(setData).catch(() => setData(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function approve() {
    const ok = await confirm({
      title: 'Approve onboarding?',
      body: 'This generates the employee ID, creates the login account and emails a one-time link to set a password. Before the date of joining the login stays closed. This cannot be undone.',
      confirmLabel: 'Approve & create account',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.post(`/onboarding/${data.onboarding.id}/approve`);
      setMsg(`Approved. Employee ID ${r.employeeCode} created; a set-password link was emailed${r.loginFrom ? ` (login opens on ${fmtDate(r.loginFrom)})` : ''}.`);
      await load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  // ── Termination (employer-initiated exit) ─────────────────────────────────
  const { canManage: canManageModule, canView: canViewModule } = usePerms();
  const mayTerminate = canManageModule('TERMINATION');
  const [terms, setTerms] = useState([]);
  const [termTypes, setTermTypes] = useState([]);
  const [termOpen, setTermOpen] = useState(false);
  const [termConfirm, setTermConfirm] = useState(false);
  const [termBusy, setTermBusy] = useState(false);
  const [termForm, setTermForm] = useState({
    type: 'TERMINATION', reason: '', notes: '', lastWorkingDate: todayIso(), noticeWaived: false, rehireEligible: true,
  });
  const liveTermination = terms.find((t) => t.status === 'ACTIVE') || null;

  async function loadTerminations() {
    if (!canViewModule('TERMINATION')) return;
    try { setTerms(await api.get(`/admin/employees/${id}/termination`) || []); } catch { setTerms([]); }
  }
  useEffect(() => {
    loadTerminations();
    if (canViewModule('TERMINATION')) {
      api.get('/admin/termination-types').then((t) => setTermTypes(t || [])).catch(() => setTermTypes([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function submitTermination() {
    setTermBusy(true);
    try {
      await api.post(`/admin/employees/${id}/terminate`, {
        type: termForm.type, reason: termForm.reason.trim(), notes: termForm.notes.trim() || undefined,
        lastWorkingDate: termForm.lastWorkingDate, noticeWaived: termForm.noticeWaived, rehireEligible: termForm.rehireEligible,
      });
      setTermOpen(false); setTermConfirm(false);
      setMsg(`Recorded as leaving on ${fmtDate(termForm.lastWorkingDate)}. Their access is now blocked.`);
      await Promise.all([load(), loadTerminations()]);
    } catch (e) { setMsg(e.message); setTermConfirm(false); }
    finally { setTermBusy(false); }
  }
  async function reverseTermination() {
    const reason = window.prompt('Why is this being reversed? (kept on the record)');
    if (reason == null) return;
    if (reason.trim().length < 5) { setMsg('Please give a reason of at least 5 characters.'); return; }
    try {
      await api.post(`/admin/terminations/${liveTermination.id}/revoke`, { reason: reason.trim() });
      setMsg('Termination reversed — this person is active again and can sign in.');
      await Promise.all([load(), loadTerminations()]);
    } catch (e) { setMsg(e.message); }
  }
  const termReady = termForm.reason.trim().length >= 5 && termForm.lastWorkingDate;

  // ── Bank & statutory ─────────────────────────────────────────────────────
  const [bs, setBs] = useState(null);
  const [bsErrors, setBsErrors] = useState({});
  const [bsBusy, setBsBusy] = useState(false);
  async function saveBankStatutory() {
    const v = validator();
    if (bs.accountHolder) v.name('bank.accountHolder', bs.accountHolder, 'Account holder name');
    if (bs.accountNumber) v.check('bank.accountNumber', bs.accountNumber, /^\d{9,18}$/, 'Account number must be 9–18 digits');
    if (bs.ifsc) v.pattern('bank.ifsc', bs.ifsc, 'ifsc', 'IFSC');
    if (bs.pan) v.pattern('statutory.pan', bs.pan, 'pan', 'PAN');
    if (bs.aadhaar) v.pattern('statutory.aadhaar', bs.aadhaar, 'aadhaar', 'Aadhaar');
    if (bs.uan) v.pattern('statutory.uan', bs.uan, 'uan', 'UAN');
    if (bs.esiNumber) v.pattern('statutory.esiNumber', bs.esiNumber, 'esic', 'ESIC number');
    if (bs.pfNumber) v.pattern('statutory.pfNumber', bs.pfNumber, 'pf', 'PF number');
    if (!v.ok) { setBsErrors(v.fields); return; }
    setBsBusy(true); setMsg('');
    try {
      const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== ''));
      await api.patch(`/admin/employees/${id}/bank-statutory`, {
        bank: clean({ accountHolder: bs.accountHolder, accountNumber: bs.accountNumber, ifsc: bs.ifsc, bankName: bs.bankName, branch: bs.branch }),
        statutory: clean({ pan: bs.pan, aadhaar: bs.aadhaar, uan: bs.uan, pfNumber: bs.pfNumber, esiNumber: bs.esiNumber }),
      });
      setBs(null); setBsErrors({}); setMsg('Bank & statutory details updated.'); await load();
    } catch (e2) { setBsErrors(e2.fields || { _: e2.message }); } finally { setBsBusy(false); }
  }

  // ── Documents ────────────────────────────────────────────────────────────
  async function uploadDoc(type, fileObj, replacing) {
    if (!fileObj) return;
    if (fileObj.size > 8 * 1024 * 1024) { setMsg('File larger than 8MB.'); return; }
    if (replacing && !(await confirm({
      title: `Replace ${DOC_LABELS[type] || type}?`,
      body: 'The candidate’s file is replaced by yours. The replacement is recorded in the audit log with your name.',
      confirmLabel: 'Replace', tone: 'danger',
    }))) return;
    setMsg('');
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej; r.readAsDataURL(fileObj);
      });
      await api.post(`/admin/employees/${id}/documents`, { type, file: b64, mime: fileObj.type, filename: fileObj.name });
      setMsg(replacing ? 'Document replaced (recorded in the audit log).' : 'Document uploaded.'); await load();
    } catch (e2) { setMsg(e2.message); }
  }
  async function verifyDoc(doc, status, remark) {
    try {
      await api.post(`/admin/employees/${id}/documents/${doc.id}/verify`, { status, remark });
      setDocAction(null); await load();
    } catch (e2) {
      if (docAction) setDocAction((d) => ({ ...d, error: e2.fields?.remark || e2.message })); else setMsg(e2.message);
    }
  }

  // ── Offer letter ─────────────────────────────────────────────────────────
  async function generateOffer() {
    const ok = await confirm({
      title: 'Regenerate the offer letter?',
      body: 'The offer letter + Annexure A on file is replaced with a newly generated one. Preview it first if you are unsure.',
      confirmLabel: 'Regenerate', tone: 'danger',
    });
    if (!ok) return;
    setBusy(true); setMsg('');
    try { await api.post(`/admin/employees/${id}/generate-offer`); setMsg('Offer letter + Annexure A generated.'); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function resetPassword() {
    const ok = await confirm({
      title: 'Reset this employee’s password?',
      body: 'Their current password stops working immediately and a one-time link to set a new one is emailed to them.',
      confirmLabel: 'Reset password', tone: 'danger',
    });
    if (!ok) return;
    setResetBusy(true); setMsg('');
    try { setResetInfo(await api.post(`/admin/employees/${id}/reset-password`)); }
    catch (e) { setMsg(e.message); } finally { setResetBusy(false); }
  }
  async function setActive(active) {
    const reason = active ? '' : window.prompt('Reason for deactivating (sent to the employee, optional):') ?? null;
    if (reason === null) return;
    const ok = await confirm({
      title: active ? 'Re-activate this employee?' : 'Deactivate this employee?',
      body: active ? 'Their login is restored and they are emailed.' : 'Their login is blocked immediately, they leave the directory and payroll runs, and they are emailed.',
      confirmLabel: active ? 'Re-activate' : 'Deactivate', tone: active ? 'brand' : 'danger',
    });
    if (!ok) return;
    setMsg('');
    try {
      await api.post(`/admin/employees/${id}/active`, { active, reason: reason || undefined });
      setMsg(active ? 'Employee re-activated — login restored.' : 'Employee deactivated — login blocked, removed from directory & payroll runs.');
      await load();
    } catch (e) { setMsg(e.message); }
  }
  async function submitCandidate() {
    if ((cand.reason || '').trim().length < 5) { setCand((c) => ({ ...c, error: 'Reason must be at least 5 characters' })); return; }
    try {
      await api.post(`/admin/employees/${id}/candidate-action`, { action: cand.action, reason: cand.reason.trim() });
      setCand(null); setMsg(`${label(cand.action)} — recorded with your reason.`); await load();
    } catch (e) { setCand((c) => ({ ...c, error: e.fields?.reason || e.message })); }
  }

  // ── Edit ─────────────────────────────────────────────────────────────────
  async function openEdit() {
    setMsg(''); setEditErrors({});
    if (!meta) {
      const [departments, designations, managers, branches, subDepartments] = await Promise.all([
        api.get('/meta/departments').catch(() => []),
        api.get('/meta/designations').catch(() => []),
        api.get('/meta/managers').catch(() => []),
        api.get('/meta/org-masters?kind=BRANCH').catch(() => []),
        api.get('/meta/org-masters?kind=SUB_DEPARTMENT').catch(() => []),
      ]);
      setMeta({ departments, designations, managers, branches, subDepartments });
    }
    const e = data.employee;
    const p = e.profile || {};
    setEdit({
      firstName: e.first_name || '', lastName: e.last_name || '', phone: e.phone || '',
      dob: day(e.dob), gender: (e.gender || '').toUpperCase(),
      departmentId: e.department_id ? String(e.department_id) : '', designationId: e.designation_id ? String(e.designation_id) : '',
      subDepartmentId: e.sub_department_id || '', branchId: e.branch_id || '',
      reportingManagerId: e.reporting_manager_id ? String(e.reporting_manager_id) : '',
      functionManagerId: e.function_manager_id ? String(e.function_manager_id) : '',
      operationalManagerId: e.operational_manager_id ? String(e.operational_manager_id) : '',
      // H35/H71: the CTC on file (or the salary structure's) is pre-filled.
      ctc: e.annual_ctc ? String(Number(e.annual_ctc)) : '', dateOfJoining: day(e.date_of_joining), location: e.location || '',
      personalEmail: e.personal_email || '', officialEmail: e.official_email || '',
      employmentType: e.employment_type || 'FULL_TIME',
      bloodGroup: p.bloodGroup || '', maritalStatus: p.maritalStatus || '',
      emName: p.emergencyContact?.name || '', emPhone: p.emergencyContact?.phone || '',
    });
  }
  async function saveEdit(allowLowerLevelManager = false) {
    const e = data.employee;
    const v = checkEmployee(edit, { current: { id: e.id, location: e.location } });
    if (edit.emName) v.name('profile.emergencyContactName', edit.emName, 'Emergency contact name');
    if (edit.emPhone) v.mobile('profile.emergencyContactPhone', m10(edit.emPhone), 'Emergency contact phone');
    if (!v.ok) { setEditErrors(v.fields); return; }
    setSaveBusy(true); setMsg('');
    try {
      const body = {};
      for (const k of ['firstName', 'lastName', 'phone', 'dob', 'gender', 'departmentId', 'designationId', 'subDepartmentId', 'branchId',
        'reportingManagerId', 'functionManagerId', 'operationalManagerId', 'dateOfJoining', 'location', 'personalEmail', 'officialEmail', 'employmentType']) {
        body[k] = edit[k] === '' ? null : edit[k];
      }
      body.ctc = edit.ctc === '' ? null : toNumber(edit.ctc);
      body.profile = {
        ...(edit.bloodGroup ? { bloodGroup: edit.bloodGroup } : {}),
        ...(edit.maritalStatus ? { maritalStatus: edit.maritalStatus } : {}),
        ...(edit.emName || edit.emPhone ? { emergencyContact: { name: edit.emName.trim(), phone: edit.emPhone.trim() } } : {}),
      };
      if (allowLowerLevelManager) body.allowLowerLevelManager = true;
      await api.patch(`/admin/employees/${id}`, body);
      setEdit(null); setEditErrors({}); setMsg('Employee updated.'); await load();
    } catch (err) {
      // H53: a manager on a lower level needs an explicit OK.
      if (err.status === 409 && /level/i.test(err.message) && !allowLowerLevelManager) {
        setSaveBusy(false);
        if (await confirm({ title: 'Manager is on a lower level', body: err.message, confirmLabel: 'Save anyway' })) return saveEdit(true);
        setEditErrors(err.fields || {}); return undefined;
      }
      // C10/H48: the panel stays open with everything typed, errors in place.
      setEditErrors(err.fields && Object.keys(err.fields).length ? err.fields : { _: err.message });
    } finally { setSaveBusy(false); }
    return undefined;
  }
  async function sendBack() {
    if (notes.trim().length < 5) { setNotesErr('Say what needs correcting (at least 5 characters)'); return; }
    setBusy(true);
    try { await api.post(`/onboarding/${data.onboarding.id}/send-back`, { notes: notes.trim() }); setShowSendBack(false); setNotes(''); setMsg('Sent back to employee for corrections.'); await load(); }
    catch (e) { setNotesErr(e.fields?.notes || e.message); } finally { setBusy(false); }
  }

  // Authenticated file → in-page viewer (H18: full-width, responsive modal).
  async function openAuthed(path, errMsg, lbl) {
    setMsg('');
    try {
      const blob = await fetchBlob(path);
      if (!blob.size) { setMsg(`${errMsg} (empty file)`); return; }
      setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return { url: URL.createObjectURL(blob), mime: blob.type || '', label: lbl }; });
    } catch (e) { setMsg(`${errMsg} ${e.message ? `(${e.message})` : ''}`); }
  }
  function closePreview() { setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return null; }); }
  const viewOfferLetter = () => openAuthed(`/employees/${id}/offer-letter`, 'No offer letter on file.', 'Offer letter');
  const previewOffer = () => openAuthed(`/admin/employees/${id}/offer-preview`, 'Could not preview the offer letter.', 'Offer letter preview (not saved)');
  const viewDocument = (docId, lbl) => openAuthed(`/employees/${id}/documents/${docId}`, 'Could not open the document.', lbl);
  const viewSheet = () => openAuthed(`/employees/${id}/sheet`, 'Could not generate the sheet.', 'Personal Information Sheet');

  if (data === null) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (data === false) return <Card className="p-8 max-w-lg"><p className="text-ink-soft">Employee not found.</p></Card>;

  const { employee: e, onboarding, bank, statutory, addresses, esign, documents = [], history = [], account, approval_gaps: gaps } = data;
  const status = e.display_status || e.onboarding_status;
  const canReview = ['DETAILS_SUBMITTED', 'HR_REVIEW'].includes(onboarding?.state);
  const isCandidate = !['ACTIVE', 'INACTIVE', 'REJECTED', 'EXPIRED'].includes(e.onboarding_status);
  const joiningLater = e.onboarding_status === 'ACTIVE' && day(e.date_of_joining) > todayIso();
  const p = e.profile || {};
  const gapList = Object.values(gaps || {});
  const bounds = dateBounds();
  const setE = (k) => (ev) => { const val = ev.target.value; setEdit((x) => ({ ...x, [k]: val })); setEditErrors((x) => ({ ...x, [k]: undefined })); };
  const mgrOptions = (meta?.managers || []).filter((m) => String(m.id) !== String(id));

  return (
    <div className="space-y-5">
      {confirmUi}
      <Link href="/admin/employees" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-brand-700"><IconArrowLeft width={15} height={15} /> Employees</Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid place-items-center h-14 w-14 rounded-2xl bg-brand-600 text-white text-lg font-bold">
            {((e.first_name || '?')[0] + (e.last_name || '')[0] || '').toUpperCase()}</div>
          <div>
            <h1 className="text-2xl font-bold text-ink">{e.first_name} {e.last_name}</h1>
            <div className="text-sm text-ink-faint">{e.designation || '—'} · {e.department || '—'} {e.employee_code && `· ${e.employee_code}`}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {e.has_offer_letter && <Button variant="outline" size="sm" onClick={viewOfferLetter}><IconFile width={15} height={15} /> Offer letter</Button>}
          <Button variant="soft" size="sm" onClick={viewSheet}><IconFile width={15} height={15} /> Info sheet (PDF)</Button>
          <Button variant="outline" size="sm" onClick={openEdit}>Edit</Button>
          {/* C9/H40: only before joining; preview first, confirm to replace. */}
          {e.can_regenerate_offer && <Button variant="outline" size="sm" onClick={previewOffer}>Preview offer</Button>}
          {e.can_regenerate_offer && <Button variant="outline" size="sm" onClick={generateOffer} disabled={busy}>Regenerate offer</Button>}
          {e.onboarding_status === 'ACTIVE' && (
            <Button variant="outline" size="sm" onClick={resetPassword} disabled={resetBusy}>{resetBusy ? <Spinner /> : 'Reset password'}</Button>
          )}
          {e.onboarding_status === 'ACTIVE' && <Button variant="outline" size="sm" onClick={() => setActive(false)}>Deactivate</Button>}
          {e.onboarding_status === 'INACTIVE' && <Button variant="outline" size="sm" onClick={() => setActive(true)}>Activate</Button>}
          {isCandidate && !e.on_hold && <Button variant="outline" size="sm" onClick={() => setCand({ action: 'ON_HOLD', reason: '' })}>Put on hold</Button>}
          {isCandidate && e.on_hold && <Button variant="outline" size="sm" onClick={() => setCand({ action: 'RESUME', reason: '' })}>Resume</Button>}
          {isCandidate && <Button variant="outline" size="sm" onClick={() => setCand({ action: 'DECLINED', reason: '' })}>Mark declined</Button>}
          {(isCandidate || joiningLater) && <Button variant="outline" size="sm" onClick={() => setCand({ action: 'DID_NOT_JOIN', reason: '' })}>Did not join</Button>}
          {mayTerminate && !liveTermination && e.onboarding_status === 'ACTIVE' && (
            <Button variant="danger" size="sm" onClick={() => { setTermConfirm(false); setTermOpen(true); }}>
              <IconExit width={15} height={15} /> Terminate
            </Button>
          )}
          <StatusBadge status={status} />
        </div>
      </div>

      {liveTermination && (
        <div className="rounded-xl bg-rose-50 ring-1 ring-inset ring-rose-200 px-4 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-rose-800 flex items-center gap-2">
                <IconExit width={16} height={16} /> {liveTermination.typeLabel} — last working day {fmtDate(liveTermination.lastWorkingDate)}
              </div>
              <div className="text-sm text-rose-700 mt-1">{liveTermination.reason}</div>
              <div className="text-[11px] text-rose-600/80 mt-1">
                Recorded by {liveTermination.initiatedBy || 'an administrator'}
                {liveTermination.initiatedAt ? ` on ${fmtDate(String(liveTermination.initiatedAt).slice(0, 10))}` : ''}
                {liveTermination.rehireEligible === false ? ' · not eligible for rehire' : ''}
              </div>
            </div>
            {mayTerminate && <Button variant="outline" size="sm" onClick={reverseTermination} className="shrink-0">Reverse</Button>}
          </div>
        </div>
      )}

      {e.on_hold && <div className="text-sm bg-amber-50 text-amber-800 rounded-xl px-4 py-3">On hold: {e.on_hold_reason || '—'}</div>}
      {joiningLater && account?.login_from && (
        <div className="text-sm bg-sky-50 text-sky-800 rounded-xl px-4 py-3">Joining on {fmtDate(day(e.date_of_joining))}. Their login opens on {fmtDate(day(account.login_from))}.</div>
      )}
      {msg && <div className="text-sm text-brand-700 bg-brand-50 rounded-xl px-4 py-3">{msg}</div>}

      {canReview && (
        <Card className="p-5 border-violet-200 bg-violet-50/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-ink">This submission is awaiting your review</div>
              <div className="text-sm text-ink-faint">Verify each document and the details, then approve or send back.</div>
            </div>
            <div className="flex gap-2">
              <Button onClick={approve} disabled={busy || gapList.length > 0}>{busy ? <Spinner /> : <><IconCheck width={16} height={16} /> Approve &amp; create account</>}</Button>
              <Button variant="outline" onClick={() => setShowSendBack((s) => !s)}>Send back</Button>
            </div>
          </div>
          {gapList.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-semibold mb-1">Approval is blocked until these are fixed:</div>
              <ul className="list-disc pl-5 space-y-0.5">{gapList.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </div>
          )}
          {showSendBack && (
            <div className="mt-4 space-y-2">
              <Field label="What needs correcting?" required error={notesErr}>
                <Textarea rows={3} value={notes} onChange={(ev) => { setNotes(ev.target.value); setNotesErr(''); }} />
              </Field>
              <Button variant="danger" onClick={sendBack} disabled={busy}>Send back to employee</Button>
            </div>
          )}
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        <Card className="p-6">
          <h2 className="font-semibold text-ink mb-3">Profile</h2>
          <Row label="Personal email" value={e.personal_email} />
          <Row label="Official email" value={e.official_email} />
          <Row label="Phone" value={e.phone} />
          <Row label="Date of birth" value={e.dob ? fmtDate(day(e.dob)) : null} />
          <Row label="Gender" value={e.gender ? label(String(e.gender).toUpperCase()) : null} />
          <Row label="Company" value={e.company} />
          <Row label="Sub-department" value={e.sub_department} />
          <Row label="Reporting manager" value={person(e.rm_first, e.rm_last, e.rm_code)} />
          <Row label="Functional manager" value={person(e.fm_first, e.fm_last, e.fm_code)} />
          <Row label="Operational manager" value={person(e.om_first, e.om_last, e.om_code)} />
          <Row label="Date of joining" value={e.date_of_joining ? fmtDate(day(e.date_of_joining)) : null} />
          <Row label="Location" value={e.branch || e.location} />
          <Row label="Employment type" value={e.employment_type ? label(e.employment_type) : null} />
          <Row label="Annual CTC" value={inr(e.annual_ctc)} />
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-ink mb-3">Personal information</h2>
          <Row label="Blood group" value={p.bloodGroup} />
          <Row label="Marital status" value={p.maritalStatus} />
          <Row label="Place of birth" value={p.placeOfBirth} />
          <Row label="Emergency contact" value={p.emergencyContact?.name ? `${p.emergencyContact.name}${p.emergencyContact.phone ? ` · ${p.emergencyContact.phone}` : ''}` : null} />
          <Row label="Nationality" value={p.nationality} />
          <Row label="Experience" value={p.experienceYears} />
          <p className="text-xs text-ink-faint mt-2">Everything else from the Personal Information Sheet is in the Info sheet PDF. Use Edit to correct these.</p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-ink">Bank & statutory <span className="text-xs font-normal text-ink-faint">(PII masked)</span></h2>
            <button type="button" onClick={() => { setBsErrors({}); setBs({ accountHolder: bank?.account_holder || '', accountNumber: '', ifsc: bank?.ifsc || '', bankName: bank?.bank_name || '', branch: bank?.branch || '', pan: '', aadhaar: '', uan: statutory?.uan || '', pfNumber: statutory?.pf_number || '', esiNumber: statutory?.esi_number || '' }); }}
              className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
          </div>
          <Row label="Account holder" value={bank?.account_holder} />
          <Row label="Account number" value={bank?.account_number_masked} />
          <Row label="IFSC" value={bank?.ifsc} />
          <Row label="Bank" value={bank?.bank_name} />
          {bank?.bank_from_ifsc && bank?.bank_name && bank.bank_from_ifsc.toLowerCase() !== String(bank.bank_name).toLowerCase() && (
            <p className="text-xs text-amber-700 py-1">IFSC belongs to {bank.bank_from_ifsc} — check the bank name.</p>
          )}
          <Row label="PAN" value={statutory?.pan_masked} />
          <Row label="Aadhaar" value={statutory?.aadhaar_masked} />
          <Row label="UAN" value={statutory?.uan} />
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-ink mb-3">Address</h2>
          {addresses?.length ? addresses.map((a) => (
            <div key={a.id} className="text-sm text-ink-soft mb-2">
              <span className="text-xs font-semibold text-ink-faint">{ADDR_LABEL[a.type] || label(a.type)}</span><br />
              {[a.line1, a.line2, a.city, a.district, a.state, a.pincode].filter(Boolean).join(', ')}
            </div>
          )) : <p className="text-sm text-ink-faint">Not submitted yet.</p>}
          <h2 className="font-semibold text-ink mt-5 mb-2">E-signature</h2>
          {esign?.signature_data ? (
            <div>
              <img src={esign.signature_data} alt="signature" className="border border-slate-200 rounded-xl bg-white max-h-32" />
              <div className="text-xs text-ink-faint mt-2">Signed {new Date(esign.signed_at).toLocaleString()} · IP {esign.ip_address || '—'}</div>
            </div>
          ) : <p className="text-sm text-ink-faint">Not signed yet.</p>}
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="font-semibold text-ink mb-3">E-joining documents <span className="text-xs font-normal text-ink-faint">({documents.length})</span></h2>
        {documents.length === 0 ? (
          <p className="text-sm text-ink-faint">No documents uploaded yet.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {documents.map((d) => (
              <div key={d.id} className="rounded-xl border border-line bg-white px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center h-9 w-9 rounded-lg bg-slate-100 text-ink-faint shrink-0"><IconFile width={16} height={16} /></span>
                  <button type="button" onClick={() => viewDocument(d.id, DOC_LABELS[d.type] || d.type)} className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-medium text-ink truncate">{DOC_LABELS[d.type] || label(d.type)}</span>
                    <span className="block text-xs text-ink-faint truncate">{d.filename || (d.mime === 'application/pdf' ? 'PDF' : 'Image')}</span>
                  </button>
                  <Badge tone={DOC_TONE[d.verify_status] || 'neutral'}>{label(d.verify_status || 'PENDING')}</Badge>
                </div>
                {d.duplicate_of?.length > 0 && <div className="text-[11.5px] text-rose-600 mt-1.5">Same file as: {d.duplicate_of.join(', ')}</div>}
                {d.verify_remark && <div className="text-[11.5px] text-ink-faint mt-1">{d.replaced_by_hr ? '' : 'Remark: '}{d.verify_remark}{d.verified_by_email ? ` · ${d.verified_by_email}` : ''}</div>}
                <div className="flex items-center gap-3 mt-2 text-xs font-medium">
                  <button type="button" onClick={() => viewDocument(d.id, DOC_LABELS[d.type] || d.type)} className="text-brand-700">View</button>
                  {d.verify_status !== 'VERIFIED' && <button type="button" onClick={() => verifyDoc(d, 'VERIFIED')} className="text-emerald-700">Verify</button>}
                  {d.verify_status !== 'REJECTED' && <button type="button" onClick={() => setDocAction({ doc: d, remark: '', error: '' })} className="text-rose-600">Reject</button>}
                  <label className="text-ink-soft hover:text-ink cursor-pointer">
                    Replace
                    <input type="file" accept="application/pdf,image/*" className="hidden"
                      onChange={(ev) => { uploadDoc(d.type, ev.target.files?.[0], true); ev.target.value = ''; }} />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-faint text-xs">Add a missing document:</span>
          {Object.entries(DOC_LABELS).filter(([t]) => !documents.some((d) => d.type === t)).map(([t, l]) => (
            <label key={t} className="text-xs font-medium text-brand-700 bg-brand-50 border border-brand-100 rounded-full px-3 py-1.5 cursor-pointer hover:bg-brand-100">
              + {l}
              <input type="file" accept="application/pdf,image/*" className="hidden"
                onChange={(ev) => { uploadDoc(t, ev.target.files?.[0], false); ev.target.value = ''; }} />
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold text-ink mb-3">History</h2>
        {history.length === 0 ? <p className="text-sm text-ink-faint">No status changes recorded yet.</p> : (
          <ul className="space-y-2">
            {history.map((h, i) => (
              <li key={i} className="text-sm flex flex-wrap gap-x-3 border-b border-slate-50 pb-2 last:border-0">
                <span className="text-ink-faint w-36 shrink-0">{new Date(h.created_at).toLocaleString()}</span>
                <span className="font-medium text-ink">{HISTORY_LABEL[h.action] || label(h.action)}</span>
                {h.reason && <span className="text-ink-soft">— {h.reason}</span>}
                <span className="text-ink-faint">{h.actor || (h.actor === null ? 'candidate / system' : '')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Bank & statutory */}
      <Modal open={!!bs} onClose={() => setBs(null)} title="Edit bank & statutory" size="lg"
        actions={<>
          <Button variant="ghost" onClick={() => setBs(null)}>Cancel</Button>
          <Button onClick={saveBankStatutory} disabled={bsBusy}>{bsBusy ? <Spinner /> : 'Save'}</Button>
        </>}>
        {bs && (
          <div className="space-y-3">
            {bsErrors._ && <p className="text-sm text-neg">{bsErrors._}</p>}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Account holder" error={bsErrors['bank.accountHolder']}><Input value={bs.accountHolder} onChange={(ev) => setBs({ ...bs, accountHolder: ev.target.value })} /></Field>
              <Field label="Account number" error={bsErrors['bank.accountNumber']} hint={`Current: ${bank?.account_number_masked || '—'} — leave blank to keep`}>
                <Input inputMode="numeric" value={bs.accountNumber} onChange={(ev) => setBs({ ...bs, accountNumber: ev.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="IFSC" error={bsErrors['bank.ifsc']} hint={bankForIfsc(bs.ifsc) ? `Bank: ${bankForIfsc(bs.ifsc)}` : 'e.g. SBIN0001234'}>
                <Input value={bs.ifsc} maxLength={11} onChange={(ev) => {
                  const ifsc = ev.target.value.toUpperCase();
                  setBs((x) => ({ ...x, ifsc, bankName: bankForIfsc(ifsc) && (!x.bankName || bankForIfsc(x.ifsc) === x.bankName) ? bankForIfsc(ifsc) : x.bankName }));
                }} /></Field>
              <Field label="Bank name" error={bsErrors['bank.bankName']} hint="Filled from the IFSC; suggestions from the Bank Master">
                <MasterText kind="BANK" value={bs.bankName} onChange={(ev) => setBs({ ...bs, bankName: ev.target.value })} placeholder="Start typing…" />
              </Field>
              <Field label="Branch"><Input value={bs.branch} onChange={(ev) => setBs({ ...bs, branch: ev.target.value })} /></Field>
              <Field label="PAN" error={bsErrors['statutory.pan']} hint={`Current: ${statutory?.pan_masked || '—'} — leave blank to keep`}>
                <Input value={bs.pan} onChange={(ev) => setBs({ ...bs, pan: ev.target.value.toUpperCase() })} maxLength={10} /></Field>
              <Field label="Aadhaar" error={bsErrors['statutory.aadhaar']} hint={`Current: ${statutory?.aadhaar_masked || '—'} — leave blank to keep`}>
                <Input inputMode="numeric" value={bs.aadhaar} onChange={(ev) => setBs({ ...bs, aadhaar: ev.target.value.replace(/\D/g, '') })} maxLength={12} /></Field>
              <Field label="UAN" error={bsErrors['statutory.uan']}><Input value={bs.uan} onChange={(ev) => setBs({ ...bs, uan: ev.target.value.replace(/\D/g, '') })} maxLength={12} /></Field>
              <Field label="PF number" error={bsErrors['statutory.pfNumber']} hint="e.g. MHBAN00123450000123456"><Input value={bs.pfNumber} onChange={(ev) => setBs({ ...bs, pfNumber: ev.target.value.toUpperCase() })} maxLength={22} /></Field>
              <Field label="ESIC number" error={bsErrors['statutory.esiNumber']} hint="17 digits"><Input value={bs.esiNumber} inputMode="numeric" onChange={(ev) => setBs({ ...bs, esiNumber: ev.target.value.replace(/\D/g, '') })} maxLength={17} /></Field>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit employee — stays open on error with every field kept (C10). */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit employee" size="xl"
        actions={<>
          <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          <Button onClick={() => saveEdit(false)} disabled={saveBusy}>{saveBusy ? <Spinner /> : 'Save changes'}</Button>
        </>}>
        {edit && (
          <div className="space-y-3">
            {editErrors._ && <p className="text-sm text-neg">{editErrors._}</p>}
            <ErrorSummary errors={Object.fromEntries(Object.entries(editErrors).filter(([k]) => k !== '_'))} />
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="First name" required error={editErrors.firstName}><Input value={edit.firstName} onChange={setE('firstName')} /></Field>
              <Field label="Last name" required error={editErrors.lastName}><Input value={edit.lastName} onChange={setE('lastName')} /></Field>
              <Field label="Mobile number" error={editErrors.phone}><Input value={edit.phone} onChange={(ev) => setEdit({ ...edit, phone: ev.target.value.replace(/\D/g, '').slice(0, 10) })} maxLength={10} inputMode="numeric" /></Field>
              <Field label="Date of birth" error={editErrors.dob}><Input type="date" value={edit.dob} onChange={setE('dob')} min={bounds.dobMin} max={bounds.dobMax} /></Field>
              <Field label="Gender" error={editErrors.gender}>
                <Select value={edit.gender} onChange={setE('gender')}>
                  <option value="">—</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="Department" required error={editErrors.departmentId}>
                <Select value={edit.departmentId} onChange={setE('departmentId')}>
                  <option value="">—</option>
                  {(meta?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>
              <Field label="Designation" required error={editErrors.designationId}>
                <Select value={edit.designationId} onChange={setE('designationId')}>
                  <option value="">—</option>
                  {(meta?.designations || []).filter((d) => !d.department_id || !edit.departmentId || String(d.department_id) === String(edit.departmentId))
                    .map((d) => <option key={d.id} value={d.id}>{d.title}{d.grade ? ` (${d.grade})` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Sub-department" error={editErrors.subDepartmentId} hint={meta?.subDepartments?.length ? 'From Masters; filtered by department' : 'No sub-departments set up yet — add them under Masters'}>
                <MasterSelect kind="SUB_DEPARTMENT" value={edit.subDepartmentId} parentRef={edit.departmentId}
                  onChange={setE('subDepartmentId')} emptyLabel="— none —" />
              </Field>
              <Field label="Branch" error={editErrors.branchId} hint={meta?.branches?.length ? 'From Masters' : 'No branches set up yet — add them under Masters'}>
                <MasterSelect kind="BRANCH" value={edit.branchId} onChange={setE('branchId')} emptyLabel="— none —" />
              </Field>
              <Field label="Reporting manager" error={editErrors.reportingManagerId}>
                <Select value={edit.reportingManagerId} onChange={setE('reportingManagerId')}>
                  <option value="">—</option>
                  {mgrOptions.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}{m.employee_code ? ` · ${m.employee_code}` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Functional manager" error={editErrors.functionManagerId}>
                <Select value={edit.functionManagerId} onChange={setE('functionManagerId')}>
                  <option value="">—</option>
                  {mgrOptions.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}{m.employee_code ? ` · ${m.employee_code}` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Operational manager" error={editErrors.operationalManagerId}>
                <Select value={edit.operationalManagerId} onChange={setE('operationalManagerId')}>
                  <option value="">—</option>
                  {mgrOptions.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}{m.employee_code ? ` · ${m.employee_code}` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Annual CTC (₹)" error={editErrors.ctc} hint="₹10,000 – ₹10 crore"><Input value={edit.ctc} inputMode="decimal" onChange={(ev) => setEdit({ ...edit, ctc: ev.target.value.replace(/[^\d.,]/g, '') })} /></Field>
              <Field label="Date of joining" required error={editErrors.dateOfJoining}><Input type="date" value={edit.dateOfJoining} onChange={setE('dateOfJoining')} max={bounds.dojMax} /></Field>
              <Field label="Location" error={editErrors.location}>
                {meta?.branches?.length ? (
                  <Select value={edit.location} onChange={setE('location')}>
                    <option value="">—</option>
                    {edit.location && !meta.branches.some((b) => b.name === edit.location) && <option value={edit.location}>{edit.location}</option>}
                    {meta.branches.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </Select>
                ) : <Input value={edit.location} onChange={setE('location')} />}
              </Field>
              <Field label="Employment type" error={editErrors.employmentType}>
                <Select value={edit.employmentType} onChange={setE('employmentType')}>
                  {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </Select>
              </Field>
              <Field label="Personal email" required error={editErrors.personalEmail}><Input value={edit.personalEmail} onChange={setE('personalEmail')} /></Field>
              <Field label="Official email" required error={editErrors.officialEmail} hint="Also updates the login email"><Input value={edit.officialEmail} onChange={setE('officialEmail')} /></Field>
              <Field label="Blood group" error={editErrors['profile.bloodGroup']}>
                <Select value={edit.bloodGroup} onChange={setE('bloodGroup')}><option value="">—</option>{BLOOD.map((b) => <option key={b}>{b}</option>)}</Select>
              </Field>
              <Field label="Marital status" error={editErrors['profile.maritalStatus']}>
                <Select value={edit.maritalStatus} onChange={setE('maritalStatus')}><option value="">—</option>{MARITAL.map((b) => <option key={b}>{b}</option>)}</Select>
              </Field>
              <Field label="Emergency contact name" error={editErrors['profile.emergencyContactName']}><Input value={edit.emName} onChange={setE('emName')} /></Field>
              <Field label="Emergency contact phone" error={editErrors['profile.emergencyContactPhone']}><Input value={edit.emPhone} inputMode="numeric" maxLength={10} onChange={(ev) => setEdit({ ...edit, emPhone: ev.target.value.replace(/\D/g, '').slice(0, 10) })} /></Field>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!resetInfo} onClose={() => setResetInfo(null)} title="Password reset" size="sm"
        actions={<Button onClick={() => setResetInfo(null)}>Done</Button>}>
        {resetInfo?.tempPassword ? (
          <>
            <p>New temporary password for <b className="text-ink">{resetInfo.email}</b>:</p>
            <div className="mt-3 flex items-center gap-2">
              <code className="text-lg font-bold tracking-wider bg-slate-100 border border-line rounded-lg px-4 py-2">{resetInfo.tempPassword}</code>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(resetInfo.tempPassword || '')}>Copy</Button>
            </div>
            <p className="mt-3 text-xs text-ink-faint">They must change it at first login.</p>
          </>
        ) : <p>{resetInfo?.message || 'A link to set a new password has been emailed.'}</p>}
      </Modal>

      <Modal open={!!docAction} onClose={() => setDocAction(null)} title={`Reject ${docAction ? (DOC_LABELS[docAction.doc.type] || docAction.doc.type) : ''}`} tone="danger" size="sm"
        actions={<>
          <Button variant="ghost" onClick={() => setDocAction(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => {
            if ((docAction.remark || '').trim().length < 3) { setDocAction((d) => ({ ...d, error: 'Remark is required' })); return; }
            verifyDoc(docAction.doc, 'REJECTED', docAction.remark.trim());
          }}>Reject document</Button>
        </>}>
        {docAction && (
          <Field label="Remark" required error={docAction.error} hint="Say what is wrong so it can be replaced">
            <Textarea rows={3} value={docAction.remark} onChange={(ev) => setDocAction({ ...docAction, remark: ev.target.value, error: '' })} />
          </Field>
        )}
      </Modal>

      <Modal open={!!cand} onClose={() => setCand(null)} title={cand ? label(cand.action === 'RESUME' ? 'Resume onboarding' : cand.action) : ''} size="sm"
        tone={cand && ['DECLINED', 'DID_NOT_JOIN'].includes(cand.action) ? 'danger' : 'brand'}
        actions={<>
          <Button variant="ghost" onClick={() => setCand(null)}>Cancel</Button>
          <Button variant={cand && ['DECLINED', 'DID_NOT_JOIN'].includes(cand.action) ? 'danger' : 'primary'} onClick={submitCandidate}>Confirm</Button>
        </>}>
        {cand && (
          <div className="space-y-2">
            {['DECLINED', 'DID_NOT_JOIN'].includes(cand.action) && <p className="text-sm">The record is closed as Rejected, the offer and form links stop working{joiningLater ? ' and the login is disabled' : ''}.</p>}
            <Field label="Reason" required error={cand.error} hint="Kept in the history">
              <Textarea rows={3} value={cand.reason} onChange={(ev) => setCand({ ...cand, reason: ev.target.value, error: '' })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!preview} onClose={closePreview} title={preview?.label || 'Document'} size="full"
        actions={preview && <>
          <a href={preview.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-700 hover:underline self-center">Open in new tab</a>
          <a href={preview.url} download className="text-xs font-medium text-brand-700 hover:underline self-center">Download</a>
          <Button variant="ghost" onClick={closePreview}>Close</Button>
        </>}>
        {preview && (preview.mime.startsWith('image/')
          ? <img src={preview.url} alt={preview.label || 'document'} className="max-h-[70vh] max-w-full mx-auto object-contain" />
          : <iframe src={preview.url} title={preview.label || 'document'} className="w-full h-[70vh] border-0" />)}
      </Modal>

      <Modal
        open={termOpen}
        onClose={() => { setTermOpen(false); setTermConfirm(false); }}
        tone={termConfirm ? 'danger' : 'brand'}
        title={termConfirm ? 'Confirm this termination' : `Terminate ${e.first_name} ${e.last_name}`}
        actions={termConfirm ? (
          <>
            <Button variant="ghost" onClick={() => setTermConfirm(false)}>Back</Button>
            <Button variant="danger" onClick={submitTermination} disabled={termBusy}>{termBusy ? <Spinner /> : 'Confirm termination'}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setTermOpen(false)}>Cancel</Button>
            <Button onClick={() => setTermConfirm(true)} disabled={!termReady}>Review</Button>
          </>
        )}
      >
        {!termConfirm ? (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Type" required>
                <Select value={termForm.type} onChange={(ev) => setTermForm({ ...termForm, type: ev.target.value })}>
                  {(termTypes.length ? termTypes : [{ key: 'TERMINATION', label: 'Termination' }]).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </Select>
              </Field>
              <Field label="Last working day" required hint="Payroll pays up to this date">
                <Input type="date" value={termForm.lastWorkingDate} onChange={(ev) => setTermForm({ ...termForm, lastWorkingDate: ev.target.value })} />
              </Field>
            </div>
            <Field label="Reason" required hint="Kept on the permanent record — at least 5 characters">
              <Textarea rows={3} value={termForm.reason} placeholder="Repeated unauthorised absence after two written warnings"
                onChange={(ev) => setTermForm({ ...termForm, reason: ev.target.value })} />
            </Field>
            <Field label="Internal notes" hint="Not shown to the employee">
              <Textarea rows={2} value={termForm.notes} onChange={(ev) => setTermForm({ ...termForm, notes: ev.target.value })} />
            </Field>
            <div className="space-y-2 rounded-xl border border-line bg-slate-50/60 p-4">
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={termForm.noticeWaived} onChange={(ev) => setTermForm({ ...termForm, noticeWaived: ev.target.checked })} className="h-4 w-4 accent-brand-600 cursor-pointer" />
                Notice period waived
              </label>
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={termForm.rehireEligible} onChange={(ev) => setTermForm({ ...termForm, rehireEligible: ev.target.checked })} className="h-4 w-4 accent-brand-600 cursor-pointer" />
                May be considered for rehire in future
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="font-semibold text-rose-800">{e.first_name} {e.last_name} will lose access immediately.</div>
              <ul className="mt-2 space-y-1 text-rose-700 text-[13px] list-disc pl-5">
                <li>Their login is blocked as soon as you confirm — including the mobile app.</li>
                <li>They are removed from directories, team lists and future payroll runs.</li>
                <li>Payroll pays them up to <b>{fmtDate(termForm.lastWorkingDate)}</b> and no further.</li>
                <li>The reason is kept permanently and appears in the audit log.</li>
              </ul>
            </div>
            <p className="text-ink-soft">If this was raised in error you can reverse it from this page, which restores their access.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
