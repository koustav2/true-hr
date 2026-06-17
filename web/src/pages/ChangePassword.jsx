import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Logo } from '../components/Brand.jsx';
import { Button, Input, Field, Card } from '../components/ui.jsx';

export default function ChangePassword() {
  const { patchUser } = useAuth();
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setErr('');
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
      patchUser({ mustChangePassword: false });
      nav('/admin');
    } catch (e) { setErr(e.message); }
  }
  return (
    <div className="min-h-full grid place-items-center p-6">
      <Card className="w-full max-w-md p-8 animate-in">
        <Logo size={36} />
        <h2 className="text-xl font-bold mt-6">Set a new password</h2>
        <p className="text-ink-faint text-sm mb-6">For security, please change your temporary password.</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Current / temporary password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
          <Field label="New password" hint="At least 8 characters"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
          {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
          <Button type="submit" className="w-full">Update password</Button>
        </form>
      </Card>
    </div>
  );
}
