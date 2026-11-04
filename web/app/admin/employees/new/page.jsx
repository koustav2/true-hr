'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, fetchBlob } from '@/lib/api.js';
import { toNumber } from '@/lib/validate.js';
import { Button, Input, Select, Field, Spinner, SearchPicker, ErrorSummary, Modal } from '@/components/ui.jsx';
import SectionCard from '@/components/SectionCard.jsx';
import PdfDropzone from '@/components/PdfDropzone.jsx';
import { IconArrowLeft, IconUser, IconBriefcase, IconFile } from '@/components/icons.jsx';
import { checkEmployee, dateBounds, mgrLabel } from '../rules.js';

export default function NewEmployeePage() {
  const router = useRouter();
  const [meta, setMeta] = useState({ departments: [], designations: [], managers: [], companies: [], branches: [] });
  const [offerLetter, setOfferLetter] = useState(null);
  const [autoOffer, setAutoOffer] = useState(true);
  const [f, setF] = useState({
    firstName: '', lastName: '', personalEmail: '', officialEmail: '', phone: '', dob: '', gender: '',
    companyId: '', departmentId: '', designationId: '', reportingManagerId: '', functionManagerId: '', operationalManagerId: '',
    dateOfJoining: '', employmentType: 'FULL_TIME', location: '', ctc: '',
  });
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);   // { url }
  const [previewBusy, setPreviewBusy] = useState(false);
  const set = (k) => (e) => { const val = e.target.value; setF((p) => ({ ...p, [k]: val })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const setV = (k) => (val) => { setF((p) => ({ ...p, [k]: val })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const bounds = dateBounds();

  const [metaErr, setMetaErr] = useState('');
  // Load each list independently so one failing request can't blank the others.
  const load = (path, key) => api.get(path)
    .then((rows) => setMeta((m) => ({ ...m, [key]: rows || [] })))
    .catch((e) => { setMetaErr(e.message); });

  useEffect(() => {
    load('/meta/managers', 'managers');
    // H14: the organisation's branches (Masters) make the location a dropdown.
    load('/meta/org-masters?kind=BRANCH', 'branches');
    api.get('/meta/companies')
      .then((rows) => {
        const list = rows || [];
        setMeta((m) => ({ ...m, companies: list }));
        if (list.length) setF((p) => (p.companyId ? p : { ...p, companyId: String(list[0].id) }));
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
    setF((p) => ({ ...p, departmentId: '', designationId: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.companyId]);

  // H12: when designations carry a department, only that department's are offered.
  const designations = meta.designations.filter((d) => !d.department_id || !f.departmentId || String(d.department_id) === String(f.departmentId));

  function validate() {
    const v = checkEmployee(f, { creating: true, needCtc: !offerLetter && autoOffer });
    if (meta.branches.length && f.location && !meta.branches.some((b) => b.name === f.location)) v.add('location', 'Choose the location from the list');
    setErrors(v.fields);
    return v.ok;
  }

  async function showPreview() {
    const v = checkEmployee(f, { creating: true, needCtc: true });
    const need = ['firstName', 'lastName', 'ctc'].filter((k) => v.fields[k]);
    if (need.length) { setErrors((x) => ({ ...x, ...Object.fromEntries(need.map((k) => [k, v.fields[k]])) })); return; }
    setPreviewBusy(true); setErr('');
    try {
      const q = new URLSearchParams({
        firstName: f.firstName.trim(), lastName: f.lastName.trim(), ctc: String(toNumber(f.ctc)),
        designationId: f.designationId || '', departmentId: f.departmentId || '', dateOfJoining: f.dateOfJoining || '',
        location: f.location || '', companyId: f.companyId || '',
      });
      const blob = await fetchBlob(`/admin/employees/offer-preview?${q}`);
      setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return { url: URL.createObjectURL(blob) }; });
    } catch (e) { setErr(e.message); } finally { setPreviewBusy(false); }
  }
  function closePreview() { setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return null; }); }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = { ...f, firstName: f.firstName.trim(), lastName: f.lastName.trim(), personalEmail: f.personalEmail.trim(), officialEmail: f.officialEmail.trim() };
      ['departmentId', 'designationId', 'reportingManagerId', 'functionManagerId', 'operationalManagerId', 'dob', 'dateOfJoining', 'gender', 'location']
        .forEach((k) => { if (!payload[k]) payload[k] = null; });
      payload.ctc = f.ctc ? toNumber(f.ctc) : null;
      const branch = meta.branches.find((b) => b.name === f.location);
      if (branch) payload.branchId = branch.id;
      if (offerLetter) payload.offerLetter = { name: offerLetter.name, dataUrl: offerLetter.dataUrl };
      if (!offerLetter && autoOffer) payload.autoOfferLetter = true;
      const { employee } = await api.post('/employees', payload);
      router.push(`/admin/employees/${employee.id}?created=1`);
    } catch (e2) {
      // The form keeps everything typed; the server's field errors show in place.
      if (e2.fields) setErrors(e2.fields);
      setErr(e2.fields ? '' : e2.message);
    } finally { setSaving(false); }
  }

  const grid = 'grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4';

  return (
    <form onSubmit={submit} noValidate className="w-full space-y-6 pb-4">
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

      {metaErr && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">Couldn't load some dropdown options ({metaErr}). Reload the page to try again.</div>}
      <ErrorSummary errors={errors} />

      <SectionCard Icon={IconUser} title="Personal details" subtitle="Basic information about the new hire.">
        <div className={grid}>
          <Field label="First name" required error={errors.firstName}><Input value={f.firstName} onChange={set('firstName')} /></Field>
          <Field label="Last name" required error={errors.lastName}><Input value={f.lastName} onChange={set('lastName')} /></Field>
          <Field label="Mobile number" error={errors.phone} hint="10 digits, starting with 6-9">
            <Input value={f.phone} onChange={(e) => setV('phone')(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" maxLength={10} />
          </Field>
          <Field label="Personal email" required error={errors.personalEmail} hint="The offer link is sent here"><Input type="email" value={f.personalEmail} onChange={set('personalEmail')} /></Field>
          <Field label="Date of birth" required error={errors.dob}><Input type="date" value={f.dob} onChange={set('dob')} min={bounds.dobMin} max={bounds.dobMax} /></Field>
          <Field label="Gender" error={errors.gender}>
            <Select value={f.gender} onChange={set('gender')}>
              <option value="">Select…</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option>
            </Select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard Icon={IconBriefcase} title="Role & reporting" subtitle="Position, team and reporting lines.">
        <div className={grid}>
          <Field label="Official email" required error={errors.officialEmail} hint="Must differ from the personal email"><Input type="email" value={f.officialEmail} onChange={set('officialEmail')} /></Field>
          {meta.companies.length > 1 && (
            <Field label="Company" required error={errors.companyId} hint="Which legal entity this person joins — sets their employee ID prefix">
              <Select value={f.companyId} onChange={set('companyId')}>
                {meta.companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.codePrefix})</option>)}
              </Select>
            </Field>
          )}
          <Field label="Department" required error={errors.departmentId}>
            <Select value={f.departmentId} onChange={(e) => { setV('departmentId')(e.target.value); setF((p) => ({ ...p, designationId: '' })); }}>
              <option value="">Select…</option>
              {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Designation" required error={errors.designationId}>
            <Select value={f.designationId} onChange={set('designationId')}>
              <option value="">Select…</option>
              {designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Select>
          </Field>
          <Field label="Reporting manager" error={errors.reportingManagerId} hint="Needed before the onboarding can be approved">
            <SearchPicker value={f.reportingManagerId} onChange={setV('reportingManagerId')} options={meta.managers} getLabel={mgrLabel} />
          </Field>
          <Field label="Functional manager" error={errors.functionManagerId} hint="Optional">
            <SearchPicker value={f.functionManagerId} onChange={setV('functionManagerId')} options={meta.managers} getLabel={mgrLabel} />
          </Field>
          <Field label="Operational manager" error={errors.operationalManagerId} hint="Optional — used by the org chart’s operational view">
            <SearchPicker value={f.operationalManagerId} onChange={setV('operationalManagerId')} options={meta.managers} getLabel={mgrLabel} />
          </Field>
          <Field label="Employment type" error={errors.employmentType}>
            <Select value={f.employmentType} onChange={set('employmentType')}>
              <option value="FULL_TIME">Full time</option><option value="PART_TIME">Part time</option>
              <option value="CONTRACT">Contract</option><option value="INTERN">Intern</option>
            </Select>
          </Field>
          <Field label="Date of joining" required error={errors.dateOfJoining} hint="Today or later, within a year">
            <Input type="date" value={f.dateOfJoining} onChange={set('dateOfJoining')} min={bounds.today} max={bounds.dojMax} />
          </Field>
          <Field label="Location of joining" error={errors.location} hint={meta.branches.length ? 'From your branch list (Masters)' : 'Add branches under Masters to pick from a list'}>
            {meta.branches.length ? (
              <Select value={f.location} onChange={set('location')}>
                <option value="">Select…</option>
                {meta.branches.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
              </Select>
            ) : (
              <Input value={f.location} onChange={set('location')} placeholder="e.g. Bhubaneswar, Odisha" />
            )}
          </Field>
        </div>
      </SectionCard>

      <SectionCard Icon={IconFile} title="Offer letter" subtitle="Attach a signed PDF, or let the system generate the Offer Letter + Annexure A. Preview it before sending.">
        <div className="space-y-4">
          <PdfDropzone value={offerLetter} onChange={setOfferLetter} />
          <div className="rounded-xl border border-line bg-slate-50/60 p-4 space-y-3">
            {!offerLetter && (
              <label className="flex items-center gap-2.5 text-sm font-medium text-ink cursor-pointer">
                <input type="checkbox" checked={autoOffer} onChange={(e) => setAutoOffer(e.target.checked)} className="h-4 w-4 accent-brand-600" />
                Auto-generate Offer Letter + Annexure A for this employee
              </label>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Annual CTC (₹)" required={!offerLetter && autoOffer} error={errors.ctc} hint="e.g. 6,00,000 — between ₹10,000 and ₹10 crore">
                <Input value={f.ctc} onChange={(e) => setV('ctc')(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder="e.g. 6,00,000" className="max-w-[240px]" />
              </Field>
              {!offerLetter && autoOffer && (
                <Button type="button" variant="outline" onClick={showPreview} disabled={previewBusy}>
                  {previewBusy ? <Spinner /> : 'Preview offer letter'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? <Spinner /> : 'Submit & send offer'}</Button>
        <Button as={Link} href="/admin/employees" variant="outline">Cancel</Button>
      </div>

      <Modal open={!!preview} onClose={closePreview} title="Offer letter preview" size="full"
        actions={<Button variant="ghost" onClick={closePreview}>Close</Button>}>
        {preview && <iframe src={preview.url} title="Offer letter preview" className="w-full h-[70vh] border-0 rounded" />}
      </Modal>
    </form>
  );
}
