'use client';
import { useEffect, useState } from 'react';
import { api, openFile } from '@/lib/api.js';
import { Card, Button, Spinner, Empty, Modal, useConfirm } from '@/components/ui.jsx';
import { fmtDate, todayIso } from '@/lib/labels.js';
import {
  Status, VendorFields, VendorDetails, validateVendor, AgreementFields, validateAgreement,
  agreementBody, agreementTypeLabel, ExpiryTag,
} from '@/app/admin/vendors/vendorForms.jsx';

// GreenHR "Vendor Registration" + "Upload Rent Agreement" — employee web forms.
export default function EssVendorsPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-ink">Vendors & Agreements</h1>
      <div className="flex gap-1.5 border-b border-line">
        {['Vendor Registration', 'Upload Agreement'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {tab === 0 ? <VendorTab /> : <AgreementTab />}
    </div>
  );
}

const strip = ({ id, status, registeredBy, reviewedBy, reviewedAt, reviewNote, createdAt, updatedAt, hasDocument, associationWith, ...body }) => body;

function VendorTab() {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({});
  const [editing, setEditing] = useState(null);   // vendor being edited (pending only)
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [view, setView] = useState(null);
  const [confirm, confirmUi] = useConfirm();
  const load = () => api.get('/vendors').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  async function submit() {
    const errs = validateVendor(f);
    setErrors(errs); setMsg('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (editing) await api.put(`/vendors/${editing.id}`, strip(f)); else await api.post('/vendors', strip(f));
      setF({}); setEditing(null); setErrors({}); setMsg(editing ? 'Changes saved.' : 'Vendor submitted for HR approval.'); load();
    } catch (e) { setErrors(e.fields || {}); if (!e.fields) setMsg(e.message); } finally { setBusy(false); }
  }
  async function withdraw(v) {
    if (!(await confirm({ title: `Withdraw ${v.companyName}?`, body: 'The registration will no longer go to HR for approval.', confirmLabel: 'Withdraw', tone: 'danger' }))) return;
    try { await api.post(`/vendors/${v.id}/withdraw`); load(); } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="grid lg:grid-cols-[440px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <div className="font-semibold text-sm">{editing ? `Edit ${editing.companyName}` : 'Register vendor'}</div>
        <VendorFields f={f} setF={setF} errors={errors} />
        {msg && <p className={`text-sm ${/saved|submitted/.test(msg) ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Register vendor'}</Button>
          {editing && <Button variant="ghost" onClick={() => { setEditing(null); setF({}); setErrors({}); }}>Cancel edit</Button>}
        </div>
      </Card>
      <Card className="p-0 overflow-x-auto">
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !rows.length ? <Empty title="No registrations yet" subtitle="Your vendor registrations appear here for HR approval." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">Company</th><th className="px-2 py-2.5">PAN / GSTIN</th><th className="px-2 py-2.5">Status</th><th className="px-4 py-2.5" /></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-4 py-2.5">{v.companyName}<div className="text-xs text-ink-faint">{fmtDate(v.createdAt)}</div></td>
                  <td className="px-2 py-2.5 text-xs text-ink-soft">{v.pan || '—'} / {v.gst || '—'}</td>
                  <td className="px-2 py-2.5"><Status status={v.status} />
                    {v.status === 'REJECTED' && v.reviewNote && <div className="text-xs text-rose-700 mt-1">Reason: {v.reviewNote}</div>}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button className="text-xs text-brand-700 font-semibold mr-3" onClick={() => setView(v)}>View</button>
                    {v.status === 'PENDING' && <>
                      <button className="text-xs text-brand-700 font-semibold mr-3" onClick={() => { setEditing(v); setF({ ...v }); setErrors({}); setMsg(''); }}>Edit</button>
                      <button className="text-xs text-rose-600 font-semibold" onClick={() => withdraw(v)}>Withdraw</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal open={!!view} onClose={() => setView(null)} title="Vendor details" size="lg"
        actions={view?.hasDocument ? <Button variant="outline" onClick={() => openFile(`/vendors/${view.id}/document`).catch((e) => setMsg(e.message))}>Open document</Button> : null}>
        {view && <VendorDetails v={view} />}
      </Modal>
      {confirmUi}
    </div>
  );
}

function AgreementTab() {
  const [rows, setRows] = useState(null);
  const [m, setM] = useState(null);
  const [f, setF] = useState({ agreementType: 'RENT', startDate: todayIso() });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirm, confirmUi] = useConfirm();
  const load = () => api.get('/agreements').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); api.get('/meta/nfa-masters').then(setM).catch(() => setM({})); }, []);

  async function submit() {
    const errs = validateAgreement(f);
    setErrors(errs); setMsg('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('/agreements', agreementBody(f));
      setF({ agreementType: 'RENT', startDate: todayIso() }); setMsg('Agreement submitted for approval.'); load();
    } catch (e) { setErrors(e.fields || {}); if (!e.fields) setMsg(e.message); } finally { setBusy(false); }
  }
  async function withdraw(a) {
    if (!(await confirm({ title: 'Withdraw this agreement?', confirmLabel: 'Withdraw', tone: 'danger' }))) return;
    try { await api.post(`/agreements/${a.id}/withdraw`); load(); } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="grid lg:grid-cols-[400px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <div className="font-semibold text-sm">Upload agreement</div>
        <AgreementFields f={f} setF={setF} errors={errors} masters={m} onDocError={setMsg} />
        {msg && <p className={`text-sm ${/submitted/.test(msg) ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
        <Button onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit agreement'}</Button>
      </Card>
      <Card className="p-0 overflow-x-auto">
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !rows.length ? <Empty title="No agreements yet" subtitle="Your uploaded agreements appear here for approval." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">Agreement</th><th className="px-2 py-2.5">Period</th><th className="px-2 py-2.5">Status</th><th className="px-4 py-2.5" /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-4 py-2.5">{agreementTypeLabel(a.agreementType)} — {a.project?.name || '—'}
                    <div className="text-xs text-ink-faint">{[a.client?.name, a.location?.name].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-2 py-2.5 text-xs text-ink-soft">{fmtDate(a.startDate)} to {fmtDate(a.endDate)}<div><ExpiryTag a={a} /></div></td>
                  <td className="px-2 py-2.5"><Status status={a.status} />
                    {a.status === 'REJECTED' && a.reviewNote && <div className="text-xs text-rose-700 mt-1">Reason: {a.reviewNote}</div>}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {a.hasDocument && <button className="text-xs text-brand-700 font-semibold mr-3" onClick={() => openFile(`/agreements/${a.id}/document`).catch((e) => setMsg(e.message))}>Document</button>}
                    {a.status === 'PENDING' && <button className="text-xs text-rose-600 font-semibold" onClick={() => withdraw(a)}>Withdraw</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {confirmUi}
    </div>
  );
}
