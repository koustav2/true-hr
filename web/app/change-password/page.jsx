'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { homeFor } from '@/lib/permissions.js';
import { Logo } from '@/components/Brand.jsx';
import { Button, Input, Field, Card, Spinner } from '@/components/ui.jsx';

// Same rule as the server (v2): at least 8 characters, a letter and a digit.
function passwordError(pw) {
  const s = String(pw || '');
  if (!s) return 'New password is required';
  if (s.length < 8) return 'Password must be at least 8 characters';
  if (s.length > 128) return 'Password must be at most 128 characters';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Password must contain at least one letter and one digit';
  return null;
}

export default function ChangePasswordPage() {
  const { patchUser, user } = useAuth();
  const router = useRouter();
  const forced = !!user?.mustChangePassword;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault(); setErr('');
    const f = {};
    if (!forced && !cur) f.currentPassword = 'Enter your current password';
    const pe = passwordError(next); if (pe) f.newPassword = pe;
    if (!f.newPassword && next !== again) f.confirm = 'The two passwords do not match';
    setErrors(f);
    if (Object.keys(f).length) return;
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: cur || undefined, newPassword: next });
      patchUser({ mustChangePassword: false });
      // C52/E66: land where this role belongs — an employee goes to /ess.
      router.push(homeFor(user?.role));
    } catch (e2) {
      setErrors(e2.fields || {});
      setErr(e2.fields ? '' : e2.message);
    } finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Card className="w-full max-w-md p-8 animate-in">
        <Logo size={36} />
        <h2 className="text-xl font-bold mt-6">{forced ? 'Set a new password' : 'Change password'}</h2>
        <p className="text-ink-faint text-sm mb-6">
          {forced ? 'For security, please replace your temporary password.' : 'Choose a new password for your account.'}
        </p>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label={forced ? 'Current / temporary password (optional)' : 'Current password'} error={errors.currentPassword}>
            <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          </Field>
          <Field label="New password" hint="At least 8 characters, with a letter and a digit" error={errors.newPassword}>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password" error={errors.confirm}>
            <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? <Spinner /> : 'Update password'}</Button>
          {!forced && (
            <button type="button" onClick={() => router.back()} className="w-full text-center text-[12.5px] text-ink-faint hover:text-ink">Cancel</button>
          )}
        </form>
      </Card>
    </div>
  );
}
