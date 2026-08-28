'use client';
import { useEffect, useState } from 'react';
import { api, getStoredAuth } from '@/lib/api.js';
import { Card, Button, Field, Input, Textarea, Select, Modal, Spinner, Empty, SearchPicker } from '@/components/ui.jsx';

export default function LettersPage() {
  const [types, setTypes] = useState(null);
  const [issued, setIssued] = useState([]);
  const [emps, setEmps] = useState([]);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [empId, setEmpId] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [preview, setPreview] = useState(null);
  const [extra, setExtra] = useState({});

  const load = () => {
    api.get('/admin/letters/types').then((r) => setTypes(r)).catch(() => setTypes({ builtin: [], custom: [] }));
    api.get('/admin/letters/issued').then((r) => setIssued(r.letters || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { api.get('/admin/employees').then((r) => setEmps(Array.isArray(r) ? r : [])).catch(() => {}); }, []);

  const empLabel = (e) => `${e.first_name || ''} ${e.last_name || ''} (${e.employee_code || e.id})`.trim();
  const allTypes = types ? [...(types.builtin || []), ...(types.custom || [])] : [];
  const chosen = allTypes.find((t) => t.code === typeCode);
  const fields = (chosen?.fields || []).filter((f) => !['employeeName', 'companyName', 'designation', 'department', 'dateOfJoining', 'employeeCode'].includes(f));

  async function issue() {
    if (!empId || !typeCode) { setMsg('Pick an employee and a letter type.'); return; }
    try {
      const r = await api.post('/admin/letters/issue', { employeeId: Number(empId), typeCode, data: extra });
      setPreview(r); load();
    } catch (e) { setMsg(e.message); }
  }
  async function openPdf(id) {
    const auth = getStoredAuth();
    const res = await fetch(`/api/admin/letters/${id}/pdf`, { headers: { Authorization: `Bearer ${auth?.token}` } });
    if (res.ok) window.open(URL.createObjectURL(await res.blob()), '_blank');
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Letters</h1>
          <p className="text-ink-faint text-sm mt-0.5">Issue confirmation, transfer, promotion, experience, relieving and other letters from templates.</p>
        </div>
        <Button onClick={() => { setOpen(true); setPreview(null); setMsg(''); }}>Issue a letter</Button>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <Card className="overflow-hidden">
        {types === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : issued.length === 0 ? <Empty title="No letters issued yet" subtitle="Issue your first letter — it is saved here with a reference number." />
          : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['Ref', 'Type', 'Title', 'Employee', 'Issued', ''].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {issued.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono text-[12px]">{l.ref_no}</td>
                  <td className="px-4 py-3">{l.type_code}</td>
                  <td className="px-4 py-3">{l.title}</td>
                  <td className="px-4 py-3">{`${l.first_name || ''} ${l.last_name || ''} (${l.employee_code || ''})`}</td>
                  <td className="px-4 py-3 text-ink-faint">{String(l.issued_at).slice(0, 10)}</td>
                  <td className="px-4 py-3"><button onClick={() => openPdf(l.id)} className="text-brand-700 font-medium">PDF</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Issue a letter" size="lg"
        actions={<><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button><Button onClick={issue}>Generate</Button></>}>
        <div className="space-y-4">
          <Field label="Employee"><SearchPicker value={empId} onChange={setEmpId} options={emps} getLabel={empLabel} /></Field>
          <Field label="Letter type">
            <Select value={typeCode} onChange={(e) => { setTypeCode(e.target.value); setExtra({}); }}>
              <option value="">Select a type…</option>
              {allTypes.map((t) => <option key={t.code} value={t.code}>{t.title}{t.custom ? ' (custom)' : ''}</option>)}
            </Select>
          </Field>
          {fields.map((f) => (
            <Field key={f} label={f.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}>
              <Input value={extra[f] || ''} onChange={(e) => setExtra({ ...extra, [f]: e.target.value })} />
            </Field>
          ))}
          {preview && (
            <div className="rounded-xl border border-line bg-slate-50 p-4">
              <div className="text-[13px] font-semibold text-ink mb-1">{preview.title} · {preview.letter?.ref_no}</div>
              {preview.missing?.length > 0 && <div className="text-xs text-amber-700 mb-2">Missing: {preview.missing.join(', ')}</div>}
              <pre className="whitespace-pre-wrap text-[12px] text-ink-soft font-sans">{preview.text}</pre>
              <div className="mt-3"><Button size="sm" onClick={() => openPdf(preview.letter.id)}>Download PDF</Button></div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
