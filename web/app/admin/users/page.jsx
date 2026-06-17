'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { can, ROLE_LABEL } from '@/lib/permissions.js';
import { Card, Button, Input, Select, Field, Spinner, Empty } from '@/components/ui.jsx';
import { IconPlus, IconShield } from '@/components/icons.jsx';

const ROLE_BADGE = {
  SUPER_ADMIN: 'bg-violet-50 text-violet-700 ring-violet-200',
  HR_ADMIN: 'bg-brand-50 text-brand-700 ring-brand-200',
  IT_ADMIN: 'bg-sky-50 text-sky-700 ring-sky-200',
  EMPLOYEE: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function UsersPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', role: 'HR_ADMIN' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/admin/users').then(setRows).catch((e) => { setRows([]); setErr(e.message); });
  useEffect(() => { load(); }, []);

  if (user && !can.admin(user.role)) {
    return <Card className="p-8 max-w-lg"><p className="text-ink-soft">This area is restricted to IT Admins and Super Admins.</p></Card>;
  }

  async function create(e) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true);
    try {
      await api.post('/admin/users', form);
      setMsg(`User ${form.email} created.`); setForm({ email: '', password: '', role: 'HR_ADMIN' }); setShow(false);
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function toggle(u) {
    const status = u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try { await api.post(`/admin/users/${u.id}/status`, { status }); await load(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-ink tracking-tight">Users &amp; roles</h1>
          <p className="text-ink-faint text-sm mt-0.5">Manage HR and Super Admin accounts.</p>
        </div>
        <Button onClick={() => { setShow((s) => !s); setErr(''); setMsg(''); }}><IconPlus width={16} height={16} /> Add user</Button>
      </div>

      {msg && <div className="text-sm text-brand-700 bg-brand-50 rounded-xl px-4 py-3">{msg}</div>}

      {show && (
        <Card className="p-6">
          <h2 className="font-semibold text-ink mb-4 flex items-center gap-2"><IconShield width={18} height={18} className="text-brand-600" /> New staff account</h2>
          <form onSubmit={create} className="grid sm:grid-cols-3 gap-4 items-end">
            <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required /></Field>
            <Field label="Temporary password" required hint="≥ 8 characters"><Input type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required /></Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="HR_ADMIN">HR Admin</option>
                <option value="IT_ADMIN">IT Admin</option>
                {can.superadmin(user?.role) && <option value="SUPER_ADMIN">Super Admin</option>}
              </Select>
            </Field>
            <div className="sm:col-span-3 flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? <Spinner /> : 'Create user'}</Button>
              <Button type="button" variant="outline" onClick={() => setShow(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}

      <Card className="overflow-hidden">
        {!rows ? (
          <div className="grid place-items-center py-20"><Spinner className="text-brand-600 h-6 w-6" /></div>
        ) : rows.length === 0 ? (
          <Empty title="No users" icon={<IconShield width={22} height={22} />} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint bg-slate-50/60 border-b border-line">
                <th className="font-medium px-5 py-3">User</th>
                <th className="font-medium px-5 py-3">Role</th>
                <th className="font-medium px-5 py-3 hidden md:table-cell">Last login</th>
                <th className="font-medium px-5 py-3">Status</th>
                <th className="font-medium px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-ink">{u.first_name ? `${u.first_name} ${u.last_name}` : u.email.split('@')[0]}</div>
                    <div className="text-xs text-ink-faint">{u.email}</div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${ROLE_BADGE[u.role] || ROLE_BADGE.EMPLOYEE}`}>{ROLE_LABEL[u.role] || u.role}</span>
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell text-ink-soft">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${u.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-400'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${u.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-300'}`} />{u.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {u.role === 'EMPLOYEE' || String(u.id) === String(user?.id) ? (
                      <span className="text-xs text-ink-faint">—</span>
                    ) : (
                      <Button size="sm" variant={u.status === 'ACTIVE' ? 'outline' : 'soft'} onClick={() => toggle(u)}>
                        {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
