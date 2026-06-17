import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Logo } from '../../components/Brand.jsx';
import { Card, Button, Input, Field, Spinner } from '../../components/ui.jsx';
import SignaturePad from '../../components/SignaturePad.jsx';

const STEPS = ['Bank details', 'Statutory info', 'Address', 'Review & sign'];

export default function OnboardingForm() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const nav = useNavigate();
  const [boot, setBoot] = useState({ loading: true });
  const [step, setStep] = useState(0);
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [bank, setBank] = useState({ accountHolder: '', accountNumber: '', ifsc: '', bankName: '', branch: '' });
  const [stat, setStat] = useState({ pan: '', aadhaar: '', uan: '', pfNumber: '', esiNumber: '' });
  const [addr, setAddr] = useState({ line1: '', line2: '', city: '', state: '', pincode: '' });

  useEffect(() => {
    if (!token) { setBoot({ error: 'Missing link token.' }); return; }
    api.get(`/onboarding/form?token=${encodeURIComponent(token)}`)
      .then((d) => { setBoot({ data: d }); if (d.employee?.first_name) setBank((b) => ({ ...b, accountHolder: `${d.employee.first_name} ${d.employee.last_name}` })); })
      .catch((e) => setBoot({ error: e.message }));
  }, [token]);

  const sb = (set) => (k) => (e) => set((p) => ({ ...p, [k]: e.target.value }));
  const setBankF = sb(setBank), setStatF = sb(setStat), setAddrF = sb(setAddr);

  async function finish() {
    if (!signature) { setErr('Please add your e-signature to submit.'); return; }
    setErr(''); setBusy(true);
    try {
      await api.post('/onboarding/details', {
        token, bank, statutory: stat,
        addresses: [{ type: 'CURRENT', ...addr, country: 'India' }],
      });
      await api.post('/onboarding/esign', { token, signature });
      nav('/onboarding/done');
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  if (boot.loading) return <Center><Spinner className="text-brand-600 h-6 w-6" /></Center>;
  if (boot.error) return <Center><Card className="p-8 max-w-md text-center"><div className="text-4xl mb-3">⚠️</div><p className="text-ink-soft">{boot.error}</p></Card></Center>;
  if (boot.data.submitted) return <Center><Card className="p-8 max-w-md text-center"><div className="text-4xl mb-3">✅</div><p className="text-ink-soft">Your details are already submitted and under review. We'll email you once HR approves.</p></Card></Center>;

  const emp = boot.data.employee;
  const notes = boot.data.reviewNotes;
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex justify-center mb-6"><Logo size={44} /></div>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 flex items-center">
              <div className={`grid place-items-center h-8 w-8 rounded-full text-xs font-bold shrink-0 transition ${
                i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 mx-1.5 ${i < step ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        <Card className="p-7 animate-in">
          <h1 className="text-xl font-bold text-ink">Onboarding · {STEPS[step]}</h1>
          <p className="text-ink-faint text-sm mb-5">Hi {emp.first_name}, please complete your details to finish onboarding.</p>

          {notes && step === 0 && (
            <div className="mb-5 text-sm bg-orange-50 text-orange-800 rounded-xl px-4 py-3">
              <strong>HR requested changes:</strong> {notes}
            </div>
          )}

          {step === 0 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Account holder name" required><Input value={bank.accountHolder} onChange={setBankF('accountHolder')} /></Field>
              <Field label="Account number" required><Input value={bank.accountNumber} onChange={setBankF('accountNumber')} inputMode="numeric" /></Field>
              <Field label="IFSC" required><Input value={bank.ifsc} onChange={setBankF('ifsc')} className="uppercase" /></Field>
              <Field label="Bank name"><Input value={bank.bankName} onChange={setBankF('bankName')} /></Field>
              <Field label="Branch"><Input value={bank.branch} onChange={setBankF('branch')} /></Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="PAN" required hint="10-character PAN"><Input value={stat.pan} onChange={setStatF('pan')} className="uppercase" maxLength={10} /></Field>
              <Field label="Aadhaar number" required hint="Stored encrypted"><Input value={stat.aadhaar} onChange={setStatF('aadhaar')} inputMode="numeric" maxLength={12} /></Field>
              <Field label="UAN (if any)"><Input value={stat.uan} onChange={setStatF('uan')} /></Field>
              <Field label="PF number (if any)"><Input value={stat.pfNumber} onChange={setStatF('pfNumber')} /></Field>
              <Field label="ESI number (if any)"><Input value={stat.esiNumber} onChange={setStatF('esiNumber')} /></Field>
            </div>
          )}

          {step === 2 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2"><Field label="Address line 1" required><Input value={addr.line1} onChange={setAddrF('line1')} /></Field></div>
              <div className="sm:col-span-2"><Field label="Address line 2"><Input value={addr.line2} onChange={setAddrF('line2')} /></Field></div>
              <Field label="City" required><Input value={addr.city} onChange={setAddrF('city')} /></Field>
              <Field label="State" required><Input value={addr.state} onChange={setAddrF('state')} /></Field>
              <Field label="Pincode" required><Input value={addr.pincode} onChange={setAddrF('pincode')} inputMode="numeric" maxLength={6} /></Field>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-px bg-slate-100 rounded-xl overflow-hidden text-sm">
                {[
                  ['Account holder', bank.accountHolder], ['Account no.', bank.accountNumber ? '••••' + bank.accountNumber.slice(-4) : '—'],
                  ['IFSC', bank.ifsc], ['PAN', stat.pan || '—'],
                  ['Aadhaar', stat.aadhaar ? '••••••••' + stat.aadhaar.slice(-4) : '—'],
                  ['City', addr.city || '—'],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white p-3"><div className="text-xs text-ink-faint">{k}</div><div className="font-medium text-ink">{v || '—'}</div></div>
                ))}
              </div>
              <div>
                <div className="text-sm font-medium text-ink-soft mb-2">Declaration & e-signature <span className="text-rose-500">*</span></div>
                <p className="text-xs text-ink-faint mb-3">I confirm the information provided is true and correct to the best of my knowledge.</p>
                <SignaturePad onChange={setSignature} />
              </div>
            </div>
          )}

          {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-4">{err}</div>}

          <div className="flex items-center justify-between mt-6">
            <Button variant="ghost" onClick={prev} disabled={step === 0}>← Back</Button>
            {step < STEPS.length - 1
              ? <Button onClick={next}>Continue →</Button>
              : <Button onClick={finish} disabled={busy}>{busy ? <Spinner /> : 'Submit & e-sign'}</Button>}
          </div>
        </Card>
        <p className="text-center text-xs text-ink-faint mt-4">🔒 Your PAN, Aadhaar and bank details are encrypted and visible only to HR in masked form.</p>
      </div>
    </div>
  );
}
function Center({ children }) { return <div className="min-h-full grid place-items-center p-6">{children}</div>; }
