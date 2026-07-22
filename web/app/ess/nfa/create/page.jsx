'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Textarea, Spinner, Field } from '@/components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PAYMENT_TYPES = [
  ['ADVANCE_SELF', 'Advance for self'], ['ADVANCE_VENDOR', 'Advance for Vendor'],
  ['REIMB_SELF', 'Reimbursement for self'], ['REIMB_VENDOR', 'Reimbursement for Vendor'],
  ['PPS_CANDIDATE', 'PPS for Candidate'], ['INCENTIVE', 'Incentive Payment'],
];
const BILLABLE_TYPES = [
  ['NON_BILLABLE', 'Non-billable from client'], ['BILLABLE_CLIENT', 'Billable from client'], ['BILLABLE_PARTNER', 'Billable from Partner'],
];
const fmtMoney = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// GreenHR CreateNFA.aspx equivalent — full web form with client-side cascading
// masters (no postbacks) and a live approver-chain preview.
export default function CreateNfaPage() {
  const router = useRouter();
  const [m, setM] = useState(null);
  const [f, setF] = useState({
    raiseFor: 'EXPENSE', businessOperationId: '', groupCompanyId: '', projectId: '',
    expenseCategoryId: '', zoneId: '', locationId: '', clientVendorId: '',
    expenseMonth: String(new Date().getMonth() + 1), paymentType: 'ADVANCE_SELF',
    billableType: 'NON_BILLABLE', billedState: '', invoiceDate: '', invoiceAmount: '',
    expectedPaymentDate: '', settlementDueDate: plusDays(7), purpose: '', description: '', priority: 'MEDIUM',
  });
  const [lines, setLines] = useState([]);
  const [line, setLine] = useState({ headerId: '', subheaderId: '', nfaAmount: '', logisticAmount: '' });
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/meta/nfa-masters').then(setM).catch(() => setM(false)); }, []);

  // Client-side cascades — the fix for GreenHR's "Please wait…" postbacks.
  const projects = useMemo(() => (m?.projects || []).filter((p) => !f.businessOperationId || !p.businessOperationId || String(p.businessOperationId) === f.businessOperationId), [m, f.businessOperationId]);
  const categories = useMemo(() => (m?.expenseCategories || []).filter((c) => !f.businessOperationId || !c.businessOperationId || String(c.businessOperationId) === f.businessOperationId), [m, f.businessOperationId]);
  const headers = useMemo(() => (m?.expenseHeaders || []).filter((h) => String(h.categoryId) === f.expenseCategoryId), [m, f.expenseCategoryId]);
  const subheaders = useMemo(() => (m?.expenseSubheaders || []).filter((s) => String(s.headerId) === line.headerId), [m, line.headerId]);

  // Live approver-chain preview (like GreenHR's read-only RM/PL/Finance/BL fields).
  useEffect(() => {
    if (!f.projectId || !f.expenseCategoryId || !f.zoneId) { setPreview(null); return; }
    api.get(`/approvals/preview?flow=NFA&projectId=${f.projectId}&expenseCategoryId=${f.expenseCategoryId}&zoneId=${f.zoneId}`)
      .then(setPreview).catch(() => setPreview(null));
  }, [f.projectId, f.expenseCategoryId, f.zoneId]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const totals = lines.reduce((a, l) => ({ nfa: a.nfa + l.nfa, log: a.log + l.log }), { nfa: 0, log: 0 });

  function addLine() {
    const nfa = Number(line.nfaAmount || 0), log = Number(line.logisticAmount || 0);
    if (!line.headerId || nfa + log <= 0) { setMsg('Pick an expense header and enter an amount.'); return; }
    const h = headers.find((x) => String(x.id) === line.headerId);
    const s = subheaders.find((x) => String(x.id) === line.subheaderId);
    setLines((ls) => [...ls, { headerId: h.id, headerName: h.name, subheaderId: s?.id || null, subheaderName: s?.name || null, nfa, log }]);
    setLine({ headerId: '', subheaderId: '', nfaAmount: '', logisticAmount: '' });
    setMsg('');
  }

  async function submit() {
    setBusy(true); setMsg('');
    try {
      await api.post('/nfa', {
        raiseFor: f.raiseFor,
        businessOperationId: Number(f.businessOperationId), groupCompanyId: Number(f.groupCompanyId),
        projectId: Number(f.projectId), expenseCategoryId: Number(f.expenseCategoryId),
        zoneId: Number(f.zoneId), locationId: Number(f.locationId),
        clientVendorId: f.clientVendorId ? Number(f.clientVendorId) : undefined,
        expenseMonth: Number(f.expenseMonth), paymentType: f.paymentType, billableType: f.billableType,
        billedState: f.billedState || undefined, invoiceDate: f.invoiceDate || undefined,
        invoiceAmount: f.invoiceAmount ? Number(f.invoiceAmount) : undefined,
        expectedPaymentDate: f.expectedPaymentDate || undefined,
        settlementDueDate: f.settlementDueDate, purpose: f.purpose, description: f.description || undefined,
        priority: f.priority,
        lines: lines.map((l) => ({ headerId: l.headerId, subheaderId: l.subheaderId, nfaAmount: l.nfa, logisticAmount: l.log })),
      });
      router.push('/ess/nfa?created=1');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  if (m === null) return <div className="p-10 flex justify-center"><Spinner /></div>;
  if (m === false) return <p className="text-sm text-red-600">Could not load masters.</p>;

  const sel = (label, key, options, { required = true, placeholder = 'Select' } = {}) => (
    <Field label={label} required={required}>
      <Select value={f[key]} onChange={set(key)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.id ?? o[0]} value={o.id ?? o[0]}>{o.name ?? o[1]}</option>)}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-5 max-w-4xl">
      <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">Create NFA</h1>

      <Card className="p-4">
        <div className="font-semibold text-sm text-ink mb-3">Project Details</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sel('NFA Raise For', 'raiseFor', [['EXPENSE', 'Expense'], ['PURCHASE_REQUEST', 'Purchase Request']], { placeholder: 'Expense' })}
          {sel('Business Operation', 'businessOperationId', m.businessOperations)}
          {sel('Cost to Company', 'groupCompanyId', m.groupCompanies)}
          {sel('Select Project', 'projectId', projects)}
          {sel('Expense Category', 'expenseCategoryId', categories)}
          {sel('Cost Approval Zone', 'zoneId', m.costZones)}
          {sel('Location', 'locationId', m.locations)}
          {sel('Client / Vendor', 'clientVendorId', m.clientsVendors, { required: false })}
          {sel('Month', 'expenseMonth', MONTHS.map((name, i) => [String(i + 1), name]))}
          {sel('Payment Type', 'paymentType', PAYMENT_TYPES)}
          {sel('Billable Type', 'billableType', BILLABLE_TYPES)}
          <Field label="Settlement Date" required>
            <Input type="date" value={f.settlementDueDate} onChange={set('settlementDueDate')} />
          </Field>
        </div>

        {f.billableType === 'BILLABLE_CLIENT' && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3 p-3 rounded-lg bg-sky-50/60 border border-sky-100">
            {sel('Billed / To be billed', 'billedState', [['BILLED', 'Billed'], ['TO_BE_BILLED', 'To be billed']])}
            {f.billedState === 'BILLED' && <>
              <Field label="Invoice Date" required><Input type="date" value={f.invoiceDate} onChange={set('invoiceDate')} /></Field>
              <Field label="Invoice Amount" required><Input type="number" value={f.invoiceAmount} onChange={set('invoiceAmount')} /></Field>
            </>}
            <Field label="Expected Date of Payment"><Input type="date" value={f.expectedPaymentDate} onChange={set('expectedPaymentDate')} /></Field>
          </div>
        )}
      </Card>

      {preview && (
        <Card className="p-4">
          <div className="font-semibold text-sm text-ink mb-2">Approval Chain (auto-derived)</div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {preview.map((s) => (
              <div key={s.seq} className="flex justify-between border-b border-line/60 py-1">
                <span className="text-ink-faint">{s.seq}. {s.roleKey.replace(/_/g, ' ')}</span>
                <span className={s.approver ? 'text-ink font-medium' : 'text-ink-faint'}>{s.approver?.name || (s.willBypass ? '— (auto bypass)' : '—')}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="font-semibold text-sm text-ink mb-3">Expense Lines (Add Headers)</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Field label="Expense Header" required>
            <Select value={line.headerId} onChange={(e) => setLine((x) => ({ ...x, headerId: e.target.value, subheaderId: '' }))} disabled={!f.expenseCategoryId}>
              <option value="">{f.expenseCategoryId ? 'Select' : 'Pick a category first'}</option>
              {headers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </Select>
          </Field>
          <Field label="Sub Header">
            <Select value={line.subheaderId} onChange={(e) => setLine((x) => ({ ...x, subheaderId: e.target.value }))} disabled={!line.headerId}>
              <option value="">Select</option>
              {subheaders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="NFA Amount"><Input type="number" value={line.nfaAmount} onChange={(e) => setLine((x) => ({ ...x, nfaAmount: e.target.value }))} /></Field>
          <Field label="Logistic Amount"><Input type="number" value={line.logisticAmount} onChange={(e) => setLine((x) => ({ ...x, logisticAmount: e.target.value }))} /></Field>
          <Button onClick={addLine}>+ Add</Button>
        </div>

        {!!lines.length && (
          <table className="w-full text-sm mt-4 border border-line rounded">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-3 py-1.5">#</th><th className="px-2 py-1.5">Header</th><th className="px-2 py-1.5">Sub Header</th>
              <th className="px-2 py-1.5 text-right">NFA</th><th className="px-2 py-1.5 text-right">Logistic</th>
              <th className="px-2 py-1.5 text-right">Total</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5">{i + 1}</td><td className="px-2 py-1.5">{l.headerName}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{l.subheaderName || '—'}</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(l.nfa)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(l.log)}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{fmtMoney(l.nfa + l.log)}</td>
                  <td className="px-2 py-1.5 text-right"><button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-xs text-red-600">remove</button></td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-medium">
                <td colSpan={3} className="px-3 py-1.5 text-right text-xs text-ink-faint">Grand Total</td>
                <td className="px-2 py-1.5 text-right">{fmtMoney(totals.nfa)}</td>
                <td className="px-2 py-1.5 text-right">{fmtMoney(totals.log)}</td>
                <td className="px-2 py-1.5 text-right">{fmtMoney(totals.nfa + totals.log)}</td><td />
              </tr>
            </tbody>
          </table>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <Field label="NFA Purpose" required><Input value={f.purpose} onChange={set('purpose')} placeholder="Purpose" /></Field>
        <Field label="NFA Description"><Textarea rows={2} value={f.description} onChange={set('description')} placeholder="Item description" /></Field>
        <Field label="Priority Level" required>
          <Select value={f.priority} onChange={set('priority')}>
            {['HIGH', 'MEDIUM', 'LOW'].map((p) => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}
          </Select>
        </Field>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        <Button onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit NFA'}</Button>
      </Card>
    </div>
  );
}
