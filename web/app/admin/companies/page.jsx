'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { Button, Card, Field, Input, Modal, Select, Spinner, Empty, ConfirmClick } from '@/components/ui.jsx';
import { IconBriefcase, IconPlus, IconCheck, IconUsers, IconX } from '@/components/icons.jsx';

// ============================================================================
// Companies — the legal entities inside this organisation.
//
// An organisation is the tenant; a company is a payroll/legal entity within it.
// A group can run several: each mints its own employee codes from its prefix and
// keeps its own departments, designations and salary template, while HR still
// works across the whole organisation in one place.
// ============================================================================

export default function CompaniesPage() {
  const { canManage, activeOrg } = usePerms();
  // Creating a legal entity (GSTIN, PAN, prefix) is a Super Admin decision;
  // maintaining its departments and designations is everyday HR work. Two
  // separate permissions, so HR can do the second without the first.
  const mayManage = canManage('COMPANIES');
  const mayManageStructure = canManage('STRUCTURE');

  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '', codePrefix: '', legalName: '', gstin: '', pan: '', pfCode: '', esicCode: '', address: '',
    seedStructure: true,
  });
  const [editing, setEditing] = useState(null);
  const [structFor, setStructFor] = useState(null);   // { company, departments, designations }
  const [newDep, setNewDep] = useState('');
  const [newDes, setNewDes] = useState({ title: '', grade: '' });

  async function load() {
    try { setRows(await api.get('/admin/companies')); setError(''); }
    catch (e) { setError(e.message); setRows([]); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setSaving(true); setError('');
    try {
      const created = await api.post('/admin/companies', {
        name: form.name.trim(),
        codePrefix: form.codePrefix.trim().toUpperCase(),
        legalName: form.legalName.trim() || undefined,
        gstin: form.gstin.trim() || undefined,
        pan: form.pan.trim().toUpperCase() || undefined,
        pfCode: form.pfCode.trim() || undefined,
        esicCode: form.esicCode.trim() || undefined,
        address: form.address.trim() || undefined,
        seedStructure: form.seedStructure,
      });
      setCreating(false);
      setForm({ name: '', codePrefix: '', legalName: '', gstin: '', pan: '', pfCode: '', esicCode: '', address: '', seedStructure: true });
      setNotice(`${created.name} created. New hires there get employee IDs starting ${created.codePrefix}.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function saveEdit() {
    setSaving(true); setError('');
    try {
      await api.patch(`/admin/companies/${editing.id}`, {
        name: editing.name, legalName: editing.legalName, gstin: editing.gstin,
        pan: editing.pan, pfCode: editing.pfCode, esicCode: editing.esicCode, address: editing.address,
      });
      setEditing(null); setNotice('Company updated.'); await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function setActive(c, active) {
    setError('');
    try {
      await api.post(`/admin/companies/${c.id}/status`, { active });
      setNotice(active
        ? `${c.name} restored — it can receive new hires again.`
        : `${c.name} archived. Its records stay, but it no longer appears when hiring.`);
      await load();
    } catch (e) { setError(e.message); }
  }

  async function openStructure(c) {
    setError('');
    try {
      const s = await api.get(`/admin/companies/${c.id}/structure`);
      setStructFor({ company: c, ...s });
      setNewDep(''); setNewDes({ title: '', grade: '' });
    } catch (e) { setError(e.message); }
  }
  async function refreshStructure() {
    const s = await api.get(`/admin/companies/${structFor.company.id}/structure`);
    setStructFor((p) => ({ ...p, ...s }));
  }
  async function addDep() {
    if (!newDep.trim()) return;
    try { await api.post(`/admin/companies/${structFor.company.id}/departments`, { name: newDep.trim() }); setNewDep(''); await refreshStructure(); await load(); }
    catch (e) { setError(e.message); }
  }
  async function delDep(d) {
    try { await api.del(`/admin/companies/${structFor.company.id}/departments/${d.id}`); await refreshStructure(); await load(); }
    catch (e) { setError(e.message); }
  }
  async function addDes() {
    if (!newDes.title.trim()) return;
    try {
      await api.post(`/admin/companies/${structFor.company.id}/designations`,
        { title: newDes.title.trim(), grade: newDes.grade.trim() || undefined });
      setNewDes({ title: '', grade: '' }); await refreshStructure(); await load();
    } catch (e) { setError(e.message); }
  }
  async function delDes(d) {
    try { await api.del(`/admin/companies/${structFor.company.id}/designations/${d.id}`); await refreshStructure(); await load(); }
    catch (e) { setError(e.message); }
  }

  if (rows === null) return <div className="grid place-items-center py-20"><Spinner className="h-6 w-6 text-brand-600" /></div>;

  const active = rows.filter((c) => c.active);
  const archived = rows.filter((c) => !c.active);

  const CompanyCard = ({ c }) => (
    <Card className={`p-5 ${c.active ? '' : 'opacity-70'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-ink truncate">{c.name}</div>
          <div className="text-[11px] text-ink-faint mt-0.5 truncate">
            {c.legalName && c.legalName !== c.name ? c.legalName : ' '}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="rounded-full bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 px-2 py-0.5 text-[10px] font-bold tracking-wide">
            {c.codePrefix}
          </span>
          {!c.active && (
            <span className="rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 px-2 py-0.5 text-[10px] font-semibold">
              Archived
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-ink-soft">
          <IconUsers className="text-ink-faint" />
          <b className="text-ink tabular-nums">{c.employees ?? 0}</b> employees
        </span>
        <span className="text-ink-soft"><b className="text-ink tabular-nums">{c.departments ?? 0}</b> departments</span>
        <span className="text-ink-soft"><b className="text-ink tabular-nums">{c.designations ?? 0}</b> roles</span>
      </div>

      {(c.gstin || c.pan || c.pfCode || c.esicCode) && (
        <div className="mt-3 text-[11px] text-ink-faint space-y-0.5">
          {c.gstin && <div>GSTIN {c.gstin}</div>}
          {[c.pan && `PAN ${c.pan}`, c.pfCode && `PF ${c.pfCode}`, c.esicCode && `ESIC ${c.esicCode}`]
            .filter(Boolean).join(' · ') && (
            <div>{[c.pan && `PAN ${c.pan}`, c.pfCode && `PF ${c.pfCode}`, c.esicCode && `ESIC ${c.esicCode}`].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button size="sm" variant="ghost" onClick={() => openStructure(c)}>Departments &amp; roles</Button>
        {mayManage && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing({ ...c })}>Edit</Button>
            {c.active ? (
              <ConfirmClick onConfirm={() => setActive(c, false)} confirmLabel="Archive this company?" className="text-sm">
                Archive
              </ConfirmClick>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setActive(c, true)}>Restore</Button>
            )}
          </>
        )}
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Companies</h2>
          <p className="text-sm text-ink-soft mt-1 max-w-2xl">
            The legal entities inside {activeOrg?.name || 'this organisation'}. Each one issues its own employee
            IDs and keeps its own departments, designations and payroll template — while HR works across all of
            them in one place.
          </p>
        </div>
        {mayManage
          ? <Button onClick={() => setCreating(true)} className="shrink-0"><IconPlus /> New company</Button>
          : mayManageStructure
            ? <p className="text-xs text-ink-faint max-w-[220px] shrink-0">
                You can edit departments and designations. Creating a company is a Super Admin action.
              </p>
            : null}
      </div>

      {error && <div className="rounded-lg bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 px-4 py-3 text-sm">{error}</div>}
      {notice && (
        <div className="rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 px-4 py-3 text-sm flex items-start gap-2">
          <IconCheck className="mt-0.5 shrink-0" /><span>{notice}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((c) => <CompanyCard key={c.id} c={c} />)}
        {rows.length === 0 && (
          <Card className="p-10 sm:col-span-2 xl:col-span-3">
            <Empty title="No companies yet" subtitle="Add the first legal entity for this organisation." icon={<IconBriefcase />} />
          </Card>
        )}
      </div>

      {archived.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint mb-2">Archived</div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {archived.map((c) => <CompanyCard key={c.id} c={c} />)}
          </div>
        </div>
      )}

      {/* ── New company ───────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New company"
        size="lg"
        actions={(
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={create} disabled={saving || !form.name.trim() || !form.codePrefix.trim()}>
              {saving ? <Spinner className="h-4 w-4" /> : 'Create company'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Company name" required>
              <Input value={form.name} placeholder="Acme Manufacturing Pvt Ltd"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Employee ID prefix" required
              hint="2–6 letters or digits. Cannot be changed later — employee IDs are minted from it.">
              <Input value={form.codePrefix} placeholder="ACM"
                onChange={(e) => setForm({ ...form, codePrefix: e.target.value.toUpperCase().slice(0, 6) })} />
            </Field>
          </div>
          <Field label="Legal name" hint="If different from the display name">
            <Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="GSTIN"><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></Field>
            <Field label="PAN"><Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} /></Field>
            <Field label="PF code"><Input value={form.pfCode} onChange={(e) => setForm({ ...form, pfCode: e.target.value })} /></Field>
            <Field label="ESIC code"><Input value={form.esicCode} onChange={(e) => setForm({ ...form, esicCode: e.target.value })} /></Field>
          </div>
          <Field label="Registered address">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-line bg-slate-50/60 p-4 cursor-pointer">
            <input type="checkbox" checked={form.seedStructure}
              onChange={(e) => setForm({ ...form, seedStructure: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-brand-600 cursor-pointer" />
            <span>
              <span className="block text-sm font-semibold text-ink">Start with a standard department list</span>
              <span className="block text-xs text-ink-soft mt-0.5">
                Creates Engineering, HR, Sales, Operations and Finance plus common designations, so you can hire
                straight away. You can edit them afterwards.
              </span>
            </span>
          </label>
        </div>
      </Modal>

      {/* ── Edit ──────────────────────────────────────────────────────────── */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : ''}
        size="lg"
        actions={(
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? <Spinner className="h-4 w-4" /> : 'Save'}</Button>
          </>
        )}
      >
        {editing && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 ring-1 ring-inset ring-line px-4 py-3 text-xs text-ink-soft">
              Employee ID prefix is <b className="text-ink">{editing.codePrefix}</b> and cannot be changed —
              existing employee IDs were issued from it.
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Company name" required>
                <Input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Legal name">
                <Input value={editing.legalName || ''} onChange={(e) => setEditing({ ...editing, legalName: e.target.value })} />
              </Field>
              <Field label="GSTIN"><Input value={editing.gstin || ''} onChange={(e) => setEditing({ ...editing, gstin: e.target.value })} /></Field>
              <Field label="PAN"><Input value={editing.pan || ''} onChange={(e) => setEditing({ ...editing, pan: e.target.value.toUpperCase() })} /></Field>
              <Field label="PF code"><Input value={editing.pfCode || ''} onChange={(e) => setEditing({ ...editing, pfCode: e.target.value })} /></Field>
              <Field label="ESIC code"><Input value={editing.esicCode || ''} onChange={(e) => setEditing({ ...editing, esicCode: e.target.value })} /></Field>
            </div>
            <Field label="Registered address">
              <Input value={editing.address || ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      {/* ── Departments & designations, per company ───────────────────────── */}
      <Modal
        open={!!structFor}
        onClose={() => setStructFor(null)}
        size="lg"
        title={structFor ? `${structFor.company.name} — departments & roles` : ''}
        actions={<Button variant="ghost" onClick={() => setStructFor(null)}>Close</Button>}
      >
        {structFor && (
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <div className="text-sm font-semibold text-ink mb-2">Departments</div>
              <div className="rounded-xl border border-line divide-y divide-line max-h-64 overflow-y-auto">
                {(structFor.departments || []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="text-ink">{d.name}</span>
                    {mayManageStructure && (
                      <button onClick={() => delDep(d)} title="Remove"
                        className="text-ink-faint hover:text-rose-600"><IconX width={14} height={14} /></button>
                    )}
                  </div>
                ))}
                {(structFor.departments || []).length === 0 && (
                  <div className="px-3 py-4 text-xs text-ink-faint">None yet.</div>
                )}
              </div>
              {mayManageStructure && (
                <div className="flex gap-2 mt-2">
                  <Input value={newDep} placeholder="Add a department"
                    onChange={(e) => setNewDep(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDep(); } }} />
                  <Button size="sm" onClick={addDep} disabled={!newDep.trim()}>Add</Button>
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-semibold text-ink mb-2">Designations</div>
              <div className="rounded-xl border border-line divide-y divide-line max-h-64 overflow-y-auto">
                {(structFor.designations || []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="text-ink">
                      {d.title}
                      {d.grade && <span className="text-ink-faint text-xs ml-1.5">{d.grade}</span>}
                    </span>
                    {mayManageStructure && (
                      <button onClick={() => delDes(d)} title="Remove"
                        className="text-ink-faint hover:text-rose-600"><IconX width={14} height={14} /></button>
                    )}
                  </div>
                ))}
                {(structFor.designations || []).length === 0 && (
                  <div className="px-3 py-4 text-xs text-ink-faint">None yet.</div>
                )}
              </div>
              {mayManageStructure && (
                <div className="flex gap-2 mt-2">
                  <Input value={newDes.title} placeholder="Add a designation"
                    onChange={(e) => setNewDes({ ...newDes, title: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDes(); } }} />
                  <Input value={newDes.grade} placeholder="Grade" className="!w-24"
                    onChange={(e) => setNewDes({ ...newDes, grade: e.target.value })} />
                  <Button size="sm" onClick={addDes} disabled={!newDes.title.trim()}>Add</Button>
                </div>
              )}
            </div>

            <p className="sm:col-span-2 text-xs text-ink-faint">
              {mayManageStructure
                ? 'Anything already in use by an employee cannot be removed.'
                : 'You have read-only access here. Ask a Super Admin to grant you “Departments & Roles”.'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
