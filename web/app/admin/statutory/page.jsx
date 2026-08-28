'use client';
import { useEffect, useState } from 'react';
import { api, getStoredAuth, downloadFile } from '@/lib/api.js';
import { Card, Button, Field, Input, Select, Modal, Spinner, Empty, SearchPicker } from '@/components/ui.jsx';

export default function StatutoryPage() {
  const [emps, setEmps] = useState([]);
  const [empId, setEmpId] = useState('');
  const [profile, setProfile] = useState(null);
  const [nominees, setNominees] = useState([]);
  const [msg, setMsg] = useState('');
  const [nomOpen, setNomOpen] = useState(false);
  const [nom, setNom] = useState({ scheme: 'PF', name: '', relation: '', sharePct: '' });

  useEffect(() => { api.get('/admin/employees').then((r) => setEmps(Array.isArray(r) ? r : [])).catch(() => {}); }, []);
  const empLabel = (e) => `${e.first_name || ''} ${e.last_name || ''} (${e.employee_code || e.id})`.trim();

  function loadProfile(id) {
    if (!id) { setProfile(null); setNominees([]); return; }
    api.get(`/admin/employees/${id}/statutory`).then((r) => { setProfile(r.profile || {}); setNominees(r.nominees || []); }).catch((e) => setMsg(e.message));
  }
  useEffect(() => { loadProfile(empId); /* eslint-disable-next-line */ }, [empId]);

  async function saveProfile() {
    try { await api.put(`/admin/employees/${empId}/statutory`, profile); setMsg('Saved.'); }
    catch (e) { setMsg(e.message); }
  }
  async function addNominee() {
    try { await api.post(`/admin/employees/${empId}/statutory/nominees`, nom); setNomOpen(false); setNom({ scheme: 'PF', name: '', relation: '', sharePct: '' }); loadProfile(empId); }
    catch (e) { setMsg(e.message); }
  }
  async function delNominee(id) { await api.del(`/admin/statutory/nominees/${id}`); loadProfile(empId); }
  function form16() {
    const auth = getStoredAuth();
    fetch(`/api/admin/reports/form16/${empId}`, { headers: { Authorization: `Bearer ${auth?.token}` } })
      .then((r) => r.ok && r.blob()).then((b) => b && window.open(URL.createObjectURL(b), '_blank'));
  }
  const p = profile || {};
  const set = (k, v) => setProfile({ ...p, [k]: v });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Statutory records</h1>
        <p className="text-ink-faint text-sm mt-0.5">PF / ESIC / gratuity identifiers and nominations, plus statutory registers and Form 16.</p>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}

      <Card className="p-5">
        <div className="flex gap-3 items-end flex-wrap">
          <div className="w-80"><Field label="Employee"><SearchPicker value={empId} onChange={setEmpId} options={emps} getLabel={empLabel} /></Field></div>
          <Button variant="outline" onClick={() => downloadFile('/admin/reports/pf-register?format=csv', 'pf-register.csv')}>PF register (CSV)</Button>
          <Button variant="outline" onClick={() => downloadFile('/admin/reports/esic-register?format=csv', 'esic-register.csv')}>ESIC register (CSV)</Button>
        </div>
      </Card>

      {empId && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-ink">Identifiers</h2>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={form16}>Form 16 PDF</Button><Button size="sm" onClick={saveProfile}>Save</Button></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="UAN"><Input value={p.uan || ''} onChange={(e) => set('uan', e.target.value)} /></Field>
            <Field label="PF number"><Input value={p.pf_number || ''} onChange={(e) => set('pf_number', e.target.value)} /></Field>
            <Field label="Pension number"><Input value={p.pension_number || ''} onChange={(e) => set('pension_number', e.target.value)} /></Field>
            <Field label="ESIC number"><Input value={p.esic_number || ''} onChange={(e) => set('esic_number', e.target.value)} /></Field>
            <Field label="ESIC dispensary"><Input value={p.esic_dispensary || ''} onChange={(e) => set('esic_dispensary', e.target.value)} /></Field>
            <Field label="PF join date"><Input type="date" value={(p.pf_join_date || '').slice(0, 10)} onChange={(e) => set('pf_join_date', e.target.value)} /></Field>
          </div>

          <div className="flex items-center justify-between pt-2">
            <h2 className="font-bold text-ink">Nominees</h2>
            <Button size="sm" variant="soft" onClick={() => setNomOpen(true)}>Add nominee</Button>
          </div>
          {nominees.length === 0 ? <p className="text-sm text-ink-faint">No nominees recorded.</p> : (
            <table className="w-full text-sm">
              <thead className="text-ink-faint border-b border-line"><tr>{['Scheme', 'Name', 'Relation', 'Share %', ''].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {nominees.map((n) => (
                  <tr key={n.id}><td className="px-3 py-2">{n.scheme}</td><td className="px-3 py-2">{n.name}</td><td className="px-3 py-2">{n.relation || '—'}</td><td className="px-3 py-2">{n.share_pct}</td>
                    <td className="px-3 py-2"><button onClick={() => delNominee(n.id)} className="text-rose-600">Remove</button></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Modal open={nomOpen} onClose={() => setNomOpen(false)} title="Add nominee"
        actions={<><Button variant="ghost" onClick={() => setNomOpen(false)}>Cancel</Button><Button onClick={addNominee}>Add</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Scheme"><Select value={nom.scheme} onChange={(e) => setNom({ ...nom, scheme: e.target.value })}>{['PF', 'GRATUITY', 'ESIC', 'PENSION'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Share %"><Input type="number" value={nom.sharePct} onChange={(e) => setNom({ ...nom, sharePct: e.target.value })} /></Field>
          <Field label="Name" required><Input value={nom.name} onChange={(e) => setNom({ ...nom, name: e.target.value })} /></Field>
          <Field label="Relation"><Input value={nom.relation} onChange={(e) => setNom({ ...nom, relation: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
