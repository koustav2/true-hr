'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Field, Spinner, ErrorSummary } from '@/components/ui.jsx';
import { validator, INDIAN_STATES } from '@/lib/validate.js';
import { todayIso } from '@/lib/labels.js';
import OrgBrand from '../OrgBrand.jsx';
import { bankForIfsc } from '../ifsc.js';
import SignaturePad from '@/components/SignaturePad.jsx';
import DocUpload from '@/components/DocUpload.jsx';

const STEPS = ['Personal', 'Address', 'Bank', 'Statutory & IDs', 'Education', 'Family', 'Experience', 'Declarations', 'Documents', 'Review & sign'];
const YN = ['No', 'Yes'];
const RELATIONS = ['Father', 'Mother', 'Spouse', 'Child 1', 'Child 2'];
const COURSES = ['10th', '12th', 'Graduation', 'Post Graduation'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Parsi', 'Other'];
const NATIONALITIES = ['Indian', 'Other'];
const EXPERIENCE = ['Fresher', '0–1 years', '1–3 years', '3–5 years', '5–10 years', '10+ years'];

const DOC_GROUPS = [
  { title: 'Photograph & signature', items: [
    { type: 'PHOTO', label: 'Passport-size photograph', accept: 'image', required: true, hint: 'Within 3 months' },
    { type: 'SIGNATURE_IMAGE', label: 'Signature image', accept: 'image', required: true, hint: 'White bg, blue ink' },
  ]},
  { title: 'Education certificates (PDF)', items: [
    { type: 'CERT_10', label: '10th marksheet', accept: 'pdf', required: true },
    { type: 'CERT_12', label: '12th marksheet', accept: 'pdf', required: true },
    { type: 'CERT_GRAD', label: 'Graduation marksheet', accept: 'pdf', required: true },
    { type: 'CERT_PG', label: 'Post-graduation marksheet', accept: 'pdf', required: false },
    { type: 'CERT_OTHER', label: 'Other certification', accept: 'pdf', required: false },
  ]},
  { title: 'Employment documents (PDF)', items: [
    { type: 'RELIEVING_LAST', label: 'Relieving letter — last employer', accept: 'pdf', required: false },
    { type: 'RELIEVING_PREV', label: 'Relieving letter — previous employers', accept: 'pdf', required: false },
  ]},
  { title: 'Identity documents (PDF)', items: [
    { type: 'ID_AADHAAR', label: 'Aadhaar card', accept: 'pdf', required: true },
    { type: 'ID_PAN', label: 'PAN card', accept: 'pdf', required: true },
    { type: 'ID_BANK', label: 'Bank passbook / cancelled cheque', accept: 'pdf', required: true },
    { type: 'ID_DL_FRONT', label: 'Driving licence — front', accept: 'pdf', required: false },
    { type: 'ID_DL_REAR', label: 'Driving licence — rear', accept: 'pdf', required: false },
  ]},
];
const REQUIRED_DOCS = DOC_GROUPS.flatMap((g) => g.items).filter((i) => i.required).map((i) => i.type);
const DOC_NAME = Object.fromEntries(DOC_GROUPS.flatMap((g) => g.items).map((i) => [i.type, i.label]));
// lib/validate mobile() strips a leading "91"; prefix +91 to a bare 10-digit number.
const m10 = (x) => (/^\d{10}$/.test(String(x ?? '').trim()) ? `+91${String(x).trim()}` : x);
const placeOk = (x) => /^[A-Za-z][A-Za-z .,'()-]*$/.test(String(x || '').trim());
// Which step owns a server field key, so a server error opens the right step.
const STEP_OF = (k) => (k.startsWith('profile.experience') ? 6 : k.startsWith('profile.family') ? 5 : k.startsWith('profile.nominee') ? 7
  : k.startsWith('profile') ? 0 : k.startsWith('present') || k.startsWith('permanent') ? 1 : k.startsWith('bank') ? 2
  : k.startsWith('statutory') ? 3 : k === 'documents' ? 8 : 9);

function checkAddr(v, prefix, a, lbl) {
  v.text(`${prefix}line1`, a.line1, `${lbl} line 1`, { required: true, min: 3, max: 200 });
  if (!a.state) v.add(`${prefix}state`, `${lbl}: state is required`);
  else if (!INDIAN_STATES.includes(a.state)) v.add(`${prefix}state`, `${lbl}: choose a state from the list`);
  if (!String(a.district || '').trim()) v.add(`${prefix}district`, `${lbl}: district is required`);
  else if (!placeOk(a.district)) v.add(`${prefix}district`, `${lbl}: district should contain letters only`);
  if (!String(a.city || '').trim()) v.add(`${prefix}city`, `${lbl}: city is required`);
  else if (!placeOk(a.city)) v.add(`${prefix}city`, `${lbl}: city should contain letters only`);
  v.pattern(`${prefix}pincode`, a.pincode, 'pin', `${lbl} PIN code`, { required: true });
}

function Center({ children }) { return <div className="min-h-screen grid place-items-center p-6">{children}</div>; }
const grid2 = 'grid sm:grid-cols-2 gap-4';
const grid3 = 'grid sm:grid-cols-3 gap-4';

function FormInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const router = useRouter();
  const [boot, setBoot] = useState({ loading: true });
  const [step, setStep] = useState(0);
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [errors, setErrors] = useState({});

  // slices
  const [bank, setBank] = useState({ accountHolder: '', accountNumber: '', ifsc: '', bankName: '', branch: '' });
  const [stat, setStat] = useState({ pan: '', aadhaar: '', uan: '', pfNumber: '', esiNumber: '' });
  const [present, setPresent] = useState({ line1: '', line2: '', city: '', state: '', district: '', pincode: '' });
  const [permanent, setPermanent] = useState({ line1: '', line2: '', city: '', state: '', district: '', pincode: '' });
  const [sameAddr, setSameAddr] = useState(false);
  const [info, setInfo] = useState({ middleName: '', placeOfBirth: '', maritalStatus: '', weddingDate: '', children: '', bloodGroup: '', religion: '', nationality: 'Indian', physicallyChallenged: 'No', emName: '', emPhone: '' });
  const [ids, setIds] = useState({ passportNumber: '', passportPlace: '', passportValid: '', dlNumber: '', dlPlace: '', dlValid: '' });
  const [languages, setLanguages] = useState([{ name: '', read: false, write: false, speak: false, understand: false }, { name: '', read: false, write: false, speak: false, understand: false }]);
  const [family, setFamily] = useState(RELATIONS.map((relation) => ({ relation, name: '', dob: '', gender: relation === 'Father' ? 'Male' : relation === 'Mother' ? 'Female' : '' })));
  const [education, setEducation] = useState(COURSES.map((course) => ({ course, specialization: '', institution: '', percentage: '', toYear: '' })));
  const [experienceYears, setExperienceYears] = useState('');
  const [employers, setEmployers] = useState([{ employer: '', reportingManager: '', managerDesignation: '', contactNo: '', hrManager: '', hrContact: '' }]);
  const [dec, setDec] = useState({ convicted: 'No', dismissed: 'No', bankrupt: 'No', medical: 'No', relatives: 'No', relativesDetail: '' });
  const [nominee, setNominee] = useState({ name: '', relationship: '', address: '', bankName: '', accountNumber: '', ifsc: '' });
  const [docs, setDocs] = useState({});
  const [docNames, setDocNames] = useState({});

  useEffect(() => {
    if (!token) { setBoot({ error: 'Missing link token.' }); return; }
    api.get(`/onboarding/form?token=${encodeURIComponent(token)}`)
      .then((d) => {
        setBoot({ data: d });
        if (d.employee?.first_name) setBank((b) => ({ ...b, accountHolder: `${d.employee.first_name} ${d.employee.last_name}` }));
        const up = d.uploadedDocs || [];
        setDocs(Object.fromEntries(up.map((x) => [x.type, true])));
        setDocNames(Object.fromEntries(up.map((x) => [x.type, x.filename])));
        const p = d.profile || {};
        if (Object.keys(p).length) {
          setInfo((s) => ({ ...s, middleName: p.middleName || '', placeOfBirth: p.placeOfBirth || '', maritalStatus: p.maritalStatus || '', weddingDate: p.weddingDate?.slice?.(0,10) || '', children: p.children ?? '', bloodGroup: p.bloodGroup || '', religion: p.religion || '', nationality: p.nationality || 'Indian', physicallyChallenged: p.physicallyChallenged || 'No', emName: p.emergencyContact?.name || '', emPhone: p.emergencyContact?.phone || '' }));
          if (Array.isArray(p.languages) && p.languages.length) setLanguages(p.languages);
          if (Array.isArray(p.family) && p.family.length) setFamily(RELATIONS.map((r) => p.family.find((f) => f.relation === r) || { relation: r, name: '', dob: '', gender: '' }));
          if (Array.isArray(p.education) && p.education.length) setEducation(COURSES.map((c) => p.education.find((e) => e.course === c) || { course: c, specialization: '', institution: '', percentage: '', toYear: '' }));
          setExperienceYears(p.experienceYears || '');
          if (Array.isArray(p.previousEmployers) && p.previousEmployers.length) setEmployers(p.previousEmployers);
          if (p.declarations) setDec((s) => ({ ...s, ...p.declarations }));
          if (p.nominee) setNominee((s) => ({ ...s, ...p.nominee }));
          if (p.ids) setIds({ passportNumber: p.ids.passport?.number || '', passportPlace: p.ids.passport?.placeOfIssue || '', passportValid: p.ids.passport?.validUpto?.slice?.(0,10) || '', dlNumber: p.ids.drivingLicence?.number || '', dlPlace: p.ids.drivingLicence?.placeOfIssue || '', dlValid: p.ids.drivingLicence?.validUpto?.slice?.(0,10) || '' });
        }
        const ad = d.addresses || [];
        const cur = ad.find((a) => a.type === 'CURRENT'); const per = ad.find((a) => a.type === 'PERMANENT');
        const st = (x) => INDIAN_STATES.find((n) => n.toLowerCase() === String(x || '').trim().toLowerCase()) || '';
        if (cur) setPresent({ line1: cur.line1 || '', line2: cur.line2 || '', city: cur.city || '', state: st(cur.state), district: cur.district || '', pincode: cur.pincode || '' });
        if (per) setPermanent({ line1: per.line1 || '', line2: per.line2 || '', city: per.city || '', state: st(per.state), district: per.district || '', pincode: per.pincode || '' });
      })
      .catch((e) => setBoot({ error: e.message }));
  }, [token]);

  const sb = (set) => (k) => (e) => set((p) => ({ ...p, [k]: e.target.value }));
  const setBankF = sb(setBank), setStatF = sb(setStat), setInfoF = sb(setInfo), setIdsF = sb(setIds), setDecF = sb(setDec), setNomF = sb(setNominee), setPresF = sb(setPresent), setPermF = sb(setPermanent);
  const onDoc = (type, ok) => setDocs((p) => ({ ...p, [type]: ok }));
  const needDocs = experienceYears && experienceYears !== 'Fresher' ? [...REQUIRED_DOCS, 'RELIEVING_LAST'] : REQUIRED_DOCS;
  const missingDocs = needDocs.filter((t) => !docs[t]);

  const upd = (arr, set, i, k, val) => { const next = arr.slice(); next[i] = { ...next[i], [k]: val }; set(next); };

  // Every error of the step at once (C7, H31-H34).
  function stepErrors(st) {
    const v = validator();
    if (st === 0) {
      if (info.middleName) v.name('profile.middleName', info.middleName, 'Middle name');
      if (!String(info.placeOfBirth).trim()) v.add('profile.placeOfBirth', 'Place of birth is required');
      else if (!placeOk(info.placeOfBirth)) v.add('profile.placeOfBirth', 'Place of birth should contain letters only');
      v.require('profile.bloodGroup', info.bloodGroup, 'Blood group');
      v.require('profile.maritalStatus', info.maritalStatus, 'Marital status');
      v.name('profile.emergencyContact.name', info.emName, 'Emergency contact name', { required: true });
      v.mobile('profile.emergencyContact.phone', m10(info.emPhone), 'Emergency contact phone', { required: true });
    }
    if (st === 1) {
      checkAddr(v, 'present.', present, 'Present address');
      if (!sameAddr) checkAddr(v, 'permanent.', permanent, 'Permanent address');
    }
    if (st === 2) {
      v.name('bank.accountHolder', bank.accountHolder, 'Account holder name', { required: true });
      v.check('bank.accountNumber', bank.accountNumber, /^\d{9,18}$/, 'Account number must be 9–18 digits', { required: true, label: 'Account number' });
      v.pattern('bank.ifsc', bank.ifsc, 'ifsc', 'IFSC', { required: true });
      const known = bankForIfsc(bank.ifsc);
      if (!bank.bankName && !known) v.add('bank.bankName', 'Bank name is required');
      if (bank.branch && !placeOk(bank.branch)) v.add('bank.branch', 'Branch should contain letters only');
    }
    if (st === 3) {
      v.pattern('statutory.pan', stat.pan, 'pan', 'PAN', { required: true });
      v.pattern('statutory.aadhaar', stat.aadhaar, 'aadhaar', 'Aadhaar', { required: true });
      if (stat.uan) v.pattern('statutory.uan', stat.uan, 'uan', 'UAN');
    }
    if (st === 5) {
      family.forEach((f, i) => { if (f.name) v.name(`profile.family.${i}.name`, f.name, `${f.relation} name`); });
    }
    if (st === 6 && !experienceYears) v.add('profile.experienceYears', 'Please select your total years of experience');
    if (st === 7 && nominee.name) v.name('profile.nominee.name', nominee.name, 'Nominee name');
    if (st === 8 && missingDocs.length) v.add('documents', `Please upload: ${missingDocs.map((t) => DOC_NAME[t] || t).join(', ')}`);
    return v.fields;
  }
  function next() {
    const f = stepErrors(step);
    setErrors(f);
    if (Object.keys(f).length) { setErr(''); return; }
    setErr(''); setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function prev() { setErr(''); setErrors({}); setStep((s) => Math.max(s - 1, 0)); }

  async function finish() {
    for (let st = 0; st < STEPS.length - 1; st += 1) {
      const f = stepErrors(st);
      if (Object.keys(f).length) { setErrors(f); setStep(st); setErr('Please fix the highlighted fields on this step.'); return; }
    }
    if (!signature) { setErrors({ signature: 'Please add your e-signature to submit' }); return; }
    setErr(''); setBusy(true);
    const profile = {
      middleName: info.middleName, placeOfBirth: info.placeOfBirth, maritalStatus: info.maritalStatus, weddingDate: info.weddingDate,
      children: info.children, bloodGroup: info.bloodGroup, religion: info.religion, nationality: info.nationality, physicallyChallenged: info.physicallyChallenged,
      emergencyContact: { name: info.emName, phone: info.emPhone },
      languages: languages.filter((l) => l.name).map((l) => ({ name: l.name, read: l.read ? 'Yes' : '', write: l.write ? 'Yes' : '', speak: l.speak ? 'Yes' : '', understand: l.understand ? 'Yes' : '' })),
      family: family.filter((f) => f.name), education: education.filter((e) => e.institution || e.percentage),
      experienceYears, previousEmployers: employers.filter((e) => e.employer || e.reportingManager),
      ids: { passport: { number: ids.passportNumber, placeOfIssue: ids.passportPlace, validUpto: ids.passportValid }, drivingLicence: { number: ids.dlNumber, placeOfIssue: ids.dlPlace, validUpto: ids.dlValid } },
      declarations: dec, nominee,
    };
    const addresses = [{ type: 'CURRENT', ...present, country: 'India' }, { type: 'PERMANENT', ...(sameAddr ? present : permanent), country: 'India' }];
    try {
      await api.post('/onboarding/details', { token, bank: { ...bank, ifsc: bank.ifsc.toUpperCase(), bankName: bank.bankName || bankForIfsc(bank.ifsc) || '' }, statutory: { ...stat, pan: stat.pan.toUpperCase() }, addresses, profile });
      await api.post('/onboarding/esign', { token, signature });
      router.push('/onboarding/done');
    } catch (e) {
      // Server field errors open the step they belong to, everything typed kept.
      if (e.fields && Object.keys(e.fields).length) {
        setErrors(e.fields);
        setStep(Math.min(...Object.keys(e.fields).map(STEP_OF)));
        setErr('');
      } else setErr(e.message);
      setBusy(false);
    }
  }

  if (boot.loading) return <Center><Spinner className="text-brand-600 h-6 w-6" /></Center>;
  if (boot.error) return <Center><Card className="p-8 max-w-md text-center"><div className="text-4xl mb-3">⚠️</div><p className="text-ink-soft">{boot.error}</p></Card></Center>;
  if (boot.data.submitted) return <Center><Card className="p-8 max-w-md text-center"><div className="text-4xl mb-3">✅</div><p className="text-ink-soft">Your details are already submitted and under review. We'll email you once HR approves.</p></Card></Center>;

  const emp = boot.data.employee;
  const notes = boot.data.reviewNotes;
  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex justify-center mb-6"><OrgBrand brand={boot.data.brand} size={40} /></div>

        {/* progress */}
        <div className="mb-5">
          <div className="flex items-center justify-between text-xs text-ink-faint mb-1.5">
            <span className="font-medium text-ink-soft">Step {step + 1} of {STEPS.length} · {STEPS[step]}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <Card className="p-7">
          <h1 className="text-xl font-bold text-ink tracking-tight">E-joining · {STEPS[step]}</h1>
          <p className="text-ink-faint text-sm mb-5">Hi {emp.first_name}, complete your Personal Information Sheet to finish onboarding.</p>
          {notes && step === 0 && <div className="mb-5 text-sm bg-orange-50 text-orange-800 rounded-xl px-4 py-3"><strong>HR requested changes:</strong> {notes}</div>}

          {step === 0 && (
            <div className="space-y-4">
              <div className={grid3}>
                <Field label="Middle name" error={errors['profile.middleName']}><Input value={info.middleName} onChange={setInfoF('middleName')} /></Field>
                <Field label="Place of birth" required error={errors['profile.placeOfBirth']}><Input value={info.placeOfBirth} onChange={setInfoF('placeOfBirth')} /></Field>
                <Field label="Blood group" required error={errors['profile.bloodGroup']}><Select value={info.bloodGroup} onChange={setInfoF('bloodGroup')}><option value="">Select…</option>{BLOOD.map((o) => <option key={o}>{o}</option>)}</Select></Field>
                <Field label="Marital status" required error={errors['profile.maritalStatus']}><Select value={info.maritalStatus} onChange={setInfoF('maritalStatus')}><option value="">Select…</option><option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option><option>Other</option></Select></Field>
                {info.maritalStatus === 'Married' && (<>
                <Field label="Date of wedding"><Input type="date" value={info.weddingDate} onChange={setInfoF('weddingDate')} max={todayIso()} /></Field>
                <Field label="No. of children"><Input type="number" min="0" value={info.children} onChange={setInfoF('children')} /></Field>
                </>)}
                <Field label="Religion"><Select value={info.religion} onChange={setInfoF('religion')}><option value="">Select…</option>{RELIGIONS.map((o) => <option key={o}>{o}</option>)}</Select></Field>
                <Field label="Nationality"><Select value={info.nationality} onChange={setInfoF('nationality')}>{NATIONALITIES.map((o) => <option key={o}>{o}</option>)}</Select></Field>
                <Field label="Physically challenged"><Select value={info.physicallyChallenged} onChange={setInfoF('physicallyChallenged')}>{YN.map((o) => <option key={o}>{o}</option>)}</Select></Field>
              </div>
              <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint pt-1">Emergency contact</div>
              <div className={grid2}>
                <Field label="Contact name" required error={errors['profile.emergencyContact.name']}><Input value={info.emName} onChange={setInfoF('emName')} /></Field>
                <Field label="Contact phone" required error={errors['profile.emergencyContact.phone']} hint="10-digit mobile number"><Input value={info.emPhone} onChange={(e) => setInfo((x) => ({ ...x, emPhone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} maxLength={10} inputMode="numeric" /></Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint mb-2.5">Present address</div>
                <div className={grid2}>
                  <div className="sm:col-span-2"><Field label="Address line 1" required error={errors['present.line1']}><Input value={present.line1} onChange={setPresF('line1')} /></Field></div>
                  <div className="sm:col-span-2"><Field label="Address line 2"><Input value={present.line2} onChange={setPresF('line2')} /></Field></div>
                  <Field label="State" required error={errors['present.state']}><Select value={present.state} onChange={setPresF('state')}><option value="">Select…</option>{INDIAN_STATES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
                  <Field label="District" required error={errors['present.district']}><Input value={present.district} onChange={setPresF('district')} /></Field>
                  <Field label="City" required error={errors['present.city']}><Input value={present.city} onChange={setPresF('city')} /></Field>
                  <Field label="PIN code" required error={errors['present.pincode']}><Input value={present.pincode} onChange={(e) => setPresent((x) => ({ ...x, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))} maxLength={6} inputMode="numeric" /></Field>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" checked={sameAddr} onChange={(e) => setSameAddr(e.target.checked)} className="h-4 w-4 accent-brand-600" />
                Permanent address is the same as present (otherwise it is required)
              </label>
              {!sameAddr && (
                <div>
                  <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint mb-2.5">Permanent address</div>
                  <div className={grid2}>
                    <div className="sm:col-span-2"><Field label="Address line 1" required error={errors['permanent.line1']}><Input value={permanent.line1} onChange={setPermF('line1')} /></Field></div>
                  <div className="sm:col-span-2"><Field label="Address line 2"><Input value={permanent.line2} onChange={setPermF('line2')} /></Field></div>
                  <Field label="State" required error={errors['permanent.state']}><Select value={permanent.state} onChange={setPermF('state')}><option value="">Select…</option>{INDIAN_STATES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
                  <Field label="District" required error={errors['permanent.district']}><Input value={permanent.district} onChange={setPermF('district')} /></Field>
                  <Field label="City" required error={errors['permanent.city']}><Input value={permanent.city} onChange={setPermF('city')} /></Field>
                  <Field label="PIN code" required error={errors['permanent.pincode']}><Input value={permanent.pincode} onChange={(e) => setPermanent((x) => ({ ...x, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))} maxLength={6} inputMode="numeric" /></Field>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className={grid2}>
              <Field label="Account holder name" required error={errors['bank.accountHolder']}><Input value={bank.accountHolder} onChange={setBankF('accountHolder')} /></Field>
              <Field label="Account number" required error={errors['bank.accountNumber']}><Input value={bank.accountNumber} onChange={(e) => setBank((x) => ({ ...x, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 18) }))} inputMode="numeric" /></Field>
              <Field label="IFSC" required error={errors['bank.ifsc']} hint={bankForIfsc(bank.ifsc) ? `Bank: ${bankForIfsc(bank.ifsc)}` : 'e.g. SBIN0001234'}>
                <Input value={bank.ifsc} maxLength={11} className="uppercase" onChange={(e) => {
                  const ifsc = e.target.value.toUpperCase();
                  // H34: the bank comes from the IFSC.
                  setBank((x) => ({ ...x, ifsc, bankName: bankForIfsc(ifsc) || (bankForIfsc(x.ifsc) === x.bankName ? '' : x.bankName) }));
                }} />
              </Field>
              <Field label="Bank name" required error={errors['bank.bankName']} hint={bankForIfsc(bank.ifsc) ? 'Filled from the IFSC' : undefined}>
                <Input value={bank.bankName} onChange={setBankF('bankName')} readOnly={!!bankForIfsc(bank.ifsc)} />
              </Field>
              <Field label="Branch" error={errors['bank.branch']}><Input value={bank.branch} onChange={setBankF('branch')} /></Field>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className={grid3}>
                <Field label="PAN" required error={errors['statutory.pan']}><Input value={stat.pan} onChange={setStatF('pan')} className="uppercase" maxLength={10} /></Field>
                <Field label="Aadhaar number" required hint="Encrypted" error={errors['statutory.aadhaar']}><Input value={stat.aadhaar} onChange={(e) => setStat((x) => ({ ...x, aadhaar: e.target.value.replace(/\D/g, '').slice(0, 12) }))} inputMode="numeric" maxLength={12} /></Field>
                <Field label="UAN (if any)" error={errors['statutory.uan']}><Input value={stat.uan} onChange={setStatF('uan')} /></Field>
                <Field label="PF number (if any)"><Input value={stat.pfNumber} onChange={setStatF('pfNumber')} /></Field>
                <Field label="ESI number (if any)"><Input value={stat.esiNumber} onChange={setStatF('esiNumber')} /></Field>
              </div>
              <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint pt-1">Passport (if any)</div>
              <div className={grid3}>
                <Field label="Passport number"><Input value={ids.passportNumber} onChange={setIdsF('passportNumber')} /></Field>
                <Field label="Place of issue"><Input value={ids.passportPlace} onChange={setIdsF('passportPlace')} /></Field>
                <Field label="Valid up to"><Input type="date" value={ids.passportValid} onChange={setIdsF('passportValid')} /></Field>
              </div>
              <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint pt-1">Driving licence (if any)</div>
              <div className={grid3}>
                <Field label="DL number"><Input value={ids.dlNumber} onChange={setIdsF('dlNumber')} /></Field>
                <Field label="Place of issue"><Input value={ids.dlPlace} onChange={setIdsF('dlPlace')} /></Field>
                <Field label="Valid up to"><Input type="date" value={ids.dlValid} onChange={setIdsF('dlValid')} /></Field>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint mb-2.5">Education</div>
                <div className="space-y-3">
                  {education.map((row, i) => (
                    <div key={row.course} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-center">
                      <div className="text-sm font-medium text-ink">{row.course}</div>
                      <Input placeholder="Institution / board" value={row.institution} onChange={(e) => upd(education, setEducation, i, 'institution', e.target.value)} />
                      <Input placeholder="Specialization" value={row.specialization} onChange={(e) => upd(education, setEducation, i, 'specialization', e.target.value)} />
                      <Input placeholder="% marks" value={row.percentage} onChange={(e) => upd(education, setEducation, i, 'percentage', e.target.value)} />
                      <Input placeholder="Year" value={row.toYear} onChange={(e) => upd(education, setEducation, i, 'toYear', e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint mb-2.5">Languages known</div>
                <div className="space-y-2">
                  {languages.map((l, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-3">
                      <Select value={['Hindi', 'English', ''].includes(l.name) ? l.name : 'Others'}
                        onChange={(e) => upd(languages, setLanguages, i, 'name', e.target.value === 'Others' ? 'Others' : e.target.value)}
                        className="max-w-[200px]">
                        <option value="">Select…</option><option>Hindi</option><option>English</option><option>Others</option>
                      </Select>
                      {!['Hindi', 'English', ''].includes(l.name) || l.name === 'Others' ? (
                        <Input value={l.name === 'Others' ? '' : l.name} placeholder="Specify language"
                          onChange={(e) => upd(languages, setLanguages, i, 'name', e.target.value || 'Others')}
                          className="max-w-[180px]" />
                      ) : null}
                      {['read', 'write', 'speak', 'understand'].map((k) => (
                        <label key={k} className="flex items-center gap-1.5 text-xs text-ink-soft capitalize">
                          <input type="checkbox" checked={!!l[k]} onChange={(e) => upd(languages, setLanguages, i, k, e.target.checked)} className="h-4 w-4 accent-brand-600" />{k}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint px-1">
                <span>Relation</span><span>Name</span><span>Date of birth</span><span>Gender</span>
              </div>
              {family.map((f, i) => (['Spouse', 'Child 1', 'Child 2'].includes(f.relation) && info.maritalStatus !== 'Married') ? null : (
                <div key={f.relation} className="grid grid-cols-4 gap-2 items-center">
                  <div className="text-sm font-medium text-ink">{f.relation}</div>
                  <Input value={f.name} onChange={(e) => upd(family, setFamily, i, 'name', e.target.value)} />
                  <Input type="date" value={f.dob} onChange={(e) => upd(family, setFamily, i, 'dob', e.target.value)} />
                  {f.relation === 'Father' || f.relation === 'Mother'
                    ? <Input value={f.relation === 'Father' ? 'Male' : 'Female'} disabled readOnly />
                    : <Select value={f.gender} onChange={(e) => upd(family, setFamily, i, 'gender', e.target.value)}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></Select>}
                </div>
              ))}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-5">
              <Field label="Total years of experience" required error={errors['profile.experienceYears']}>
                <Select value={experienceYears} onChange={(e) => setExperienceYears(e.target.value)} className="max-w-[240px]">
                  <option value="">Select…</option>
                  {EXPERIENCE.map((o) => <option key={o}>{o}</option>)}
                </Select>
              </Field>
              {employers.map((emp2, i) => (
                <div key={i}>
                  <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint mb-2.5">Previous employer {i + 1}</div>
                  <div className={grid2}>
                    <Field label="Employer / company"><Input value={emp2.employer} onChange={(e) => upd(employers, setEmployers, i, 'employer', e.target.value)} /></Field>
                    <Field label="Reporting manager"><Input value={emp2.reportingManager} onChange={(e) => upd(employers, setEmployers, i, 'reportingManager', e.target.value)} /></Field>
                    <Field label="Manager designation"><Input value={emp2.managerDesignation} onChange={(e) => upd(employers, setEmployers, i, 'managerDesignation', e.target.value)} /></Field>
                    <Field label="Manager contact no."><Input value={emp2.contactNo} onChange={(e) => upd(employers, setEmployers, i, 'contactNo', e.target.value)} inputMode="tel" /></Field>
                    <Field label="HR manager name"><Input value={emp2.hrManager} onChange={(e) => upd(employers, setEmployers, i, 'hrManager', e.target.value)} /></Field>
                    <Field label="HR contact no."><Input value={emp2.hrContact} onChange={(e) => upd(employers, setEmployers, i, 'hrContact', e.target.value)} inputMode="tel" /></Field>
                  </div>
                </div>
              ))}
              {employers.length < 2 && <Button type="button" variant="outline" onClick={() => setEmployers((e) => [...e, { employer: '', reportingManager: '', managerDesignation: '', contactNo: '', hrManager: '', hrContact: '' }])}>+ Add another employer</Button>}
            </div>
          )}

          {step === 7 && (
            <div className="space-y-5">
              <div className="space-y-3">
                {[['convicted', 'Ever convicted for a criminal offence?'], ['dismissed', 'Ever dismissed/terminated from a job?'], ['bankrupt', 'Ever declared bankrupt?'], ['medical', 'Any medical history / critical illness?'], ['relatives', 'Any relatives working in the company?']].map(([k, q]) => (
                  <div key={k} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-ink-soft">{q}</span>
                    <Select value={dec[k]} onChange={setDecF(k)} className="max-w-[110px]">{YN.map((o) => <option key={o}>{o}</option>)}</Select>
                  </div>
                ))}
                {dec.relatives === 'Yes' && <Field label="Relatives detail"><Input value={dec.relativesDetail} onChange={setDecF('relativesDetail')} /></Field>}
              </div>
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint mb-2.5">Nomination</div>
                <div className={grid3}>
                  <Field label="Nominee name" error={errors['profile.nominee.name']}><Input value={nominee.name} onChange={setNomF('name')} /></Field>
                  <Field label="Relationship"><Input value={nominee.relationship} onChange={setNomF('relationship')} /></Field>
                  <Field label="Address"><Input value={nominee.address} onChange={setNomF('address')} /></Field>
                  <Field label="Bank name"><Input value={nominee.bankName} onChange={setNomF('bankName')} /></Field>
                  <Field label="Account number"><Input value={nominee.accountNumber} onChange={setNomF('accountNumber')} /></Field>
                  <Field label="IFSC"><Input value={nominee.ifsc} onChange={setNomF('ifsc')} className="uppercase" /></Field>
                </div>
              </div>
            </div>
          )}

          {step === 8 && (
            <div className="space-y-6">
              <p className="text-sm text-ink-soft -mt-2">Upload clear scans. Fields marked <span className="text-brand-600 font-semibold">*</span> are required. Each file ≤ 10 MB.</p>
              {DOC_GROUPS.map((g) => (
                <div key={g.title}>
                  <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-faint mb-2.5">{g.title}</div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {g.items.map((it) => (
                      <DocUpload key={it.type} token={token} type={it.type} label={it.label} hint={it.hint} required={it.required} accept={it.accept} defaultName={docNames[it.type] || null} onStatus={onDoc} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 9 && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-3 gap-px bg-slate-100 rounded-xl overflow-hidden text-sm">
                {[
                  ['Name', `${emp.first_name} ${emp.last_name}`], ['Blood group', info.bloodGroup || '—'],
                  ['Account no.', bank.accountNumber ? '••••' + bank.accountNumber.slice(-4) : '—'],
                  ['PAN', stat.pan || '—'], ['Aadhaar', stat.aadhaar ? '••••••••' + stat.aadhaar.slice(-4) : '—'],
                  ['Documents', `${Object.values(docs).filter(Boolean).length} files`],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white p-3"><div className="text-xs text-ink-faint">{k}</div><div className="font-medium text-ink">{v || '—'}</div></div>
                ))}
              </div>
              {missingDocs.length > 0 && <div className="text-sm bg-orange-50 text-orange-800 rounded-xl px-4 py-3">Some required documents are missing (Documents step).</div>}
              <div>
                <div className="text-sm font-medium text-ink-soft mb-2">Declaration & e-signature <span className="text-brand-600">*</span></div>
                <p className="text-xs text-ink-faint mb-3">I confirm the information and documents provided are true and correct to the best of my knowledge.</p>
                <SignaturePad onChange={(x) => { setSignature(x); setErrors((e) => ({ ...e, signature: undefined })); }} />
                {errors.signature && <p className="text-[11.5px] text-neg mt-1.5">{errors.signature}</p>}
              </div>
            </div>
          )}

          <div className="mt-4"><ErrorSummary errors={errors} /></div>
          {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 mt-4">{err}</div>}

          <div className="flex items-center justify-between mt-6">
            <Button variant="ghost" onClick={prev} disabled={step === 0}>← Back</Button>
            {step < STEPS.length - 1 ? <Button onClick={next}>Continue →</Button> : <Button onClick={finish} disabled={busy}>{busy ? <Spinner /> : 'Submit & e-sign'}</Button>}
          </div>
        </Card>
        <p className="text-center text-xs text-ink-faint mt-4">🔒 Your documents and PAN/Aadhaar/bank details are encrypted and visible only to HR.</p>
      </div>
    </div>
  );
}

export default function OnboardingFormPage() {
  return <Suspense fallback={<Center><Spinner className="text-brand-600 h-6 w-6" /></Center>}><FormInner /></Suspense>;
}
