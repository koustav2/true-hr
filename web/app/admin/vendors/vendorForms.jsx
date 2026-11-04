'use client';
// Vendor & agreement forms shared by the admin page and the employee (ESS)
// page. Same rules as backend/src/controllers/vendorController.js.
import { Input, Select, Textarea, Field, ErrorSummary } from '@/components/ui.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { validator, patterns } from '@/lib/validate.js';
import { label, fmtDate, todayIso } from '@/lib/labels.js';

export const ENTITY_TYPES = ['Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'Public Limited',
  'Trust / Society / NGO', 'Government body', 'Individual', 'Others'];
export const AGREEMENT_TYPES = ['RENT', 'SERVICE', 'MOU', 'OTHER'];
const AGREEMENT_LABEL = { RENT: 'Rent', SERVICE: 'Service', MOU: 'MoU', OTHER: 'Other' };
export const agreementTypeLabel = (t) => AGREEMENT_LABEL[t] || label(t);

const UDYAM = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const NSIC = /^[A-Z0-9/-]{5,30}$/;
const up = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

export function Status({ status }) {
  return <StatusBadge status={status} />;
}

// Client-side vendor validation; returns { fieldKey: message }.
export function validateVendor(f) {
  const v = validator();
  v.text('companyName', f.companyName, 'Company name', { required: true, min: 2, max: 150 });
  v.require('typeOfCompany', f.typeOfCompany, 'Type of company');
  v.pattern('pan', up(f.pan), 'pan', 'PAN', { required: true });
  v.pattern('gst', up(f.gst), 'gstin', 'GSTIN');
  if (!v.fields.pan && !v.fields.gst && f.gst && f.pan && up(f.gst).slice(2, 12) !== up(f.pan)) {
    v.add('gst', 'GSTIN does not match the PAN (characters 3-12 of a GSTIN are the PAN)');
  }
  v.pattern('esic', String(f.esic || '').trim(), 'esic', 'ESIC number');
  v.pattern('pf', up(f.pf), 'pf', 'PF establishment code');
  v.check('msmed', up(f.msmed), UDYAM, 'MSME (Udyam) number is not valid (like UDYAM-OD-01-0001234)');
  v.check('nsicSsi', up(f.nsicSsi), NSIC, 'NSIC / SSI number is not valid (5-30 letters, digits, / or -)');
  v.mobile('contactPhone', f.contactPhone, 'Contact phone');
  v.email('contactEmail', f.contactEmail, 'Contact email');
  if (f.bankAccountHolder || f.bankName || f.bankAccountNumber || f.bankIfsc) {
    v.require('bankAccountHolder', f.bankAccountHolder, 'Account holder name');
    v.require('bankName', f.bankName, 'Bank name');
    v.check('bankAccountNumber', String(f.bankAccountNumber || '').trim(), /^\d{9,18}$/, 'Account number must be 9-18 digits', { required: true, label: 'Account number' });
    v.pattern('bankIfsc', up(f.bankIfsc), 'ifsc', 'IFSC', { required: true });
  }
  return v.fields;
}

// Attach a supporting document (PDF/image, max 5MB) as base64.
export function DocPicker({ value, onPick, onClear, label: lbl = 'Supporting document (PAN card / GST certificate / cancelled cheque — PDF or image, optional)', onError }) {
  return (
    <div className="text-sm">
      <span className="block text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">{lbl}</span>
      {value ? (
        <div className="flex items-center justify-between gap-2 border border-line rounded-lg px-3 py-2">
          <span className="truncate text-ink-soft text-xs">{value.documentName}</span>
          <button type="button" onClick={onClear} className="text-xs text-rose-600 shrink-0">Remove</button>
        </div>
      ) : (
        <input type="file" accept="application/pdf,image/*" className="block w-full text-xs text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:px-3 file:py-2 file:text-xs file:font-semibold"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { onError?.('The file is larger than 5 MB'); e.target.value = ''; return; }
            const b64 = await new Promise((res, rej) => {
              const r = new FileReader();
              r.onload = () => res(String(r.result).split(',')[1]);
              r.onerror = rej; r.readAsDataURL(file);
            });
            onPick({ document: b64, documentMime: file.type, documentName: file.name });
          }} />
      )}
    </div>
  );
}

export function VendorFields({ f, setF, errors = {}, withDoc = true }) {
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const In = (k, lbl, props = {}) => (
    <Field label={lbl} error={errors[k]} required={props.required}>
      <Input value={f[k] || ''} onChange={set(k)} placeholder={props.placeholder} maxLength={props.maxLength} />
    </Field>
  );
  return (
    <div className="space-y-3">
      <ErrorSummary errors={errors} />
      {In('companyName', 'Company name', { required: true, maxLength: 150 })}
      <div className="grid sm:grid-cols-2 gap-2.5">
        <Field label="Type of company" required error={errors.typeOfCompany}>
          <Select value={f.typeOfCompany || ''} onChange={set('typeOfCompany')}>
            <option value="">Select</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            {f.typeOfCompany && !ENTITY_TYPES.includes(f.typeOfCompany) && <option value={f.typeOfCompany}>{f.typeOfCompany} (old value)</option>}
          </Select>
        </Field>
        {In('natureOfBusiness', 'Nature of business')}
      </div>
      <div className="text-[12px] font-semibold text-ink pt-1">Statutory details</div>
      <div className="grid sm:grid-cols-2 gap-2.5">
        {In('pan', 'PAN', { required: true, placeholder: 'ABCDE1234F', maxLength: 10 })}
        {In('gst', 'GSTIN (if registered)', { placeholder: '21ABCDE1234F1Z5', maxLength: 15 })}
        {In('esic', 'ESIC number', { placeholder: '17 digits', maxLength: 17 })}
        {In('pf', 'PF establishment code', { placeholder: 'MHBAN00123450000123456', maxLength: 22 })}
        {In('msmed', 'MSME (Udyam) number', { placeholder: 'UDYAM-OD-01-0001234', maxLength: 19 })}
        {In('nsicSsi', 'NSIC / SSI number')}
      </div>
      <div className="text-[12px] font-semibold text-ink pt-1">Contact</div>
      <div className="grid sm:grid-cols-3 gap-2.5">
        {In('contactPerson', 'Contact person')}
        {In('contactPhone', 'Contact phone', { placeholder: '10-digit mobile', maxLength: 13 })}
        {In('contactEmail', 'Contact email')}
      </div>
      <Field label="Head office address" error={errors.headOfficeAddress}>
        <Textarea rows={2} value={f.headOfficeAddress || ''} onChange={set('headOfficeAddress')} />
      </Field>
      <div className="text-[12px] font-semibold text-ink pt-1">Bank details (for payments)</div>
      <div className="grid sm:grid-cols-2 gap-2.5">
        {In('bankAccountHolder', 'Account holder name')}
        {In('bankName', 'Bank name')}
        {In('bankAccountNumber', 'Account number', { maxLength: 18 })}
        {In('bankIfsc', 'IFSC', { placeholder: 'SBIN0001234', maxLength: 11 })}
      </div>
      {withDoc && (
        <DocPicker value={f.document ? f : null}
          onPick={(d) => setF((x) => ({ ...x, ...d }))}
          onClear={() => setF(({ document, documentMime, documentName, ...rest }) => rest)} />
      )}
    </div>
  );
}

// Read-only vendor details (statutory, bank, contact, review).
export function VendorDetails({ v }) {
  const row = (k, val) => (
    <div className="flex justify-between gap-3 py-1 border-b border-line/60 last:border-0">
      <span className="text-ink-faint">{k}</span><span className="text-ink text-right break-all">{val || '—'}</span>
    </div>
  );
  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="flex items-center gap-2"><span className="font-semibold text-ink">{v.companyName}</span><Status status={v.status} /></div>
      <div>
        {row('Type of company', v.typeOfCompany)}
        {row('Nature of business', v.natureOfBusiness)}
        {row('PAN', v.pan)}{row('GSTIN', v.gst)}{row('ESIC', v.esic)}{row('PF', v.pf)}
        {row('MSME (Udyam)', v.msmed)}{row('NSIC / SSI', v.nsicSsi)}
        {row('Contact', [v.contactPerson, v.contactPhone, v.contactEmail].filter(Boolean).join(' · '))}
        {row('Address', v.headOfficeAddress)}
        {row('Bank', v.bankName ? `${v.bankAccountHolder || ''} · ${v.bankName} · A/c ${v.bankAccountNumber || '—'} · ${v.bankIfsc || ''}` : null)}
        {row('Registered by', v.registeredBy ? `${v.registeredBy.name} (${v.registeredBy.employeeCode})` : 'Admin')}
        {row('Registered on', fmtDate(v.createdAt))}
        {v.reviewedAt && row(v.status === 'REJECTED' ? 'Rejected by' : 'Reviewed by', `${v.reviewedBy || '—'} on ${fmtDate(v.reviewedAt)}`)}
        {v.reviewNote && row(v.status === 'REJECTED' ? 'Reason for rejection' : 'Note', v.reviewNote)}
      </div>
    </div>
  );
}

// Client-side agreement validation (project & client required, no expired periods).
export function validateAgreement(f) {
  const v = validator();
  const today = todayIso();
  v.require('projectId', f.projectId, 'Project');
  v.require('clientId', f.clientId, 'Client');
  v.require('agreementType', f.agreementType, 'Agreement type');
  v.date('startDate', f.startDate, 'Start date', { required: true });
  v.date('endDate', f.endDate, 'End date', { required: true, min: today, minMsg: 'End date has already passed — an expired agreement cannot be uploaded' });
  if (!v.fields.startDate && !v.fields.endDate && f.endDate < f.startDate) v.add('endDate', 'End date must be on or after the start date');
  return v.fields;
}

export function AgreementFields({ f, setF, errors = {}, masters, onDocError }) {
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const clients = (masters?.clientsVendors || []).filter((c) => c.type !== 'VENDOR');
  return (
    <div className="space-y-2.5">
      <ErrorSummary errors={errors} />
      <Field label="Project" required error={errors.projectId}><Select value={f.projectId || ''} onChange={set('projectId')}>
        <option value="">Select</option>{(masters?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Client" required error={errors.clientId}><Select value={f.clientId || ''} onChange={set('clientId')}>
        <option value="">Select</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="Location" error={errors.locationId}><Select value={f.locationId || ''} onChange={set('locationId')}>
        <option value="">Select</option>{(masters?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
      <Field label="Agreement type" required error={errors.agreementType}><Select value={f.agreementType || ''} onChange={set('agreementType')}>
        {AGREEMENT_TYPES.map((t) => <option key={t} value={t}>{agreementTypeLabel(t)}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start date" required error={errors.startDate}><Input type="date" value={f.startDate || ''} onChange={set('startDate')} /></Field>
        <Field label="End date" required error={errors.endDate}><Input type="date" min={f.startDate && f.startDate > todayIso() ? f.startDate : todayIso()} value={f.endDate || ''} onChange={set('endDate')} /></Field>
      </div>
      <Field label="Details" error={errors.details}><Textarea rows={2} value={f.details || ''} onChange={set('details')} /></Field>
      <DocPicker label="Signed agreement (PDF or image, optional)" value={f.document ? f : null} onError={onDocError}
        onPick={(d) => setF((x) => ({ ...x, ...d }))}
        onClear={() => setF(({ document, documentMime, documentName, ...rest }) => rest)} />
    </div>
  );
}

// Body for POST /agreements from the form state.
export const agreementBody = (f) => ({
  ...f,
  projectId: f.projectId ? Number(f.projectId) : undefined,
  locationId: f.locationId ? Number(f.locationId) : undefined,
  clientId: f.clientId ? Number(f.clientId) : undefined,
  details: f.details?.trim() || undefined,
});

export function ExpiryTag({ a }) {
  if (a.status !== 'APPROVED' || !a.expiry) return null;
  if (a.expiry === 'EXPIRED') return <span className="text-[11px] font-semibold text-rose-700">Expired</span>;
  if (a.expiry === 'EXPIRING_SOON') return <span className="text-[11px] font-semibold text-amber-700">Expires in {a.daysToExpiry} day{a.daysToExpiry === 1 ? '' : 's'}</span>;
  return null;
}

export { patterns };
