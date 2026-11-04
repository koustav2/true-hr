'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import {
  Card, Button, Field, Input, Select, Textarea, Modal, Spinner, Empty, SearchPicker, ErrorSummary, useConfirm,
} from '@/components/ui.jsx';

const STATUS_STYLES = {
  in_stock: 'bg-slate-100 text-ink-soft', assigned: 'bg-brand-50 text-brand-700',
  repair: 'bg-amber-50 text-amber-700', retired: 'bg-slate-100 text-ink-faint', lost: 'bg-rose-50 text-rose-600',
};
const STATUSES = ['in_stock', 'assigned', 'repair', 'retired', 'lost'];
const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'DAMAGED'];
const REQ_KIND = { REQUEST: 'New asset', ISSUE: 'Issue reported', RETURN: 'Return' };
const EMPTY = {
  assetTag: '', category: '', isIt: true, brand: '', model: '', serialNo: '', vendorId: '', vendor: '', cost: '',
  purchaseDate: '', warrantyExpiry: '', invoiceNo: '', condition: 'NEW', status: 'in_stock', notes: '',
};
const iso = (v) => (v ? String(v).slice(0, 10) : '');
const money = (v) => (v == null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

// A select from a master list; free text only while the master is still empty.
function MasterChoice({ list, value, onChange, placeholder, masterName }) {
  if (!list?.length) {
    return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} title={`Add entries under Master data › ${masterName} to get a dropdown`} />;
  }
  const known = list.some((x) => x.toLowerCase() === String(value || '').toLowerCase());
  return (
    <Select value={known ? list.find((x) => x.toLowerCase() === String(value).toLowerCase()) : ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select…</option>
      {list.map((x) => <option key={x} value={x}>{x}</option>)}
    </Select>
  );
}

export default function AssetsPage() {
  const [assets, setAssets] = useState(null);
  const [emps, setEmps] = useState([]);
  const [opts, setOpts] = useState({ brands: [], categories: [], vendors: [] });
  const [requests, setRequests] = useState([]);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, confirmUi] = useConfirm();

  const [editing, setEditing] = useState(null); // null | 'new' | asset row
  const [form, setForm] = useState(EMPTY);
  const [formErr, setFormErr] = useState({});
  const [assignFor, setAssignFor] = useState(null);
  const [assign, setAssign] = useState({ employeeId: '', assignedOn: todayIso(), condition: 'GOOD', notes: '', requestId: null });
  const [assignErr, setAssignErr] = useState({});
  const [returnFor, setReturnFor] = useState(null);
  const [ret, setRet] = useState({ condition: 'GOOD', status: 'in_stock', notes: '' });
  const [retErr, setRetErr] = useState({});
  const [actFor, setActFor] = useState(null); // { request, status }
  const [actNote, setActNote] = useState('');
  const [actErr, setActErr] = useState({});

  const load = () => {
    const p = new URLSearchParams();
    if (statusF) p.set('status', statusF);
    if (q.trim()) p.set('q', q.trim());
    return api.get('/admin/assets?' + p.toString()).then((r) => setAssets(r.assets || [])).catch((e) => { setErr(e.message); setAssets([]); });
  };
  const loadRequests = () => api.get('/admin/asset-requests').then((r) => setRequests(r.requests || [])).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusF]);
  useEffect(() => {
    api.get('/admin/assets/employees').then((r) => setEmps(r.employees || [])).catch(() => {});
    api.get('/admin/assets/options').then(setOpts).catch(() => {});
    loadRequests();
  }, []);

  const empLabel = (e) => `${e.first_name || ''} ${e.last_name || ''} (${e.employee_code || e.id})`.trim();
  const setF = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setFormErr((e) => ({ ...e, [k]: undefined, _: undefined })); };

  function openNew() { setEditing('new'); setForm(EMPTY); setFormErr({}); }
  function openEdit(a) {
    setEditing(a); setFormErr({});
    setForm({
      assetTag: a.asset_tag, category: a.category || '', isIt: a.is_it !== false, brand: a.brand || '', model: a.model || '',
      serialNo: a.serial_no || '', vendorId: a.vendor_id ? String(a.vendor_id) : '', vendor: a.vendor || '',
      cost: a.cost ?? '', purchaseDate: iso(a.purchase_date), warrantyExpiry: iso(a.warranty_expiry), invoiceNo: a.invoice_no || '',
      condition: a.condition || '', status: a.status, notes: a.notes || '',
    });
  }

  function checkForm() {
    const v = validator();
    if (editing === 'new') v.text('assetTag', form.assetTag, 'Asset tag', { required: true, max: 40 });
    v.number('cost', form.cost, 'Cost', { min: 0, max: 100000000 });
    if (!v.fields.cost && form.cost !== '' && !/^\d[\d,]*(\.\d{1,2})?$/.test(String(form.cost).trim())) v.add('cost', 'Cost can have at most 2 decimal places');
    v.date('purchaseDate', form.purchaseDate, 'Purchase date', { max: todayIso(), maxMsg: 'Purchase date cannot be in the future' });
    v.date('warrantyExpiry', form.warrantyExpiry, 'Warranty expiry', { min: form.purchaseDate || undefined, minMsg: 'Warranty expiry cannot be before the purchase date' });
    v.text('model', form.model, 'Model', { max: 80 });
    v.text('serialNo', form.serialNo, 'Serial no.', { max: 80 });
    v.text('notes', form.notes, 'Notes', { max: 1000 });
    setFormErr(v.fields);
    return v.ok;
  }
  async function save() {
    if (!checkForm()) return;
    setSaving(true);
    const body = { ...form, cost: form.cost === '' ? null : form.cost };
    if (!body.vendorId) delete body.vendorId;
    if (editing !== 'new' && editing.status === 'assigned') delete body.status;
    try {
      if (editing === 'new') await api.post('/admin/assets', body);
      else await api.patch(`/admin/assets/${editing.id}`, body);
      setMsg(editing === 'new' ? `Asset ${form.assetTag} added.` : `Asset ${form.assetTag} updated.`);
      setEditing(null); setErr(''); load();
    } catch (e) { setFormErr(e.fields || { _: e.message }); } finally { setSaving(false); }
  }
  async function remove(a) {
    if (!(await confirm({ title: `Delete ${a.asset_tag}?`, body: 'The asset is removed from the register. This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await api.del(`/admin/assets/${a.id}`); setMsg(`Asset ${a.asset_tag} deleted.`); load(); } catch (e) { setErr(e.message); }
  }

  function openAssign(a, request = null) {
    setAssignFor(a); setAssignErr({});
    setAssign({ employeeId: request ? String(request.employeeId) : '', assignedOn: todayIso(), condition: a.condition && CONDITIONS.includes(a.condition) ? a.condition : 'GOOD', notes: '', requestId: request?.id || null });
  }
  async function doAssign() {
    const v = validator();
    if (!assign.employeeId) v.add('employeeId', 'Choose the employee');
    v.date('assignedOn', assign.assignedOn, 'Assigned date', { required: true, max: todayIso(), min: iso(assignFor.purchase_date) || undefined,
      maxMsg: 'Assigned date cannot be in the future', minMsg: 'Assigned date cannot be before the purchase date' });
    v.require('condition', assign.condition, 'Condition at hand-over');
    setAssignErr(v.fields);
    if (!v.ok) return;
    setSaving(true);
    try {
      await api.post(`/admin/assets/${assignFor.id}/assign`, { ...assign, employeeId: Number(assign.employeeId) });
      setMsg(`${assignFor.asset_tag} assigned.`); setAssignFor(null); load(); loadRequests();
    } catch (e) { setAssignErr(e.fields || { _: e.message }); } finally { setSaving(false); }
  }
  async function doReturn() {
    const v = validator();
    v.require('condition', ret.condition, 'Condition on return');
    v.text('notes', ret.notes, 'Notes', { max: 500 });
    setRetErr(v.fields);
    if (!v.ok) return;
    setSaving(true);
    try {
      await api.post(`/admin/assets/${returnFor.id}/return`, ret);
      setMsg(`${returnFor.asset_tag} returned — now ${label(ret.status).toLowerCase()}.`); setReturnFor(null); load(); loadRequests();
    } catch (e) { setRetErr(e.fields || { _: e.message }); } finally { setSaving(false); }
  }
  async function doAction() {
    const v = validator();
    if (actFor.status === 'REJECTED') v.text('note', actNote, 'Reason', { required: true, max: 500 });
    setActErr(v.fields);
    if (!v.ok) return;
    setSaving(true);
    try {
      await api.post(`/admin/asset-requests/${actFor.request.id}/action`, { status: actFor.status, note: actNote.trim() });
      setActFor(null); loadRequests();
    } catch (e) { setActErr(e.fields || { _: e.message }); } finally { setSaving(false); }
  }

  const openReqs = requests.filter((r) => ['OPEN', 'APPROVED'].includes(r.status));
  const filtered = !!(q.trim() || statusF);

  return (
    <div className="space-y-5">
      {confirmUi}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-ink">Asset Management</h1>
          <p className="text-ink-faint text-sm mt-0.5">IT &amp; non-IT assets — register, assign to employees, record returns, and handle employee requests.</p>
        </div>
        <Button onClick={openNew}>Add asset</Button>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}

      {openReqs.length > 0 && (
        <Card className="overflow-x-auto">
          <div className="px-4 py-3 border-b border-line font-semibold text-ink text-sm">Employee requests ({openReqs.length} open)</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['Raised', 'Employee', 'Type', 'Details', 'Status', 'Actions'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {openReqs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-ink-faint">{fmtDate(iso(r.createdAt))}</td>
                  <td className="px-4 py-3">{r.employeeName} <span className="text-ink-faint">({r.employeeCode})</span></td>
                  <td className="px-4 py-3">{REQ_KIND[r.kind]}{r.assetTag ? ` · ${r.assetTag}` : r.category ? ` · ${r.category}` : ''}</td>
                  <td className="px-4 py-3 max-w-[320px] break-words">{r.details}</td>
                  <td className="px-4 py-3">{label(r.status)}</td>
                  <td className="px-4 py-3 space-x-3 whitespace-nowrap">
                    {r.status === 'OPEN' && <button className="text-brand-700 font-medium" onClick={() => { setActFor({ request: r, status: 'APPROVED' }); setActNote(''); setActErr({}); }}>Approve</button>}
                    {r.status === 'OPEN' && <button className="text-rose-600" onClick={() => { setActFor({ request: r, status: 'REJECTED' }); setActNote(''); setActErr({}); }}>Reject</button>}
                    <button className="text-ink-soft" onClick={() => { setActFor({ request: r, status: 'CLOSED' }); setActNote(''); setActErr({}); }}>Close</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="flex gap-2 flex-wrap">
        <Input placeholder="Search tag / serial / model / brand…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()} className="w-64" />
        <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Button variant="outline" onClick={load}>Search</Button>
      </div>

      <Card className="overflow-x-auto">
        {assets === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : assets.length === 0 ? (filtered ? <Empty title="No assets found" subtitle="Try a different search or status." /> : <Empty title="No assets yet" subtitle="Add your first asset to start tracking." />)
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>{['Tag', 'Category', 'Make / Model', 'Serial', 'Cost', 'Warranty till', 'Status', 'Held by', 'Actions'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {assets.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono text-[13px]">{a.asset_tag}</td>
                  <td className="px-4 py-3">{a.category || '—'}{a.is_it ? '' : ' (non-IT)'}</td>
                  <td className="px-4 py-3">{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[12px]">{a.serial_no || '—'}</td>
                  <td className="px-4 py-3">{money(a.cost)}</td>
                  <td className="px-4 py-3 text-ink-faint">{fmtDate(iso(a.warranty_expiry))}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[a.status] || 'bg-slate-100'}`}>{label(a.status)}</span></td>
                  <td className="px-4 py-3">{a.employee_code ? <>{`${a.first_name || ''} ${a.last_name || ''} (${a.employee_code})`}<div className="text-xs text-ink-faint">since {fmtDate(iso(a.assigned_on || a.assigned_at))}{a.assigned_condition ? ` · ${label(a.assigned_condition)}` : ''}</div></> : '—'}</td>
                  <td className="px-4 py-3 space-x-3 whitespace-nowrap">
                    {a.status === 'assigned' && <button onClick={() => { setReturnFor(a); setRet({ condition: 'GOOD', status: 'in_stock', notes: '' }); setRetErr({}); }} className="text-brand-700 font-medium">Return</button>}
                    {a.status === 'in_stock' && <button onClick={() => openAssign(a)} className="text-brand-700 font-medium">Assign</button>}
                    <button onClick={() => openEdit(a)} className="text-ink-soft">Edit</button>
                    {!a.times_assigned && <button onClick={() => remove(a)} className="text-rose-600">Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add asset' : `Edit ${editing?.asset_tag || ''}`} size="lg"
        actions={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save asset'}</Button></>}>
        <div className="space-y-4">
          <ErrorSummary errors={formErr} />
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Asset tag" required error={formErr.assetTag}><Input value={form.assetTag} disabled={editing !== 'new'} maxLength={40} onChange={(e) => setF('assetTag', e.target.value)} placeholder="LT-0007" /></Field>
            <Field label="Category" error={formErr.category} hint={opts.categories?.length ? undefined : 'Add categories under Master data to get a dropdown'}>
              <MasterChoice list={opts.categories} value={form.category} onChange={(v) => setF('category', v)} placeholder="Laptop" masterName="Asset categories" />
            </Field>
            <Field label="Type"><Select value={form.isIt ? '1' : '0'} onChange={(e) => setF('isIt', e.target.value === '1')}><option value="1">IT asset</option><option value="0">Non-IT asset</option></Select></Field>
            <Field label="Brand" error={formErr.brand} hint={opts.brands?.length ? 'From the Brand Master' : 'Add brands under Master data › Brand Master to get a dropdown'}>
              <MasterChoice list={opts.brands} value={form.brand} onChange={(v) => setF('brand', v)} placeholder="Dell" masterName="Brand Master" />
            </Field>
            <Field label="Model" error={formErr.model}><Input value={form.model} maxLength={80} onChange={(e) => setF('model', e.target.value)} /></Field>
            <Field label="Serial no." error={formErr.serialNo}><Input value={form.serialNo} maxLength={80} onChange={(e) => setF('serialNo', e.target.value)} /></Field>
            <Field label="Vendor" error={formErr.vendorId || formErr.vendor} hint={opts.vendors?.length ? 'Approved vendor registrations' : 'No approved vendor registrations yet'}>
              {opts.vendors?.length ? (
                <Select value={form.vendorId} onChange={(e) => setF('vendorId', e.target.value)}>
                  <option value="">Select…</option>{opts.vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              ) : <Input value={form.vendor} onChange={(e) => setF('vendor', e.target.value)} />}
            </Field>
            <Field label="Cost (₹)" error={formErr.cost}><Input inputMode="decimal" value={form.cost} onChange={(e) => setF('cost', e.target.value)} placeholder="50,000" /></Field>
            <Field label="Purchase date" error={formErr.purchaseDate}><Input type="date" max={todayIso()} value={form.purchaseDate} onChange={(e) => setF('purchaseDate', e.target.value)} /></Field>
            <Field label="Warranty expiry" error={formErr.warrantyExpiry}><Input type="date" min={form.purchaseDate || undefined} value={form.warrantyExpiry} onChange={(e) => setF('warrantyExpiry', e.target.value)} /></Field>
            <Field label="Invoice no." error={formErr.invoiceNo}><Input value={form.invoiceNo} maxLength={60} onChange={(e) => setF('invoiceNo', e.target.value)} /></Field>
            <Field label="Condition" error={formErr.condition}>
              <Select value={form.condition} onChange={(e) => setF('condition', e.target.value)}><option value="">—</option>{CONDITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
            </Field>
            {editing !== 'new' && editing?.status !== 'assigned' && (
              <Field label="Status" error={formErr.status}>
                <Select value={form.status} onChange={(e) => setF('status', e.target.value)}>{STATUSES.filter((s) => s !== 'assigned').map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
              </Field>
            )}
            {editing !== 'new' && editing?.status === 'assigned' && <p className="text-xs text-ink-faint self-end">Status: Assigned — record a return to change it.</p>}
          </div>
          <Field label="Notes" error={formErr.notes}><Textarea rows={2} maxLength={1000} value={form.notes} onChange={(e) => setF('notes', e.target.value)} /></Field>
        </div>
      </Modal>

      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title={`Assign ${assignFor?.asset_tag || ''}`}
        actions={<><Button variant="ghost" onClick={() => setAssignFor(null)}>Cancel</Button><Button onClick={doAssign} disabled={saving}>{saving ? 'Saving…' : 'Assign'}</Button></>}>
        <div className="space-y-4">
          <ErrorSummary errors={assignErr} />
          <Field label="Employee" required error={assignErr.employeeId}><SearchPicker value={assign.employeeId} onChange={(v) => { setAssign({ ...assign, employeeId: v }); setAssignErr({}); }} options={emps} getLabel={empLabel} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Assigned on" required error={assignErr.assignedOn}><Input type="date" max={todayIso()} min={iso(assignFor?.purchase_date) || undefined} value={assign.assignedOn} onChange={(e) => setAssign({ ...assign, assignedOn: e.target.value })} /></Field>
            <Field label="Condition at hand-over" required error={assignErr.condition}>
              <Select value={assign.condition} onChange={(e) => setAssign({ ...assign, condition: e.target.value })}>{CONDITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
            </Field>
          </div>
          <Field label="Notes" error={assignErr.notes}><Textarea rows={2} maxLength={500} value={assign.notes} onChange={(e) => setAssign({ ...assign, notes: e.target.value })} placeholder="Charger, bag…" /></Field>
        </div>
      </Modal>

      <Modal open={!!returnFor} onClose={() => setReturnFor(null)} title={`Return ${returnFor?.asset_tag || ''}`}
        actions={<><Button variant="ghost" onClick={() => setReturnFor(null)}>Cancel</Button><Button onClick={doReturn} disabled={saving}>{saving ? 'Saving…' : 'Record return'}</Button></>}>
        <div className="space-y-4">
          <ErrorSummary errors={retErr} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Condition on return" required error={retErr.condition}>
              <Select value={ret.condition} onChange={(e) => setRet({ ...ret, condition: e.target.value })}>{CONDITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
            </Field>
            <Field label="Asset goes to" error={retErr.status}>
              <Select value={ret.status} onChange={(e) => setRet({ ...ret, status: e.target.value })}>{['in_stock', 'repair', 'retired', 'lost'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
            </Field>
          </div>
          <Field label="Notes" error={retErr.notes}><Textarea rows={2} maxLength={500} value={ret.notes} onChange={(e) => setRet({ ...ret, notes: e.target.value })} placeholder="Missing charger, scratches…" /></Field>
        </div>
      </Modal>

      <Modal open={!!actFor} onClose={() => setActFor(null)} title={actFor ? `${actFor.status === 'APPROVED' ? 'Approve' : actFor.status === 'REJECTED' ? 'Reject' : 'Close'} request` : ''}
        actions={<><Button variant="ghost" onClick={() => setActFor(null)}>Cancel</Button><Button variant={actFor?.status === 'REJECTED' ? 'danger' : 'primary'} onClick={doAction} disabled={saving}>Confirm</Button></>}>
        <div className="space-y-3">
          <ErrorSummary errors={actErr} />
          {actFor && <p className="text-sm">{actFor.request.employeeName}: {REQ_KIND[actFor.request.kind]} — {actFor.request.details}</p>}
          {actFor?.status === 'APPROVED' && actFor.request.kind === 'REQUEST' && <p className="text-xs text-ink-faint">After approving, use Assign on an in-stock asset to hand it over.</p>}
          <Field label={actFor?.status === 'REJECTED' ? 'Reason' : 'Note to the employee'} required={actFor?.status === 'REJECTED'} error={actErr.note}>
            <Textarea rows={3} maxLength={500} value={actNote} onChange={(e) => { setActNote(e.target.value); setActErr({}); }} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
