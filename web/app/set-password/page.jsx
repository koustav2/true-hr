'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api.js';
import { Logo } from '@/components/Brand.jsx';
import { Button, Input, Field, Card, Spinner } from '@/components/ui.jsx';

// D3: a new joiner (or an employee whose password HR reset) opens the one-time
// link from their email and chooses a password here. The link is the
// credential; it works once and expires after a few days.
function passwordError(pw) {
  const s = String(pw || '');
  if (!s) return 'New password is required';
  if (s.length < 8) return 'Password must be at least 8 characters';
  if (s.length > 128) return 'Password must be at most 128 characters';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Password must contain at least one letter and one digit';
  return null;
}

function SetPasswordInner() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [info, setInfo] = useState(null);      // { name, email, opensOn } | false
  const [linkErr, setLinkErr] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!token) { setInfo(false); setLinkErr('This link is incomplete. Open it again from your email.'); return; }
    api.get(`/auth/set-password?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e) => { setInfo(false); setLinkErr(e.message); });
  }, [token]);

  async function submit(e) {
    e.preventDefault(); setErr('');
    const f = {};
    const pe = passwordError(pw); if (pe) f.newPassword = pe;
    if (!f.newPassword && pw !== pw2) f.confirm = 'The two passwords do not match';
    setErrors(f);
    if (Object.keys(f).length) return;
    setBusy(true);
    try {
      setDone(await api.post('/auth/set-password', { token, newPassword: pw }));
    } catch (e2) {
      setErrors(e2.fields || {});
      setErr(e2.fields ? '' : e2.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-canvas p-6">
      <Card className="w-full max-w-md p-8 animate-in">
        <Logo size={36} />
        {info === null ? (
          <div className="mt-8 flex items-center gap-2 text-sm text-ink-faint"><Spinner className="text-brand-600" /> Checking your link…</div>
        ) : info === false ? (
          <>
            <h2 className="text-xl font-bold mt-6">Link not valid</h2>
            <p className="text-ink-faint text-sm mt-1.5 mb-6">{linkErr}</p>
            <Link href="/login"><Button variant="outline" className="w-full">Go to sign in</Button></Link>
          </>
        ) : done ? (
          <>
            <h2 className="text-xl font-bold mt-6">Password set</h2>
            <p className="text-ink-faint text-sm mt-1.5 mb-6">{done.message}</p>
            <Link href="/login"><Button className="w-full">Go to sign in</Button></Link>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold mt-6">Choose your password</h2>
            <p className="text-ink-faint text-sm mt-1.5 mb-6">
              {info.name ? `Welcome, ${info.name}. ` : ''}Set the password for <b className="text-ink">{info.email}</b>.
              {info.opensOn && <> You can sign in from <b className="text-ink">{info.opensOn}</b>.</>}
            </p>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="New password" hint="At least 8 characters, with a letter and a digit" error={errors.newPassword}>
                <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
              </Field>
              <Field label="Confirm new password" error={errors.confirm}>
                <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </Field>
              {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? <Spinner /> : 'Set password'}</Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

export default function SetPasswordPage() {
  return <Suspense fallback={null}><SetPasswordInner /></Suspense>;
}
