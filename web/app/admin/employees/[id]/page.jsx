'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { api, getStoredAuth } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { Card, Button, Spinner, Textarea, Modal, Input, Select, Field, ConfirmClick } from '@/components/ui.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { IconArrowLeft, IconCheck, IconFile, IconExit } from '@/components/icons.jsx';

const DOC_LABELS = {
  PHOTO: 'Photograph', SIGNATURE_IMAGE: 'Signature image',
  CERT_10: '10th marksheet', CERT_12: '12th marksheet', CERT_GRAD: 'Graduation marksheet',
  CERT_PG: 'Post-graduation marksheet', CERT_OTHER: 'Other certificate',
  RELIEVING_LAST: 'Relieving letter (last)', RELIEVING_PREV: 'Relieving letter (previous)',
  ID_AADHAAR: 'Aadhaar card', ID_PAN: 'PAN card', ID_BANK: 'Bank passbook / cheque',
  ID_DL_FRONT: 'Driving licence (front)', ID_DL_REAR: 'Driving licence (rear)',
};

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm text-ink-faint">{label}</span>
      <span className="text-sm font-medium text-ink text-right">{value || '—'}</span>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const params = useSearchParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(params.get('created') ? 'Offer email queued to the employee’s personal email.' : '');
  const [notes, setNotes] = useState('');
  const [showSendBack, setShowSendBack] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [preview, setPreview] = useState(null); // { url, mime, label }
  const [resetInfo, setResetInfo] = useState(null); // { email, tempPassword }
  const [resetBusy, setResetBusy] = useState(false);
  const [edit, setEdit] = useState(null);      // form values while editing
  const [meta, setMeta] = useState(null);      // { departments, designations, managers }
  const [saveBusy, setSaveBusy] = useState(false);

  const load = () => api.get(`/employees/${id}`).then(setData).catch(() => setData(false));
  useEffect(() => { load(); }, [id]);

  async function approve() {
    setConfirmApprove(false);
    setBusy(true);
    try { const r = await api.post(`/onboarding/${data.onboarding.id}/approve`); setMsg(`Approved. Employee ID ${r.employeeCode} created; credentials emailed.`); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  // ── Termination (employer-initiated exit) ─────────────────────────────────
  // Kept on the profile because this is where HR is already looking when the
  // decision is made, rather than on a separate list screen.
  const { canManage: canManageModule, canView: canViewModule } = usePerms();
  const mayTerminate = canManageModule('TERMINATION');
  const [terms, setTerms] = useState([]);          // this employee's history
  const [termTypes, setTermTypes] = useState([]);
  const [termOpen, setTermOpen] = useState(false);
  const [termConfirm, setTermConfirm] = useState(false);
  const [termBusy, setTermBusy] = useState(false);
  const [termForm, setTermForm] = useState({
    type: 'TERMINATION', reason: '', notes: '',
    lastWorkingDate: new Date().toISOString().slice(0, 10),
    noticeWaived: false, rehireEligible: true,
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
        type: termForm.type,
        reason: termForm.reason.trim(),
        notes: termForm.notes.trim() || undefined,
        lastWorkingDate: termForm.lastWorkingDate,
        noticeWaived: termForm.noticeWaived,
        rehireEligible: termForm.rehireEligible,
      });
      setTermOpen(false); setTermConfirm(false);
      setMsg(`Recorded as leaving on ${termForm.lastWorkingDate}. Their access is now blocked.`);
      await Promise.all([load(), loadTerminations()]);
    } catch (e) { setMsg(''); alert(e.message); setTermConfirm(false); }
    finally { setTermBusy(false); }
  }

  async function reverseTermination() {
    const reason = window.prompt('Why is this being reversed? (kept on the record)');
    if (reason == null) return;
    if (reason.trim().length < 5) { alert('Please give a reason of at least 5 characters.'); return; }
    try {
      await api.post(`/admin/terminations/${liveTermination.id}/revoke`, { reason: reason.trim() });
      setMsg('Termination reversed — this person is active again and can sign in.');
      await Promise.all([load(), loadTerminations()]);
    } catch (e) { alert(e.message); }
  }

  const termReady = termForm.reason.trim().length >= 5 && termForm.lastWorkingDate;

  const [bs, setBs] = useState(null); // bank/statutory edit form
  const [bsBusy, setBsBusy] = useState(false);
  async function saveBankStatutory() {
    setBsBusy(true); setMsg('');
    try {
      const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));
      await api.patch(`/admin/employees/${id}/bank-statutory`, {
        bank: clean({ accountHolder: bs.accountHolder, accountNumber: bs.accountNumber, ifsc: bs.ifsc, bankName: bs.bankName, branch: bs.branch }),
        statutory: clean({ pan: bs.pan, aadhaar: bs.aadhaar, uan: bs.uan, pfNumber: bs.pfNumber, esiNumber: bs.esiNumber }),
      });
      setBs(null); setMsg('Bank & statutory details updated.'); await load();
    } catch (e2) { setMsg(e2.message); } finally { setBsBusy(false); }
  }
  async function uploadDoc(type, fileObj) {
    if (!fileObj) return;
    if (fileObj.size > 8 * 1024 * 1024) { setMsg('File larger than 8MB.'); return; }
    setMsg('');
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej; r.readAsDataURL(fileObj);
      });
      await api.post(`/admin/employees/${id}/documents`, { type, file: b64, mime: fileObj.type, filename: fileObj.name });
      setMsg('Document uploaded.'); await load();
    } catch (e2) { setMsg(e2.message); }
  }
  async function generateOffer() {
    setBusy(true); setMsg('');
    try { await api.post(`/admin/employees/${id}/generate-offer`); setMsg('Offer letter + Annexure A generated.'); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function resetPassword() {
    setResetBusy(true); setMsg('');
    try { setResetInfo(await api.post(`/admin/employees/${id}/reset-password`)); }
    catch (e) { setMsg(e.message); } finally { setResetBusy(false); }
  }
  async function setActive(active) {
    setMsg('');
    try {
      await api.post(`/admin/employees/${id}/active`, { active });
      setMsg(active ? 'Employee activated — login restored.' : 'Employee deactivated — login blocked, removed from directory & payroll runs.');
      await load();
    } catch (e) { setMsg(e.message); }
  }
  async function openEdit() {
    setMsg('');
    if (!meta) {
      const [departments, designations, managers] = await Promise.all([
        api.get('/meta/departments').catch(() => []),
        api.get('/meta/designations').catch(() => []),
        api.get('/meta/managers').catch(() => []),
      ]);
      setMeta({ departments, designations, managers });
    }
    const e = data.employee;
    setEdit({
      firstName: e.first_name || '', lastName: e.last_name || '', phone: e.phone || '',
      departmentId: e.department_id || '', designationId: e.designation_id || '',
      reportingManagerId: e.reporting_manager_id || '', functionManagerId: e.function_manager_id || '',
      ctc: e.ctc || '', dateOfJoining: (e.date_of_joining || '').slice(0, 10), location: e.location || '',
      personalEmail: e.personal_email || '', officialEmail: e.official_email || '',
      employmentType: e.employment_type || 'FULL_TIME',
    });
  }
  async function saveEdit() {
    setSaveBusy(true); setMsg('');
    try {
      const body = {};
      for (const [k, v] of Object.entries(edit)) body[k] = v === '' ? null : v;
      await api.patch(`/admin/employees/${id}`, body);
      setEdit(null); setMsg('Employee updated.'); await load();
    } catch (e) { setMsg(e.message); } finally { setSaveBusy(false); }
  }
  async function sendBack() {
    setBusy(true);
    try { await api.post(`/onboarding/${data.onboarding.id}/send-back`, { notes }); setShowSendBack(false); setMsg('Sent back to employee for corrections.'); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  // Fetch the file (auth-protected) and preview it inside the page. Rendering in
  // an in-app overlay avoids popup-blocker issues that silently cancel new tabs.
  async function openAuthed(url, errMsg, label) {
    setMsg('');
    try {
      const auth = getStoredAuth();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${auth?.token}` } });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json())?.error || ''; } catch { /* not json */ }
        setMsg(`${errMsg} (HTTP ${res.status}${detail ? ` – ${detail}` : ''})`);
        return;
      }
      const blob = await res.blob();
      const mime = blob.type || res.headers.get('content-type') || '';
      if (!blob.size) { setMsg(`${errMsg} (empty file)`); return; }
      setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return { url: URL.createObjectURL(blob), mime, label }; });
    } catch (e) { setMsg(`${errMsg} (${e?.message || 'network error'})`); }
  }
  function closePreview() {
    setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return null; });
  }
  const viewOfferLetter = () => openAuthed(`/api/employees/${id}/offer-letter`, 'No offer letter on file.', 'Offer letter');
  const viewDocument = (docId, label) => openAuthed(`/api/employees/${id}/documents/${docId}`, 'Could not open the document.', label);
  const viewSheet = () => openAuthed(`/api/employees/${id}/sheet`, 'Could not generate the sheet.', 'Personal Information Sheet');

  if (data === null) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (data === false) return <Card className="p-8 max-w-lg"><p className="text-ink-soft">Employee not found.</p></Card>;

  const { employee: e, onboarding, bank, statutory, addresses, esign, documents = [] } = data;
  const canReview = ['DETAILS_SUBMITTED','HR_REVIEW'].includes(onboarding?.state);

  return (
    <div className="space-y-5">
      <Link href="/admin/employees" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-brand-700"><IconArrowLeft width={15} height={15} /> Employees</Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid place-items-center h-14 w-14 rounded-2xl bg-brand-600 text-white text-lg font-bold">
            {(e.first_name[0] + e.last_name[0]).toUpperCase()}</div>
          <div>
            <h1 className="text-2xl font-bold text-ink">{e.first_name} {e.last_name}</h1>
            <div className="text-sm text-ink-faint">{e.designation || '—'} · {e.department || '—'} {e.employee_code && `· ${e.employee_code}`}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {e.has_offer_letter && (
            <Button variant="outline" size="sm" onClick={viewOfferLetter}><IconFile width={15} height={15} /> Offer letter</Button>
          )}
          <Button variant="soft" size="sm" onClick={viewSheet}><IconFile width={15} height={15} /> Info sheet (PDF)</Button>
          <Button variant="outline" size="sm" onClick={openEdit}>Edit</Button>
          <Button variant="outline" size="sm" onClick={generateOffer} disabled={busy}>Generate offer + Annexure A</Button>
          {e.onboarding_status === 'ACTIVE' && (
            <Button variant="outline" size="sm" onClick={resetPassword} disabled={resetBusy}>
              {resetBusy ? <Spinner /> : 'Reset password'}
            </Button>
          )}
          {e.onboarding_status === 'ACTIVE' && (
            <ConfirmClick onConfirm={() => setActive(false)} confirmLabel="Deactivate? Login blocks immediately"
              className="text-xs font-semibold text-rose-600 border border-rose-200 rounded-lg px-3 py-1.5 hover:bg-rose-50">
              Deactivate
            </ConfirmClick>
          )}
          {e.onboarding_status === 'INACTIVE' && (
            <ConfirmClick onConfirm={() => setActive(true)} confirmLabel="Re-activate this employee?"
              className="text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg px-3 py-1.5 hover:bg-emerald-50">
              Activate
            </ConfirmClick>
          )}
          {mayTerminate && !liveTermination && e.onboarding_status === 'ACTIVE' && (
            <Button variant="danger" size="sm" onClick={() => { setTermConfirm(false); setTermOpen(true); }}>
              <IconExit width={15} height={15} /> Terminate
            </Button>
          )}
          <StatusBadge status={e.onboarding_status} />
        </div>
      </div>

      {/* An exit in force is the most important fact about this record, so it
          sits above everything else. */}
      {liveTermination && (
        <div className="rounded-xl bg-rose-50 ring-1 ring-inset ring-rose-200 px-4 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-rose-800 flex items-center gap-2">
                <IconExit width={16} height={16} /> {liveTermination.typeLabel} — last working day {liveTermination.lastWorkingDate}
              </div>
              <div className="text-sm text-rose-700 mt-1">{liveTermination.reason}</div>
              <div className="text-[11px] text-rose-600/80 mt-1">
                Recorded by {liveTermination.initiatedBy || 'an administrator'}
                {liveTermination.initiatedAt ? ` on ${new Date(liveTermination.initiatedAt).toLocaleDateString()}` : ''}
                {liveTermination.rehireEligible === false ? ' · not eligible for rehire' : ''}
              </div>
            </div>
            {mayTerminate && (
              <Button variant="outline" size="sm" onClick={reverseTermination} className="shrink-0">Reverse</Button>
            )}
          </div>
        </div>
      )}

      {msg && <div className="text-sm text-brand-700 bg-brand-50 rounded-xl px-4 py-3">{msg}</div>}

      {canReview && (
        <Card className="p-5 border-violet-200 bg-violet-50/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-ink">This submission is awaiting your review</div>
              <div className="text-sm text-ink-faint">Verify the details and e-signature, then approve or send back.</div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setConfirmApprove(true)} disabled={busy}>{busy ? <Spinner /> : <><IconCheck width={16} height={16} /> Approve &amp; create account</>}</Button>
              <Button variant="outline" onClick={() => setShowSendBack((s) => !s)}>Send back</Button>
            </div>
          </div>
          {showSendBack && (
            <div className="mt-4 space-y-2">
              <Textarea rows={3} placeholder="What needs correcting?" value={notes} onChange={(ev) => setNotes(ev.target.value)} />
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
          <Row label="Reporting manager" value={e.rm_first ? `${e.rm_first} ${e.rm_last}${e.rm_code ? ` · ${e.rm_code}` : ''}` : null} />
          <Row label="Functional manager" value={e.fm_first ? `${e.fm_first} ${e.fm_last}${e.fm_code ? ` · ${e.fm_code}` : ''}` : null} />
          <Row label="Date of joining" value={e.date_of_joining?.slice(0,10)} />
          <Row label="Location" value={e.location} />
          <Row label="Employment type" value={e.employment_type} />
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-ink">Bank & statutory <span className="text-xs font-normal text-ink-faint">(PII masked)</span></h2>
            <button onClick={() => setBs({ accountHolder: bank?.account_holder || '', accountNumber: '', ifsc: bank?.ifsc || '', bankName: bank?.bank_name || '', branch: bank?.branch || '', pan: '', aadhaar: '', uan: statutory?.uan || '', pfNumber: statutory?.pf_number || '', esiNumber: statutory?.esi_number || '' })}
              className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
          </div>
          <Row label="Account holder" value={bank?.account_holder} />
          <Row label="Account number" value={bank?.account_number_masked} />
          <Row label="IFSC" value={bank?.ifsc} />
          <Row label="Bank" value={bank?.bank_name} />
          <Row label="PAN" value={statutory?.pan_masked} />
          <Row label="Aadhaar" value={statutory?.aadhaar_masked} />
          <Row label="UAN" value={statutory?.uan} />
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-ink mb-3">Address</h2>
          {addresses?.length ? addresses.map((a) => (
            <div key={a.id} className="text-sm text-ink-soft mb-2">
              <span className="text-xs font-semibold text-ink-faint uppercase">{a.type}</span><br/>
              {[a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ')}
            </div>
          )) : <p className="text-sm text-ink-faint">Not submitted yet.</p>}
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-ink mb-3">E-signature</h2>
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
              <div key={d.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 hover:border-brand-300 transition-colors">
                <span className="grid place-items-center h-9 w-9 rounded-lg bg-slate-100 text-ink-faint shrink-0"><IconFile width={16} height={16} /></span>
                <button type="button" onClick={() => viewDocument(d.id, DOC_LABELS[d.type] || d.type)} className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-medium text-ink truncate">{DOC_LABELS[d.type] || d.type}</span>
                  <span className="block text-xs text-ink-faint truncate">{d.filename || (d.mime === 'application/pdf' ? 'PDF' : 'Image')}</span>
                </button>
                <button type="button" onClick={() => viewDocument(d.id, DOC_LABELS[d.type] || d.type)} className="text-brand-700 text-xs font-medium shrink-0">View</button>
                <label className="text-xs font-medium text-ink-soft hover:text-ink cursor-pointer shrink-0">
                  Replace
                  <input type="file" accept="application/pdf,image/*" className="hidden"
                    onChange={(ev) => { uploadDoc(d.type, ev.target.files?.[0]); ev.target.value = ''; }} />
                </label>
              </div>
            ))}
          </div>
        )}
        {/* upload any missing document type */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-faint text-xs">Add / replace by type:</span>
          {Object.entries(DOC_LABELS).filter(([t]) => !documents.some((d) => d.type === t)).map(([t, label]) => (
            <label key={t} className="text-xs font-medium text-brand-700 bg-brand-50 border border-brand-100 rounded-full px-3 py-1.5 cursor-pointer hover:bg-brand-100">
              + {label}
              <input type="file" accept="application/pdf,image/*" className="hidden"
                onChange={(ev) => { uploadDoc(t, ev.target.files?.[0]); ev.target.value = ''; }} />
            </label>
          ))}
        </div>
      </Card>

      <Modal open={!!bs} onClose={() => setBs(null)} title="Edit bank & statutory" size="lg"
        actions={<>
          <Button variant="ghost" onClick={() => setBs(null)}>Cancel</Button>
          <Button onClick={saveBankStatutory} disabled={bsBusy}>{bsBusy ? <Spinner /> : 'Save'}</Button>
        </>}>
        {bs && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Account holder"><Input value={bs.accountHolder} onChange={(ev) => setBs({ ...bs, accountHolder: ev.target.value })} /></Field>
            <Field label="Account number" hint={`Current: ${bank?.account_number_masked || '—'} — leave blank to keep`}>
              <Input inputMode="numeric" value={bs.accountNumber} onChange={(ev) => setBs({ ...bs, accountNumber: ev.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="IFSC"><Input value={bs.ifsc} onChange={(ev) => setBs({ ...bs, ifsc: ev.target.value.toUpperCase() })} maxLength={11} /></Field>
            <Field label="Bank name"><Input value={bs.bankName} onChange={(ev) => setBs({ ...bs, bankName: ev.target.value })} /></Field>
            <Field label="Branch"><Input value={bs.branch} onChange={(ev) => setBs({ ...bs, branch: ev.target.value })} /></Field>
            <Field label="PAN" hint={`Current: ${statutory?.pan_masked || '—'} — leave blank to keep`}>
              <Input value={bs.pan} onChange={(ev) => setBs({ ...bs, pan: ev.target.value.toUpperCase() })} maxLength={10} /></Field>
            <Field label="Aadhaar" hint={`Current: ${statutory?.aadhaar_masked || '—'} — leave blank to keep`}>
              <Input inputMode="numeric" value={bs.aadhaar} onChange={(ev) => setBs({ ...bs, aadhaar: ev.target.value.replace(/\D/g, '') })} maxLength={12} /></Field>
            <Field label="UAN"><Input value={bs.uan} onChange={(ev) => setBs({ ...bs, uan: ev.target.value })} /></Field>
            <Field label="PF number"><Input value={bs.pfNumber} onChange={(ev) => setBs({ ...bs, pfNumber: ev.target.value })} /></Field>
            <Field label="ESI number"><Input value={bs.esiNumber} onChange={(ev) => setBs({ ...bs, esiNumber: ev.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit employee" size="lg"
        actions={<>
          <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          <Button onClick={saveEdit} disabled={saveBusy}>{saveBusy ? <Spinner /> : 'Save changes'}</Button>
        </>}>
        {edit && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="First name" required><Input value={edit.firstName} onChange={(ev) => setEdit({ ...edit, firstName: ev.target.value })} /></Field>
            <Field label="Last name" required><Input value={edit.lastName} onChange={(ev) => setEdit({ ...edit, lastName: ev.target.value })} /></Field>
            <Field label="Phone"><Input value={edit.phone} onChange={(ev) => setEdit({ ...edit, phone: ev.target.value })} maxLength={10} inputMode="numeric" /></Field>
            <Field label="Department">
              <Select value={edit.departmentId} onChange={(ev) => setEdit({ ...edit, departmentId: ev.target.value })}>
                <option value="">—</option>
                {(meta?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Designation">
              <Select value={edit.designationId} onChange={(ev) => setEdit({ ...edit, designationId: ev.target.value })}>
                <option value="">—</option>
                {(meta?.designations || []).map((d) => <option key={d.id} value={d.id}>{d.title}{d.grade ? ` (${d.grade})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Reporting manager">
              <Select value={edit.reportingManagerId} onChange={(ev) => setEdit({ ...edit, reportingManagerId: ev.target.value })}>
                <option value="">—</option>
                {(meta?.managers || []).filter((m) => String(m.id) !== String(id)).map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}{m.employee_code ? ` · ${m.employee_code}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Functional manager">
              <Select value={edit.functionManagerId} onChange={(ev) => setEdit({ ...edit, functionManagerId: ev.target.value })}>
                <option value="">—</option>
                {(meta?.managers || []).filter((m) => String(m.id) !== String(id)).map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}{m.employee_code ? ` · ${m.employee_code}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Annual CTC (₹)" hint="Needed for Annexure A"><Input type="number" min="0" value={edit.ctc} onChange={(ev) => setEdit({ ...edit, ctc: ev.target.value })} /></Field>
            <Field label="Date of joining"><Input type="date" value={edit.dateOfJoining} onChange={(ev) => setEdit({ ...edit, dateOfJoining: ev.target.value })} /></Field>
            <Field label="Location"><Input value={edit.location} onChange={(ev) => setEdit({ ...edit, location: ev.target.value })} /></Field>
            <Field label="Employment type">
              <Select value={edit.employmentType} onChange={(ev) => setEdit({ ...edit, employmentType: ev.target.value })}>
                {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </Select>
            </Field>
            <Field label="Personal email"><Input value={edit.personalEmail} onChange={(ev) => setEdit({ ...edit, personalEmail: ev.target.value })} /></Field>
            <Field label="Official email" hint="Also updates the login email"><Input value={edit.officialEmail} onChange={(ev) => setEdit({ ...edit, officialEmail: ev.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!resetInfo} onClose={() => setResetInfo(null)} title="Password reset" size="sm"
        actions={<Button onClick={() => setResetInfo(null)}>Done</Button>}>
        <p>New temporary password for <b className="text-ink">{resetInfo?.email}</b>:</p>
        <div className="mt-3 flex items-center gap-2">
          <code className="text-lg font-bold tracking-wider bg-slate-100 border border-line rounded-lg px-4 py-2">{resetInfo?.tempPassword}</code>
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(resetInfo?.tempPassword || '')}>Copy</Button>
        </div>
        <p className="mt-3 text-xs text-ink-faint">It has also been emailed to the employee. They must change it at first login. Share it over a secure channel only.</p>
      </Modal>

      <Modal open={confirmApprove} onClose={() => setConfirmApprove(false)} title="Approve onboarding?"
        actions={<>
          <Button variant="outline" onClick={() => setConfirmApprove(false)}>Cancel</Button>
          <Button onClick={approve}><IconCheck width={16} height={16} /> Approve</Button>
        </>}>
        This will generate the employee&rsquo;s ID, create their login account, and email their credentials and the app link. This action can&rsquo;t be undone.
      </Modal>

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" onClick={closePreview} />
          <div className="relative m-auto flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl2 border border-line bg-white shadow-pop">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
              <h3 className="truncate text-sm font-semibold text-ink">{preview.label || 'Document'}</h3>
              <div className="flex items-center gap-2">
                <a href={preview.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-700 hover:underline">Open in new tab</a>
                <a href={preview.url} download className="text-xs font-medium text-brand-700 hover:underline">Download</a>
                <button type="button" onClick={closePreview} className="grid h-7 w-7 place-items-center rounded-lg text-ink-faint hover:bg-slate-100" aria-label="Close">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-50 grid place-items-center">
              {preview.mime.startsWith('image/') ? (
                <img src={preview.url} alt={preview.label || 'document'} className="max-h-full max-w-full object-contain" />
              ) : (
                <iframe src={preview.url} title={preview.label || 'document'} className="h-full w-full border-0" />
              )}
            </div>
          </div>
        </div>
      )}
    {/* ── Terminate ─────────────────────────────────────────────────────── */}
    <Modal
      open={termOpen}
      onClose={() => { setTermOpen(false); setTermConfirm(false); }}
      tone={termConfirm ? 'danger' : 'brand'}
      title={termConfirm ? 'Confirm this termination' : `Terminate ${e.first_name} ${e.last_name}`}
      actions={termConfirm ? (
        <>
          <Button variant="ghost" onClick={() => setTermConfirm(false)}>Back</Button>
          <Button variant="danger" onClick={submitTermination} disabled={termBusy}>
            {termBusy ? <Spinner /> : 'Confirm termination'}
          </Button>
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
                {(termTypes.length ? termTypes : [{ key: 'TERMINATION', label: 'Termination' }])
                  .map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Last working day" required hint="Payroll pays up to this date">
              <Input type="date" value={termForm.lastWorkingDate}
                onChange={(ev) => setTermForm({ ...termForm, lastWorkingDate: ev.target.value })} />
            </Field>
          </div>
          <Field label="Reason" required hint="Kept on the permanent record — at least 5 characters">
            <Textarea rows={3} value={termForm.reason}
              placeholder="Repeated unauthorised absence after two written warnings"
              onChange={(ev) => setTermForm({ ...termForm, reason: ev.target.value })} />
          </Field>
          <Field label="Internal notes" hint="Not shown to the employee">
            <Textarea rows={2} value={termForm.notes}
              onChange={(ev) => setTermForm({ ...termForm, notes: ev.target.value })} />
          </Field>
          <div className="space-y-2 rounded-xl border border-line bg-slate-50/60 p-4">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={termForm.noticeWaived}
                onChange={(ev) => setTermForm({ ...termForm, noticeWaived: ev.target.checked })}
                className="h-4 w-4 accent-brand-600 cursor-pointer" />
              Notice period waived
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={termForm.rehireEligible}
                onChange={(ev) => setTermForm({ ...termForm, rehireEligible: ev.target.checked })}
                className="h-4 w-4 accent-brand-600 cursor-pointer" />
              May be considered for rehire in future
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="font-semibold text-rose-800">
              {e.first_name} {e.last_name} will lose access immediately.
            </div>
            <ul className="mt-2 space-y-1 text-rose-700 text-[13px] list-disc pl-5">
              <li>Their login is blocked as soon as you confirm — including the mobile app.</li>
              <li>They are removed from directories, team lists and future payroll runs.</li>
              <li>Payroll pays them up to <b>{termForm.lastWorkingDate}</b> and no further.</li>
              <li>The reason is kept permanently and appears in the audit log.</li>
            </ul>
          </div>
          <p className="text-ink-soft">
            If this was raised in error you can reverse it from this page, which restores their access.
          </p>
        </div>
      )}
    </Modal>

    </div>
  );
}
