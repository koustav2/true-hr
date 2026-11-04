'use client';
import { useEffect, useState } from 'react';
import { api, downloadFile, openFile } from '@/lib/api.js';
import { label, todayIso, fmtDate } from '@/lib/labels.js';
import { validator } from '@/lib/validate.js';
import { Card, Button, Field, Input, Select, Modal, Badge, SearchPicker, ErrorSummary, useConfirm } from '@/components/ui.jsx';

const SCHEMES = ['PF', 'GRATUITY', 'ESIC', 'PENSION'];
const RELATIONS = ['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'];
const BLANK_NOM = { scheme: 'PF', name: '', relation: '', sharePct: '', dateOfBirth: '' };

export default function StatutoryPage() {
  const [confirm, confirmUi] = useConfirm();
  const [emps, setEmps] = useState([]);
  const [empId, setEmpId] = useState('');
  const [profile, setProfile] = useState(null);
  const [nominees, setNominees] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [errors, setErrors] = useState({});
  const [nomOpen, setNomOpen] = useState(false);
  const [nom, setNom] = useState(BLANK_NOM);
  const [nomErrors, setNomErrors] = useState({});

  // H81: joined, active employees only, shown with their employee ID.
  useEffect(() => { api.get('/admin/statutory/employees').then((r) => setEmps(Array.isArray(r) ? r : [])).catch((e) => setErr(e.message)); }, []);
  const empLabel = (e) => `${e.name} (${e.code})`;

  function loadProfile(id) {
    setErrors({}); setMsg(''); setErr('');
    if (!id) { setProfile(null); setNominees([]); return; }
    api.get(`/admin/employees/${id}/statutory`).then((r) => { setProfile(r.profile || {}); setNominees(r.nominees || []); }).catch((e) => setErr(e.message));
  }
  useEffect(() => { loadProfile(empId); /* eslint-disable-next-line */ }, [empId]);

  const p = profile || {};
  const set = (k, v) => setProfile({ ...p, [k]: v });

  async function saveProfile() {
    const v = validator();
    v.pattern('uan', p.uan, 'uan', 'UAN');
    v.pattern('pfNumber', p.pf_number, 'pf', 'PF number');
    v.pattern('esicNumber', p.esic_number, 'esic', 'ESIC number');
    v.date('pfJoinDate', p.pf_join_date, 'PF join date', { max: todayIso() });
    setErrors(v.fields); setMsg(''); setErr('');
    if (!v.ok) return;
    try {
      await api.put(`/admin/employees/${empId}/statutory`, {
        uan: p.uan || null, pfNumber: p.pf_number || null, esicNumber: p.esic_number || null, pensionNumber: p.pension_number || null,
        esicDispensary: p.esic_dispensary || null, pfJoinDate: p.pf_join_date || null,
      });
      setMsg('Saved. The employee\'s Bank & statutory card shows the same identifiers.'); loadProfile(empId);
    } catch (e) { setErrors(e.fields || {}); setErr(e.message); }
  }

  const usedShare = (scheme) => nominees.filter((n) => n.scheme === scheme).reduce((a, n) => a + Number(n.share_pct || 0), 0);
  async function addNominee() {
    const v = validator();
    v.name('name', nom.name, 'Nominee name', { required: true });
    v.require('relation', nom.relation, 'Relation');
    v.number('sharePct', nom.sharePct, 'Share %', { required: true, min: 0.01, max: 100 });
    if (!v.fields.sharePct && usedShare(nom.scheme) + Number(nom.sharePct) > 100) v.add('sharePct', `${nom.scheme} nominees would total ${usedShare(nom.scheme) + Number(nom.sharePct)}% — only ${100 - usedShare(nom.scheme)}% is left`);
    v.date('dateOfBirth', nom.dateOfBirth, 'Date of birth', { max: todayIso(), maxMsg: 'Date of birth must be in the past' });
    setNomErrors(v.fields);
    if (!v.ok) return;
    try {
      await api.post(`/admin/employees/${empId}/statutory/nominees`, { ...nom, dateOfBirth: nom.dateOfBirth || null });
      setNomOpen(false); setNom(BLANK_NOM); loadProfile(empId);
    } catch (e) { setNomErrors(e.fields || { form: e.message }); }
  }
  async function delNominee(n) {
    if (!(await confirm({ title: `Remove ${n.name}?`, body: `${label(n.scheme)} nominee, ${n.share_pct}% share. The remaining shares should be adjusted to total 100%.`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try { await api.del(`/admin/statutory/nominees/${n.id}`); loadProfile(empId); } catch (e) { setErr(e.message); }
  }
  const form16 = () => openFile(`/admin/reports/form16/${empId}`).catch((e) => setErr(e.message));

  return (
    <div className="space-y-5">
      {confirmUi}
      <div>
        <h1 className="page-title text-ink">Statutory records</h1>
        {/* H82: there are no separate gratuity identifiers; gratuity is a nomination. */}
        <p className="text-ink-faint text-sm mt-0.5">UAN, PF and ESIC identifiers and nominations (PF, gratuity, ESIC, pension), plus the PF / ESIC registers and Form 16.</p>
      </div>
      {msg && <p className="text-sm text-pos">{msg}</p>}
      {err && <p className="text-sm text-neg">{err}</p>}

      <Card className="p-5">
        <div className="flex gap-3 items-end flex-wrap">
          <div className="w-80"><Field label="Employee" hint="Active employees only"><SearchPicker value={empId} onChange={setEmpId} options={emps} getLabel={empLabel} /></Field></div>
          <Button variant="outline" onClick={() => downloadFile('/admin/reports/pf-register?format=csv', 'pf-register.csv').catch((e) => setErr(e.message))}>PF register (CSV)</Button>
          <Button variant="outline" onClick={() => downloadFile('/admin/reports/esic-register?format=csv', 'esic-register.csv').catch((e) => setErr(e.message))}>ESIC register (CSV)</Button>
        </div>
      </Card>

      {empId && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-ink">Identifiers</h2>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={form16}>Form 16 PDF</Button><Button size="sm" onClick={saveProfile}>Save</Button></div>
          </div>
          <ErrorSummary errors={errors} />
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="UAN" error={errors.uan} hint="12 digits"><Input inputMode="numeric" maxLength={12} value={p.uan || ''} onChange={(e) => set('uan', e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="PF number" error={errors.pfNumber} hint="e.g. MHBAN00123450000123456"><Input value={p.pf_number || ''} onChange={(e) => set('pf_number', e.target.value.toUpperCase().replace(/\s/g, ''))} /></Field>
            <Field label="Pension number" error={errors.pensionNumber}><Input value={p.pension_number || ''} onChange={(e) => set('pension_number', e.target.value)} /></Field>
            <Field label="ESIC number" error={errors.esicNumber} hint="17 digits"><Input inputMode="numeric" maxLength={17} value={p.esic_number || ''} onChange={(e) => set('esic_number', e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="ESIC dispensary" error={errors.esicDispensary}><Input value={p.esic_dispensary || ''} onChange={(e) => set('esic_dispensary', e.target.value)} /></Field>
            <Field label="PF join date" error={errors.pfJoinDate}><Input type="date" max={todayIso()} value={(p.pf_join_date || '').slice(0, 10)} onChange={(e) => set('pf_join_date', e.target.value)} /></Field>
          </div>

          <div className="flex items-center justify-between pt-2">
            <h2 className="font-bold text-ink">Nominees</h2>
            <Button size="sm" variant="soft" onClick={() => { setNom(BLANK_NOM); setNomErrors({}); setNomOpen(true); }}>Add nominee</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {SCHEMES.filter((s) => nominees.some((n) => n.scheme === s)).map((s) => {
              const t = usedShare(s);
              return <Badge key={s} tone={Math.abs(t - 100) < 0.01 ? 'ok' : 'warn'}>{label(s)}: {t}%{Math.abs(t - 100) < 0.01 ? '' : ' — must total 100%'}</Badge>;
            })}
          </div>
          {nominees.length === 0 ? <p className="text-sm text-ink-faint">No nominees recorded.</p> : (
            <table className="w-full text-sm">
              <thead className="text-ink-faint border-b border-line"><tr>{['Scheme', 'Name', 'Relation', 'Date of birth', 'Share %', ''].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {nominees.map((n) => (
                  <tr key={n.id}><td className="px-3 py-2">{label(n.scheme)}</td><td className="px-3 py-2">{n.name}</td><td className="px-3 py-2">{n.relation || '—'}</td>
                    <td className="px-3 py-2">{fmtDate(n.date_of_birth ? String(n.date_of_birth).slice(0, 10) : null)}</td><td className="px-3 py-2">{n.share_pct}</td>
                    <td className="px-3 py-2 text-right"><button onClick={() => delNominee(n)} className="text-rose-600">Remove</button></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Modal open={nomOpen} onClose={() => setNomOpen(false)} title="Add nominee"
        actions={<><Button variant="ghost" onClick={() => setNomOpen(false)}>Cancel</Button><Button onClick={addNominee}>Add</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><ErrorSummary errors={nomErrors} /></div>
          <Field label="Scheme"><Select value={nom.scheme} onChange={(e) => setNom({ ...nom, scheme: e.target.value })}>{SCHEMES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
          <Field label="Share %" required error={nomErrors.sharePct} hint={`${100 - usedShare(nom.scheme)}% of ${label(nom.scheme)} left`}><Input inputMode="decimal" value={nom.sharePct} onChange={(e) => setNom({ ...nom, sharePct: e.target.value })} /></Field>
          <Field label="Name" required error={nomErrors.name}><Input value={nom.name} onChange={(e) => setNom({ ...nom, name: e.target.value })} /></Field>
          <Field label="Relation" required error={nomErrors.relation}><Select value={nom.relation} onChange={(e) => setNom({ ...nom, relation: e.target.value })}><option value="">— choose —</option>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <Field label="Date of birth" error={nomErrors.dateOfBirth}><Input type="date" max={todayIso()} value={nom.dateOfBirth} onChange={(e) => setNom({ ...nom, dateOfBirth: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
