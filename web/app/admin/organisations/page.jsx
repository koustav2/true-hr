'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { Button, Card, Field, Input, Modal, Spinner, Empty, ConfirmClick, Avatar, Badge, StatTile } from '@/components/ui.jsx';
import { IconBriefcase, IconPlus, IconCheck, IconUsers } from '@/components/icons.jsx';

// ============================================================================
// Organisations — the tenant list, for the platform owner only.
//
// Each organisation is a sealed box: its own employees, payroll, roles and
// reports. The owner works inside one at a time and switches between them; an
// organisation's own admins can never see another's data.
// ============================================================================

export default function OrganisationsPage() {
  const { switchOrg, orgs: switcher } = usePerms();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [form, setForm] = useState({
    name: '', code: '', legalName: '', contactEmail: '', contactPhone: '',
    withAdmin: true, adminEmail: '', adminPassword: '',
  });

  async function load() {
    try { setData(await api.get('/admin/organisations')); setError(''); }
    catch (e) { setError(e.message); setData({ organisations: [] }); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setSaving(true); setError('');
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        legalName: form.legalName.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined,
      };
      if (form.withAdmin && form.adminEmail && form.adminPassword) {
        body.admin = { email: form.adminEmail.trim(), password: form.adminPassword };
      }
      const org = await api.post('/admin/organisations', body);
      setCreating(false);
      setCreated(org);
      setForm({ name: '', code: '', legalName: '', contactEmail: '', contactPhone: '', withAdmin: true, adminEmail: '', adminPassword: '' });
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function setStatus(org, status) {
    setError('');
    try {
      await api.post(`/admin/organisations/${org.id}/status`, { status });
      setNotice(status === 'SUSPENDED'
        ? `${org.name} suspended — everyone in it is signed out until you restore it.`
        : `${org.name} restored.`);
      await load();
    } catch (e) { setError(e.message); }
  }

  if (data === null) return <div className="grid place-items-center py-20"><Spinner className="h-6 w-6 text-brand-600" /></div>;

  const activeId = String(data.activeOrganisationId ?? switcher?.activeOrganisationId ?? '');

  const list = data.organisations || [];
  const nActive = list.filter((o) => o.status === 'ACTIVE').length;
  const nSuspended = list.length - nActive;
  const totalEmployees = list.reduce((a, o) => a + (Number(o.employees) || 0), 0);

  return (
    <div className="space-y-5">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] text-ink-faint">Platform › Organisations</div>
          <h1 className="page-title text-[20px] font-semibold text-ink mt-0.5">Organisation Management</h1>
          <p className="text-[13px] text-ink-faint mt-1 max-w-2xl">
            Each organisation is an isolated tenant with its own people, payroll and roles. You work inside one at a time.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="shrink-0"><IconPlus width={15} height={15} /> New organisation</Button>
      </div>

      {error && <div className="rounded bg-neg-bg text-neg border border-neg/20 px-3.5 py-2.5 text-[13px]">{error}</div>}
      {notice && (
        <div className="rounded bg-pos-bg text-pos border border-pos/20 px-3.5 py-2.5 text-[13px] flex items-start gap-2">
          <IconCheck className="mt-0.5 shrink-0" /><span>{notice}</span>
        </div>
      )}

      {/* ── Launchpad tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
        <StatTile Icon={IconBriefcase} label="Organisations" caption="Total provisioned" value={list.length} tone="brand" />
        <StatTile label="Active" caption="Serving users" value={nActive} tone="ok" foot={nActive ? 'Operational' : 'None active'} footTone={nActive ? 'ok' : 'warn'} />
        <StatTile label="Suspended" caption="Access disabled" value={nSuspended} tone={nSuspended ? 'warn' : 'neutral'} />
        <StatTile Icon={IconUsers} label="Employees" caption="Across all tenants" value={totalEmployees} tone="brand" />
        <button onClick={() => setCreating(true)} className="text-left">
          <Card hover className="p-3.5 min-h-[104px] flex flex-col">
            <span className="grid place-items-center h-7 w-7 rounded bg-brand-50 text-brand-600"><IconPlus width={15} height={15} /></span>
            <div className="mt-auto text-[12.5px] font-semibold text-ink-soft">New organisation</div>
          </Card>
        </button>
      </div>

      {/* ── Organisations table ─────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-canvas">
          <span className="text-[13.5px] font-semibold text-ink">Organisations</span>
          <span className="text-[11.5px] text-ink-faint">{list.length} record{list.length === 1 ? '' : 's'}</span>
        </div>
        {list.length === 0 ? (
          <Empty title="No organisations yet" subtitle="Create the first one to get started." icon={<IconBriefcase width={19} height={19} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left px-4">Organisation</th>
                  <th className="text-left px-4">Code</th>
                  <th className="text-left px-4">Status</th>
                  <th className="text-right px-4">Employees</th>
                  <th className="text-right px-4">Logins</th>
                  <th className="text-left px-4">Contact</th>
                  <th className="text-right px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((o) => {
                  const isActive = String(o.id) === activeId;
                  const suspended = o.status !== 'ACTIVE';
                  return (
                    <tr key={o.id} className={isActive ? 'bg-brand-50/60' : ''}>
                      <td className="px-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar name={o.name} size={28} />
                          <span className="min-w-0">
                            <span className="block font-semibold text-ink text-[13px] truncate">{o.name}</span>
                            <span className="block text-[11px] text-ink-faint truncate">{o.legalName || '—'}</span>
                          </span>
                          {isActive && <Badge tone="brand" className="ml-1 shrink-0">Working here</Badge>}
                        </div>
                      </td>
                      <td className="px-4">{o.code ? <Badge tone="info">{o.code}</Badge> : <span className="text-ink-faint">—</span>}</td>
                      <td className="px-4">
                        <Badge tone={suspended ? 'danger' : 'ok'} dot>{suspended ? 'Suspended' : 'Active'}</Badge>
                      </td>
                      <td className="px-4 text-right tabular-nums font-semibold text-ink">{o.employees ?? 0}</td>
                      <td className="px-4 text-right tabular-nums font-semibold text-ink">{o.users ?? 0}</td>
                      <td className="px-4">
                        <span className="text-[11.5px] text-ink-faint font-mono">
                          {[o.contactEmail, o.contactPhone].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </td>
                      <td className="px-4 text-right whitespace-nowrap">
                        {!isActive && !suspended && (
                          <button onClick={() => switchOrg(o.id)} className="text-[12.5px] font-semibold text-brand-600 hover:underline mr-3">Switch to</button>
                        )}
                        {suspended ? (
                          <button onClick={() => setStatus(o, 'ACTIVE')} className="text-[12.5px] font-semibold text-brand-600 hover:underline">Restore</button>
                        ) : (
                          <ConfirmClick onConfirm={() => setStatus(o, 'SUSPENDED')}
                            confirmLabel="Suspend? Everyone here is signed out."
                            className="text-[12.5px] font-semibold text-ink-soft hover:text-neg">
                            Suspend
                          </ConfirmClick>
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

      {/* ── Create ────────────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New organisation"
        actions={(
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={create} disabled={saving || !form.name.trim()}>
              {saving ? <Spinner className="h-4 w-4" /> : 'Create organisation'}
            </Button>
          </>
        )}
      >
        <div className="space-y-6">
          <p className="text-sm text-ink-soft -mt-1">A new organisation is a fully separate workspace — its own people, payroll, roles and login.</p>

          {/* Identity */}
          <section className="space-y-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Organisation details</div>
            <Field label="Organisation name" required>
              <Input value={form.name} placeholder="Acme Industries Pvt Ltd"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Short code" hint="2–16 characters, used for employee IDs">
                <Input value={form.code} placeholder="ACME"
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Legal name" hint="As registered, if different">
                <Input value={form.legalName} placeholder="Acme Industries Private Limited"
                  onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
              </Field>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Contact email">
                <Input type="email" value={form.contactEmail} placeholder="hr@acme.com"
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
              </Field>
              <Field label="Contact phone">
                <Input value={form.contactPhone} placeholder="+91 98765 43210"
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              </Field>
            </div>
          </section>

          {/* First Super Admin */}
          <section className={`rounded-xl2 border p-4 transition-colors ${form.withAdmin ? 'border-brand-200 bg-brand-50/50' : 'border-line bg-slate-50/60'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={form.withAdmin}
                onChange={(e) => setForm({ ...form, withAdmin: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-brand-600 cursor-pointer" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">Create this organisation's first Super Admin</span>
                <span className="block text-xs text-ink-faint mt-0.5">They run the organisation and are prompted to set a new password at first sign-in.</span>
              </span>
            </label>
            {form.withAdmin && (
              <div className="grid sm:grid-cols-2 gap-4 mt-4 pl-7">
                <Field label="Their email" required>
                  <Input type="email" value={form.adminEmail} placeholder="admin@acme.com"
                    onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
                </Field>
                <Field label="Temporary password" required hint="At least 8 characters">
                  <Input value={form.adminPassword} placeholder="••••••••"
                    onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
                </Field>
              </div>
            )}
          </section>

          <p className="text-xs text-ink-faint flex items-start gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-px shrink-0"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
            Comes with its own company record, four built-in roles and independent payroll settings.
          </p>
        </div>
      </Modal>

      {/* ── Created confirmation ─────────────────────────────────────────── */}
      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        title="Organisation created"
        tone="brand"
        actions={(
          <>
            <Button variant="ghost" onClick={() => setCreated(null)}>Stay here</Button>
            {created && <Button onClick={() => switchOrg(created.id)}>Switch to it now</Button>}
          </>
        )}
      >
        {created && (
          <div className="space-y-3 text-sm">
            <p><b>{created.name}</b> is ready, with its own company, roles and payroll settings.</p>
            {created.admin && (
              <div className="rounded-lg bg-slate-50 ring-1 ring-inset ring-line px-4 py-3">
                <div className="text-xs text-ink-faint mb-1">First Super Admin</div>
                <div className="font-mono text-sm text-ink">{created.admin.email}</div>
                <p className="text-[11px] text-ink-faint mt-2">
                  Pass the temporary password on securely. It is not shown again and must be changed at first sign-in.
                </p>
              </div>
            )}
            <p className="text-ink-soft">
              Next: add employees, then adjust its roles under Roles &amp; Permissions.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
