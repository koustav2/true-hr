'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Field, Input, Select, Modal, Spinner, Empty, SearchPicker, ConfirmClick } from '@/components/ui.jsx';

const STATUS_STYLES = {
  in_stock: 'bg-slate-100 text-ink-soft', assigned: 'bg-brand-50 text-brand-700',
  repair: 'bg-amber-50 text-amber-700', retired: 'bg-slate-100 text-ink-faint', lost: 'bg-rose-50 text-rose-600',
};

export default function AssetsPage() {
  const [assets, setAssets] = useState(null);
  const [emps, setEmps] = useState([]);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [msg, setMsg] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [assignFor, setAssignFor] = useState(null); // asset row
  const [assignEmp, setAssignEmp] = useState('');
  const [form, setForm] = useState({ assetTag: '', category: '', isIt: true, brand: '', model: '', serialNo: '', vendor: '', cost: '' });

  const load = () => {
    const p = new URLSearchParams();
    if (statusF) p.set('status', statusF);
    if (q) p.set('q', q);
    return api.get('/admin/assets?' + p.toString()).then((r) => setAssets(r.assets || [])).catch((e) => { setMsg(e.message); setAssets([]); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusF]);
  useEffect(() => { api.get('/admin/employees').then((r) => setEmps(Array.isArray(r) ? r : (r.employees || []))).catch(() => {}); }, []);

  const empLabel = (e) => `${e.first_name || ''} ${e.last_name || ''} (${e.employee_code || e.id})`.trim();

  async function create() {
    if (!form.assetTag) { setMsg('Asset tag is required.'); return; }
    try { await api.post('/admin/assets', form); setAddOpen(false); setForm({ assetTag: '', category: '', isIt: true, brand: '', model: '', serialNo: '', vendor: '', cost: '' }); setMsg(''); load(); }
    catch (e) { setMsg(e.message); }
  }
  async function assign() {
    if (!assignEmp) { setMsg('Pick an employee.'); return; }
    try { await api.post(`/admin/assets/${assignFor.id}/assign`, { employeeId: Number(assignEmp) }); setAssignFor(null); setAssignEmp(''); load(); }
    catch (e) { setMsg(e.message); }
  }
  async function ret(a) { try { await api.post(`/admin/assets/${a.id}/return`, {}); load(); } catch (e) { setMsg(e.message); } }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Asset Management</h1>
          <p className="text-ink-faint text-sm mt-0.5">IT &amp; non-IT assets — register, assign to employees, and record returns.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>Add asset</Button>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <div className="flex gap-2 flex-wrap">
        <Input placeholder="Search tag / serial / model…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()} className="w-64" />
        <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {['in_stock', 'assigned', 'repair', 'retired', 'lost'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Button variant="outline" onClick={load}>Search</Button>
      </div>

      <Card className="overflow-hidden">
        {assets === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : assets.length === 0 ? <Empty title="No assets yet" subtitle="Add your first asset to start tracking." />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>{['Tag', 'Category', 'Make / Model', 'Serial', 'Status', 'Held by', 'Actions'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {assets.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono text-[13px]">{a.asset_tag}</td>
                  <td className="px-4 py-3">{a.category || '—'}{a.is_it ? '' : ' (non-IT)'}</td>
                  <td className="px-4 py-3">{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[12px]">{a.serial_no || '—'}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[a.status] || 'bg-slate-100'}`}>{String(a.status).replace('_', ' ')}</span></td>
                  <td className="px-4 py-3">{a.employee_code ? `${a.first_name || ''} ${a.last_name || ''} (${a.employee_code})` : '—'}</td>
                  <td className="px-4 py-3">
                    {a.status === 'assigned'
                      ? <ConfirmClick onConfirm={() => ret(a)} className="text-sm text-brand-700 font-medium" confirmLabel="Confirm return">Return</ConfirmClick>
                      : (a.status === 'in_stock' ? <button onClick={() => { setAssignFor(a); setAssignEmp(''); }} className="text-sm text-brand-700 font-medium">Assign</button> : <span className="text-ink-faint text-sm">—</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add asset" size="lg"
        actions={<><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={create}>Save asset</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Asset tag" required><Input value={form.assetTag} onChange={(e) => setForm({ ...form, assetTag: e.target.value })} placeholder="LT-0007" /></Field>
          <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Laptop" /></Field>
          <Field label="Type"><Select value={form.isIt ? '1' : '0'} onChange={(e) => setForm({ ...form, isIt: e.target.value === '1' })}><option value="1">IT asset</option><option value="0">Non-IT asset</option></Select></Field>
          <Field label="Brand"><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
          <Field label="Model"><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
          <Field label="Serial no."><Input value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} /></Field>
          <Field label="Vendor"><Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></Field>
          <Field label="Cost (INR)"><Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title={`Assign ${assignFor?.asset_tag || ''}`}
        actions={<><Button variant="ghost" onClick={() => setAssignFor(null)}>Cancel</Button><Button onClick={assign}>Assign</Button></>}>
        <Field label="Employee"><SearchPicker value={assignEmp} onChange={setAssignEmp} options={emps} getLabel={empLabel} /></Field>
      </Modal>
    </div>
  );
}
