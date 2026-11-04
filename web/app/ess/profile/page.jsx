'use client';
import { useEffect, useState } from 'react';
import { api, fetchBlob } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { Card, Spinner, Empty, Input, Select, Button, Field, Badge, Modal } from '@/components/ui.jsx';

const DOC_TYPES = {
  PHOTO: 'Photograph', SIGNATURE_IMAGE: 'Signature image', CERT_10: '10th marksheet', CERT_12: '12th marksheet',
  CERT_GRAD: 'Graduation marksheet', CERT_PG: 'Post-graduation marksheet', CERT_OTHER: 'Other certificate',
  RELIEVING_LAST: 'Relieving letter (last employer)', RELIEVING_PREV: 'Relieving letter (previous employers)',
  ID_AADHAAR: 'Aadhaar card', ID_PAN: 'PAN card', ID_BANK: 'Bank passbook / cancelled cheque',
  ID_DL_FRONT: 'Driving licence (front)', ID_DL_REAR: 'Driving licence (rear)',
};
const DOC_TONE = { VERIFIED: 'ok', REJECTED: 'danger', PENDING: 'warn' };

export default function ProfilePage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-ink">My Profile & Team</h1>
      <div className="flex gap-1.5 border-b border-line">
        {['Profile', 'My documents', 'My Team', 'Address Book'].map((t, i) => (
          <button key={t} type="button" onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Profile />}
      {tab === 1 && <Documents />}
      {tab === 2 && <Team />}
      {tab === 3 && <Directory />}
    </div>
  );
}

function Section({ title, rows }) {
  return (
    <Card className="p-4">
      <h2 className="font-semibold text-ink mb-2">{title}</h2>
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1.5">
            <span className="text-ink-faint">{k}</span><span className="text-right font-medium break-all">{v || '—'}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// E53: the full record, read-only; sensitive values arrive masked from the server.
function Profile() {
  const [p, setP] = useState(null);
  useEffect(() => { api.get('/me/full-profile').then(setP).catch(() => setP(false)); }, []);
  if (p === null) return <Spinner />;
  if (!p) return <Empty title="No employee profile linked to this account" />;
  const addr = (a) => [a.line1, a.line2, a.city, a.district, a.state, a.pincode].filter(Boolean).join(', ');
  return (
    <div className="space-y-4 max-w-4xl">
      <Section title="Employment" rows={[
        ['Employee code', p.employeeCode], ['Name', p.fullName], ['Company', p.company],
        ['Department', p.department], ['Sub-department', p.subDepartment], ['Designation', p.designation],
        ['Employment type', p.employmentType ? label(p.employmentType) : null], ['Date of joining', p.dateOfJoining ? fmtDate(p.dateOfJoining) : null],
        ['Location', p.branch || p.location], ['Reporting manager', p.reportingManager],
        ['Functional manager', p.functionalManager], ['Operational manager', p.operationalManager],
      ]} />
      <Section title="Personal & contact" rows={[
        ['Date of birth', p.dob ? fmtDate(p.dob) : null], ['Gender', p.gender ? label(p.gender) : null],
        ['Blood group', p.bloodGroup], ['Marital status', p.maritalStatus],
        ['Phone', p.phone], ['Personal email', p.personalEmail], ['Official email', p.officialEmail],
        ['Emergency contact', p.emergencyContact ? `${p.emergencyContact.name}${p.emergencyContact.phone ? ` · ${p.emergencyContact.phone}` : ''}` : null],
        ...(p.addresses || []).map((a) => [a.type === 'PERMANENT' ? 'Permanent address' : 'Present address', addr(a)]),
      ]} />
      <Section title="Bank & statutory (masked)" rows={[
        ['Account holder', p.bank?.accountHolder], ['Bank', p.bank?.bankName], ['Branch', p.bank?.branch], ['IFSC', p.bank?.ifsc],
        ['Account number', p.bank?.accountNumberMasked], ['PAN', p.statutory?.panMasked], ['Aadhaar', p.statutory?.aadhaarMasked],
        ['UAN', p.statutory?.uan],
      ]} />
      <p className="text-xs text-ink-faint">Something wrong? Use <b>Request a change</b> — HR reviews it before your record is updated.</p>
    </div>
  );
}

// E53: upload documents for HR to verify.
function Documents() {
  const [rows, setRows] = useState(null);
  const [type, setType] = useState('');
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const load = () => api.get('/me/documents').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  async function upload() {
    const e = {};
    if (!type) e.type = 'Choose a document type';
    if (!file) e.file = 'Choose a file to upload';
    else if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) e.file = 'Only PDF or image (PNG/JPG) files are allowed';
    else if (file.size > 10 * 1024 * 1024) e.file = 'File larger than 10 MB';
    setErrors(e); setMsg('');
    if (Object.keys(e).length) return;
    const replacing = (rows || []).some((r) => r.type === type);
    if (replacing && !window.confirm(`Replace your ${DOC_TYPES[type]}? HR will need to verify the new file.`)) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      await api.post('/me/documents', { type, name: file.name, dataUrl });
      setMsg('Uploaded — HR will verify it.'); setType(''); setFile(null); await load();
    } catch (err) { setErrors(err.fields || { file: err.message }); } finally { setBusy(false); }
  }
  async function open(d) {
    try { const blob = await fetchBlob(`/me/documents/${d.id}`); setView({ url: URL.createObjectURL(blob), mime: blob.type, label: d.label }); }
    catch (err) { setMsg(err.message); }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Card className="p-4">
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <Field label="Document" required error={errors.type}>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Select…</option>
              {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="File (PDF / JPG / PNG, max 10 MB)" required error={errors.file}>
            <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
          </Field>
          <Button onClick={upload} disabled={busy}>{busy ? <Spinner /> : 'Upload'}</Button>
        </div>
        {msg && <p className="text-sm text-pos mt-2">{msg}</p>}
      </Card>
      <Card className="overflow-hidden">
        {!rows ? <div className="p-8 grid place-items-center"><Spinner /></div> : !rows.length ? <Empty title="No documents yet" subtitle="Upload your Aadhaar, PAN, certificates or photo for HR to verify." /> : (
          <ul className="divide-y divide-line">
            {rows.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <button type="button" onClick={() => open(d)} className="font-medium text-ink hover:text-brand-700 text-left flex-1 min-w-0">
                  {d.label}<span className="block text-xs text-ink-faint truncate">{d.filename || ''} · {fmtDate(String(d.uploaded_at).slice(0, 10))}</span>
                </button>
                <Badge tone={DOC_TONE[d.verify_status] || 'neutral'}>{d.verify_status === 'PENDING' ? 'Waiting for HR' : label(d.verify_status)}</Badge>
                {d.verify_remark && <span className="text-xs text-ink-faint w-full">HR: {d.verify_remark}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={!!view} onClose={() => { if (view?.url) URL.revokeObjectURL(view.url); setView(null); }} title={view?.label} size="full">
        {view && (view.mime.startsWith('image/') ? <img src={view.url} alt={view.label} className="max-h-[70vh] mx-auto" />
          : <iframe src={view.url} title={view.label} className="w-full h-[70vh] border-0" />)}
      </Modal>
    </div>
  );
}

// Photo next to every name — authenticated fetch, initials fallback.
function PersonAvatar({ id, name }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!id) return undefined;
    let url; let live = true;
    fetchBlob(`/employees/${id}/photo`).then((b) => { if (live && b?.size) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (src) return <img src={src} alt={name} className="h-10 w-10 rounded-full object-cover shrink-0 ring-1 ring-line" />;
  return (
    <span className="grid place-items-center h-10 w-10 rounded-full bg-gradient-to-br from-brand-500 to-emerald-600 text-white text-xs font-bold shrink-0">
      {(name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
    </span>
  );
}

function PersonRow({ m, showPhone }) {
  const name = m.name || `${m.firstName || m.first_name || ''} ${m.lastName || m.last_name || ''}`.trim();
  return (
    <Card className="p-3 text-sm flex flex-wrap justify-between items-center gap-2">
      <div className="flex items-center gap-3 min-w-0">
        <PersonAvatar id={m.id} name={name} />
        <div className="min-w-0">
          <div className="font-medium">{name} <span className="text-xs text-ink-faint">{m.employeeCode || m.employee_code}</span></div>
          <div className="text-xs text-ink-faint">{[m.designation, m.department, m.location || m.state].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {/* E55: the email exactly as stored — never wrapped or trimmed at a "+". */}
      <div className="text-xs text-ink-soft text-right min-w-0 max-w-full">
        <div className="whitespace-nowrap overflow-x-auto" title={m.email || ''}>{m.officialEmail || m.official_email || m.email || ''}</div>
        {showPhone && <div>{m.phone || ''}</div>}
      </div>
    </Card>
  );
}

function Team() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/me/team').then(setRows).catch(() => setRows([])); }, []);
  return !rows ? <Spinner /> : !rows.length ? <Empty title="No team yet" subtitle="People reporting to you appear here." /> : (
    <div className="space-y-2">{rows.map((m) => <PersonRow key={m.id || m.employeeCode} m={m} showPhone />)}</div>
  );
}

// E54-E56: current employees, official contacts only, trimmed search across
// name, code, department and designation.
function Directory() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api.get('/me/directory').then(setRows).catch(() => setRows([])); }, []);
  const needle = q.trim().replace(/\s+/g, ' ').toLowerCase();
  const filtered = (rows || []).filter((m) => !needle
    || `${m.name || ''} ${m.employeeCode || ''} ${m.designation || ''} ${m.department || ''}`.toLowerCase().includes(needle));
  return (
    <div className="space-y-3">
      <Input placeholder="Search name, employee ID, department or designation…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      {!rows ? <Spinner /> : !filtered.length ? <Empty title={needle ? 'No matches' : 'Nobody here yet'} subtitle={needle ? 'Try a name, employee ID, department or designation.' : undefined} /> : (
        <div className="space-y-2">{filtered.map((m, i) => <PersonRow key={m.id || i} m={m} />)}</div>
      )}
    </div>
  );
}
