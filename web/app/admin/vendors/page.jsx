'use client';
import { useEffect, useState } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Button, Spinner, Empty, ConfirmClick } from '@/components/ui.jsx';

const TABS = ['Vendor Registrations', 'Agreements'];

// Open an auth-protected document in a new tab (blob URL avoids header limits on <a>).
async function openDoc(url) {
  const win = window.open('', '_blank');
  try {
    const auth = getStoredAuth();
    const res = await fetch(`/api${url}`, { headers: { Authorization: `Bearer ${auth?.token}` } });
    if (!res.ok) { win?.close(); return; }
    const blob = URL.createObjectURL(await res.blob());
    if (win) win.location = blob; else window.location.href = blob;
  } catch { win?.close(); }
}
const TONE = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

export default function VendorsPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Vendors & Agreements</h1>
        <p className="text-ink-faint text-sm mt-0.5">Vendor registrations (statutory details) and rent/service agreements awaiting approval.</p>
      </div>
      <div className="flex gap-1.5 border-b border-line">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Vendors />}
      {tab === 1 && <Agreements />}
    </div>
  );
}

function Chip({ status }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium ${TONE[status] || ''}`}>{status}</span>;
}

function Vendors() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/vendors').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function review(id, action) {
    try { await api.post(`/admin/vendors/${id}/review`, { action }); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="space-y-3">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
        !rows.length ? <Empty title="No vendor registrations" subtitle="Employees register vendors from the app (NFA → Vendor Registration)." /> :
        rows.map((v) => (
          <Card key={v.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-ink">{v.companyName} <Chip status={v.status} /></div>
                <div className="text-xs text-ink-faint mt-0.5">
                  {[v.natureOfBusiness, v.typeOfCompany, v.associationWith].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="grid sm:grid-cols-3 gap-x-6 gap-y-0.5 text-xs text-ink-soft mt-2">
                  <span>PAN: {v.pan || '—'}</span><span>GST: {v.gst || '—'}</span><span>ESIC: {v.esic || '—'}</span>
                  <span>PF: {v.pf || '—'}</span><span>MSMED: {v.msmed || '—'}</span><span>NSIC/SSI: {v.nsicSsi || '—'}</span>
                </div>
                <div className="text-xs text-ink-faint mt-1">
                  Contact: {[v.contactPerson, v.contactPhone, v.contactEmail].filter(Boolean).join(' · ') || '—'}
                  {v.registeredBy && <> · Registered by {v.registeredBy.name}</>}
                </div>
              </div>
              <div className="flex gap-2 items-start">
                {v.hasDocument && <Button size="sm" variant="outline" onClick={() => openDoc(`/vendors/${v.id}/document`)}>Document</Button>}
              {v.status === 'PENDING' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => review(v.id, 'APPROVED')}>Approve</Button>
                  <ConfirmClick onConfirm={() => review(v.id, 'REJECTED')} confirmLabel="Confirm reject?" className="px-3 py-1.5 text-[13px] rounded-lg bg-white border border-rose-200 text-rose-600 hover:bg-rose-50">Reject</ConfirmClick>
                </div>
              )}
              </div>
            </div>
          </Card>
        ))}
    </div>
  );
}

function Agreements() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/agreements').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function review(id, action) {
    try { await api.post(`/admin/agreements/${id}/review`, { action }); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="space-y-3">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
        !rows.length ? <Empty title="No agreements" subtitle="Employees upload rent/service agreements from the app (NFA → Upload Agreement)." /> :
        rows.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-ink">{a.agreementType} agreement <Chip status={a.status} /></div>
                <div className="text-xs text-ink-soft mt-1">
                  {[a.project?.name, a.location?.name, a.client?.name].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="text-xs text-ink-faint mt-0.5">
                  {a.startDate?.slice(0, 10)} → {a.endDate?.slice(0, 10)}
                  {a.details && <> · {a.details}</>}
                  {a.uploadedBy && <> · Uploaded by {a.uploadedBy.name}</>}
                </div>
              </div>
              <div className="flex gap-2 items-start">
                {a.hasDocument && <Button size="sm" variant="outline" onClick={() => openDoc(`/agreements/${a.id}/document`)}>Document</Button>}
              {a.status === 'PENDING' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => review(a.id, 'APPROVED')}>Approve</Button>
                  <ConfirmClick onConfirm={() => review(a.id, 'REJECTED')} confirmLabel="Confirm reject?" className="px-3 py-1.5 text-[13px] rounded-lg bg-white border border-rose-200 text-rose-600 hover:bg-rose-50">Reject</ConfirmClick>
                </div>
              )}
              </div>
            </div>
          </Card>
        ))}
    </div>
  );
}
