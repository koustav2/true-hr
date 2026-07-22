'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Textarea, Spinner, Empty, Field } from '@/components/ui.jsx';

const TONE = { PENDING: 'text-amber-700', APPROVED: 'text-emerald-700', REJECTED: 'text-rose-700' };

// GreenHR "Vendor Registration" + "Upload Rent Agreement" — employee web forms.
export default function EssVendorsPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">Vendors & Agreements</h1>
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


// Attach a supporting document (PDF/image, max 5MB) as base64.
function DocPicker({ value, onPick, onClear }) {
  return (
    <div className="text-sm">
      <span className="block text-[13px] font-medium text-ink-soft mb-1.5">Supporting document (PDF/image, optional)</span>
      {value ? (
        <div className="flex items-center justify-between gap-2 border border-line rounded-lg px-3 py-2">
          <span className="truncate text-ink-soft text-xs">{value.documentName}</span>
          <button onClick={onClear} className="text-xs text-rose-600 shrink-0">remove</button>
        </div>
      ) : (
        <input type="file" accept="application/pdf,image/*" className="block w-full text-xs text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:px-3 file:py-2 file:text-xs file:font-semibold"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { alert('File larger than 5MB'); e.target.value = ''; return; }
            const b64 = await new Promise((res, rej) => {
              const r = new FileReader();
              r.onload = () => res(String(r.result).split(',')[1]);
              r.onerror = rej; r.readAsDataURL(file);
            });
            onPick({ document: b64, documentMime: file.type, documentName: file.name });
          }} />
      )}
    </div>
  );
}

function VendorTab() {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/vendors').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit() {
    if (!f.companyName?.trim()) { setMsg('Company name is required.'); return; }
    setBusy(true); setMsg('');
    try { await api.post('/vendors', f); setF({}); load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <div className="font-semibold text-sm">Register Vendor</div>
        <Field label="Company name" required><Input value={f.companyName || ''} onChange={set('companyName')} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nature of business"><Input value={f.natureOfBusiness || ''} onChange={set('natureOfBusiness')} /></Field>
          <Field label="Type of company"><Input value={f.typeOfCompany || ''} onChange={set('typeOfCompany')} /></Field>
          <Field label="PAN"><Input value={f.pan || ''} onChange={set('pan')} /></Field>
          <Field label="GST"><Input value={f.gst || ''} onChange={set('gst')} /></Field>
          <Field label="ESIC"><Input value={f.esic || ''} onChange={set('esic')} /></Field>
          <Field label="PF"><Input value={f.pf || ''} onChange={set('pf')} /></Field>
          <Field label="MSMED"><Input value={f.msmed || ''} onChange={set('msmed')} /></Field>
          <Field label="NSIC / SSI"><Input value={f.nsicSsi || ''} onChange={set('nsicSsi')} /></Field>
          <Field label="Contact person"><Input value={f.contactPerson || ''} onChange={set('contactPerson')} /></Field>
          <Field label="Contact phone"><Input value={f.contactPhone || ''} onChange={set('contactPhone')} /></Field>
        </div>
        <DocPicker value={f.document ? f : null}
          onPick={(d) => setF((x) => ({ ...x, ...d }))}
          onClear={() => setF(({ document, documentMime, documentName, ...rest }) => rest)} />
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        <Button onClick={submit} disabled={busy}>{busy ? 'Registering…' : 'Register Vendor'}</Button>
      </Card>
      <Card className="p-0">
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !rows.length ? <Empty title="No registrations yet" subtitle="Your vendor registrations appear here for HR approval." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">Company</th><th className="px-2 py-2.5">PAN / GST</th><th className="px-4 py-2.5">Status</th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{v.companyName}<div className="text-xs text-ink-faint">{v.natureOfBusiness || ''}</div></td>
                  <td className="px-2 py-2.5 text-xs text-ink-soft">{v.pan || '—'} / {v.gst || '—'}</td>
                  <td className={`px-4 py-2.5 text-xs font-semibold ${TONE[v.status] || ''}`}>{v.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function AgreementTab() {
  const [rows, setRows] = useState(null);
  const [m, setM] = useState(null);
  const [f, setF] = useState({ agreementType: 'RENT' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/agreements').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); api.get('/meta/nfa-masters').then(setM).catch(() => {}); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit() {
    if (!f.startDate || !f.endDate) { setMsg('Start and end dates are required.'); return; }
    setBusy(true); setMsg('');
    try {
      await api.post('/agreements', {
        ...f,
        projectId: f.projectId ? Number(f.projectId) : undefined,
        locationId: f.locationId ? Number(f.locationId) : undefined,
        clientId: f.clientId ? Number(f.clientId) : undefined,
      });
      setF({ agreementType: 'RENT' }); load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-2.5">
        <div className="font-semibold text-sm">Upload Agreement</div>
        <Field label="Project"><Select value={f.projectId || ''} onChange={set('projectId')}>
          <option value="">Select</option>{(m?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Location"><Select value={f.locationId || ''} onChange={set('locationId')}>
          <option value="">Select</option>{(m?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Client"><Select value={f.clientId || ''} onChange={set('clientId')}>
          <option value="">Select</option>{(m?.clientsVendors || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Agreement type" required><Select value={f.agreementType} onChange={set('agreementType')}>
          {['RENT', 'SERVICE', 'MOU', 'OTHER'].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Start date" required><Input type="date" value={f.startDate || ''} onChange={set('startDate')} /></Field>
          <Field label="End date" required><Input type="date" value={f.endDate || ''} onChange={set('endDate')} /></Field>
        </div>
        <Field label="Details"><Textarea rows={2} value={f.details || ''} onChange={set('details')} /></Field>
        <DocPicker value={f.document ? f : null}
          onPick={(d) => setF((x) => ({ ...x, ...d }))}
          onClear={() => setF(({ document, documentMime, documentName, ...rest }) => rest)} />
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        <Button onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit Agreement'}</Button>
      </Card>
      <Card className="p-0">
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !rows.length ? <Empty title="No agreements yet" subtitle="Your uploaded agreements appear here for admin approval." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">Agreement</th><th className="px-2 py-2.5">Period</th><th className="px-4 py-2.5">Status</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{a.agreementType} — {a.project?.name || '—'}
                    <div className="text-xs text-ink-faint">{[a.location?.name, a.client?.name].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-2 py-2.5 text-xs text-ink-soft">{a.startDate?.slice(0, 10)} → {a.endDate?.slice(0, 10)}</td>
                  <td className={`px-4 py-2.5 text-xs font-semibold ${TONE[a.status] || ''}`}>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
