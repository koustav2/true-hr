'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth.jsx';
import { homeFor } from '@/lib/permissions.js';
import { Button, Input, Field, Spinner } from '@/components/ui.jsx';

export default function LoginPage() {
  const { login, verifyLoginOtp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('hr@truehr.example');
  const [password, setPassword] = useState('');
  const [otpStage, setOtpStage] = useState(null); // { maskedEmail } once the code is emailed
  const [otp, setOtp] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  if (typeof window !== 'undefined' && !expired && window.location.search.includes('expired=1')) setExpired(true);

  const go = (user) => router.push(user.mustChangePassword ? '/change-password' : homeFor(user.role));

  async function submit(e) {
    e?.preventDefault();
    setErr(''); setInfo(''); setLoading(true);
    try {
      const r = await login(email, password);
      if (r.otpRequired) { setOtpStage({ maskedEmail: r.maskedEmail }); setOtp(''); }
      else go(r);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }

  async function submitOtp(e) {
    e.preventDefault();
    setErr(''); setInfo(''); setLoading(true);
    try { go(await verifyLoginOtp(email, otp)); }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  }

  async function resend() {
    setErr(''); setInfo(''); setLoading(true);
    try { await login(email, password); setOtp(''); setInfo('A new code has been emailed.'); }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  }

  const FEATURES = [
    ['Automated offers', 'Offer to acceptance without the email ping-pong'],
    ['E-signed documents', 'Legally-binding, stored and searchable'],
    ['Encrypted PII', 'AES-256 at rest — private by default'],
  ];

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_460px] bg-canvas">
      {/* ── Product panel ────────────────────────────────────────────── */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-shell text-white overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-[.07]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.8) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
        <div className="relative z-10 flex items-center gap-3">
          <span className="grid place-items-center h-8 w-8 rounded bg-brand-gradient text-[11px] font-bold">TK</span>
          <span className="font-semibold text-[15px] tracking-tight">True HR</span>
          <span className="h-4 w-px bg-white/25" />
          <span className="text-[12.5px] text-white/60">People Operations Platform</span>
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-[-.02em]">Onboard people,<br/>not paperwork.</h1>
          <p className="mt-4 text-white/65 leading-relaxed text-[14px]">
            From offer letter to first login — TRUE HR runs the entire employee lifecycle across every company in your organisation.
          </p>
          <div className="mt-9 grid gap-px bg-white/10 rounded overflow-hidden">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="bg-shell/60 px-4 py-3.5">
                <div className="text-[13px] font-semibold text-white/90">{t}</div>
                <div className="text-[12px] text-white/55 mt-0.5">{d}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-white/45 text-[12px]">© {new Date().getFullYear()} TRUE HR · True HR Pvt Ltd</div>
      </div>

      {/* ── Sign-in ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center p-6 sm:p-10 bg-white lg:border-l border-line">
        <div className="w-full max-w-[356px] animate-in">
          <div className="lg:hidden mb-8 flex items-center gap-2.5">
            <span className="grid place-items-center h-7 w-7 rounded bg-brand-gradient text-white text-[10px] font-bold">TK</span>
            <span className="font-semibold text-[15px] text-ink">True HR</span>
          </div>

          {otpStage ? (
            <>
              <h2 className="text-[21px] font-semibold text-ink tracking-[-.015em]">Check your email</h2>
              <p className="text-ink-faint text-[13px] mt-1.5 mb-6 leading-relaxed">
                We emailed a 6-digit sign-in code to <span className="font-semibold text-ink font-mono">{otpStage.maskedEmail}</span>. It expires in 10 minutes.
              </p>
              <form onSubmit={submitOtp} className="space-y-4">
                <Field label="Sign-in code">
                  <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus required
                    className="text-center tracking-[0.45em] font-semibold text-base font-mono" />
                </Field>
                {err && <div className="text-[12.5px] text-neg bg-neg-bg border border-neg/20 rounded px-3 py-2">{err}</div>}
                {info && <div className="text-[12.5px] text-pos bg-pos-bg border border-pos/20 rounded px-3 py-2">{info}</div>}
                <Button type="submit" disabled={loading || otp.length !== 6} className="w-full" size="lg">{loading ? <Spinner /> : 'Verify & sign in'}</Button>
                <div className="flex justify-between text-[12.5px] pt-1">
                  <button type="button" onClick={() => { setOtpStage(null); setErr(''); setInfo(''); }} className="text-ink-faint hover:text-ink font-medium">← Back</button>
                  <button type="button" onClick={resend} disabled={loading} className="text-brand-600 font-semibold hover:underline">Resend code</button>
                </div>
              </form>
            </>
          ) : (
          <>
          <h2 className="text-[21px] font-semibold text-ink tracking-[-.015em]">Sign in</h2>
          <p className="text-ink-faint text-[13px] mt-1.5 mb-6">Use your work email or Employee ID.</p>
          {expired && (
            <div className="flex items-start gap-2.5 text-[12.5px] text-crit bg-crit-bg border border-crit/20 rounded px-3 py-2.5 mb-5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-px shrink-0"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
              <span>Your session expired. Please sign in again.</span>
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email or Employee ID"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com or TKF5001" required /></Field>
            <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required /></Field>
            {err && <div className="text-[12.5px] text-neg bg-neg-bg border border-neg/20 rounded px-3 py-2">{err}</div>}
            <div className="text-right -mt-1">
              <Link href="/forgot-password" className="text-[12.5px] text-brand-600 font-semibold hover:underline">Forgot password?</Link>
            </div>
            <Button type="submit" disabled={loading} className="w-full" size="lg">{loading ? <Spinner /> : 'Sign in'}</Button>
          </form>
          <p className="text-center text-[11.5px] text-ink-faint mt-7 leading-relaxed">
            Protected by encryption. Trouble signing in? Contact your HR administrator.
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
