'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { label } from '@/lib/labels.js';
import { Card, Button, Select, Field, Spinner, Empty, Badge, useConfirm } from '@/components/ui.jsx';

const FLOW_LABEL = { NFA: 'NFA', NFA_SETTLEMENT: 'Settlement', RESIGNATION: 'Resignation', PMS_RATING: 'PMS' };
const RESOLVER_HINT = {
  manager_chain: 'Normally the employee\'s own manager; this row is used when the employee has none.',
  named_user: 'Used for every request in the chain.',
  matrix: 'Used for every request in the chain; a project / category / zone row overrides the blanket one.',
};
const empty = { roleKey: '', approverEmployeeId: '', projectId: '', expenseCategoryId: '', zoneId: '' };

// Approver matrix: who approves each chain stage. A row with no project /
// category / zone applies everywhere; scoped rows win over wildcard ones.
export default function ApproversPage() {
  const [data, setData] = useState(null);            // { stages, rows }
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [zones, setZones] = useState([]);
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);              // { ok, text }
  const [confirm, confirmUi] = useConfirm();

  const load = () => api.get('/admin/approver-matrix').then(setData).catch((e) => { setData({ stages: [], rows: [] }); setMsg({ text: e.message }); });
  useEffect(() => {
    load();
    // Only current employees (never candidates or people who have left).
    api.get('/admin/approver-matrix/candidates').then(setPeople).catch(() => {});
    api.get('/admin/masters/projects').then(setProjects).catch(() => {});
    api.get('/admin/masters/expense-categories').then(setCategories).catch(() => {});
    api.get('/admin/masters/cost-zones').then(setZones).catch(() => {});
  }, []);

  const stages = data?.stages || [];
  const stage = stages.find((s) => s.key === f.roleKey);
  const stageLabel = (k) => stages.find((s) => s.key === k)?.label || label(k);
  const scopeOf = (r) => `${r.projectId || ''}|${r.expenseCategoryId || ''}|${r.zoneId || ''}`;

  async function save() {
    const e = {};
    if (!f.roleKey) e.roleKey = 'Choose a stage';
    if (!f.approverEmployeeId) e.approverEmployeeId = 'Choose an approver';
    setErrors(e);
    if (Object.keys(e).length) return;
    const rows = data?.rows || [];
    const sameScope = rows.find((r) => r.roleKey === f.roleKey && scopeOf(r) === scopeOf(f));
    if (sameScope && String(sameScope.approverEmployeeId) === String(f.approverEmployeeId) && !sameScope.needsReassignment) {
      setMsg({ text: `${sameScope.approver} is already the ${stageLabel(f.roleKey)} approver for this scope.` });
      return;
    }
    const other = [...new Set(rows.filter((r) => String(r.approverEmployeeId) === String(f.approverEmployeeId) && r.roleKey !== f.roleKey).map((r) => stageLabel(r.roleKey)))];
    const person = people.find((p) => String(p.id) === String(f.approverEmployeeId));
    const warn = [];
    if (sameScope) warn.push(`This replaces ${sameScope.approver} as ${stageLabel(f.roleKey)} for this scope.`);
    if (other.length) warn.push(`${person?.name || 'This person'} already approves: ${other.join(', ')}. One person on several stages means they approve the same request more than once, and cannot approve their own requests.`);
    if (warn.length && !(await confirm({ title: 'Save this approver?', body: <div className="space-y-2">{warn.map((w) => <p key={w}>{w}</p>)}</div>, confirmLabel: 'Save anyway' }))) return;
    setBusy(true); setMsg(null);
    try {
      await api.post('/admin/approver-matrix', f);
      setF(empty);
      await load(); setMsg({ ok: true, text: 'Approver saved.' });
    } catch (er) { setErrors(er.fields || {}); setMsg({ text: er.message }); } finally { setBusy(false); }
  }
  async function remove(r) {
    if (!(await confirm({ title: `Remove ${r.approver}?`, tone: 'danger', confirmLabel: 'Remove',
      body: `${r.approver} will no longer be the ${stageLabel(r.roleKey)} approver${r.project || r.category || r.zone ? ' for this scope' : ''}. Requests already in progress keep their approver.` }))) return;
    try { await api.del(`/admin/approver-matrix/${r.id}`); load(); } catch (e) { setMsg({ text: e.message }); }
  }
  const flagged = (data?.rows || []).filter((r) => r.needsReassignment);

  return (
    <div className="space-y-5">
      {confirmUi}
      <div>
        <h1 className="page-title text-ink">Approvers</h1>
        <p className="text-ink-faint text-sm mt-0.5">
          Assign who approves each stage of the NFA, settlement, resignation and PMS chains. Leave project, category and
          zone blank to apply everywhere — a more specific row overrides the blanket one. Optional stages with no approver
          are skipped; a required stage (marked “Required”) must have an approver, otherwise employees cannot submit.
          Nobody ever approves their own request.
        </p>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
      {!!flagged.length && (
        <Card className="p-3 border-amber-200 bg-amber-50/60 text-sm text-amber-800">
          {flagged.length} approver row{flagged.length > 1 ? 's need' : ' needs'} reassignment because the approver has left — those stages are skipped until you pick someone new.
        </Card>
      )}

      <Card className="p-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-start">
          <Field label="Stage" required error={errors.roleKey} hint={stage ? `${stage.flows.map((x) => FLOW_LABEL[x] || label(x)).join(', ')} · ${RESOLVER_HINT[stage.resolver] || ''}` : undefined}>
            <Select value={f.roleKey} onChange={(e) => setF({ ...f, roleKey: e.target.value })}>
              <option value="">Select</option>
              {stages.map((s) => <option key={s.key} value={s.key}>{s.label}{s.optional ? '' : ' (required)'}</option>)}
            </Select>
          </Field>
          <Field label="Approver" required error={errors.approverEmployeeId}>
            <Select value={f.approverEmployeeId} onChange={(e) => setF({ ...f, approverEmployeeId: e.target.value })}>
              <option value="">Select employee</option>
              {people.map((m) => <option key={m.id} value={m.id}>{m.name}{m.employeeCode ? ` · ${m.employeeCode}` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Project (optional)">
            <Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Expense category (optional)">
            <Select value={f.expenseCategoryId} onChange={(e) => setF({ ...f, expenseCategoryId: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Field label="Zone (optional)">
                <Select value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })}>
                  <option value="">All zones</option>
                  {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </Select>
              </Field>
            </div>
            <Button onClick={save} disabled={busy} className="shrink-0">{busy ? <Spinner /> : 'Save'}</Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {data === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : !data.rows.length ? <Empty title="No approvers assigned yet" subtitle="Optional stages without an approver are skipped; required stages need one before employees can submit." />
          : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Stage</th>
                  <th className="text-left px-5 py-3 font-medium">Approver</th>
                  <th className="text-left px-5 py-3 font-medium">Scope</th>
                  <th className="text-right px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-medium text-ink">{r.roleLabel || stageLabel(r.roleKey)}</td>
                    <td className="px-5 py-3 text-ink-soft">
                      {r.approver}{r.employeeCode ? ` · ${r.employeeCode}` : ''}
                      {r.needsReassignment && <Badge tone="warn" className="ml-2">Needs reassignment{r.reassignReason ? ` — ${r.reassignReason}` : ''}</Badge>}
                    </td>
                    <td className="px-5 py-3 text-ink-soft">
                      {[r.project, r.category, r.zone].filter(Boolean).join(' · ') || <span className="text-ink-faint">Everywhere</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button type="button" onClick={() => remove(r)} className="text-xs font-medium text-rose-600 hover:underline">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
