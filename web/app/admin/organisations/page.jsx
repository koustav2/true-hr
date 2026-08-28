'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { Button, Card, Field, Input, Modal, Spinner, Empty, ConfirmClick } from '@/components/ui.jsx';
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Organisations</h2>
          <p className="text-sm text-ink-soft mt-1 max-w-2xl">
            Each organisation keeps its own people, payroll and roles. You work inside one at a time —
            switch using the selector at the top of the screen.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="shrink-0"><IconPlus /> New organisation</Button>
      </div>

      {error && <div className="rounded-lg bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 px-4 py-3 text-sm">{error}</div>}
      {notice && (
        <div className="rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 px-4 py-3 text-sm flex items-start gap-2">
          <IconCheck className="mt-0.5 shrink-0" /><span>{notice}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(data.organisations || []).map((o) => {
          const isActive = String(o.id) === activeId;
          const suspended = o.status !== 'ACTIVE';
          return (
            <Card key={o.id} className={`p-5 ${isActive ? 'ring-2 ring-brand-200' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-ink truncate">{o.name}</div>
                  <div className="text-[11px] text-ink-faint mt-0.5">
                    {o.code ? `${o.code} · ` : ''}{o.legalName || '—'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {isActive && <span className="rounded-full bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 px-2 py-0.5 text-[10px] font-semibold">Working here</span>}
                  {suspended && <span className="rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 px-2 py-0.5 text-[10px] font-semibold">Suspended</span>}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-5 text-sm">
                <div className="flex items-center gap-1.5 text-ink-soft">
                  <IconUsers className="text-ink-faint" />
                  <span className="tabular-nums font-semibold text-ink">{o.employees ?? 0}</span> employees
                </div>
                <div className="text-ink-soft">
                  <span className="tabular-nums font-semibold text-ink">{o.users ?? 0}</span> logins
                </div>
              </div>

              {(o.contactEmail || o.contactPhone) && (
                <div className="mt-3 text-[11px] text-ink-faint truncate">
                  {[o.contactEmail, o.contactPhone].filter(Boolean).join(' · ')}
                </div>
              )}

              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
                {!isActive && !suspended && (
                  <Button size="sm" variant="ghost" onClick={() => switchOrg(o.id)}>Switch to this</Button>
                )}
                {suspended ? (
                  <Button size="sm" variant="ghost" onClick={() => setStatus(o, 'ACTIVE')}>Restore</Button>
                ) : (
                  <ConfirmClick onConfirm={() => setStatus(o, 'SUSPENDED')}
                    confirmLabel="Suspend? Everyone here is signed out." className="text-sm">
                    Suspend
                  </ConfirmClick>
                )}
              </div>
            </Card>
          );
        })}
        {(data.organisations || []).length === 0 && (
          <Card className="p-10 sm:col-span-2 xl:col-span-3">
            <Empty title="No organisations yet" subtitle="Create the first one to get started." icon={<IconBriefcase />} />
          </Card>
        )}
      </div>

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
