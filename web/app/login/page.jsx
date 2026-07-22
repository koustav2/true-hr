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

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-white">
      {/* Left: brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(150deg,#1e3a8a 0%,#2563eb 45%,#16a34a 100%)' }}>
        <Logo light size={36} />
        <div className="relative z-10">
          <h1 className="text-[40px] leading-[1.1] font-extrabold tracking-tight">Onboard people,<br/>not paperwork.</h1>
          <p className="mt-5 text-white/85 max-w-md leading-relaxed">From offer letter to first login — TRUE HR runs the entire onboarding journey, automatically.</p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            {['Automated offers', 'E-signed documents', 'Encrypted PII'].map((t) => (
              <span key={t} className="text-[13px] rounded-full bg-white/15 px-3 py-1.5 backdrop-blur">{t}</span>
            ))}
          </div>
        </div>
        <div className="text-white/60 text-sm relative z-10">© {new Date().getFullYear()} TRUE HR · True HR Pvt Ltd</div>
        <div className="absolute -right-28 -bottom-28 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute right-24 top-6 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-6 bg-canvas">
        <div className="w-full max-w-sm animate-in">
          <div className="lg:hidden mb-8"><Logo size={36} /></div>
          {otpStage ? (
            <>
              <h2 className="text-2xl font-bold text-ink tracking-tight">Check your email</h2>
              <p className="text-ink-faint text-sm mt-1.5 mb-7">
                We emailed a 6-digit sign-in code to <span className="font-medium text-ink">{otpStage.maskedEmail}</span>. It expires in 10 minutes.
              </p>
              <form onSubmit={submitOtp} className="space-y-4">
                <Field label="Sign-in code">
                  <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus required
                    className="text-center tracking-[0.5em] font-bold text-lg" />
                </Field>
                {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}
                {info && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{info}</div>}
                <Button type="submit" disabled={loading || otp.length !== 6} className="w-full">{loading ? <Spinner /> : 'Verify & sign in'}</Button>
                <div className="flex justify-between text-sm">
                  <button type="button" onClick={() => { setOtpStage(null); setErr(''); setInfo(''); }} className="text-ink-faint hover:underline">← Back</button>
                  <button type="button" onClick={resend} disabled={loading} className="text-brand-700 font-medium hover:underline">Resend code</button>
                </div>
              </form>
            </>
          ) : (
          <>
          <h2 className="text-2xl font-bold text-ink tracking-tight">Welcome back</h2>
          <p className="text-ink-faint text-sm mt-1.5 mb-7">Sign in to the HR admin console.</p>
          {expired && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">Your session expired. Please sign in again.</div>}
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email or Employee ID"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com or TKF5001" required /></Field>
            <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required /></Field>
            {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}
            <div className="text-right -mt-1">
              <Link href="/forgot-password" className="text-sm text-brand-700 font-medium hover:underline">Forgot password?</Link>
            </div>
            <Button type="submit" disabled={loading} className="w-full">{loading ? <Spinner /> : 'Sign in'}</Button>
          </form>
          </>
          )}
          {/* <p className="text-xs text-ink-faint mt-6 leading-relaxed">Demo HR login is pre-filled. The password is set during <code className="text-brand-700 bg-brand-50 px-1 py-0.5 rounded">npm run seed</code>.</p> */}
        </div>
      </div>
    </div>
  );
}
