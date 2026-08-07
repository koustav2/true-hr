'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { Button, Input, Select, Field, Spinner, SearchPicker } from '@/components/ui.jsx';
import SectionCard from '@/components/SectionCard.jsx';
import PdfDropzone from '@/components/PdfDropzone.jsx';
import { IconArrowLeft, IconUser, IconBriefcase, IconFile } from '@/components/icons.jsx';

export default function NewEmployeePage() {
  const router = useRouter();
  const [meta, setMeta] = useState({ departments: [], designations: [], managers: [], companies: [] });
  const [offerLetter, setOfferLetter] = useState(null);
  const [autoOffer, setAutoOffer] = useState(true);
  const [ctc, setCtc] = useState('');
  const [f, setF] = useState({
    firstName: '', lastName: '', personalEmail: '', officialEmail: '', phone: '', dob: '', gender: '',
    companyId: '', departmentId: '', designationId: '', reportingManagerId: '', functionManagerId: '',
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

  // Load each list independently so one failing request can't blank the others.
  const load = (path, key) => api.get(path)
    .then((rows) => setMeta((m) => ({ ...m, [key]: rows || [] })))
    .catch((e) => { console.error(`meta ${path} failed:`, e.message); setMetaErr(e.message); });

  useEffect(() => {
    load('/meta/managers', 'managers');
    // An organisation may run several companies. Default to the first, and only
    // show the picker when there is genuinely a choice to make.
    api.get('/meta/companies')
      .then((rows) => {
        const list = rows || [];
        setMeta((m) => ({ ...m, companies: list }));
        if (list.length && !f.companyId) setF((p) => ({ ...p, companyId: String(list[0].id) }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Departments and designations belong to a company, so refetch them whenever
  // the chosen company changes — otherwise a group's entities would mix.
  useEffect(() => {
    const q = f.companyId ? `?companyId=${f.companyId}` : '';
    load(`/meta/departments${q}`, 'departments');
    load(`/meta/designations${q}`, 'designations');
    // Clear selections that belong to the previous company.
    setF((p) => ({ ...p, departmentId: '', designationId: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.companyId]);

  async function submit(e) {
    e.preventDefault();
    if (!/^[A-Za-z .'-]+$/.test(f.firstName || '') || !/^[A-Za-z .'-]+$/.test(f.lastName || '')) { setErr('Employee name can contain letters only.'); return; }
    if (f.phone && !/^\d{10}$/.test(f.phone)) { setErr('Mobile number must be exactly 10 digits.'); return; }
    setErr(''); setSaving(true);
    try {
      const payload = { ...f };
      ['departmentId','designationId','reportingManagerId','functionManagerId','dob','dateOfJoining']
        .forEach((k) => { if (!payload[k]) payload[k] = null; });
      if (offerLetter) payload.offerLetter = { name: offerLetter.name, dataUrl: offerLetter.dataUrl };
      if (!offerLetter && autoOffer && ctc) { payload.autoOfferLetter = true; payload.ctc = Number(ctc); }
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
          {/* Only worth asking when the organisation actually runs more than one
              legal entity; the employee ID prefix comes from this choice. */}
          {meta.companies.length > 1 && (
            <Field label="Company" required hint="Which legal entity this person joins — sets their employee ID prefix">
              <Select value={f.companyId} onChange={set('companyId')}>
                {meta.companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.codePrefix})</option>
                ))}
              </Select>
            </Field>
          )}
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
          <Field label="Reporting manager" hint="Optional — search by name or Employee ID">
            <SearchPicker value={f.reportingManagerId} onChange={(v) => setF((x) => ({ ...x, reportingManagerId: v }))}
              options={meta.managers} getLabel={mgrLabel} />
          </Field>
          <Field label="Functional manager" hint="Optional — search by name or Employee ID">
            <SearchPicker value={f.functionManagerId} onChange={(v) => setF((x) => ({ ...x, functionManagerId: v }))}
              options={meta.managers} getLabel={mgrLabel} />
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

      <SectionCard Icon={IconFile} title="Offer letter" subtitle="Attach a signed PDF, or let the system generate the Offer Letter + Annexure A automatically and attach it to the offer email.">
        <div className="space-y-4">
          <PdfDropzone value={offerLetter} onChange={setOfferLetter} />
          {!offerLetter && (
            <div className="rounded-xl border border-line bg-slate-50/60 p-4 space-y-3">
              <label className="flex items-center gap-2.5 text-sm font-medium text-ink cursor-pointer">
                <input type="checkbox" checked={autoOffer} onChange={(e) => setAutoOffer(e.target.checked)} className="h-4 w-4 accent-brand-600" />
                Auto-generate Offer Letter + Annexure A for this employee
              </label>
              {autoOffer && (
                <Field label="Annual CTC (₹)" required hint="Needed for the Annexure A compensation sheet">
                  <Input type="number" value={ctc} onChange={(e) => setCtc(e.target.value)} placeholder="e.g. 600000" className="max-w-[240px]" required />
                </Field>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? <Spinner /> : 'Submit & send offer'}</Button>
        <Button as={Link} href="/admin/employees" variant="outline">Cancel</Button>
      </div>
    </form>
  );
}
