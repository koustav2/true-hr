'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { label, todayIso } from '@/lib/labels.js';
import { validator, toNumber, addDays } from '@/lib/validate.js';
import { Card, Button, Input, Select, Textarea, Spinner, Field, ErrorSummary } from '@/components/ui.jsx';
import { fmtMoney, readFiles, DOC_KINDS } from '../NfaParts.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PAYMENT_TYPES = [
  ['ADVANCE_SELF', 'Advance for self'], ['ADVANCE_VENDOR', 'Advance for vendor'],
  ['REIMB_SELF', 'Reimbursement for self'], ['REIMB_VENDOR', 'Reimbursement for vendor'],
  ['PPS_CANDIDATE', 'PPS for candidate'], ['INCENTIVE', 'Incentive payment'],
];
const BILLABLE_TYPES = [
  ['NON_BILLABLE', 'Non-billable from client'], ['BILLABLE_CLIENT', 'Billable from client'], ['BILLABLE_PARTNER', 'Billable from partner'],
];
const MAX_TOTAL = 10000000; // ₹1,00,00,000 — same limit as the server
const twoDp = (n) => Math.round(n * 100) === n * 100;

// GreenHR CreateNFA.aspx equivalent — full web form with client-side cascading
// masters (no postbacks) and a live approver-chain preview.
export default function CreateNfaPage() {
  const router = useRouter();
  const today = todayIso();
  const [m, setM] = useState(null);
  const [f, setF] = useState({
    raiseFor: 'EXPENSE', businessOperationId: '', groupCompanyId: '', projectId: '',
    expenseCategoryId: '', zoneId: '', locationId: '', clientVendorId: '',
    expenseMonth: String(new Date().getMonth() + 1), paymentType: 'ADVANCE_SELF',
    billableType: 'NON_BILLABLE', billedState: '', invoiceDate: '', invoiceAmount: '',
    expectedPaymentDate: '', settlementDueDate: addDays(today, 7), purpose: '', description: '', priority: 'MEDIUM',
    vendorQuoteRef: '',
  });
  const [lines, setLines] = useState([]);
  const blankLine = { headerId: '', subheaderId: '', nfaAmount: '', logisticAmount: '', itemDescription: '', quantity: '', unitRate: '' };
  const [line, setLine] = useState(blankLine);
  const [lineErr, setLineErr] = useState({});
  const [docs, setDocs] = useState([]);
  const [docKind, setDocKind] = useState('BILL');
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const pr = f.raiseFor === 'PURCHASE_REQUEST';

  useEffect(() => { api.get('/meta/nfa-masters').then(setM).catch(() => setM(false)); }, []);

  // Client-side cascades — the fix for GreenHR's "Please wait…" postbacks.
  const projects = useMemo(() => (m?.projects || []).filter((p) => !f.businessOperationId || !p.businessOperationId || String(p.businessOperationId) === f.businessOperationId), [m, f.businessOperationId]);
  const categories = useMemo(() => (m?.expenseCategories || []).filter((c) => !f.businessOperationId || !c.businessOperationId || String(c.businessOperationId) === f.businessOperationId), [m, f.businessOperationId]);
  const headers = useMemo(() => (m?.expenseHeaders || []).filter((h) => String(h.categoryId) === f.expenseCategoryId), [m, f.expenseCategoryId]);
  const subheaders = useMemo(() => (m?.expenseSubheaders || []).filter((s) => String(s.headerId) === line.headerId), [m, line.headerId]);

  // Live approver-chain preview: exactly what submission will do.
  useEffect(() => {
    if (!f.projectId || !f.expenseCategoryId || !f.zoneId) { setPreview(null); return; }
    api.get(`/approvals/preview?flow=NFA&projectId=${f.projectId}&expenseCategoryId=${f.expenseCategoryId}&zoneId=${f.zoneId}`)
      .then(setPreview).catch(() => setPreview(null));
  }, [f.projectId, f.expenseCategoryId, f.zoneId]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const totals = lines.reduce((a, l) => ({ nfa: a.nfa + l.nfa, log: a.log + l.log }), { nfa: 0, log: 0 });
  const missing = (preview || []).filter((s) => s.missing);

  function addLine() {
    const e = {};
    if (!line.headerId) e.headerId = 'Choose an expense header';
    let nfa = toNumber(line.nfaAmount) ?? 0;
    const log = toNumber(line.logisticAmount) ?? 0;
    if (pr) {
      if (!line.itemDescription.trim()) e.itemDescription = 'Item is required';
      const q = toNumber(line.quantity); const r = toNumber(line.unitRate);
      if (!(q >= 1) || !Number.isInteger(q)) e.quantity = 'Quantity must be a whole number of 1 or more';
      if (!(r > 0) || !twoDp(r)) e.unitRate = 'Unit rate must be more than 0, with at most 2 decimals';
      if (!e.quantity && !e.unitRate) nfa = Math.round(q * r * 100) / 100;
    } else if (Number.isNaN(nfa) || nfa < 0) e.nfaAmount = 'NFA amount cannot be negative';
    else if (!twoDp(nfa)) e.nfaAmount = 'NFA amount can have at most 2 decimal places';
    if (Number.isNaN(log) || log < 0) e.logisticAmount = 'Logistic amount cannot be negative';
    else if (!twoDp(log)) e.logisticAmount = 'Logistic amount can have at most 2 decimal places';
    if (!e.nfaAmount && !e.logisticAmount && !e.quantity && !e.unitRate && nfa + log <= 0) e.nfaAmount = 'Enter an amount greater than zero';
    if (!e.nfaAmount && totals.nfa + totals.log + nfa + log > MAX_TOTAL) e.nfaAmount = `The NFA total cannot be more than ${fmtMoney(MAX_TOTAL)}`;
    if (line.headerId && lines.some((l) => String(l.headerId) === line.headerId && String(l.subheaderId || '') === String(line.subheaderId || ''))) {
      e.headerId = 'This expense header is already added — change the amount on the existing line instead';
    }
    setLineErr(e);
    if (Object.keys(e).length) return;
    const h = headers.find((x) => String(x.id) === line.headerId);
    const s = subheaders.find((x) => String(x.id) === line.subheaderId);
    setLines((ls) => [...ls, {
      headerId: h.id, headerName: h.name, subheaderId: s?.id || null, subheaderName: s?.name || null, nfa, log,
      itemDescription: line.itemDescription.trim(), quantity: toNumber(line.quantity), unitRate: toNumber(line.unitRate),
    }]);
    setLine(blankLine);
  }

  async function pick(list) {
    const { files, errors: errs } = await readFiles(list, docKind);
    setDocs((x) => [...x, ...files].slice(0, 10));
    setMsg(errs.join('; '));
  }

  function validate() {
    const v = validator();
    v.require('businessOperationId', f.businessOperationId, 'Business operation');
    v.require('groupCompanyId', f.groupCompanyId, 'Cost to company');
    v.require('projectId', f.projectId, 'Project');
    v.require('expenseCategoryId', f.expenseCategoryId, 'Expense category');
    v.require('zoneId', f.zoneId, 'Cost approval zone');
    v.require('locationId', f.locationId, 'Location');
    v.date('settlementDueDate', f.settlementDueDate, 'Settlement date', {
      required: true, min: today, max: addDays(today, 366),
      minMsg: 'Settlement date cannot be in the past', maxMsg: 'Settlement date must be within one year',
    });
    v.require('purpose', f.purpose.trim(), 'Purpose');
    if (f.purpose.trim() && f.purpose.trim().length < 3) v.add('purpose', 'Purpose must be at least 3 characters');
    if (f.billableType === 'BILLABLE_CLIENT') {
      if (!f.billedState) v.add('billedState', 'Choose Billed or To be billed');
      if (f.billedState === 'BILLED') {
        v.date('invoiceDate', f.invoiceDate, 'Invoice date', { required: true, max: today, maxMsg: 'Invoice date cannot be in the future' });
        v.number('invoiceAmount', f.invoiceAmount, 'Invoice amount', { required: true, min: 0.01, max: MAX_TOTAL, decimals: 2 });
      }
    }
    if (!lines.length) v.add('lines', 'Add at least one expense line');
    if (['REIMB_SELF', 'REIMB_VENDOR'].includes(f.paymentType) && !docs.some((d) => ['BILL', 'INVOICE'].includes(d.kind))) {
      v.add('documents', 'Attach the bill or invoice for a reimbursement');
    }
    if (pr && !docs.some((d) => d.kind === 'QUOTATION')) v.add('documents', 'Attach the vendor quotation for a purchase request');
    if (missing.length) v.add('approvers', 'Your approval chain is incomplete — see the Approval chain card');
    return v.fields;
  }

  async function submit() {
    const errs = validate();
    setErrors(errs); setMsg('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('/nfa', {
        raiseFor: f.raiseFor,
        businessOperationId: Number(f.businessOperationId), groupCompanyId: Number(f.groupCompanyId),
        projectId: Number(f.projectId), expenseCategoryId: Number(f.expenseCategoryId),
        zoneId: Number(f.zoneId), locationId: Number(f.locationId),
        clientVendorId: f.clientVendorId ? Number(f.clientVendorId) : undefined,
        expenseMonth: Number(f.expenseMonth), paymentType: f.paymentType, billableType: f.billableType,
        billedState: f.billedState || undefined, invoiceDate: f.invoiceDate || undefined,
        invoiceAmount: f.invoiceAmount ? toNumber(f.invoiceAmount) : undefined,
        expectedPaymentDate: f.expectedPaymentDate || undefined,
        settlementDueDate: f.settlementDueDate, purpose: f.purpose.trim(), description: f.description.trim() || undefined,
        priority: f.priority, vendorQuoteRef: pr && f.vendorQuoteRef.trim() ? f.vendorQuoteRef.trim() : undefined,
        lines: lines.map((l) => ({
          headerId: l.headerId, subheaderId: l.subheaderId, nfaAmount: l.nfa, logisticAmount: l.log,
          ...(pr ? { itemDescription: l.itemDescription, quantity: l.quantity, unitRate: l.unitRate } : {}),
        })),
        documents: docs,
      });
      router.push('/ess/nfa?created=1');
    } catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); } finally { setBusy(false); }
  }

  if (m === null) return <div className="p-10 flex justify-center"><Spinner /></div>;
  if (m === false) return <p className="text-sm text-red-600">Could not load the NFA options. Please reload the page.</p>;

  const sel = (lbl, key, options, { required = true, placeholder = 'Select' } = {}) => (
    <Field label={lbl} required={required} error={errors[key]}>
      <Select value={f[key]} onChange={set(key)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.id ?? o[0]} value={o.id ?? o[0]}>{o.name ?? o[1]}</option>)}
      </Select>
    </Field>
  );
  const lineErrs = Object.entries(errors).filter(([k]) => k.startsWith('lines.')).map(([, v]) => v);

  return (
    <div className="space-y-5 max-w-4xl">
      <h1 className="page-title text-ink">Create NFA</h1>
      <ErrorSummary errors={errors} />

      <Card className="p-4">
        <div className="font-semibold text-sm text-ink mb-3">Project details</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="NFA raised for" required>
            <Select value={f.raiseFor} onChange={(e) => { set('raiseFor')(e); setLines([]); setDocKind(e.target.value === 'PURCHASE_REQUEST' ? 'QUOTATION' : 'BILL'); }}>
              <option value="EXPENSE">Expense</option><option value="PURCHASE_REQUEST">Purchase request</option>
            </Select>
          </Field>
          {sel('Business operation', 'businessOperationId', m.businessOperations)}
          {sel('Cost to company', 'groupCompanyId', m.groupCompanies)}
          {sel('Project', 'projectId', projects)}
          {sel('Expense category', 'expenseCategoryId', categories)}
          {sel('Cost approval zone', 'zoneId', m.costZones)}
          {sel('Location', 'locationId', m.locations.map((l) => ({ id: l.id, name: l.kind && l.kind !== 'CITY' ? `${l.name} (${label(l.kind)})` : l.name })))}
          {sel('Client / vendor', 'clientVendorId', m.clientsVendors, { required: false, placeholder: 'None' })}
          {sel('Expense month', 'expenseMonth', MONTHS.map((name, i) => [String(i + 1), name]))}
          {sel('Payment type', 'paymentType', PAYMENT_TYPES)}
          {sel('Billable type', 'billableType', BILLABLE_TYPES)}
          <Field label="Settlement date" required error={errors.settlementDueDate}>
            <Input type="date" min={today} max={addDays(today, 366)} value={f.settlementDueDate} onChange={set('settlementDueDate')} />
          </Field>
        </div>

        {f.billableType === 'BILLABLE_CLIENT' && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3 p-3 rounded-lg bg-sky-50/60 border border-sky-100">
            {sel('Billed / to be billed', 'billedState', [['BILLED', 'Billed'], ['TO_BE_BILLED', 'To be billed']])}
            {f.billedState === 'BILLED' && <>
              <Field label="Invoice date" required error={errors.invoiceDate}><Input type="date" max={today} value={f.invoiceDate} onChange={set('invoiceDate')} /></Field>
              <Field label="Invoice amount (₹)" required error={errors.invoiceAmount}><Input inputMode="decimal" value={f.invoiceAmount} onChange={set('invoiceAmount')} /></Field>
            </>}
            <Field label="Expected date of payment"><Input type="date" min={today} value={f.expectedPaymentDate} onChange={set('expectedPaymentDate')} /></Field>
          </div>
        )}
      </Card>

      {preview && (
        <Card className="p-4">
          <div className="font-semibold text-sm text-ink mb-2">Approval chain</div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {preview.map((s) => (
              <div key={s.seq} className="flex justify-between border-b border-line/60 py-1">
                <span className="text-ink-faint">{s.seq}. {s.roleLabel || label(s.roleKey)}</span>
                <span className={s.approver ? 'text-ink font-medium' : s.missing ? 'text-red-600 font-medium' : 'text-ink-faint'}>
                  {s.approver?.name || (s.missing ? 'Not assigned — required' : 'Skipped (no approver)')}
                </span>
              </div>
            ))}
          </div>
          {!!missing.length && (
            <p className="text-sm text-red-600 mt-2">
              {missing.map((s) => s.roleLabel).join(', ')} {missing.length > 1 ? 'have' : 'has'} no approver for you (you cannot approve your own NFA).
              Ask HR to assign one on the Approvers page before raising this NFA.
            </p>
          )}
        </Card>
      )}

      <Card className="p-4">
        <div className="font-semibold text-sm text-ink mb-3">{pr ? 'Items to purchase' : 'Expense lines'}</div>
        <div className={`grid sm:grid-cols-2 ${pr ? 'lg:grid-cols-4' : 'lg:grid-cols-5'} gap-3 items-start`}>
          <Field label="Expense header" required error={lineErr.headerId}>
            <Select value={line.headerId} onChange={(e) => setLine((x) => ({ ...x, headerId: e.target.value, subheaderId: '' }))} disabled={!f.expenseCategoryId}>
              <option value="">{f.expenseCategoryId ? 'Select' : 'Pick a category first'}</option>
              {headers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </Select>
          </Field>
          <Field label="Sub-header">
            <Select value={line.subheaderId} onChange={(e) => setLine((x) => ({ ...x, subheaderId: e.target.value }))} disabled={!line.headerId}>
              <option value="">Select</option>
              {subheaders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          {pr ? <>
            <Field label="Item" required error={lineErr.itemDescription}><Input value={line.itemDescription} onChange={(e) => setLine((x) => ({ ...x, itemDescription: e.target.value }))} placeholder="e.g. Office chair" /></Field>
            <Field label="Quantity" required error={lineErr.quantity}><Input inputMode="numeric" value={line.quantity} onChange={(e) => setLine((x) => ({ ...x, quantity: e.target.value }))} /></Field>
            <Field label="Unit rate (₹)" required error={lineErr.unitRate}><Input inputMode="decimal" value={line.unitRate} onChange={(e) => setLine((x) => ({ ...x, unitRate: e.target.value }))} /></Field>
          </> : (
            <Field label="NFA amount (₹)" error={lineErr.nfaAmount}><Input inputMode="decimal" value={line.nfaAmount} onChange={(e) => setLine((x) => ({ ...x, nfaAmount: e.target.value }))} /></Field>
          )}
          <Field label="Logistic amount (₹)" error={lineErr.logisticAmount || (pr ? lineErr.nfaAmount : undefined)}><Input inputMode="decimal" value={line.logisticAmount} onChange={(e) => setLine((x) => ({ ...x, logisticAmount: e.target.value }))} /></Field>
          <div className="pt-6"><Button onClick={addLine}>+ Add line</Button></div>
        </div>
        {errors.lines && <p className="text-sm text-red-600 mt-2">{errors.lines}</p>}
        {lineErrs.map((t, i) => <p key={i} className="text-sm text-red-600 mt-1">{t}</p>)}

        {!!lines.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-4 border border-line rounded min-w-[560px]">
              <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
                <th className="px-3 py-1.5">#</th><th className="px-2 py-1.5">Header</th><th className="px-2 py-1.5">Sub-header</th>
                {pr && <th className="px-2 py-1.5">Item</th>}
                <th className="px-2 py-1.5 text-right">{pr ? 'Qty × rate' : 'NFA'}</th><th className="px-2 py-1.5 text-right">Logistic</th>
                <th className="px-2 py-1.5 text-right">Total</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5">{i + 1}</td><td className="px-2 py-1.5">{l.headerName}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{l.subheaderName || '—'}</td>
                    {pr && <td className="px-2 py-1.5">{l.itemDescription}</td>}
                    <td className="px-2 py-1.5 text-right">{pr ? `${l.quantity} × ${fmtMoney(l.unitRate)} = ${fmtMoney(l.nfa)}` : fmtMoney(l.nfa)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(l.log)}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{fmtMoney(l.nfa + l.log)}</td>
                    <td className="px-2 py-1.5 text-right"><button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-xs text-red-600">Remove</button></td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td colSpan={pr ? 4 : 3} className="px-3 py-1.5 text-right text-xs text-ink-faint">Grand total</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(totals.nfa)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(totals.log)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(totals.nfa + totals.log)}</td><td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-semibold text-sm text-ink">Attachments</div>
        <p className="text-xs text-ink-faint">
          Attach bills / invoices (required for a reimbursement), the vendor quotation (required for a purchase request)
          and the filled reimbursement form. PDF or image, up to 5MB each, 10 files.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="w-48"><Select value={docKind} onChange={(e) => setDocKind(e.target.value)}>
            {DOC_KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select></div>
          <input type="file" accept="application/pdf,image/*" multiple
            className="text-xs text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
            onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
        </div>
        {docs.map((d, i) => (
          <div key={i} className="flex justify-between text-xs border border-line rounded px-2 py-1">
            <span className="truncate">{DOC_KINDS.find(([k]) => k === d.kind)?.[1]}: {d.filename}</span>
            <button type="button" onClick={() => setDocs((x) => x.filter((_, j) => j !== i))} className="text-rose-600 ml-2">Remove</button>
          </div>
        ))}
        {errors.documents && <p className="text-sm text-red-600">{errors.documents}</p>}
        {pr && (
          <Field label="Vendor quotation reference"><Input value={f.vendorQuoteRef} onChange={set('vendorQuoteRef')} placeholder="e.g. Quote no. Q-17 dated 01-11-2026" /></Field>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <Field label="Purpose" required error={errors.purpose}><Input value={f.purpose} onChange={set('purpose')} placeholder="Purpose" /></Field>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={set('description')} placeholder="Item / expense description" /></Field>
        <Field label="Priority" required>
          <Select value={f.priority} onChange={set('priority')}>
            {['HIGH', 'MEDIUM', 'LOW'].map((p) => <option key={p} value={p}>{label(p)}</option>)}
          </Select>
        </Field>
        {errors.approvers && <p className="text-sm text-red-600">{errors.approvers}</p>}
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        <Button onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit NFA'}</Button>
      </Card>
    </div>
  );
}
