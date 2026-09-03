'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth.jsx';
import { homeFor } from '@/lib/permissions.js';
import { Logo } from '@/components/Brand.jsx';
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
    <div className="min-h-screen grid lg:grid-cols-[1.08fr_1fr] bg-canvas">
      {/* Left: brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-14 text-white overflow-hidden"
        style={{ background: 'linear-gradient(125deg,#12225e 0%,#1d4ed8 44%,#12a150 118%)' }}>
        <div className="pointer-events-none absolute -right-32 -bottom-36 h-[30rem] w-[30rem] rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute right-24 top-2 h-52 w-52 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.9) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />

        <div className="relative z-10"><Logo light size={38} /></div>

        <div className="relative z-10">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/12 ring-1 ring-inset ring-white/20 px-3.5 py-1.5 text-[12px] font-semibold tracking-wide backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> People operations, on autopilot
          </span>
          <h1 className="mt-6 text-[44px] leading-[1.05] font-extrabold tracking-[-0.03em]">Onboard people,<br/>not paperwork.</h1>
          <p className="mt-5 text-white/80 max-w-md leading-relaxed text-[15px]">
            From offer letter to first login — TRUE HR runs the entire onboarding journey, automatically.
          </p>
          <ul className="mt-9 space-y-3.5 max-w-md">
            {FEATURES.map(([t, d]) => (
              <li key={t} className="flex items-start gap-3.5">
                <span className="mt-0.5 grid place-items-center h-6 w-6 rounded-lg bg-white/15 ring-1 ring-inset ring-white/25 shrink-0">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                </span>
                <span>
                  <span className="block text-[14px] font-semibold">{t}</span>
                  <span className="block text-[12.5px] text-white/65 leading-snug">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 text-white/55 text-[13px]">© {new Date().getFullYear()} TRUE HR · True HR Pvt Ltd</div>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[400px] animate-in">
          <div className="lg:hidden mb-9"><Logo size={38} /></div>

          {otpStage ? (
            <>
              <h2 className="text-[26px] font-extrabold text-ink tracking-tight">Check your email</h2>
              <p className="text-ink-faint text-sm mt-2 mb-7 leading-relaxed">
                We emailed a 6-digit sign-in code to <span className="font-semibold text-ink">{otpStage.maskedEmail}</span>. It expires in 10 minutes.
              </p>
              <form onSubmit={submitOtp} className="space-y-4">
                <Field label="Sign-in code">
                  <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus required
                    className="text-center tracking-[0.5em] font-bold text-lg font-mono" />
                </Field>
                {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{err}</div>}
                {info && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5">{info}</div>}
                <Button type="submit" disabled={loading || otp.length !== 6} className="w-full" size="lg">{loading ? <Spinner /> : 'Verify & sign in'}</Button>
                <div className="flex justify-between text-sm pt-1">
                  <button type="button" onClick={() => { setOtpStage(null); setErr(''); setInfo(''); }} className="text-ink-faint hover:text-ink font-medium">← Back</button>
                  <button type="button" onClick={resend} disabled={loading} className="text-brand-700 font-semibold hover:underline">Resend code</button>
                </div>
              </form>
            </>
          ) : (
          <>
          <h2 className="text-[28px] font-extrabold text-ink tracking-[-0.02em]">Welcome back</h2>
          <p className="text-ink-faint text-sm mt-2 mb-7">Sign in to the HR admin console.</p>
          {expired && (
            <div className="flex items-start gap-2.5 text-sm text-amber-800 bg-amber-50 border border-amber-200/70 rounded-xl px-3.5 py-3 mb-5">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-px shrink-0"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
              <span>Your session expired. Please sign in again.</span>
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email or Employee ID"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com or TKF5001" required /></Field>
            <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required /></Field>
            {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{err}</div>}
            <div className="text-right -mt-1">
              <Link href="/forgot-password" className="text-sm text-brand-700 font-semibold hover:underline">Forgot password?</Link>
            </div>
            <Button type="submit" disabled={loading} className="w-full" size="lg">{loading ? <Spinner /> : 'Sign in'}</Button>
          </form>
          <p className="text-center text-xs text-ink-faint mt-7 leading-relaxed">
            Protected by encryption. Trouble signing in? Contact your HR administrator.
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
