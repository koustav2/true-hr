'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, openFile } from '@/lib/api.js';
import { Card, Button, Spinner, Empty, Input, Select, Field, Textarea, Modal, useConfirm } from '@/components/ui.jsx';
import { fmtDate, todayIso } from '@/lib/labels.js';
import {
  Status, VendorFields, VendorDetails, validateVendor, AgreementFields, validateAgreement,
  agreementBody, agreementTypeLabel, ExpiryTag,
} from './vendorForms.jsx';

const TABS = ['Vendor Registrations', 'Agreements'];
const V_FILTERS = [['PENDING', 'Pending approval'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['INACTIVE', 'Deactivated'], ['WITHDRAWN', 'Withdrawn'], ['', 'All']];
const A_FILTERS = [['PENDING', 'Pending approval'], ['APPROVED', 'Approved'], ['EXPIRING', 'Expiring in 30 days'], ['REJECTED', 'Rejected'], ['WITHDRAWN', 'Withdrawn'], ['', 'All']];


// The HR dashboard deep-links here with ?status= (and ?tab=); useSearchParams
// needs a Suspense boundary on a client page.
export default function VendorsPage() {
  return <Suspense fallback={null}><VendorsInner /></Suspense>;
}

// Nearest filter for a status from a link; unknown → Pending approval.
const filterFrom = (filters, v) => {
  const s = String(v ?? '').toUpperCase();
  if (v == null) return 'PENDING';
  if (filters.some(([k]) => k === s)) return s;
  if (['DEACTIVATED', 'DISABLED'].includes(s)) return filters.some(([k]) => k === 'INACTIVE') ? 'INACTIVE' : '';
  if (['EXPIRING_SOON', 'EXPIRY'].includes(s)) return filters.some(([k]) => k === 'EXPIRING') ? 'EXPIRING' : '';
  if (s === 'ALL') return '';
  return 'PENDING';
};

function VendorsInner() {
  const sp = useSearchParams();
  const initialStatus = sp.get('status');
  const [tab, setTab] = useState(() => (String(sp.get('tab') || '').toLowerCase().startsWith('agreement') ? 1 : 0));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-ink">Vendors & Agreements</h1>
        <p className="text-ink-faint text-sm mt-0.5">
          Employees register vendors and upload agreements from the employee portal&apos;s <b>Vendors</b> menu; they wait here for approval.
          You can also add a vendor or upload an agreement directly.
        </p>
      </div>
      <div className="flex gap-1.5 border-b border-line">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Vendors initialStatus={filterFrom(V_FILTERS, initialStatus)} />}
      {tab === 1 && <Agreements initialStatus={filterFrom(A_FILTERS, initialStatus)} />}
    </div>
  );
}

function FilterBar({ filters, value, onChange, q, setQ, placeholder, action }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-52">
        {filters.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="w-64" />
      <div className="flex-1" />
      {action}
    </div>
  );
}

// Asks for a mandatory reason (reject / deactivate).
function ReasonModal({ open, title, confirmLabel, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setErr(''); } }, [open]);
  async function go() {
    if (!reason.trim()) { setErr('Reason is required'); return; }
    setBusy(true);
    try { await onSubmit(reason.trim()); onClose(); } catch (e) { setErr(e.fields?.reason || e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={title} tone="danger" size="sm"
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={go} disabled={busy}>{busy ? 'Saving…' : confirmLabel}</Button></>}>
      <Field label="Reason (shown to the employee)" required error={err}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
    </Modal>
  );
}

function VendorFormModal({ open, vendor, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(vendor ? { ...vendor } : {}); setErrors({}); setMsg(''); } }, [open, vendor]);
  async function save() {
    const errs = validateVendor(f);
    setErrors(errs); setMsg('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const { id, status, registeredBy, reviewedBy, reviewedAt, reviewNote, createdAt, updatedAt, hasDocument, associationWith, ...body } = f;
      if (vendor) await api.put(`/admin/vendors/${vendor.id}`, body); else await api.post('/admin/vendors', body);
      onSaved(); onClose();
    } catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={vendor ? `Edit vendor — ${vendor.companyName}` : 'Add vendor'} size="lg"
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : vendor ? 'Save changes' : 'Add vendor'}</Button></>}>
      {!vendor && <p className="mb-3 text-ink-faint">A vendor added here is approved straight away, so PAN and the entity type are required.</p>}
      <VendorFields f={f} setF={setF} errors={errors} />
      {msg && <p className="text-sm text-red-600 mt-2">{msg}</p>}
    </Modal>
  );
}

function TrailModal({ vendor, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!vendor) return;
    setRows(null);
    api.get(`/admin/vendors/${vendor.id}/trail`).then(setRows).catch(() => setRows([]));
  }, [vendor]);
  return (
    <Modal open={!!vendor} onClose={onClose} title={vendor ? `${vendor.companyName} — details & approval trail` : ''} size="lg">
      {vendor && <VendorDetails v={vendor} />}
      <div className="font-semibold text-ink mt-4 mb-1">Approval trail</div>
      {!rows ? <Spinner /> : !rows.length ? <p className="text-ink-faint">No history recorded.</p> : (
        <ul className="space-y-1">
          {rows.map((t, i) => (
            <li key={i} className="flex flex-wrap gap-x-2 text-[12.5px]">
              <span className="font-medium text-ink">{t.action}</span>
              <span className="text-ink-faint">by {t.by} on {fmtDate(t.at)} {new Date(t.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
              {t.note && <span className="text-ink-soft">— {t.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Vendors({ initialStatus = 'PENDING' }) {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState(initialStatus);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState(null);     // { vendor } | null
  const [reason, setReason] = useState(null); // { vendor, kind }
  const [trail, setTrail] = useState(null);
  const [confirm, confirmUi] = useConfirm();
  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (q.trim()) qs.set('q', q.trim());
    api.get(`/vendors?${qs}`).then(setRows).catch((e) => { setRows([]); setMsg(e.message); });
  }, [status, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function approve(v) {
    if (!(await confirm({ title: `Approve ${v.companyName}?`, body: `PAN ${v.pan || '—'} · GSTIN ${v.gst || 'not registered'}. The vendor is added to your Clients / Vendors master.`, confirmLabel: 'Approve' }))) return;
    setMsg('');
    try { await api.post(`/admin/vendors/${v.id}/review`, { action: 'APPROVED' }); load(); } catch (e) { setMsg(e.message); }
  }
  async function reactivate(v) {
    if (!(await confirm({ title: `Reactivate ${v.companyName}?`, confirmLabel: 'Reactivate' }))) return;
    try { await api.post(`/admin/vendors/${v.id}/reactivate`, {}); load(); } catch (e) { setMsg(e.message); }
  }
  const submitReason = async (text) => {
    const { vendor, kind } = reason;
    if (kind === 'reject') await api.post(`/admin/vendors/${vendor.id}/review`, { action: 'REJECTED', reason: text });
    else await api.post(`/admin/vendors/${vendor.id}/deactivate`, { reason: text });
    load();
  };

  return (
    <div className="space-y-3">
      <FilterBar filters={V_FILTERS} value={status} onChange={setStatus} q={q} setQ={setQ} placeholder="Search name, PAN, GSTIN, contact"
        action={<Button onClick={() => setForm({ vendor: null })}>Add vendor</Button>} />
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
        !rows.length ? <Empty title={q.trim() || status ? 'No vendors found' : 'No vendor registrations'}
          subtitle={q.trim() || status ? 'Nothing matches the current filter.' : 'Employees register vendors from the employee portal (Vendors menu).'} /> :
        rows.map((v) => (
          <Card key={v.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-ink flex items-center gap-2">{v.companyName} <Status status={v.status} /></div>
                <div className="text-xs text-ink-faint mt-0.5">
                  {[v.typeOfCompany, v.natureOfBusiness, v.associationWith].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="grid sm:grid-cols-3 gap-x-6 gap-y-0.5 text-xs text-ink-soft mt-2">
                  <span>PAN: {v.pan || '—'}</span><span>GSTIN: {v.gst || '—'}</span><span>ESIC: {v.esic || '—'}</span>
                  <span>PF: {v.pf || '—'}</span><span>MSME: {v.msmed || '—'}</span><span>NSIC/SSI: {v.nsicSsi || '—'}</span>
                </div>
                <div className="text-xs text-ink-soft mt-1">
                  Bank: {v.bankName ? `${v.bankAccountHolder} · ${v.bankName} · A/c ${v.bankAccountNumber} · ${v.bankIfsc}` : '—'}
                </div>
                <div className="text-xs text-ink-faint mt-1">
                  Contact: {[v.contactPerson, v.contactPhone, v.contactEmail].filter(Boolean).join(' · ') || '—'}
                  {' · '}{v.registeredBy ? `Registered by ${v.registeredBy.name} on ${fmtDate(v.createdAt)}` : `Added by admin on ${fmtDate(v.createdAt)}`}
                  {v.reviewedAt && <> · {v.status === 'REJECTED' ? 'Rejected' : 'Reviewed'} by {v.reviewedBy || '—'} on {fmtDate(v.reviewedAt)}</>}
                </div>
                {v.reviewNote && <div className="text-xs text-rose-700 mt-1">Reason: {v.reviewNote}</div>}
              </div>
              <div className="flex flex-wrap gap-2 items-start">
                <Button size="sm" variant="outline" onClick={() => setTrail(v)}>Details & trail</Button>
                {v.hasDocument && <Button size="sm" variant="outline" onClick={() => openFile(`/vendors/${v.id}/document`).catch((e) => setMsg(e.message))}>Document</Button>}
                {v.status !== 'WITHDRAWN' && <Button size="sm" variant="outline" onClick={() => setForm({ vendor: v })}>Edit</Button>}
                {v.status === 'PENDING' && <>
                  <Button size="sm" onClick={() => approve(v)}>Approve</Button>
                  <Button size="sm" variant="danger" onClick={() => setReason({ vendor: v, kind: 'reject' })}>Reject</Button>
                </>}
                {v.status === 'APPROVED' && <Button size="sm" variant="danger" onClick={() => setReason({ vendor: v, kind: 'deactivate' })}>Deactivate</Button>}
                {v.status === 'INACTIVE' && <Button size="sm" variant="outline" onClick={() => reactivate(v)}>Reactivate</Button>}
              </div>
            </div>
          </Card>
        ))}
      <VendorFormModal open={!!form} vendor={form?.vendor || null} onClose={() => setForm(null)} onSaved={load} />
      <ReasonModal open={!!reason} onClose={() => setReason(null)} onSubmit={submitReason}
        title={reason?.kind === 'reject' ? `Reject ${reason?.vendor.companyName}` : `Deactivate ${reason?.vendor.companyName || ''}`}
        confirmLabel={reason?.kind === 'reject' ? 'Reject' : 'Deactivate'} />
      <TrailModal vendor={trail} onClose={() => setTrail(null)} />
      {confirmUi}
    </div>
  );
}

function AgreementUploadModal({ open, onClose, onSaved }) {
  const [f, setF] = useState({ agreementType: 'RENT' });
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState(null);
  useEffect(() => {
    if (!open) return;
    setF({ agreementType: 'RENT', startDate: todayIso() }); setErrors({}); setMsg('');
    api.get('/meta/nfa-masters').then(setM).catch(() => setM({}));
  }, [open]);
  async function save() {
    const errs = validateAgreement(f);
    setErrors(errs); setMsg('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try { await api.post('/admin/agreements', agreementBody(f)); onSaved(); onClose(); }
    catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Upload agreement" size="lg"
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Upload'}</Button></>}>
      <p className="mb-3 text-ink-faint">An agreement uploaded by HR is recorded as approved.</p>
      <AgreementFields f={f} setF={setF} errors={errors} masters={m} onDocError={setMsg} />
      {msg && <p className="text-sm text-red-600 mt-2">{msg}</p>}
    </Modal>
  );
}

function Agreements({ initialStatus = 'PENDING' }) {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState(initialStatus);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [upload, setUpload] = useState(false);
  const [reject, setReject] = useState(null);
  const [confirm, confirmUi] = useConfirm();
  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (status === 'EXPIRING') qs.set('expiring', '30'); else if (status) qs.set('status', status);
    if (q.trim()) qs.set('q', q.trim());
    api.get(`/agreements?${qs}`).then(setRows).catch((e) => { setRows([]); setMsg(e.message); });
  }, [status, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  async function approve(a) {
    if (!(await confirm({ title: 'Approve this agreement?', body: `${agreementTypeLabel(a.agreementType)} · ${a.project?.name || '—'} · ${fmtDate(a.startDate)} to ${fmtDate(a.endDate)}`, confirmLabel: 'Approve' }))) return;
    setMsg('');
    try { await api.post(`/admin/agreements/${a.id}/review`, { action: 'APPROVED' }); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="space-y-3">
      <FilterBar filters={A_FILTERS} value={status} onChange={setStatus} q={q} setQ={setQ} placeholder="Search project, client, location"
        action={<Button onClick={() => setUpload(true)}>Upload agreement</Button>} />
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
        !rows.length ? <Empty title="No agreements found" subtitle={status === 'EXPIRING' ? 'No approved agreement expires in the next 30 days.' : 'Nothing matches the current filter.'} /> :
        rows.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-ink flex items-center gap-2">{agreementTypeLabel(a.agreementType)} agreement <Status status={a.status} /> <ExpiryTag a={a} /></div>
                <div className="text-xs text-ink-soft mt-1">
                  {[a.project?.name, a.client?.name, a.location?.name].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="text-xs text-ink-faint mt-0.5">
                  {fmtDate(a.startDate)} to {fmtDate(a.endDate)}
                  {a.details && <> · {a.details}</>}
                  {a.uploadedBy && <> · Uploaded by {a.uploadedBy.name}</>}
                  {a.reviewedAt && <> · {a.status === 'REJECTED' ? 'Rejected' : 'Approved'} by {a.reviewedBy || '—'} on {fmtDate(a.reviewedAt)}</>}
                </div>
                {a.reviewNote && <div className="text-xs text-rose-700 mt-1">Reason: {a.reviewNote}</div>}
              </div>
              <div className="flex gap-2 items-start">
                {a.hasDocument && <Button size="sm" variant="outline" onClick={() => openFile(`/agreements/${a.id}/document`).catch((e) => setMsg(e.message))}>Document</Button>}
                {a.status === 'PENDING' && <>
                  <Button size="sm" onClick={() => approve(a)}>Approve</Button>
                  <Button size="sm" variant="danger" onClick={() => setReject(a)}>Reject</Button>
                </>}
              </div>
            </div>
          </Card>
        ))}
      <AgreementUploadModal open={upload} onClose={() => setUpload(false)} onSaved={load} />
      <ReasonModal open={!!reject} onClose={() => setReject(null)} title="Reject agreement" confirmLabel="Reject"
        onSubmit={async (text) => { await api.post(`/admin/agreements/${reject.id}/review`, { action: 'REJECTED', reason: text }); load(); }} />
      {confirmUi}
    </div>
  );
}
