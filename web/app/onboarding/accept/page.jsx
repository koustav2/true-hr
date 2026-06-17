'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { Logo } from '@/components/Brand.jsx';
import { Card, Button, Spinner, Textarea } from '@/components/ui.jsx';

function Center({ children }) { return <div className="min-h-screen grid place-items-center p-6 bg-canvas">{children}</div>; }

function AcceptInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const router = useRouter();
  const [state, setState] = useState({ loading: true });
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('view');     // view | rejecting | declined
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!token) { setState({ error: 'Missing link token.' }); return; }
    api.get(`/onboarding/accept?token=${encodeURIComponent(token)}`)
      .then((d) => { setState({ data: d }); if (d.state === 'REJECTED') setMode('declined'); })
      .catch((e) => setState({ error: e.message }));
  }, [token]);

  async function accept() {
    setBusy(true);
    try { const r = await api.post('/onboarding/accept', { token }); router.push(`/onboarding/form?token=${encodeURIComponent(r.formToken)}`); }
    catch (e) { setState((s) => ({ ...s, error: e.message })); setBusy(false); }
  }
  async function reject() {
    setBusy(true);
    try { await api.post('/onboarding/reject', { token, reason }); setMode('declined'); }
    catch (e) { setState((s) => ({ ...s, error: e.message })); } finally { setBusy(false); }
  }

  if (state.loading) return <Center><Spinner className="text-brand-600 h-6 w-6" /></Center>;
  if (state.error) return <Center><Card className="p-8 max-w-md text-center"><div className="text-4xl mb-3">⚠️</div><p className="text-ink-soft">{state.error}</p></Card></Center>;

  if (mode === 'declined') {
    return <Center><Card className="max-w-md w-full p-10 text-center">
      <div className="flex justify-center mb-6"><Logo size={40} /></div>
      <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-rose-50 text-rose-600 text-2xl mb-4">✕</div>
      <h1 className="text-xl font-bold text-ink">Offer declined</h1>
      <p className="text-ink-soft mt-2 text-sm">You have declined this offer. Our HR team has been notified. If this was a mistake, please contact HR.</p>
    </Card></Center>;
  }

  const o = state.data.offer;
  const accent = '#059669';
  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex justify-center mb-6"><Logo size={44} /></div>
        <Card className="overflow-hidden">
          <div className="px-8 py-7 text-white" style={{ background: `linear-gradient(135deg,${accent},#0d9488)` }}>
            <div className="text-xs uppercase tracking-[0.2em] text-white/70">Letter of Offer</div>
            <h1 className="text-2xl font-extrabold mt-1">Welcome aboard, {o.first_name}!</h1>
            <p className="text-white/85 text-sm mt-1">{o.company} is delighted to offer you a position.</p>
          </div>
          <div className="p-8 space-y-5">
            <p className="text-ink-soft leading-relaxed">
              Dear {o.first_name} {o.last_name}, we are pleased to extend this offer for the role of
              <strong className="text-ink"> {o.designation || 'your new position'}</strong>
              {o.department ? <> in the <strong className="text-ink">{o.department}</strong> team</> : null}. Please review and respond below.
            </p>
            <div className="grid sm:grid-cols-2 gap-px bg-slate-100 rounded-xl overflow-hidden">
              {[
                ['Designation', o.designation || '—'], ['Department', o.department || '—'],
                ['Employment type', (o.employment_type || '').replace('_', ' ').toLowerCase() || '—'],
                ['Location', o.location || 'To be confirmed'],
                ['Date of joining', o.date_of_joining ? new Date(o.date_of_joining).toLocaleDateString() : 'To be confirmed'],
                ['Work email', o.official_email],
              ].map(([k, v]) => (
                <div key={k} className="bg-white p-4"><div className="text-xs text-ink-faint">{k}</div><div className="font-semibold text-ink capitalize">{v}</div></div>
              ))}
            </div>

            {state.data.hasOfferLetter && (
              <a href={`/api/onboarding/offer-letter?token=${encodeURIComponent(token)}`} target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-3 rounded-xl border border-line bg-slate-50 px-4 py-3 hover:border-brand-300 hover:bg-brand-50/50 transition-colors">
                <span className="grid place-items-center h-10 w-10 rounded-lg bg-rose-50 text-rose-600 shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">View Offer Letter</span><span className="block text-xs text-ink-faint">Opens the signed PDF in a new tab</span></span>
                <span className="text-brand-700 text-sm font-medium">Open →</span>
              </a>
            )}

            {state.error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{state.error}</div>}

            {mode === 'rejecting' ? (
              <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4">
                <div className="text-sm font-medium text-ink">Decline this offer?</div>
                <Textarea rows={3} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="danger" onClick={reject} disabled={busy}>{busy ? <Spinner /> : 'Confirm decline'}</Button>
                  <Button variant="outline" onClick={() => setMode('view')} disabled={busy}>Go back</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <Button onClick={accept} disabled={busy} className="flex-1">{busy ? <Spinner /> : 'Accept offer & continue →'}</Button>
                <Button variant="outline" onClick={() => setMode('rejecting')} disabled={busy} className="sm:w-auto">Reject offer</Button>
              </div>
            )}
            <p className="text-xs text-ink-faint">By accepting, you confirm the details above and agree to complete your e-joining documents in the next step.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AcceptPage() {
  return <Suspense fallback={<Center><Spinner className="text-brand-600 h-6 w-6" /></Center>}><AcceptInner /></Suspense>;
}
