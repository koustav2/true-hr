'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api.js';
import { Logo } from '@/components/Brand.jsx';
import { Button, Input, Field, Spinner } from '@/components/ui.jsx';

// Forgot password: email → 6-digit OTP (mailed) → new password.
export default function ForgotPasswordPage() {
  const [step, setStep] = useState(1); // 1 email · 2 otp+password · 3 done
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendOtp(e) {
    e?.preventDefault();
    setErr(''); setLoading(true);
    try { await api.post('/auth/forgot-password', { email }); setStep(2); }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  }

  async function reset(e) {
    e.preventDefault();
    if (otp.length !== 6) return setErr('Enter the 6-digit code from the email');
    if (pw.length < 8) return setErr('Password must be at least 8 characters');
    if (pw !== pw2) return setErr('Passwords do not match');
    setErr(''); setLoading(true);
    try { await api.post('/auth/reset-password', { email, otp, newPassword: pw }); setStep(3); }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-canvas p-6">
      <div className="w-full max-w-sm animate-in">
        <div className="mb-8"><Logo size={36} /></div>

        {step === 3 ? (
          <>
            <h2 className="text-2xl font-bold text-ink tracking-tight">Password reset</h2>
            <p className="text-ink-faint text-sm mt-1.5 mb-7">Your password has been changed. Sign in with your new password.</p>
            <Link href="/login"><Button className="w-full">Back to sign in</Button></Link>
          </>
        ) : step === 1 ? (
          <>
            <h2 className="text-2xl font-bold text-ink tracking-tight">Forgot password?</h2>
            <p className="text-ink-faint text-sm mt-1.5 mb-7">Enter your official email or Employee ID — we&apos;ll send a 6-digit code to your registered email.</p>
            <form onSubmit={sendOtp} className="space-y-4">
              <Field label="Email or Employee ID"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required /></Field>
              {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}
              <Button type="submit" disabled={loading} className="w-full">{loading ? <Spinner /> : 'Send code'}</Button>
            </form>
            <p className="text-sm text-ink-faint mt-5"><Link href="/login" className="text-brand-700 font-medium hover:underline">Back to sign in</Link></p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-ink tracking-tight">Enter the code</h2>
            <p className="text-ink-faint text-sm mt-1.5 mb-7">We emailed a 6-digit code for “{email}”. It expires in 10 minutes.</p>
            <form onSubmit={reset} className="space-y-4">
              <Field label="6-digit code">
                <Input inputMode="numeric" maxLength={6} value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" required />
              </Field>
              <Field label="New password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
              <Field label="Confirm new password"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
              {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}
              <Button type="submit" disabled={loading} className="w-full">{loading ? <Spinner /> : 'Reset password'}</Button>
            </form>
            <div className="flex justify-between text-sm mt-5">
              <button onClick={() => { setStep(1); setOtp(''); setErr(''); }} className="text-ink-faint hover:underline">Change email</button>
              <button onClick={sendOtp} disabled={loading} className="text-brand-700 font-medium hover:underline">Resend code</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
