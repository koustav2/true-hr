'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { validator, addYears, INDIAN_STATES } from '@/lib/validate.js';
import { todayIso } from '@/lib/labels.js';
import { Card, Button, Field, Input, Select, Spinner, Empty, Badge, PageHeader, ErrorSummary, useConfirm } from '@/components/ui.jsx';

const TABS = [
  { key: 'PROFILE', label: 'Personal details' },
  { key: 'ADDRESS', label: 'Address' },
  { key: 'BANK', label: 'Bank account' },
];
const FIELD_LABEL = {
  phone: 'Phone', personalEmail: 'Personal email', dob: 'Date of birth', gender: 'Gender',
  type: 'Address type', line1: 'Address line 1', line2: 'Address line 2', city: 'City', district: 'District',
  state: 'State', pincode: 'PIN code', country: 'Country',
  accountHolder: 'Account holder', bankName: 'Bank', branch: 'Branch',
  ifsc: 'IFSC', accountNumber: 'Account number',
};
const TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger', WITHDRAWN: 'neutral' };
const KIND_LABEL = { PROFILE: 'Personal details', ADDRESS: 'Address', BANK: 'Bank account' };
const KIND_NOUN = { PROFILE: 'a personal details', ADDRESS: 'an address', BANK: 'a bank account' };
const show = (k, v) => {
  if (v == null || v === '') return '—';
  if (k === 'dob') return fmtDate(String(v).slice(0, 10));
  if (k === 'gender' || k === 'type') return label(String(v).toUpperCase());
  if (k === 'accountNumber') return `••••${String(v).slice(-4)}`;
  return String(v);
};
const placeOk = (s) => /^[A-Za-z][A-Za-z .,'()-]*$/.test(String(s || '').trim());
const m10 = (x) => (/^\d{10}$/.test(String(x ?? '').trim()) ? `+91${String(x).trim()}` : x);
const stateOf = (x) => INDIAN_STATES.find((n) => n.toLowerCase() === String(x || '').trim().toLowerCase()) || '';

export default function ChangeRequestPage() {
  const [tab, setTab] = useState('PROFILE');
  const [me, setMe] = useState(null);
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({});
  const [base, setBase] = useState({});        // what the record holds now
  const [editing, setEditing] = useState(null); // pending request being edited
  const [queued, setQueued] = useState(null);   // edit requested from the list on another tab
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState('');
  const [confirm, confirmUi] = useConfirm();

  const loadHistory = () => api.get('/me/change-requests').then(setRows).catch(() => setRows([]));
  useEffect(() => { api.get('/me/full-profile').then(setMe).catch(() => setMe(false)); loadHistory(); }, []);

  // C51/E58/E60: start from what HR holds — gender, the address for the chosen
  // type and every bank field — so only real changes are sent.
  const current = (kind, type = 'CURRENT') => {
    if (kind === 'PROFILE') return { phone: me.phone || '', personalEmail: me.personalEmail || '', dob: me.dob || '', gender: (me.gender || '').toUpperCase() };
    if (kind === 'ADDRESS') {
      const a = (me.addresses || []).find((x) => x.type === type) || {};
      return { type, line1: a.line1 || '', line2: a.line2 || '', city: a.city || '', district: a.district || '', state: stateOf(a.state), pincode: a.pincode || '', country: a.country || 'India' };
    }
    return { accountHolder: me.bank?.accountHolder || '', bankName: me.bank?.bankName || '', branch: me.bank?.branch || '', ifsc: me.bank?.ifsc || '', accountNumber: '' };
  };
  useEffect(() => {
    if (!me) return;
    if (queued && queued.kind === tab) { editPending(queued); setQueued(null); return; }
    const c = current(tab);
    setBase(c); setForm(c); setEditing(null); setErrors({}); setMsg(''); setOk('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, me]);

  const set = (k) => (e) => {
    const val = e.target.value;
    if (k === 'type' && tab === 'ADDRESS') { const c = current('ADDRESS', val); setBase(c); setForm(c); setErrors({}); return; }
    setForm((f) => ({ ...f, [k]: val })); setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const pending = (rows || []).find((r) => r.status === 'PENDING' && r.kind === tab);

  function validate(payload) {
    const v = validator();
    const today = todayIso();
    if (tab === 'PROFILE') {
      if ('phone' in payload) v.mobile('phone', m10(payload.phone), 'Phone');
      if ('personalEmail' in payload) v.email('personalEmail', payload.personalEmail, 'Personal email');
      if ('dob' in payload) v.date('dob', payload.dob, 'Date of birth', { max: addYears(today, -18), maxMsg: 'Date of birth must be in the past and you must be at least 18', min: addYears(today, -80) });
    } else if (tab === 'ADDRESS') {
      if ('line1' in payload) v.text('line1', payload.line1, 'Address line 1', { min: 3, max: 200 });
      if ('city' in payload && !placeOk(payload.city)) v.add('city', 'City should contain letters only');
      if ('district' in payload && !placeOk(payload.district)) v.add('district', 'District should contain letters only');
      if ('state' in payload && !INDIAN_STATES.includes(payload.state)) v.add('state', 'Choose a state from the list');
      if ('pincode' in payload) v.pattern('pincode', payload.pincode, 'pin', 'PIN code');
    } else {
      if ('accountHolder' in payload) v.name('accountHolder', payload.accountHolder, 'Account holder');
      if ('accountNumber' in payload) v.check('accountNumber', payload.accountNumber, /^\d{9,18}$/, 'Account number must be 9–18 digits');
      if ('ifsc' in payload) v.pattern('ifsc', payload.ifsc, 'ifsc', 'IFSC');
      if ('branch' in payload && !placeOk(payload.branch)) v.add('branch', 'Branch should contain letters only');
    }
    return v;
  }

  async function submit(e) {
    e.preventDefault();
    setMsg(''); setOk('');
    // E59/E60: only fields that differ from the record are sent.
    const payload = Object.fromEntries(Object.entries(form)
      .filter(([k, v]) => k !== 'type' && String(v ?? '').trim() !== '' && String(v ?? '').trim() !== String(base[k] ?? '').trim())
      .map(([k, v]) => [k, String(v).trim()]));
    if (!Object.keys(payload).length) { setErrors({}); setMsg('Nothing has changed — edit at least one field before sending.'); return; }
    if (tab === 'ADDRESS') payload.type = form.type || 'CURRENT';
    const v = validate(payload);
    setErrors(v.fields);
    if (!v.ok) return;
    setBusy(true);
    try {
      if (editing) await api.patch(`/me/change-requests/${editing.id}`, { payload });
      else await api.post('/me/change-request', { kind: tab, payload });
      setOk(editing ? 'Your pending request was updated.' : 'Sent to HR. You will see it below as Approved or Rejected once reviewed.');
      setEditing(null);
      loadHistory();
    } catch (err) {
      if (err.fields && !err.fields._form) setErrors(err.fields);
      setMsg(err.fields?._form || (err.fields ? '' : err.message));
    } finally { setBusy(false); }
  }

  function editPending(r) {
    const c = current(r.kind, r.payload?.type || 'CURRENT');
    setBase(c); setForm({ ...c, ...r.payload }); setEditing(r); setErrors({}); setMsg(''); setOk('');
  }
  async function withdraw(r) {
    if (!(await confirm({ title: 'Withdraw this request?', body: 'HR will no longer see it. You can raise a new one afterwards.', confirmLabel: 'Withdraw', tone: 'danger' }))) return;
    try { await api.post(`/me/change-requests/${r.id}/withdraw`); setEditing(null); setOk('Request withdrawn.'); loadHistory(); }
    catch (err) { setMsg(err.message); }
  }

  if (me === null) return <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (me === false) return <Card><Empty title="No employee profile linked" subtitle="Ask HR to link your login to your employee record." /></Card>;
  const showForm = !pending || editing;

  return (
    <div className="space-y-5">
      {confirmUi}
      <PageHeader title="Request a change"
        subtitle="You cannot edit your own record directly. Propose the change here and HR will review it — bank and identity details always go through a checker." />

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              tab === t.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-soft hover:border-slate-400'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-4">
        {pending && !editing && (
          <div className="text-[13px] space-y-3">
            <div>
              <Badge tone="warn">Pending</Badge>
              <p className="text-ink-soft mt-2">You already have {KIND_NOUN[tab]} request waiting with HR, submitted {fmtDate(String(pending.submittedAt).slice(0, 10))}:</p>
              <p className="text-ink mt-1">{Object.entries(pending.payload || {}).map(([k, v]) => `${FIELD_LABEL[k] || k}: ${show(k, v)}`).join(' · ')}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => editPending(pending)}>Edit request</Button>
              <Button variant="outline" onClick={() => withdraw(pending)}>Withdraw</Button>
            </div>
          </div>
        )}
        {showForm && (
          <form onSubmit={submit} noValidate className="space-y-4">
            {editing && <p className="text-[12.5px] text-ink-faint">Editing your pending request — HR sees the updated values.</p>}
            <ErrorSummary errors={errors} />
            <div className="grid gap-3.5 sm:grid-cols-2">
              {tab === 'PROFILE' && (
                <>
                  <Field label="Phone" error={errors.phone}><Input value={form.phone || ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" /></Field>
                  <Field label="Personal email" error={errors.personalEmail}><Input type="email" value={form.personalEmail || ''} onChange={set('personalEmail')} /></Field>
                  <Field label="Date of birth" error={errors.dob}><Input type="date" value={form.dob || ''} onChange={set('dob')} max={addYears(todayIso(), -18)} min={addYears(todayIso(), -80)} /></Field>
                  <Field label="Gender" error={errors.gender}>
                    <Select value={form.gender || ''} onChange={set('gender')}>
                      <option value="">— select —</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
                    </Select>
                  </Field>
                </>
              )}
              {tab === 'ADDRESS' && (
                <>
                  <Field label="Address type" required>
                    <Select value={form.type || 'CURRENT'} onChange={set('type')} disabled={!!editing}>
                      <option value="CURRENT">Present</option><option value="PERMANENT">Permanent</option>
                    </Select>
                  </Field>
                  <Field label="PIN code" error={errors.pincode}><Input value={form.pincode || ''} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))} inputMode="numeric" maxLength={6} /></Field>
                  <Field label="Address line 1" error={errors.line1}><Input value={form.line1 || ''} onChange={set('line1')} /></Field>
                  <Field label="Address line 2" error={errors.line2}><Input value={form.line2 || ''} onChange={set('line2')} /></Field>
                  <Field label="City" error={errors.city}><Input value={form.city || ''} onChange={set('city')} /></Field>
                  <Field label="District" error={errors.district}><Input value={form.district || ''} onChange={set('district')} /></Field>
                  <Field label="State" error={errors.state}>
                    <Select value={form.state || ''} onChange={set('state')}>
                      <option value="">Select…</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
                    </Select>
                  </Field>
                </>
              )}
              {tab === 'BANK' && (
                <>
                  <Field label="Account holder" error={errors.accountHolder} hint="Exactly as printed in the passbook"><Input value={form.accountHolder || ''} onChange={set('accountHolder')} /></Field>
                  <Field label="Bank" error={errors.bankName}><Input value={form.bankName || ''} onChange={set('bankName')} /></Field>
                  <Field label="Branch" error={errors.branch}><Input value={form.branch || ''} onChange={set('branch')} /></Field>
                  <Field label="IFSC" error={errors.ifsc} hint="e.g. HDFC0001234"><Input value={form.ifsc || ''} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} maxLength={11} /></Field>
                  <Field label="New account number" error={errors.accountNumber} hint={`Current: ${me.bank?.accountNumberMasked || '—'} — leave blank to keep`}><Input value={form.accountNumber || ''} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" /></Field>
                </>
              )}
            </div>
            {msg && <p className="text-[13px] text-neg">{msg}</p>}
            {ok && <p className="text-[13px] text-pos">{ok}</p>}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>{busy ? <Spinner /> : editing ? 'Update request' : 'Send to HR'}</Button>
              {editing && <Button type="button" variant="ghost" onClick={() => { setEditing(null); setErrors({}); }}>Cancel</Button>}
              <span className="text-[11.5px] text-ink-faint">Only the fields you change are sent.</span>
            </div>
          </form>
        )}
        {!showForm && ok && <p className="text-[13px] text-pos mt-3">{ok}</p>}
      </Card>

      <section>
        <h2 className="mb-2.5">My requests</h2>
        <Card className="overflow-hidden">
          {rows === null ? <div className="p-8 grid place-items-center"><Spinner className="text-brand-600 h-5 w-5" /></div>
            : rows.length === 0 ? <Empty title="Nothing requested yet" subtitle="Changes you propose appear here with their status." />
            : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr><th className="text-left">Type</th><th className="text-left">What you asked for</th><th className="text-left">Submitted</th><th className="text-left">Status</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 whitespace-nowrap text-ink font-medium">{KIND_LABEL[r.kind] || label(r.kind)}</td>
                      <td className="px-4 max-w-[420px] text-[12.5px] text-ink-soft">
                        {Object.entries(r.payload || {}).map(([k, v]) => `${FIELD_LABEL[k] || k}: ${show(k, v)}`).join(' · ')}
                      </td>
                      <td className="px-4 whitespace-nowrap text-ink-soft text-[12.5px]">{fmtDate(String(r.submittedAt).slice(0, 10))}</td>
                      <td className="px-4">
                        <Badge tone={TONE[r.status] || 'neutral'}>{label(r.status)}</Badge>
                        {r.reviewNote && <div className="text-ink-faint text-[11.5px] mt-1 max-w-[240px]">{r.reviewNote}</div>}
                      </td>
                      <td className="px-4 whitespace-nowrap text-right">
                        {r.status === 'PENDING' && (
                          <>
                            <button type="button" className="text-brand-700 text-[12px] font-semibold mr-3" onClick={() => { if (r.kind === tab) editPending(r); else { setQueued(r); setTab(r.kind); } window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
                            <button type="button" className="text-neg text-[12px] font-semibold" onClick={() => withdraw(r)}>Withdraw</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
