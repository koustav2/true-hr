'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Button, Spinner, Textarea, Modal } from '@/components/ui.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { IconArrowLeft, IconCheck, IconFile } from '@/components/icons.jsx';

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

  const load = () => api.get(`/employees/${id}`).then(setData).catch(() => setData(false));
  useEffect(() => { load(); }, [id]);

  async function approve() {
    setConfirmApprove(false);
    setBusy(true);
    try { const r = await api.post(`/onboarding/${data.onboarding.id}/approve`); setMsg(`Approved. Employee ID ${r.employeeCode} created; credentials emailed.`); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
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
          <StatusBadge status={e.onboarding_status} />
        </div>
      </div>

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
          <h2 className="font-semibold text-ink mb-3">Bank & statutory <span className="text-xs font-normal text-ink-faint">(PII masked)</span></h2>
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
              <button key={d.id} type="button" onClick={() => viewDocument(d.id, DOC_LABELS[d.type] || d.type)}
                className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-left hover:border-brand-300 hover:bg-slate-50 transition-colors">
                <span className="grid place-items-center h-9 w-9 rounded-lg bg-slate-100 text-ink-faint shrink-0"><IconFile width={16} height={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink truncate">{DOC_LABELS[d.type] || d.type}</span>
                  <span className="block text-xs text-ink-faint truncate">{d.filename || (d.mime === 'application/pdf' ? 'PDF' : 'Image')}</span>
                </span>
                <span className="text-brand-700 text-xs font-medium">View</span>
              </button>
            ))}
          </div>
        )}
      </Card>

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
    </div>
  );
}
