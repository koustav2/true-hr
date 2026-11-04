'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, Empty, ConfirmClick, Avatar, Badge, StatTile, ErrorSummary, useConfirm } from '@/components/ui.jsx';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator, patterns } from '@/lib/validate.js';
import { IconBriefcase, IconPlus, IconCheck, IconUsers } from '@/components/icons.jsx';

// ============================================================================
// Organisations — the tenant list, for the platform owner only.
//
// Each organisation is a sealed box: its own employees, payroll, roles and
// reports. The owner works inside one at a time and switches between them; an
// organisation's own admins can never see another's data.
// ============================================================================

// A 10-digit mobile, with an optional +91 / 91 only when the number is 12 digits
// long (so 9123456780 is not mistaken for "91" + 8 digits).
const normMobile = (p) => {
  const d = String(p || '').replace(/[\s()-]/g, '');
  return /^\+?91\d{10}$/.test(d) ? d.replace(/^\+?91/, '') : d;
};

// Client mirror of the server's v2 rules (organisationController.validateOrgV2).
function validateOrg(f, { withAdmin = false } = {}) {
  const v = validator();
  v.require('name', f.name, 'Organisation name');
  if (f.name && !/[A-Za-z]/.test(f.name)) v.add('name', 'Organisation name must contain letters');
  v.require('code', f.code, 'Short code');
  v.pattern('code', f.code, 'code', 'Short code');
  v.email('contactEmail', f.contactEmail, 'Contact email');
  v.check('contactPhone', f.contactPhone ? normMobile(f.contactPhone) : '', patterns.mobile,
    'Contact phone must be a valid 10-digit mobile number starting with 6-9');
  if (withAdmin) {
    v.require('adminEmail', f.adminEmail, "The first Super Admin's email");
    v.email('adminEmail', f.adminEmail, "The first Super Admin's email");
    v.require('adminPassword', f.adminPassword, 'Temporary password');
    if (f.adminPassword && f.adminPassword.length < 8) v.add('adminPassword', 'Temporary password must be at least 8 characters');
  }
  return v.fields;
}

const STATUS_TONE = { ACTIVE: 'ok', SUSPENDED: 'danger', ARCHIVED: 'neutral' };

export default function OrganisationsPage() {
  const [confirm, confirmUi] = useConfirm();
  const { switchOrg, orgs: switcher } = usePerms();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const blankForm = { name: '', code: '', legalName: '', contactEmail: '', contactPhone: '', adminEmail: '', adminPassword: '' };
  const [form, setForm] = useState(blankForm);
  const [errors, setErrors] = useState({});
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // ── Detail / edit ────────────────────────────────────────────────────────
  const [detail, setDetail] = useState(null);     // GET /admin/organisations/:id
  const [edit, setEdit] = useState(null);         // editable copy
  const [editErrors, setEditErrors] = useState({});
  const [newAdmin, setNewAdmin] = useState({ email: '', password: '' });
  const [adminErrors, setAdminErrors] = useState({});
  const [detailBusy, setDetailBusy] = useState(false);

  async function openDetail(o) {
    setError(''); setEditErrors({}); setAdminErrors({}); setNewAdmin({ email: '', password: '' });
    try {
      const d = await api.get(`/admin/organisations/${o.id}`);
      setDetail(d);
      setEdit({ name: d.name || '', legalName: d.legalName || '', code: d.code || '', contactEmail: d.contactEmail || '', contactPhone: d.contactPhone || '' });
    } catch (e) { setError(e.message); }
  }
  async function saveDetail() {
    const errs = validateOrg(edit);
    setEditErrors(errs);
    if (Object.keys(errs).length) return;
    setDetailBusy(true);
    try {
      const r = await api.patch(`/admin/organisations/${detail.id}`, {
        name: edit.name.trim(), legalName: edit.legalName.trim(), code: edit.code.trim(),
        contactEmail: edit.contactEmail.trim(), contactPhone: edit.contactPhone.trim(),
      });
      setNotice(`${r.name} saved.${r.warnings?.length ? ` Note: ${r.warnings.join(' ')}` : ''}`);
      setDetail(null); setEdit(null);
      await load();
    } catch (e) { setEditErrors(e.fields || { _: e.message }); }
    finally { setDetailBusy(false); }
  }
  async function addFirstAdmin() {
    const v = validator();
    v.require('email', newAdmin.email, 'Email').email('email', newAdmin.email, 'Email');
    v.require('password', newAdmin.password, 'Temporary password');
    if (newAdmin.password && newAdmin.password.length < 8) v.add('password', 'Temporary password must be at least 8 characters');
    setAdminErrors(v.fields);
    if (!v.ok) return;
    setDetailBusy(true);
    try {
      await api.post(`/admin/organisations/${detail.id}/admins`, { email: newAdmin.email.trim(), password: newAdmin.password });
      setNewAdmin({ email: '', password: '' });
      await openDetail(detail); await load();
    } catch (e) { setAdminErrors(e.fields || { _: e.message }); }
    finally { setDetailBusy(false); }
  }
  async function deleteOrg(o) {
    const ok = await confirm({
      title: `Delete ${o.name}?`, tone: 'danger', confirmLabel: 'Delete permanently',
      body: <p className="text-sm">This removes the organisation, its company record, roles and logins. It cannot be undone. Only organisations with no employee records can be deleted.</p>,
    });
    if (!ok) return;
    try {
      await api.del(`/admin/organisations/${o.id}`);
      setNotice(`${o.name} deleted.`); setDetail(null); setEdit(null);
      await load();
    } catch (e) { setError(e.message); }
  }

  // ── Subscription (module entitlements sold per organisation) ──────────
  const [subOrg, setSubOrg] = useState(null);   // the org being edited
  const [sub, setSub] = useState(null);         // its subscription payload
  const [subSaving, setSubSaving] = useState(false);

  async function openSubscription(o) {
    setSubOrg(o); setSub(null); setError('');
    try { setSub(await api.get(`/admin/organisations/${o.id}/subscription`)); }
    catch (e) { setError(e.message); setSubOrg(null); }
  }
  function toggleModule(key) {
    setSub((p) => ({ ...p, plan: 'CUSTOM', modules: p.modules.map((m) => (m.key === key ? { ...m, enabled: !m.enabled } : m)) }));
  }
  function applyPlan(planKey) {
    setSub((p) => ({ ...p, plan: planKey, _planPicked: planKey }));
  }
  async function saveSubscription() {
    setSubSaving(true); setError('');
    if (['ACTIVE', 'TRIAL'].includes(sub.status) && sub.expiresAt && sub.expiresAt.slice(0, 10) < todayIso()) {
      setSubSaving(false);
      setSub({ ...sub, _err: 'Expires on is in the past. Pick a future date, clear it, or set the status to Expired.' });
      return;
    }
    try {
      const body = { status: sub.status, expiresAt: sub.expiresAt || '', note: sub.note || null };
      // A named plan replaces the set server-side; CUSTOM sends the ticked list.
      if (sub._planPicked && sub._planPicked !== 'CUSTOM') body.plan = sub._planPicked;
      else body.modules = sub.modules.filter((m) => m.enabled).map((m) => m.key);
      const r = await api.put(`/admin/organisations/${subOrg.id}/subscription`, body);
      setNotice(`Subscription updated for ${subOrg.name} — plan ${r.plan}${r.modules ? `, ${r.modules.length} modules` : ''}.`);
      setSubOrg(null); setSub(null); await load();
    } catch (e) { setSub((p) => ({ ...p, _err: e.fields?.expiresAt || e.message })); }
    finally { setSubSaving(false); }
  }

  async function load() {
    const p = new URLSearchParams();
    if (term) p.set('q', term);
    if (statusFilter) p.set('status', statusFilter);
    try { setData(await api.get(`/admin/organisations${p.toString() ? `?${p}` : ''}`)); setError(''); }
    catch (e) { setError(e.message); setData({ organisations: [] }); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [term, statusFilter]);

  async function create() {
    const errs = validateOrg(form, { withAdmin: true });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true); setError('');
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim(),
        legalName: form.legalName.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined,
        // Every organisation starts with a Super Admin (QA M3).
        admin: { email: form.adminEmail.trim(), password: form.adminPassword },
      };
      const org = await api.post('/admin/organisations', body);
      setCreating(false);
      setCreated(org);
      setForm(blankForm); setErrors({});
      await load();
    } catch (e) {
      // The form stays open with what was typed; errors sit on their fields.
      setErrors(e.fields || { _: e.message });
    }
    finally { setSaving(false); }
  }
  const setF = (k) => (e) => {
    const val = k === 'code' ? e.target.value.toUpperCase() : e.target.value;
    setForm((f) => ({ ...f, [k]: val }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  async function setStatus(org, status) {
    setError('');
    if (status === 'ARCHIVED') {
      const ok = await confirm({
        title: `Archive ${org.name}?`, tone: 'danger', confirmLabel: 'Archive',
        body: <p className="text-sm">Everyone in it is signed out and it leaves the organisation switcher. Its records are kept, and you can restore it later.</p>,
      });
      if (!ok) return;
    }
    try {
      await api.post(`/admin/organisations/${org.id}/status`, { status });
      setDetail(null); setEdit(null);
      setNotice(status === 'SUSPENDED'
        ? `${org.name} suspended — everyone in it is signed out until you restore it.`
        : status === 'ARCHIVED' ? `${org.name} archived.` : `${org.name} restored.`);
      await load();
    } catch (e) { setError(e.message); }
  }

  if (data === null) return <div className="grid place-items-center py-20"><Spinner className="h-6 w-6 text-brand-600" /></div>;

  const activeId = String(data.activeOrganisationId ?? switcher?.activeOrganisationId ?? '');

  const list = data.organisations || [];
  const nActive = list.filter((o) => o.status === 'ACTIVE').length;
  const nSuspended = list.filter((o) => o.status === 'SUSPENDED').length;
  const filtered = !!(term || statusFilter);
  const totalEmployees = list.reduce((a, o) => a + (Number(o.employees) || 0), 0);

  return (
    <div className="space-y-5">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] text-ink-faint">Platform › Organisations</div>
          <h1 className="page-title text-ink">Organisation Management</h1>
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
        <StatTile Icon={IconUsers} label="Employees" caption="Active employees, all tenants" value={totalEmployees} tone="brand" />
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
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setTerm(q.trim())}
              placeholder="Search name, code or contact" className="w-56" aria-label="Search organisations" />
            <Button size="sm" variant="secondary" onClick={() => setTerm(q.trim())}>Search</Button>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36" aria-label="Status">
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
            {filtered && <Button size="sm" variant="ghost" onClick={() => { setQ(''); setTerm(''); setStatusFilter(''); }}>Clear</Button>}
          </div>
        </div>
        {list.length === 0 ? (
          filtered
            ? <Empty title="No organisations found" subtitle="Nothing matches this search or filter." icon={<IconBriefcase width={19} height={19} />} />
            : <Empty title="No organisations yet" subtitle="Create the first one to get started." icon={<IconBriefcase width={19} height={19} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left px-4">Organisation</th>
                  <th className="text-left px-4">Code</th>
                  <th className="text-left px-4">Status</th>
                  <th className="text-left px-4">Plan</th>
                  <th className="text-right px-4" title="Active employees: onboarded, with an Employee ID, not past their last working day. Candidates are counted separately.">Employees</th>
                  <th className="text-right px-4">Logins</th>
                  <th className="text-left px-4">Contact</th>
                  <th className="text-right px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((o) => {
                  const isActive = String(o.id) === activeId;
                  const suspended = o.status !== 'ACTIVE';
                  const subStatus = o.subscriptionEffectiveStatus || o.subscriptionStatus;
                  return (
                    <tr key={o.id} className={isActive ? 'bg-brand-50/60' : ''}>
                      <td className="px-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar name={o.name} size={28} />
                          <button type="button" onClick={() => openDetail(o)} className="min-w-0 text-left" title="View or edit">
                            <span className="block font-semibold text-ink text-[13px] truncate hover:text-brand-700 hover:underline">{o.name}</span>
                            <span className="block text-[11px] text-ink-faint truncate">{o.legalName || '—'}</span>
                          </button>
                          {isActive && <Badge tone="brand" className="ml-1 shrink-0">Working here</Badge>}
                          {o.admins === 0 && <Badge tone="warn" className="ml-1 shrink-0">No admin</Badge>}
                        </div>
                      </td>
                      <td className="px-4">{o.code ? <Badge tone="info">{o.code}</Badge> : <span className="text-ink-faint">—</span>}</td>
                      <td className="px-4">
                        <Badge tone={STATUS_TONE[o.status] || 'neutral'} dot>{label(o.status)}</Badge>
                      </td>
                      <td className="px-4">
                        <button onClick={() => openSubscription(o)} className="text-left group">
                          <Badge tone={subStatus === 'EXPIRED' ? 'danger' : subStatus === 'TRIAL' || subStatus === 'PAST_DUE' ? 'warn' : 'brand'}>
                            {label(o.plan || 'ENTERPRISE')}{subStatus && subStatus !== 'ACTIVE' ? ` · ${label(subStatus)}` : ''}
                          </Badge>
                          <span className="block text-[10.5px] text-ink-faint mt-0.5 group-hover:text-brand-600">
                            {o.moduleCount ?? '—'} modules · manage
                          </span>
                        </button>
                      </td>
                      <td className="px-4 text-right tabular-nums font-semibold text-ink">
                        {o.employees ?? 0}
                        {o.candidates > 0 && <span className="block text-[10.5px] font-normal text-ink-faint">+{o.candidates} candidate{o.candidates === 1 ? '' : 's'}</span>}
                      </td>
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
                        <button onClick={() => openDetail(o)} className="text-[12.5px] font-semibold text-brand-600 hover:underline mr-3">Edit</button>
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

      {/* ── Subscription: which modules this tenant has bought ───────────── */}
      <Modal
        open={!!subOrg}
        onClose={() => { setSubOrg(null); setSub(null); }}
        size="xl"
        title={subOrg ? `${subOrg.name} — subscription & modules` : ''}
        actions={(
          <>
            <Button variant="ghost" onClick={() => { setSubOrg(null); setSub(null); }}>Cancel</Button>
            <Button onClick={saveSubscription} disabled={!sub || subSaving}>
              {subSaving ? <Spinner className="h-4 w-4" /> : 'Save subscription'}
            </Button>
          </>
        )}
      >
        {!sub ? (
          <div className="grid place-items-center py-12"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : (
          <div className="space-y-5">
            <p className="text-[12.5px] text-ink-faint -mt-1">
              This is the outer gate: a Super Admin&rsquo;s Roles &amp; Permissions can only grant what the
              organisation is entitled to here. Revoking a module removes that section for everyone in this tenant.
            </p>

            {/* Plan presets */}
            <section className="space-y-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-faint">Plan</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {(sub.plans || []).map((pl) => {
                  const on = (sub._planPicked || sub.plan) === pl.key;
                  return (
                    <button key={pl.key} type="button" onClick={() => applyPlan(pl.key)}
                      className={`text-left rounded border p-3 transition-colors ${on ? 'border-brand-600 bg-brand-50' : 'border-line bg-white hover:border-slate-400'}`}>
                      <div className={`text-[13px] font-semibold ${on ? 'text-brand-700' : 'text-ink'}`}>{pl.label}</div>
                      <div className="text-[11px] text-ink-faint mt-0.5 leading-snug">{pl.description}</div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11.5px] text-ink-faint">
                Picking a plan replaces the module set. Ticking modules by hand switches the plan to <b>Custom</b>.
              </p>
            </section>

            {/* Billing state */}
            <section className="grid sm:grid-cols-3 gap-4">
              <Field label="Status">
                <Select value={sub.status || 'ACTIVE'} onChange={(e) => setSub({ ...sub, status: e.target.value, _err: undefined })}>
                  {(sub.statuses || []).map((st) => <option key={st} value={st}>{label(st)}</option>)}
                </Select>
              </Field>
              <Field label="Expires on" hint="Blank = no end date" error={sub._err}>
                <Input type="date" value={(sub.expiresAt || '').slice(0, 10)}
                  min={['ACTIVE', 'TRIAL'].includes(sub.status) ? todayIso() : undefined}
                  onChange={(e) => setSub({ ...sub, expiresAt: e.target.value, _err: undefined })} />
              </Field>
              <Field label="Note" hint="Internal, e.g. PO or contract ref">
                <Input value={sub.note || ''} onChange={(e) => setSub({ ...sub, note: e.target.value })} />
              </Field>
            </section>
            {sub.status === 'EXPIRED' && (
              <div className="rounded bg-crit-bg text-crit border border-crit/20 px-3.5 py-2.5 text-[12.5px]">
                While expired, this tenant keeps only the Dashboard — its people can sign in and see why, but every
                other section is closed.
              </div>
            )}

            {/* Module entitlements, grouped */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-faint">Modules included</div>
                <span className="text-[11.5px] text-ink-faint">
                  {sub.modules.filter((m) => m.enabled).length} of {sub.modules.length}
                </span>
              </div>
              {Object.entries((sub.modules || []).reduce((acc, m) => {
                (acc[m.group] = acc[m.group] || []).push(m); return acc;
              }, {})).map(([group, items]) => (
                <div key={group}>
                  <div className="text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-faint mb-1.5">{group}</div>
                  <div className="rounded border border-line divide-y divide-line overflow-hidden">
                    {items.map((m) => (
                      <label key={m.key} className="flex items-center gap-3 px-3.5 py-2 bg-white cursor-pointer hover:bg-canvas">
                        <input type="checkbox" checked={!!m.enabled} onChange={() => toggleModule(m.key)}
                          className="h-4 w-4 accent-brand-600 cursor-pointer shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-ink">
                            {m.label}
                            {m.sensitive && <span className="ml-2 text-[10px] font-bold text-crit">SENSITIVE</span>}
                          </span>
                          {m.note && <span className="block text-[11px] text-ink-faint">{m.note}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}
      </Modal>

      {/* ── Create ────────────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New organisation"
        actions={(
          <>
            <Button variant="ghost" onClick={() => { setCreating(false); setErrors({}); }}>Cancel</Button>
            <Button onClick={create} disabled={saving}>
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
            <ErrorSummary errors={errors} />
            <Field label="Organisation name" required error={errors.name}>
              <Input value={form.name} placeholder="Acme Industries Pvt Ltd" onChange={setF('name')} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Short code" required hint="2–16 letters or digits, used for employee IDs" error={errors.code}>
                <Input value={form.code} placeholder="ACME" maxLength={16} onChange={setF('code')} />
              </Field>
              <Field label="Legal name" hint="As registered, if different" error={errors.legalName}>
                <Input value={form.legalName} placeholder="Acme Industries Private Limited" onChange={setF('legalName')} />
              </Field>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Contact email" hint="A company-domain address is preferred" error={errors.contactEmail}>
                <Input type="email" value={form.contactEmail} placeholder="hr@acme.com" onChange={setF('contactEmail')} />
              </Field>
              <Field label="Contact phone" hint="10-digit mobile" error={errors.contactPhone}>
                <Input value={form.contactPhone} placeholder="+91 98765 43210" onChange={setF('contactPhone')} />
              </Field>
            </div>
          </section>

          {/* First Super Admin */}
          <section className="rounded-xl2 border p-4 border-brand-200 bg-brand-50/50">
            <span className="block text-sm font-semibold text-ink">First Super Admin</span>
            <span className="block text-xs text-ink-faint mt-0.5">Required — every organisation needs someone to run it. They are prompted to set a new password at first sign-in.</span>
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <Field label="Their email" required error={errors.adminEmail}>
                <Input type="email" value={form.adminEmail} placeholder="admin@acme.com" onChange={setF('adminEmail')} />
              </Field>
              <Field label="Temporary password" required hint="At least 8 characters" error={errors.adminPassword}>
                <Input value={form.adminPassword} placeholder="••••••••" onChange={setF('adminPassword')} />
              </Field>
            </div>
          </section>
          {errors._ && <p className="text-[13px] font-medium text-neg">{errors._}</p>}

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
            {created.warnings?.length > 0 && (
              <div className="rounded bg-crit-bg text-crit border border-crit/20 px-3 py-2 text-[12.5px] space-y-1">
                {created.warnings.map((w) => <div key={w}>{w}</div>)}
              </div>
            )}
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
      {/* ── Detail / edit ──────────────────────────────────────────────── */}
      <Modal
        open={!!detail}
        onClose={() => { setDetail(null); setEdit(null); }}
        size="lg"
        title={detail ? detail.name : ''}
        actions={(
          <>
            <Button variant="ghost" onClick={() => { setDetail(null); setEdit(null); }}>Cancel</Button>
            <Button onClick={saveDetail} disabled={detailBusy}>{detailBusy ? <Spinner className="h-4 w-4" /> : 'Save changes'}</Button>
          </>
        )}
      >
        {detail && edit && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 text-[12px]">
              <Badge tone={STATUS_TONE[detail.status] || 'neutral'} dot>{label(detail.status)}</Badge>
              <Badge tone="info">{detail.employees ?? 0} active employees</Badge>
              {detail.candidates > 0 && <Badge tone="neutral">{detail.candidates} candidates</Badge>}
              <Badge tone="neutral">{detail.users ?? 0} logins</Badge>
              <span className="text-ink-faint self-center">Created {fmtDate(detail.createdAt)}</span>
            </div>
            {detail.warnings?.length > 0 && (
              <div className="rounded bg-crit-bg text-crit border border-crit/20 px-3 py-2 text-[12.5px] space-y-1">
                {detail.warnings.map((w) => <div key={w}>{w}</div>)}
              </div>
            )}
            <ErrorSummary errors={editErrors} />
            <section className="grid sm:grid-cols-2 gap-4">
              <Field label="Organisation name" required error={editErrors.name}>
                <Input value={edit.name} onChange={(e) => { setEdit({ ...edit, name: e.target.value }); setEditErrors({ ...editErrors, name: undefined }); }} />
              </Field>
              <Field label="Legal name" error={editErrors.legalName}>
                <Input value={edit.legalName} onChange={(e) => setEdit({ ...edit, legalName: e.target.value })} />
              </Field>
              <Field label="Short code" required hint="Changing it does not renumber existing Employee IDs" error={editErrors.code}>
                <Input value={edit.code} maxLength={16} onChange={(e) => { setEdit({ ...edit, code: e.target.value.toUpperCase() }); setEditErrors({ ...editErrors, code: undefined }); }} />
              </Field>
              <div />
              <Field label="Contact email" error={editErrors.contactEmail}>
                <Input type="email" value={edit.contactEmail} onChange={(e) => { setEdit({ ...edit, contactEmail: e.target.value }); setEditErrors({ ...editErrors, contactEmail: undefined }); }} />
              </Field>
              <Field label="Contact phone" error={editErrors.contactPhone}>
                <Input value={edit.contactPhone} onChange={(e) => { setEdit({ ...edit, contactPhone: e.target.value }); setEditErrors({ ...editErrors, contactPhone: undefined }); }} />
              </Field>
            </section>
            {editErrors._ && <p className="text-[13px] font-medium text-neg">{editErrors._}</p>}

            <section className="space-y-2">
              <div className="text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-faint">Super Admins</div>
              {detail.adminAccounts?.length ? (
                <ul className="rounded border border-line divide-y divide-line">
                  {detail.adminAccounts.map((a) => (
                    <li key={a.id} className="px-3 py-2 text-[13px] flex justify-between">
                      <span className="font-mono">{a.email}</span><span className="text-ink-faint">{label(a.status)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded border border-crit/30 bg-crit-bg p-3 space-y-3">
                  <p className="text-[12.5px] text-crit">This organisation has no Super Admin, so nobody can manage it. Add one:</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Email" required error={adminErrors.email}>
                      <Input value={newAdmin.email} onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })} />
                    </Field>
                    <Field label="Temporary password" required hint="At least 8 characters" error={adminErrors.password}>
                      <Input value={newAdmin.password} onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })} />
                    </Field>
                  </div>
                  {adminErrors._ && <p className="text-[12.5px] text-neg">{adminErrors._}</p>}
                  <Button size="sm" onClick={addFirstAdmin} disabled={detailBusy}>Add Super Admin</Button>
                </div>
              )}
            </section>

            <section className="rounded border border-line p-3 space-y-2">
              <div className="text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-faint">Remove this organisation</div>
              <p className="text-[12.5px] text-ink-faint">
                {detail.canDelete
                  ? 'It has no employee records, so it can be deleted outright — useful for test tenants.'
                  : `It has ${detail.employeeRecords} employee record${detail.employeeRecords === 1 ? '' : 's'}, so it can only be archived: logins are disabled and it leaves the switcher, but its records are kept.`}
              </p>
              <div className="flex flex-wrap gap-2">
                {detail.status === 'ARCHIVED'
                  ? <Button size="sm" variant="secondary" onClick={() => setStatus(detail, 'ACTIVE')}>Restore</Button>
                  : <Button size="sm" variant="secondary" onClick={() => setStatus(detail, 'ARCHIVED')}>Archive</Button>}
                {detail.canDelete && <Button size="sm" variant="danger" onClick={() => deleteOrg(detail)}>Delete</Button>}
              </div>
            </section>
          </div>
        )}
      </Modal>
      {confirmUi}
    </div>
  );
}
