'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { Button, Card, Field, Input, Modal, Select, Spinner, Textarea, Empty, ConfirmClick } from '@/components/ui.jsx';
import { IconShield, IconPlus, IconCheck, IconSparkle } from '@/components/icons.jsx';

// ============================================================================
// Roles & Permissions.
//
// This screen is the whole point of the module system: a Super Admin creates a
// role (CEO, CTO, Payroll Officer) and ticks what it may open. Two safeguards
// are enforced by the server and mirrored here so the UI never invites a
// request that will be refused:
//   · you cannot edit a role at or above your own level
//   · you cannot grant a permission you do not hold yourself (checkbox disabled)
// ============================================================================

const BASE_ROLES = [
  ['EMPLOYEE', 'Employee — self-service only'],
  ['HR_ADMIN', 'Staff — people & payroll screens'],
  ['IT_ADMIN', 'IT — accounts & audit'],
  ['SUPER_ADMIN', 'Super Admin — everything'],
];

function RankBadge({ rank }) {
  const tone = rank <= 5 ? 'bg-grape-50 text-grape-700 ring-grape-200'
    : rank <= 20 ? 'bg-brand-50 text-brand-700 ring-brand-200'
      : 'bg-slate-100 text-slate-600 ring-slate-200';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${tone}`}>Level {rank}</span>;
}

export default function RolesPage() {
  const { canManage } = usePerms();
  const mayManage = canManage('ROLES');

  const [roles, setRoles] = useState(null);
  const [presets, setPresets] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editing, setEditing] = useState(null);   // full role detail + matrix
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ key: '', label: '', description: '', baseRole: 'HR_ADMIN', rank: 50 });

  async function load() {
    try {
      const [r, p] = await Promise.all([
        api.get('/admin/roles'),
        api.get('/admin/role-presets').catch(() => []),
      ]);
      setRoles(r); setPresets(p || []); setError('');
    } catch (e) { setError(e.message); setRoles([]); }
  }
  useEffect(() => { load(); }, []);

  async function open(id) {
    setError('');
    try { setEditing(await api.get(`/admin/roles/${id}`)); }
    catch (e) { setError(e.message); }
  }

  function toggle(key, level) {
    setEditing((prev) => ({
      ...prev,
      modules: prev.modules.map((m) => {
        if (m.key !== key) return m;
        if (level === 'manage') {
          const canManageNext = !m.canManage;
          // Manage implies view — mirrors the server's normalisation.
          return { ...m, canManage: canManageNext, canView: canManageNext ? true : m.canView };
        }
        const canViewNext = !m.canView;
        return { ...m, canView: canViewNext, canManage: canViewNext ? m.canManage : false };
      }),
    }));
  }

  async function save() {
    setSaving(true); setError('');
    try {
      await api.put(`/admin/roles/${editing.id}`, {
        label: editing.label,
        description: editing.description,
        modules: editing.modules
          .filter((m) => m.canView || m.canManage)
          .map((m) => ({ key: m.key, canView: m.canView, canManage: m.canManage })),
      });
      setNotice(`Saved “${editing.label}”. Anyone holding this role sees the change on their next page load.`);
      setEditing(null); await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function create(preset) {
    setSaving(true); setError('');
    try {
      const body = preset ? { preset: preset.key } : { ...form, rank: Number(form.rank) || 50 };
      const created = await api.post('/admin/roles', body);
      setCreating(false);
      setForm({ key: '', label: '', description: '', baseRole: 'HR_ADMIN', rank: 50 });
      await load();
      setNotice(`Created “${created.label || body.label}”. Review its permissions before assigning it.`);
      if (created?.id) open(created.id);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function remove(role) {
    setError('');
    try { await api.del(`/admin/roles/${role.id}`); setNotice(`Deleted “${role.label}”.`); await load(); }
    catch (e) { setError(e.message); }
  }

  // Group the matrix the same way the sidebar is grouped.
  const grouped = useMemo(() => {
    const out = [];
    for (const m of editing?.modules || []) {
      let g = out.find((x) => x.title === m.group);
      if (!g) { g = { title: m.group, items: [] }; out.push(g); }
      g.items.push(m);
    }
    return out;
  }, [editing]);

  if (roles === null) return <div className="grid place-items-center py-20"><Spinner className="h-6 w-6 text-brand-600" /></div>;

  const availablePresets = presets.filter((p) => !p.alreadyExists);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Roles &amp; Permissions</h2>
          <p className="text-sm text-ink-soft mt-1 max-w-2xl">
            Decide what each role can open. Changes take effect immediately — nothing needs to be redeployed.
          </p>
        </div>
        {mayManage && (
          <Button onClick={() => setCreating(true)} className="shrink-0">
            <IconPlus /> New role
          </Button>
        )}
      </div>

      {error && <div className="rounded-lg bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 px-4 py-3 text-sm">{error}</div>}
      {notice && (
        <div className="rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 px-4 py-3 text-sm flex items-start gap-2">
          <IconCheck className="mt-0.5 shrink-0" /><span>{notice}</span>
        </div>
      )}

      {/* One-click leadership roles that the old fixed role list could not express. */}
      {mayManage && availablePresets.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <IconSparkle className="text-grape-600" />
            <h3 className="font-semibold text-ink">Ready-made roles</h3>
          </div>
          <p className="text-sm text-ink-soft mb-4">
            Sensible starting points. You can adjust every permission afterwards.
          </p>
          <div className="flex flex-wrap gap-2">
            {availablePresets.map((p) => (
              <button key={p.key} onClick={() => create(p)} disabled={saving}
                className="text-left rounded-xl border border-line bg-white hover:border-brand-200 hover:shadow-soft transition px-4 py-3 disabled:opacity-50">
                <div className="font-semibold text-sm text-ink">{p.label}</div>
                <div className="text-[11px] text-ink-faint mt-0.5 max-w-[240px]">{p.description}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Role</th>
                <th className="text-left px-5 py-3 font-medium">Level</th>
                <th className="text-right px-5 py-3 font-medium">People</th>
                <th className="text-right px-5 py-3 font-medium">Modules</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {roles.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/40">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-ink flex items-center gap-2">
                      {r.label}
                      {r.isSystem && <span className="rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 px-2 py-0.5 text-[10px] font-semibold">Built-in</span>}
                    </div>
                    <div className="text-[11px] text-ink-faint mt-0.5">{r.key} · behaves as {r.baseRole?.replace('_', ' ').toLowerCase()}</div>
                    {r.description && <div className="text-[11px] text-ink-soft mt-1 max-w-md">{r.description}</div>}
                  </td>
                  <td className="px-5 py-3"><RankBadge rank={r.rank} /></td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.users ?? 0}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {r.key === 'SUPER_ADMIN' ? <span className="text-ink-faint">All</span> : (r.moduleCount ?? 0)}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => open(r.id)}>
                      {mayManage && r.key !== 'SUPER_ADMIN' ? 'Edit' : 'View'}
                    </Button>
                    {mayManage && !r.isSystem && (
                      <ConfirmClick onConfirm={() => remove(r)} confirmLabel="Delete role?" className="ml-2 text-sm">
                        Delete
                      </ConfirmClick>
                    )}
                  </td>
                </tr>
              ))}
              {roles.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-10">
                  <Empty title="No roles yet" subtitle="Create one to control what people can open." icon={<IconShield />} />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Permission matrix ─────────────────────────────────────────────── */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        size="lg"
        title={editing ? `${editing.label} — permissions` : ''}
        actions={editing && mayManage && !editing.locked ? (
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Spinner className="h-4 w-4" /> : 'Save permissions'}</Button>
          </>
        ) : <Button variant="ghost" onClick={() => setEditing(null)}>Close</Button>}
      >
        {editing && (
          <div className="space-y-5">
            {editing.locked && (
              <div className="rounded-lg bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 px-4 py-3 text-sm">
                {editing.lockedReason}
              </div>
            )}

            {mayManage && !editing.locked && (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Role name">
                  <Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                </Field>
                <Field label="Description" hint="Shown on the roles list">
                  <Input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                </Field>
              </div>
            )}

            <div className="text-xs text-ink-soft">
              <b>View</b> lets someone open the screen. <b>Manage</b> lets them change things there.
              Greyed-out boxes are permissions you do not hold yourself, so you cannot pass them on.
            </div>

            <div className="space-y-4">
              {grouped.map((g) => (
                <div key={g.title}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint mb-2">{g.title}</div>
                  <div className="rounded-xl border border-line divide-y divide-line overflow-hidden">
                    {g.items.map((m) => (
                      <div key={m.key} className="flex items-center gap-4 px-4 py-2.5 bg-white">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink flex items-center gap-2">
                            {m.label}
                            {m.sensitive && (
                              <span className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 px-1.5 py-0.5 text-[10px] font-semibold">
                                Sensitive
                              </span>
                            )}
                          </div>
                          {m.note && <div className="text-[11px] text-ink-faint">{m.note}</div>}
                        </div>
                        <label className={`flex items-center gap-1.5 text-xs ${m.grantableView && mayManage && !editing.locked ? 'text-ink-soft cursor-pointer' : 'text-ink-faint cursor-not-allowed'}`}>
                          <input type="checkbox" checked={!!m.canView}
                            disabled={!mayManage || editing.locked || !m.grantableView}
                            onChange={() => toggle(m.key, 'view')}
                            className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500 disabled:opacity-40" />
                          View
                        </label>
                        <label className={`flex items-center gap-1.5 text-xs ${m.grantableManage && mayManage && !editing.locked ? 'text-ink-soft cursor-pointer' : 'text-ink-faint cursor-not-allowed'}`}>
                          <input type="checkbox" checked={!!m.canManage}
                            disabled={!mayManage || editing.locked || !m.grantableManage}
                            onChange={() => toggle(m.key, 'manage')}
                            className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500 disabled:opacity-40" />
                          Manage
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Create a role from scratch ────────────────────────────────────── */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New role"
        actions={(
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={() => create(null)} disabled={saving || !form.key || !form.label}>
              {saving ? <Spinner className="h-4 w-4" /> : 'Create role'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Field label="Role name" required hint="What people will see, e.g. “Regional HR Manager”">
            <Input value={form.label} placeholder="Regional HR Manager"
              onChange={(e) => {
                const label = e.target.value;
                // Suggest a code from the name until the user edits it themselves.
                const auto = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
                setForm((f) => ({ ...f, label, key: f.keyTouched ? f.key : auto }));
              }} />
          </Field>
          <Field label="Role code" required hint="Capitals, digits and underscores only. Cannot be changed later.">
            <Input value={form.key} placeholder="REGIONAL_HR_MANAGER"
              onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase(), keyTouched: true })} />
          </Field>
          <Field label="Behaves as" hint="Which built-in role this is based on, for screens that are shared">
            <Select value={form.baseRole} onChange={(e) => setForm({ ...form, baseRole: e.target.value })}>
              {BASE_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Level" hint="Lower is more senior. A role can never manage a role at or above its own level.">
            <Input type="number" min={1} max={100} value={form.rank}
              onChange={(e) => setForm({ ...form, rank: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <p className="text-xs text-ink-faint">
            The role starts with no access. You will pick its modules on the next screen.
          </p>
        </div>
      </Modal>
    </div>
  );
}
