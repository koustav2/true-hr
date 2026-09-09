'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Field, Input, Select, Spinner, Empty, Badge, PageHeader } from '@/components/ui.jsx';

const TABS = [
  { key: 'PROFILE', label: 'Personal details' },
  { key: 'ADDRESS', label: 'Address' },
  { key: 'BANK', label: 'Bank account' },
];
const FIELD_LABEL = {
  phone: 'Phone', personalEmail: 'Personal email', dob: 'Date of birth', gender: 'Gender',
  type: 'Address type', line1: 'Address line 1', line2: 'Address line 2', city: 'City',
  state: 'State', pincode: 'PIN code', country: 'Country',
  accountHolder: 'Account holder', bankName: 'Bank', branch: 'Branch',
  ifsc: 'IFSC', accountNumber: 'Account number',
};
const TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger' };
const KIND_LABEL = { PROFILE: 'Personal details', ADDRESS: 'Address', BANK: 'Bank account' };

const dmy = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const day = (v) => (v ? String(v).slice(0, 10) : '');

export default function ChangeRequestPage() {
  const [tab, setTab] = useState('PROFILE');
  const [me, setMe] = useState(null);
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState('');

  const loadHistory = () => api.get('/me/change-requests').then(setRows).catch(() => setRows([]));
  useEffect(() => { api.get('/me/profile').then(setMe).catch(() => setMe(false)); loadHistory(); }, []);

  // Reset the form to the current record whenever the tab changes, so the
  // employee edits from what HR actually holds rather than a blank slate.
  useEffect(() => {
    if (!me) return;
    if (tab === 'PROFILE') setForm({ phone: me.phone || '', personalEmail: me.personalEmail || '', dob: day(me.dob), gender: me.gender || '' });
    else if (tab === 'ADDRESS') setForm({ type: 'CURRENT', line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' });
    else setForm({ accountHolder: '', bankName: me.bank?.name || '', branch: me.bank?.branch || '', ifsc: me.bank?.ifsc || '', accountNumber: '' });
    setMsg(''); setOk('');
  }, [tab, me]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pending = (rows || []).find((r) => r.status === 'PENDING' && r.kind === tab);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(''); setOk('');
    const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => String(v ?? '').trim() !== ''));
    try {
      await api.post('/me/change-request', { kind: tab, payload });
      setOk('Sent to HR. You will see it here as Approved or Rejected once reviewed.');
      loadHistory();
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }

  if (me === null) return <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (me === false) return <Card><Empty title="No employee profile linked" subtitle="Ask HR to link your login to your employee record." /></Card>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Request a change"
        subtitle="You cannot edit your own record directly. Propose the change here and HR will review it — bank and identity details always go through a checker."
      />

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              tab === t.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-soft hover:border-slate-400'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-4">
        {pending ? (
          <div className="text-[13px]">
            <Badge tone="warn">PENDING</Badge>
            <p className="text-ink-soft mt-2">
              You already have a {KIND_LABEL[tab].toLowerCase()} request waiting with HR, submitted {dmy(pending.submittedAt)}.
              You can raise another once this one is decided.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3.5 sm:grid-cols-2">
              {tab === 'PROFILE' && (
                <>
                  <Field label="Phone"><Input value={form.phone || ''} onChange={set('phone')} inputMode="tel" placeholder="10-digit mobile" /></Field>
                  <Field label="Personal email"><Input type="email" value={form.personalEmail || ''} onChange={set('personalEmail')} /></Field>
                  <Field label="Date of birth"><Input type="date" value={form.dob || ''} onChange={set('dob')} /></Field>
                  <Field label="Gender">
                    <Select value={form.gender || ''} onChange={set('gender')}>
                      <option value="">— select —</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </Select>
                  </Field>
                </>
              )}
              {tab === 'ADDRESS' && (
                <>
                  <Field label="Address type" required>
                    <Select value={form.type || 'CURRENT'} onChange={set('type')}>
                      <option value="CURRENT">Current</option>
                      <option value="PERMANENT">Permanent</option>
                    </Select>
                  </Field>
                  <Field label="PIN code"><Input value={form.pincode || ''} onChange={set('pincode')} inputMode="numeric" maxLength={6} /></Field>
                  <Field label="Address line 1"><Input value={form.line1 || ''} onChange={set('line1')} /></Field>
                  <Field label="Address line 2"><Input value={form.line2 || ''} onChange={set('line2')} /></Field>
                  <Field label="City"><Input value={form.city || ''} onChange={set('city')} /></Field>
                  <Field label="State"><Input value={form.state || ''} onChange={set('state')} /></Field>
                  <Field label="Country"><Input value={form.country || ''} onChange={set('country')} /></Field>
                </>
              )}
              {tab === 'BANK' && (
                <>
                  <Field label="Account holder" hint="Exactly as printed in the passbook"><Input value={form.accountHolder || ''} onChange={set('accountHolder')} /></Field>
                  <Field label="Bank"><Input value={form.bankName || ''} onChange={set('bankName')} /></Field>
                  <Field label="Branch"><Input value={form.branch || ''} onChange={set('branch')} /></Field>
                  <Field label="IFSC" hint="e.g. HDFC0001234"><Input value={form.ifsc || ''} onChange={set('ifsc')} className="uppercase" /></Field>
                  <Field label="Account number" hint="Stored encrypted; HR sees it only on approval"><Input value={form.accountNumber || ''} onChange={set('accountNumber')} inputMode="numeric" /></Field>
                </>
              )}
            </div>
            {msg && <p className="text-[13px] text-neg">{msg}</p>}
            {ok && <p className="text-[13px] text-pos">{ok}</p>}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>{busy ? <Spinner /> : 'Send to HR'}</Button>
              <span className="text-[11.5px] text-ink-faint">Leave a field untouched and it stays as it is.</span>
            </div>
          </form>
        )}
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
                  <tr>
                    <th className="text-left">Type</th>
                    <th className="text-left">What you asked for</th>
                    <th className="text-left">Submitted</th>
                    <th className="text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 whitespace-nowrap text-ink font-medium">{KIND_LABEL[r.kind] || r.kind}</td>
                      <td className="px-4 max-w-[420px] text-[12.5px] text-ink-soft">
                        {Object.entries(r.payload || {}).map(([k, v]) => `${FIELD_LABEL[k] || k}: ${v}`).join(' · ')}
                      </td>
                      <td className="px-4 whitespace-nowrap text-ink-soft text-[12.5px]">{dmy(r.submittedAt)}</td>
                      <td className="px-4">
                        <Badge tone={TONE[r.status] || 'neutral'}>{r.status}</Badge>
                        {r.reviewNote && <div className="text-ink-faint text-[11.5px] mt-1 max-w-[240px]">{r.reviewNote}</div>}
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
