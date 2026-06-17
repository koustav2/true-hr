'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { Button, Input, Select, Field, Spinner } from '@/components/ui.jsx';
import SectionCard from '@/components/SectionCard.jsx';
import PdfDropzone from '@/components/PdfDropzone.jsx';
import { IconArrowLeft, IconUser, IconBriefcase, IconFile } from '@/components/icons.jsx';

export default function NewEmployeePage() {
  const router = useRouter();
  const [meta, setMeta] = useState({ departments: [], designations: [], managers: [] });
  const [offerLetter, setOfferLetter] = useState(null);
  const [f, setF] = useState({
    firstName: '', lastName: '', personalEmail: '', officialEmail: '', phone: '', dob: '', gender: '',
    departmentId: '', designationId: '', reportingManagerId: '', functionManagerId: '',
    dateOfJoining: '', employmentType: 'FULL_TIME', location: '',
  });
  const mgrLabel = (m) => `${m.first_name} ${m.last_name}${m.employee_code ? ` · ${m.employee_code}` : ''}${m.designation ? ` (${m.designation})` : ''}`;
  // Scope each manager picker to its role (falls back to all if none match).
  const managersBy = (kw) => {
    const list = meta.managers.filter((m) => (m.designation || '').toLowerCase().includes(kw));
    return list.length ? list : meta.managers;
  };
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const [metaErr, setMetaErr] = useState('');
  useEffect(() => {
    // Load each list independently so one failing request can't blank the others.
    const load = (path, key) => api.get(path)
      .then((rows) => setMeta((m) => ({ ...m, [key]: rows || [] })))
      .catch((e) => { console.error(`meta ${path} failed:`, e.message); setMetaErr(e.message); });
    load('/meta/departments', 'departments');
    load('/meta/designations', 'designations');
    load('/meta/managers', 'managers');
  }, []);

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true);
    try {
      const payload = { ...f };
      ['departmentId','designationId','reportingManagerId','functionManagerId','dob','dateOfJoining']
        .forEach((k) => { if (!payload[k]) payload[k] = null; });
      if (offerLetter) payload.offerLetter = { name: offerLetter.name, dataUrl: offerLetter.dataUrl };
      const { employee } = await api.post('/employees', payload);
      router.push(`/admin/employees/${employee.id}?created=1`);
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  const grid = 'grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4';

  return (
    <form onSubmit={submit} className="w-full space-y-6 pb-4">
      {/* Header / action bar */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin/employees" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-brand-700"><IconArrowLeft width={15} height={15} /> Employees</Link>
          <h1 className="text-[26px] font-bold text-ink tracking-tight mt-1.5">Onboard a new employee</h1>
          <p className="text-ink-faint text-sm max-w-2xl mt-0.5">HR fills the core details. On submit, an offer email with an acceptance link is sent to the employee's personal email automatically.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button as={Link} href="/admin/employees" variant="outline">Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? <Spinner /> : 'Submit & send offer'}</Button>
        </div>
      </div>

      {metaErr && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">Couldn't load dropdown options ({metaErr}). Make sure the backend is running and seeded, then reload.</div>}

      <SectionCard Icon={IconUser} title="Personal details" subtitle="Basic information about the new hire.">
        <div className={grid}>
          <Field label="First name" required><Input value={f.firstName} onChange={set('firstName')} required /></Field>
          <Field label="Last name" required><Input value={f.lastName} onChange={set('lastName')} required /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Personal email" required hint="The offer link is sent here"><Input type="email" value={f.personalEmail} onChange={set('personalEmail')} required /></Field>
          <Field label="Date of birth"><Input type="date" value={f.dob} onChange={set('dob')} /></Field>
          <Field label="Gender">
            <Select value={f.gender} onChange={set('gender')}>
              <option value="">Select…</option><option>Female</option><option>Male</option><option>Other</option>
            </Select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard Icon={IconBriefcase} title="Role & reporting" subtitle="Position, team and reporting lines.">
        <div className={grid}>
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
          <Field label="Reporting manager">
            <Select value={f.reportingManagerId} onChange={set('reportingManagerId')}>
              <option value="">Select…</option>
              {meta.managers.map((m) => <option key={m.id} value={m.id}>{mgrLabel(m)}</option>)}
            </Select>
          </Field>
          <Field label="Functional manager">
            <Select value={f.functionManagerId} onChange={set('functionManagerId')}>
              <option value="">Select…</option>
              {managersBy('functional').map((m) => <option key={m.id} value={m.id}>{mgrLabel(m)}</option>)}
            </Select>
          </Field>
          <Field label="Employment type">
            <Select value={f.employmentType} onChange={set('employmentType')}>
              <option value="FULL_TIME">Full time</option><option value="PART_TIME">Part time</option>
              <option value="CONTRACT">Contract</option><option value="INTERN">Intern</option>
            </Select>
          </Field>
          <Field label="Date of joining"><Input type="date" value={f.dateOfJoining} onChange={set('dateOfJoining')} /></Field>
          <Field label="Location of joining"><Input value={f.location} onChange={set('location')} placeholder="e.g. Bengaluru, KA" /></Field>
        </div>
      </SectionCard>

      <SectionCard Icon={IconFile} title="Offer letter" subtitle="Optional — attach a signed offer letter (PDF). The new hire can view it on the acceptance page.">
        <PdfDropzone value={offerLetter} onChange={setOfferLetter} />
      </SectionCard>

      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? <Spinner /> : 'Submit & send offer'}</Button>
        <Button as={Link} href="/admin/employees" variant="outline">Cancel</Button>
      </div>
    </form>
  );
}
