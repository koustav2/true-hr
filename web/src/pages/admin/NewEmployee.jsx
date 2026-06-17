import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Card, Button, Input, Select, Field, Spinner } from '../../components/ui.jsx';

export default function NewEmployee() {
  const nav = useNavigate();
  const [meta, setMeta] = useState({ departments: [], designations: [], managers: [] });
  const [f, setF] = useState({
    firstName: '', lastName: '', personalEmail: '', officialEmail: '', phone: '', dob: '', gender: '',
    departmentId: '', designationId: '', reportingManagerId: '', functionManagerId: '',
    dateOfJoining: '', employmentType: 'FULL_TIME', ctc: '',
  });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([api.get('/meta/departments'), api.get('/meta/designations'), api.get('/meta/managers')])
      .then(([departments, designations, managers]) => setMeta({ departments, designations, managers }))
      .catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true);
    try {
      const payload = { ...f, ctc: f.ctc ? Number(f.ctc) : null };
      ['departmentId','designationId','reportingManagerId','functionManagerId','dob','dateOfJoining']
        .forEach((k) => { if (!payload[k]) payload[k] = null; });
      const { employee } = await api.post('/employees', payload);
      nav(`/admin/employees/${employee.id}`, { state: { justCreated: true } });
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link to="/admin/employees" className="text-sm text-brand-600">← Employees</Link>
        <h1 className="text-2xl font-bold text-ink mt-1">Onboard a new employee</h1>
        <p className="text-ink-faint text-sm">HR fills the core details. On submit, an offer email with an acceptance link is sent to the employee's personal email automatically.</p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <Card className="p-6">
          <h2 className="font-semibold text-ink mb-4">Personal details</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="First name" required><Input value={f.firstName} onChange={set('firstName')} required /></Field>
            <Field label="Last name" required><Input value={f.lastName} onChange={set('lastName')} required /></Field>
            <Field label="Personal email" required hint="Offer link is sent here"><Input type="email" value={f.personalEmail} onChange={set('personalEmail')} required /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
            <Field label="Date of birth"><Input type="date" value={f.dob} onChange={set('dob')} /></Field>
            <Field label="Gender">
              <Select value={f.gender} onChange={set('gender')}>
                <option value="">Select…</option><option>Female</option><option>Male</option><option>Other</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-ink mb-4">Role & reporting</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Official email" required><Input type="email" value={f.officialEmail} onChange={set('officialEmail')} required /></Field>
            <Field label="Department">
              <Select value={f.departmentId} onChange={set('departmentId')}>
                <option value="">Select…</option>
                {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Designation">
              <Select value={f.designationId} onChange={set('designationId')}>
                <option value="">Select…</option>
                {meta.designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </Select>
            </Field>
            <Field label="Employment type">
              <Select value={f.employmentType} onChange={set('employmentType')}>
                <option value="FULL_TIME">Full time</option><option value="PART_TIME">Part time</option>
                <option value="CONTRACT">Contract</option><option value="INTERN">Intern</option>
              </Select>
            </Field>
            <Field label="Reporting manager">
              <Select value={f.reportingManagerId} onChange={set('reportingManagerId')}>
                <option value="">Select…</option>
                {meta.managers.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </Select>
            </Field>
            <Field label="Function manager">
              <Select value={f.functionManagerId} onChange={set('functionManagerId')}>
                <option value="">Select…</option>
                {meta.managers.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </Select>
            </Field>
            <Field label="Date of joining"><Input type="date" value={f.dateOfJoining} onChange={set('dateOfJoining')} /></Field>
            <Field label="Annual CTC (₹)"><Input type="number" value={f.ctc} onChange={set('ctc')} placeholder="e.g. 1200000" /></Field>
          </div>
        </Card>

        {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>{saving ? <Spinner /> : 'Submit & send offer'}</Button>
          <Button as={Link} to="/admin/employees" variant="outline">Cancel</Button>
        </div>
      </form>
    </div>
  );
}
