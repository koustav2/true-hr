import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Logo } from '../components/Brand.jsx';
import { Button, Input, Field, Spinner } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('hr@truehr.example');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const user = await login(email, password);
      if (user.mustChangePassword) nav('/change-password');
      else nav('/admin');
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }

  return (
    <div className="min-h-full grid lg:grid-cols-2">
      {/* Left: brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(150deg,#4338ca,#4f46e5 45%,#6366f1)' }}>
        <Logo light size={40} />
        <div className="relative z-10">
          <h1 className="text-4xl font-extrabold leading-tight">Onboard people,<br/>not paperwork.</h1>
          <p className="mt-4 text-white/80 max-w-md">From offer letter to first login — TRUE HR runs the whole onboarding journey, automatically.</p>
        </div>
        <div className="text-white/60 text-sm">© {new Date().getFullYear()} TRUE HR · True HR Pvt Ltd</div>
        <div className="absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute right-32 top-10 h-40 w-40 rounded-full bg-white/10 blur-xl" />
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-in">
          <div className="lg:hidden mb-8"><Logo size={40} /></div>
          <h2 className="text-2xl font-bold text-ink">Welcome back</h2>
          <p className="text-ink-faint text-sm mt-1 mb-7">Sign in to the HR admin console.</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@truehr.example" required /></Field>
            <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required /></Field>
            {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
            <Button type="submit" disabled={loading} className="w-full">{loading ? <Spinner /> : 'Sign in'}</Button>
          </form>
          {/* <p className="text-xs text-ink-faint mt-6">Demo HR login is pre-filled. Password is set during <code className="text-brand-600">npm run seed</code>.</p> */}
        </div>
      </div>
    </div>
  );
}
