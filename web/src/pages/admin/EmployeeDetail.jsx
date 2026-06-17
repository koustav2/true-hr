import { useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Card, Button, Spinner, Textarea } from '../../components/ui.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm text-ink-faint">{label}</span>
      <span className="text-sm font-medium text-ink text-right">{value || '—'}</span>
    </div>
  );
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const loc = useLocation();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(loc.state?.justCreated ? 'Offer email queued to the employee’s personal email.' : '');
  const [notes, setNotes] = useState('');
  const [showSendBack, setShowSendBack] = useState(false);

  const load = () => api.get(`/employees/${id}`).then(setData).catch(() => setData(false));
  useEffect(() => { load(); }, [id]);

  async function approve() {
    if (!confirm('Approve onboarding? This creates the login account and emails credentials.')) return;
    setBusy(true);
    try { const r = await api.post(`/onboarding/${data.onboarding.id}/approve`); setMsg(`Approved. Employee ID ${r.employeeCode} created; credentials emailed.`); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function sendBack() {
    setBusy(true);
    try { await api.post(`/onboarding/${data.onboarding.id}/send-back`, { notes }); setShowSendBack(false); setMsg('Sent back to employee for corrections.'); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  if (data === null) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (data === false) return <Card className="p-8 max-w-lg"><p className="text-ink-soft">Employee not found.</p></Card>;

  const { employee: e, onboarding, bank, statutory, addresses, esign } = data;
  const canReview = ['DETAILS_SUBMITTED','HR_REVIEW'].includes(onboarding?.state);

  return (
    <div className="max-w-5xl space-y-5">
      <Link to="/admin/employees" className="text-sm text-brand-600">← Employees</Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid place-items-center h-14 w-14 rounded-2xl bg-brand-600 text-white text-lg font-bold">
            {(e.first_name[0] + e.last_name[0]).toUpperCase()}</div>
          <div>
            <h1 className="text-2xl font-bold text-ink">{e.first_name} {e.last_name}</h1>
            <div className="text-sm text-ink-faint">{e.designation || '—'} · {e.department || '—'} {e.employee_code && `· ${e.employee_code}`}</div>
          </div>
        </div>
        <StatusBadge status={e.onboarding_status} />
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
              <Button onClick={approve} disabled={busy}>{busy ? <Spinner /> : '✓ Approve & create account'}</Button>
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
          <Row label="Reporting manager" value={e.rm_first ? `${e.rm_first} ${e.rm_last}` : null} />
          <Row label="Function manager" value={e.fm_first ? `${e.fm_first} ${e.fm_last}` : null} />
          <Row label="Date of joining" value={e.date_of_joining?.slice(0,10)} />
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
    </div>
  );
}
