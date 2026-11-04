'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { Button, Card, Field, Input, Modal, Spinner, Empty, ConfirmClick, ErrorSummary } from '@/components/ui.jsx';
import { validator } from '@/lib/validate.js';
import { MasterText } from '@/components/MasterPicker.jsx';
import { IconBriefcase, IconPlus, IconCheck, IconUsers, IconX } from '@/components/icons.jsx';

// ============================================================================
// Companies — the legal entities inside this organisation.
//
// An organisation is the tenant; a company is a payroll/legal entity within it.
// A group can run several: each mints its own employee codes from its prefix and
// keeps its own salary template. Departments and designations are shared by the
// whole organisation (the same lists the Hierarchy screen edits).
// ============================================================================

// Same rules as the server (companyController.structureNameError), so every
// problem shows at once before a request is sent.
const NAME_CHARS = /^[A-Za-z0-9][A-Za-z0-9 &.,'()/+-]*$/;
function structureNameError(name, label) {
  const s = String(name ?? '').trim();
  if (!s) return `${label} is required`;
  if (s.length > 120) return `${label} must be at most 120 characters`;
  if (/[<>]/.test(s)) return `${label} cannot contain < or >`;
  if (!/[A-Za-z]/.test(s)) return `${label} must contain letters`;
  if (!NAME_CHARS.test(s)) return `${label} can use letters, digits, spaces and & . , ' ( ) / + - only`;
  return null;
}

function companyErrors(f, { prefix = true } = {}) {
  const v = validator();
  const nameErr = structureNameError(f.name, 'Company name');
  if (nameErr) v.add('name', nameErr);
  if (f.legalName && String(f.legalName).trim()) {
    const e = structureNameError(f.legalName, 'Legal name'); if (e) v.add('legalName', e);
  }
  if (prefix) {
    const px = String(f.codePrefix || '').trim().toUpperCase();
    if (!px) v.add('codePrefix', 'Employee ID prefix is required');
    else if (!/^[A-Z0-9]{2,6}$/.test(px)) v.add('codePrefix', 'Employee ID prefix must be 2–6 letters or digits (e.g. TKF)');
  }
  v.pattern('gstin', f.gstin, 'gstin', 'GSTIN');
  v.pattern('pan', f.pan, 'pan', 'PAN');
  v.pattern('pfCode', f.pfCode, 'pf', 'PF code');
  v.pattern('esicCode', f.esicCode, 'esic', 'ESIC code');
  const g = String(f.gstin || '').trim().toUpperCase(); const p = String(f.pan || '').trim().toUpperCase();
  if (g && p && !v.fields.gstin && !v.fields.pan && g.slice(2, 12) !== p) {
    v.add('gstin', 'GSTIN does not contain this PAN (characters 3-12 of a GSTIN are the PAN)');
  }
  return v.fields;
}

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
  const [errors, setErrors] = useState({});       // field errors of the open form
  const [formError, setFormError] = useState(''); // non-field error of the open form
  const [structErr, setStructErr] = useState('');
  const [structFor, setStructFor] = useState(null);   // { company, departments, designations }
  const [newDep, setNewDep] = useState('');
  const [newDes, setNewDes] = useState({ title: '', grade: '' });

  async function load() {
    try { setRows(await api.get('/admin/companies')); setError(''); }
    catch (e) { setError(e.message); setRows([]); }
  }
  useEffect(() => { load(); }, []);

  // Clear a field's error as soon as it is edited, so a corrected value never
  // keeps showing the old message.
  const clearErr = (k) => setErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  const setF = (k, v) => { setForm((f) => ({ ...f, [k]: v })); clearErr(k); };
  const setE = (k, v) => { setEditing((f) => ({ ...f, [k]: v })); clearErr(k); };

  async function create() {
    const errs = companyErrors(form);
    setErrors(errs); setFormError('');
    if (Object.keys(errs).length) return;
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
      setNotice(`${created.name} created. New hires there get employee IDs starting ${created.codePrefix}.`
        + (created.structureMessage ? ` ${created.structureMessage}` : ''));
      await load();
    } catch (e) { setErrors(e.fields || {}); setFormError(e.fields ? '' : e.message); }
    finally { setSaving(false); }
  }

  async function saveEdit() {
    const errs = companyErrors(editing, { prefix: !editing.prefixLocked });
    setErrors(errs); setFormError('');
    if (Object.keys(errs).length) return;
    setSaving(true); setError('');
    try {
      const trimOrNull = (v) => (v == null ? v : String(v).trim());
      await api.patch(`/admin/companies/${editing.id}`, {
        name: trimOrNull(editing.name), legalName: trimOrNull(editing.legalName),
        gstin: trimOrNull(editing.gstin)?.toUpperCase(), pan: trimOrNull(editing.pan)?.toUpperCase(),
        pfCode: trimOrNull(editing.pfCode)?.toUpperCase(), esicCode: trimOrNull(editing.esicCode),
        address: trimOrNull(editing.address),
        ...(editing.prefixLocked ? {} : { codePrefix: String(editing.codePrefix || '').trim().toUpperCase() }),
      });
      setEditing(null); setNotice('Company updated.'); await load();
    } catch (e) { setErrors(e.fields || {}); setFormError(e.fields ? '' : e.message); }
    finally { setSaving(false); }
  }
  const openCreate = () => { setErrors({}); setFormError(''); setCreating(true); };
  const openEdit = (c) => { setErrors({}); setFormError(''); setEditing({ ...c }); };

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
    setError(''); setStructErr('');
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
    const bad = structureNameError(newDep, 'Department name');
    if (bad) { setStructErr(bad); return; }
    setStructErr('');
    try { await api.post(`/admin/companies/${structFor.company.id}/departments`, { name: newDep.trim() }); setNewDep(''); await refreshStructure(); await load(); }
    catch (e) { setStructErr(e.message); }
  }
  async function delDep(d) {
    setStructErr('');
    try { await api.del(`/admin/companies/${structFor.company.id}/departments/${d.id}`); await refreshStructure(); await load(); }
    catch (e) { setStructErr(e.message); }
  }
  async function addDes() {
    if (!newDes.title.trim()) return;
    const bad = structureNameError(newDes.title, 'Designation title');
    if (bad) { setStructErr(bad); return; }
    setStructErr('');
    try {
      await api.post(`/admin/companies/${structFor.company.id}/designations`,
        { title: newDes.title.trim(), grade: newDes.grade.trim() || undefined });
      setNewDes({ title: '', grade: '' }); await refreshStructure(); await load();
    } catch (e) { setStructErr(e.message); }
  }
  async function delDes(d) {
    setStructErr('');
    try { await api.del(`/admin/companies/${structFor.company.id}/designations/${d.id}`); await refreshStructure(); await load(); }
    catch (e) { setStructErr(e.message); }
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
      </div>
      <div className="mt-1 text-[11px] text-ink-faint">
        Uses the organisation&apos;s {c.departments ?? 0} departments and {c.designations ?? 0} designations
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
        <Button size="sm" variant="ghost" onClick={() => openStructure(c)}>Departments &amp; designations</Button>
        {mayManage && (
          <>
            <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>Edit</Button>
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
            IDs and keeps its own payroll template. Departments and designations belong to the whole
            organisation — every company draws on the same two lists (also edited under Hierarchy &amp; Levels).
          </p>
        </div>
        {mayManage
          ? <Button onClick={openCreate} className="shrink-0"><IconPlus /> New company</Button>
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
            <Button onClick={create} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : 'Create company'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <ErrorSummary errors={errors} />
          {formError && <div role="alert" className="text-[12.5px] text-neg">{formError}</div>}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Company name" required error={errors.name}>
              <Input value={form.name} placeholder="Acme Manufacturing Pvt Ltd" maxLength={120}
                onChange={(e) => setF('name', e.target.value)} />
            </Field>
            <Field label="Employee ID prefix" required error={errors.codePrefix}
              hint="2–6 letters or digits, your own (not another company's). Editable until the first employee ID is issued.">
              <Input value={form.codePrefix} placeholder="ACM"
                onChange={(e) => setF('codePrefix', e.target.value.toUpperCase().slice(0, 6))} />
            </Field>
          </div>
          <Field label="Legal name" hint="If different from the display name" error={errors.legalName}>
            <Input value={form.legalName} maxLength={120} onChange={(e) => setF('legalName', e.target.value)} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="GSTIN" error={errors.gstin} hint="15 characters, like 21ABCDE1234F1Z5"><Input value={form.gstin} maxLength={15} onChange={(e) => setF('gstin', e.target.value.toUpperCase())} /></Field>
            <Field label="PAN" error={errors.pan} hint="Like ABCDE1234F"><Input value={form.pan} maxLength={10} onChange={(e) => setF('pan', e.target.value.toUpperCase())} /></Field>
            <Field label="PF code" error={errors.pfCode} hint="Like MHBAN00123450000123456"><Input value={form.pfCode} maxLength={22} onChange={(e) => setF('pfCode', e.target.value.toUpperCase())} /></Field>
            <Field label="ESIC code" error={errors.esicCode} hint="17 digits"><Input value={form.esicCode} maxLength={17} inputMode="numeric" onChange={(e) => setF('esicCode', e.target.value)} /></Field>
          </div>
          <Field label="Registered address" error={errors.address}>
            <Input value={form.address} maxLength={500} onChange={(e) => setF('address', e.target.value)} />
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-line bg-slate-50/60 p-4 cursor-pointer">
            <input type="checkbox" checked={form.seedStructure}
              onChange={(e) => setForm({ ...form, seedStructure: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-brand-600 cursor-pointer" />
            <span>
              <span className="block text-sm font-semibold text-ink">Add the standard department list to the organisation</span>
              <span className="block text-xs text-ink-soft mt-0.5">
                Adds Engineering, Human Resources, Sales, Operations and Finance plus 7 common designations to the
                organisation-wide lists that every company shares. Names you already have are reused, not
                duplicated; you will be told exactly what was added. Untick if your lists are already set up.
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
            <ErrorSummary errors={errors} />
            {formError && <div role="alert" className="text-[12.5px] text-neg">{formError}</div>}
            {editing.prefixLocked ? (
              <div className="rounded-lg bg-slate-50 ring-1 ring-inset ring-line px-4 py-3 text-xs text-ink-soft">
                Employee ID prefix is <b className="text-ink">{editing.codePrefix}</b> and can no longer be changed —
                {` ${editing.idsIssued} employee ID${editing.idsIssued === 1 ? ' has' : 's have'}`} already been issued from it.
              </div>
            ) : (
              <Field label="Employee ID prefix" required error={errors.codePrefix}
                hint="No employee ID has been issued from it yet, so you can still change it.">
                <Input value={editing.codePrefix || ''}
                  onChange={(e) => setE('codePrefix', e.target.value.toUpperCase().slice(0, 6))} />
              </Field>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Company name" required error={errors.name}>
                <Input value={editing.name || ''} maxLength={120} onChange={(e) => setE('name', e.target.value)} />
              </Field>
              <Field label="Legal name" error={errors.legalName}>
                <Input value={editing.legalName || ''} maxLength={120} onChange={(e) => setE('legalName', e.target.value)} />
              </Field>
              <Field label="GSTIN" error={errors.gstin}><Input value={editing.gstin || ''} maxLength={15} onChange={(e) => setE('gstin', e.target.value.toUpperCase())} /></Field>
              <Field label="PAN" error={errors.pan}><Input value={editing.pan || ''} maxLength={10} onChange={(e) => setE('pan', e.target.value.toUpperCase())} /></Field>
              <Field label="PF code" error={errors.pfCode}><Input value={editing.pfCode || ''} maxLength={22} onChange={(e) => setE('pfCode', e.target.value.toUpperCase())} /></Field>
              <Field label="ESIC code" error={errors.esicCode}><Input value={editing.esicCode || ''} maxLength={17} inputMode="numeric" onChange={(e) => setE('esicCode', e.target.value)} /></Field>
            </div>
            <Field label="Registered address" error={errors.address}>
              <Input value={editing.address || ''} maxLength={500} onChange={(e) => setE('address', e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      {/* ── Departments & designations, per company ───────────────────────── */}
      <Modal
        open={!!structFor}
        onClose={() => setStructFor(null)}
        size="lg"
        title={structFor ? `Departments & designations (organisation-wide)` : ''}
        actions={<Button variant="ghost" onClick={() => setStructFor(null)}>Close</Button>}
      >
        {structFor && (
          <div className="grid sm:grid-cols-2 gap-6">
            <p className="sm:col-span-2 text-xs text-ink-soft">
              These lists belong to the whole organisation, not only to {structFor.company.name}: every company
              shares them, and a change here shows everywhere (including Hierarchy &amp; Levels).
            </p>
            {structErr && <div role="alert" className="sm:col-span-2 text-[12.5px] text-neg">{structErr}</div>}
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
                  <Input value={newDep} placeholder="Add a department" maxLength={120}
                    onChange={(e) => { setNewDep(e.target.value); setStructErr(''); }}
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
                  <Input value={newDes.title} placeholder="Add a designation" maxLength={120}
                    onChange={(e) => { setNewDes({ ...newDes, title: e.target.value }); setStructErr(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDes(); } }} />
                  <div className="w-28 shrink-0">
                    <MasterText kind="GRADE" value={newDes.grade} placeholder="Grade"
                      onChange={(e) => setNewDes({ ...newDes, grade: e.target.value })} />
                  </div>
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
