'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { usePerms } from '@/lib/perms.jsx';
import { ROLE_LABEL } from '@/lib/permissions.js';
import { Card, Button, Input, Select, Field, Spinner, Empty, Modal } from '@/components/ui.jsx';
import { IconPlus, IconShield, IconCheck } from '@/components/icons.jsx';

// ============================================================================
// Users & accounts.
//
// Roles are now data, not a fixed list, so this screen offers whatever roles the
// organisation has defined — including CEO, CTO or Payroll Officer. The server
// decides which of them the signed-in admin may actually hand out
// (/admin/assignable-roles applies the rank rule), so the picker can never
// suggest something that would be refused on save.
// ============================================================================

const BADGE_FOR_BASE = {
  SUPER_ADMIN: 'bg-violet-50 text-violet-700 ring-violet-200',
  HR_ADMIN: 'bg-brand-50 text-brand-700 ring-brand-200',
  IT_ADMIN: 'bg-sky-50 text-sky-700 ring-sky-200',
  EMPLOYEE: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function UsersPage() {
  const { user } = useAuth();
  const { canManage, canView, isPlatformAdmin } = usePerms();
  const mayManage = canManage('USERS');

  const [rows, setRows] = useState(null);
  const [roles, setRoles] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', roleId: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRole, setConfirmRole] = useState(null); // { user, role }

  const load = () => api.get('/admin/users').then(setRows).catch((e) => { setRows([]); setErr(e.message); });

  useEffect(() => {
    load();
    // Only the roles this admin is permitted to assign come back here.
    api.get('/admin/assignable-roles')
      .then((r) => {
        setRoles(r || []);
        setForm((f) => ({ ...f, roleId: f.roleId || String(r?.find((x) => x.key === 'HR_ADMIN')?.id || r?.[0]?.id || '') }));
      })
      .catch(() => setRoles([]));
  }, []);

  if (!canView('USERS')) {
    return <Card className="p-8 max-w-lg"><p className="text-ink-soft">You do not have access to user accounts. Ask a Super Admin to grant it.</p></Card>;
  }

  async function create(e) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true);
    try {
      const created = await api.post('/admin/users', {
        email: form.email, password: form.password, roleId: Number(form.roleId) || undefined,
      });
      setMsg(`${created.email} created as ${created.roleLabel || 'staff'}. They must change this password at first sign-in.`);
      setForm({ email: '', password: '', roleId: form.roleId });
      setShow(false);
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function toggle(u) {
    const status = u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setErr(''); setMsg('');
    try {
      await api.post(`/admin/users/${u.id}/status`, { status });
      setMsg(`${u.email} ${status === 'ACTIVE' ? 'enabled' : 'disabled'}.`);
      await load();
    } catch (e) { setErr(e.message); }
  }

  // Changing a role is confirmed explicitly: it can widen or remove someone's
  // access to payroll and PII in one click.
  async function applyRole() {
    const { user: u, role } = confirmRole;
    setErr(''); setMsg(''); setConfirmRole(null);
    try {
      await api.post(`/admin/users/${u.id}/org-role`, { roleId: role.id });
      setMsg(`${u.email} is now ${role.label}.`);
      await load();
    } catch (e) { setErr(e.message); }
  }

  const myRank = useMemo(() => {
    const me = (rows || []).find((r) => String(r.id) === String(user?.id));
    return me?.role_rank ?? (isPlatformAdmin ? -1 : 100);
  }, [rows, user, isPlatformAdmin]);

  // A row is editable when it is not you, and not someone at or above your level.
  const canEdit = (u) => {
    if (String(u.id) === String(user?.id)) return false;
    if (!mayManage) return false;
    if (u.is_platform_admin && !isPlatformAdmin) return false;
    if (isPlatformAdmin) return true;
    return (u.role_rank ?? 100) > myRank;
  };

  const assignableFor = (u) => roles.filter((r) => !r.requiresEmployeeProfile || u.employee_code);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Users &amp; accounts</h1>
          <p className="text-ink-faint text-sm mt-0.5">
            Who can sign in, and which role each person holds.
            {canView('ROLES') && <> Define what a role can open under <b>Roles &amp; permissions</b>.</>}
          </p>
        </div>
        {mayManage && (
          <Button onClick={() => { setShow((s) => !s); setErr(''); setMsg(''); }}>
            <IconPlus width={16} height={16} /> Add user
          </Button>
        )}
      </div>

      {msg && (
        <div className="text-sm text-emerald-800 bg-emerald-50 ring-1 ring-inset ring-emerald-200 rounded-xl px-4 py-3 flex items-start gap-2">
          <IconCheck className="mt-0.5 shrink-0" /><span>{msg}</span>
        </div>
      )}
      {err && <div className="text-sm text-rose-700 bg-rose-50 ring-1 ring-inset ring-rose-200 rounded-lg px-4 py-3">{err}</div>}

      {show && mayManage && (
        <Card className="p-6">
          <h2 className="font-semibold text-ink mb-4 flex items-center gap-2">
            <IconShield width={18} height={18} className="text-brand-600" /> New staff account
          </h2>
          <form onSubmit={create} className="grid sm:grid-cols-3 gap-4 items-end">
            <Field label="Email" required>
              <Input type="email" value={form.email} required
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="Temporary password" required hint="≥ 8 characters; changed at first sign-in">
              <Input type="text" value={form.password} required
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </Field>
            <Field label="Role" hint={roles.length ? undefined : 'No roles available to you'}>
              <Select value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
                {roles.filter((r) => !r.requiresEmployeeProfile).map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </Select>
            </Field>
            {form.roleId && (
              <p className="sm:col-span-3 text-xs text-ink-faint -mt-2">
                {roles.find((r) => String(r.id) === String(form.roleId))?.description || ''}
              </p>
            )}
            <div className="sm:col-span-3 flex gap-2">
              <Button type="submit" disabled={busy || !roles.length}>{busy ? <Spinner /> : 'Create user'}</Button>
              <Button type="button" variant="outline" onClick={() => setShow(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden">
        {!rows ? (
          <div className="grid place-items-center py-20"><Spinner className="text-brand-600 h-6 w-6" /></div>
        ) : rows.length === 0 ? (
          <Empty title="No users" icon={<IconShield width={22} height={22} />} />
        ) : (
          <div className="overflow-x-auto">
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
                {rows.map((u) => {
                  const base = u.role;
                  const label = u.roleLabel || ROLE_LABEL[base] || base;
                  const options = assignableFor(u);
                  const editable = canEdit(u);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-ink flex items-center gap-2">
                          {u.first_name ? `${u.first_name} ${u.last_name}` : u.email.split('@')[0]}
                          {u.is_platform_admin && (
                            <span className="rounded-full bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 px-2 py-0.5 text-[10px] font-semibold">
                              Platform owner
                            </span>
                          )}
                          {String(u.id) === String(user?.id) && (
                            <span className="rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 px-2 py-0.5 text-[10px] font-semibold">You</span>
                          )}
                        </div>
                        <div className="text-xs text-ink-faint">
                          {u.email}{u.employee_code ? ` · ${u.employee_code}` : ''}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {editable && options.length ? (
                          <Select
                            value={u.org_role_id || ''}
                            onChange={(e) => {
                              const role = roles.find((r) => String(r.id) === e.target.value);
                              if (role) setConfirmRole({ user: u, role });
                            }}
                            className="!w-48 text-xs">
                            {/* The current role stays listed even if it sits above what
                                this admin may assign, so the select is never blank. */}
                            {!options.some((r) => String(r.id) === String(u.org_role_id)) && (
                              <option value={u.org_role_id || ''}>{label}</option>
                            )}
                            {options.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                          </Select>
                        ) : (
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${BADGE_FOR_BASE[base] || BADGE_FOR_BASE.EMPLOYEE}`}>
                            {label}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 hidden md:table-cell text-ink-soft">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${u.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-400'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${u.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          {u.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {!editable ? <span className="text-xs text-ink-faint">—</span> : (
                          <Button size="sm" variant={u.status === 'ACTIVE' ? 'outline' : 'soft'} onClick={() => toggle(u)}>
                            {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Role changes are confirmed: this is how someone gains or loses payroll. */}
      <Modal
        open={!!confirmRole}
        onClose={() => setConfirmRole(null)}
        title="Change this person's role?"
        actions={(
          <>
            <Button variant="ghost" onClick={() => setConfirmRole(null)}>Cancel</Button>
            <Button onClick={applyRole}>Change role</Button>
          </>
        )}
      >
        {confirmRole && (
          <div className="space-y-3 text-sm">
            <p>
              <b>{confirmRole.user.email}</b> will become <b>{confirmRole.role.label}</b>.
            </p>
            {confirmRole.role.description && (
              <p className="text-ink-soft">{confirmRole.role.description}</p>
            )}
            <p className="text-ink-soft">
              Their access changes on their next page load. This is recorded in the audit log.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
