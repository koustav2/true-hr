import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Logo } from '../../components/Brand.jsx';
import { Card, Button, Spinner } from '../../components/ui.jsx';

const fmtINR = (n) => n ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

export default function Accept() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const nav = useNavigate();
  const [state, setState] = useState({ loading: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setState({ error: 'Missing link token.' }); return; }
    api.get(`/onboarding/accept?token=${encodeURIComponent(token)}`)
      .then((d) => setState({ data: d }))
      .catch((e) => setState({ error: e.message }));
  }, [token]);

  async function accept() {
    setBusy(true);
    try {
      const r = await api.post('/onboarding/accept', { token });
      nav(`/onboarding/form?token=${encodeURIComponent(r.formToken)}`);
    } catch (e) { setState((s) => ({ ...s, error: e.message })); setBusy(false); }
  }

  if (state.loading) return <Center><Spinner className="text-brand-600 h-6 w-6" /></Center>;
  if (state.error) return <Center><Card className="p-8 max-w-md text-center"><div className="text-4xl mb-3">⚠️</div><p className="text-ink-soft">{state.error}</p></Card></Center>;

  const o = state.data.offer;
  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex justify-center mb-6"><Logo size={44} /></div>
        <Card className="overflow-hidden animate-in">
          <div className="px-8 py-7 text-white" style={{ background: 'linear-gradient(135deg,#4f46e5,#4338ca)' }}>
            <div className="text-xs uppercase tracking-[0.2em] text-white/70">Letter of Offer</div>
            <h1 className="text-2xl font-extrabold mt-1">Welcome aboard, {o.first_name}!</h1>
            <p className="text-white/80 text-sm mt-1">{o.company} is delighted to offer you a position.</p>
          </div>
          <div className="p-8 space-y-5">
            <p className="text-ink-soft leading-relaxed">
              Dear {o.first_name} {o.last_name}, we are pleased to extend this offer for the role of
              <strong className="text-ink"> {o.designation || 'your new position'}</strong>
              {o.department ? <> in the <strong className="text-ink">{o.department}</strong> team</> : null}. Please review the summary below and accept to begin your onboarding.
            </p>
            <div className="grid sm:grid-cols-2 gap-px bg-slate-100 rounded-xl overflow-hidden">
              {[
                ['Designation', o.designation || '—'],
                ['Department', o.department || '—'],
                ['Employment type', (o.employment_type || '').replace('_',' ').toLowerCase() || '—'],
                ['Annual CTC', fmtINR(o.ctc)],
                ['Date of joining', o.date_of_joining ? new Date(o.date_of_joining).toLocaleDateString() : 'To be confirmed'],
                ['Work email', o.official_email],
              ].map(([k, v]) => (
                <div key={k} className="bg-white p-4">
                  <div className="text-xs text-ink-faint">{k}</div>
                  <div className="font-semibold text-ink capitalize">{v}</div>
                </div>
              ))}
            </div>
            <div className="bg-brand-50 rounded-xl p-4 text-sm text-brand-800">
              By accepting, you confirm the details above and agree to provide your onboarding documents in the next step.
            </div>
            {state.error && <div className="text-sm text-rose-600">{state.error}</div>}
            <Button onClick={accept} disabled={busy} className="w-full">{busy ? <Spinner /> : 'Accept offer & continue →'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
function Center({ children }) { return <div className="min-h-full grid place-items-center p-6">{children}</div>; }
