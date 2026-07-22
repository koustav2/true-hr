'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Select, Field, Spinner, Empty, ConfirmClick } from '@/components/ui.jsx';

const ROLE_LABELS = {
  FINANCE_INITIATOR: 'Finance Initiator', PROJECT_LEADER: 'Project Leader',
  BUSINESS_LEADER: 'Business Leader', BUSINESS_HEAD: 'Business Head',
  OFFICE_ADMIN: 'Admin', FINANCE: 'Finance', FINAL_APPROVAL: 'Final Approval',
};
const label = (k) => ROLE_LABELS[k] || k.replace(/_/g, ' ');

// Approver matrix: who approves each chain stage. A row with no project /
// category / zone applies everywhere; scoped rows win over wildcard ones.
export default function ApproversPage() {
  const [data, setData] = useState(null);            // { roles, rows }
  const [managers, setManagers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [zones, setZones] = useState([]);
  const [f, setF] = useState({ roleKey: '', approverEmployeeId: '', projectId: '', expenseCategoryId: '', zoneId: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => api.get('/admin/approver-matrix').then(setData).catch((e) => { setData({ roles: [], rows: [] }); setMsg(e.message); });
  useEffect(() => {
    load();
    api.get('/meta/managers').then(setManagers).catch(() => {});
    api.get('/admin/masters/projects').then(setProjects).catch(() => {});
    api.get('/admin/masters/expense-categories').then(setCategories).catch(() => {});
    api.get('/admin/masters/cost-zones').then(setZones).catch(() => {});
  }, []);

  async function save() {
    setBusy(true); setMsg('');
    try {
      await api.post('/admin/approver-matrix', f);
      setF({ roleKey: '', approverEmployeeId: '', projectId: '', expenseCategoryId: '', zoneId: '' });
      await load(); setMsg('Approver saved.');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function remove(id) {
    try { await api.del(`/admin/approver-matrix/${id}`); load(); } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Approvers</h1>
        <p className="text-ink-faint text-sm mt-0.5">
          Assign who approves each stage of the NFA and resignation chains. Leave project, category and
          zone blank to apply everywhere — a more specific row overrides the blanket one. Stages with no
          approver are skipped automatically.
        </p>
      </div>
      {msg && <p className={`text-sm ${msg === 'Approver saved.' ? 'text-emerald-700' : 'text-rose-600'}`}>{msg}</p>}

      <Card className="p-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Field label="Stage / role" required>
            <Select value={f.roleKey} onChange={(e) => setF({ ...f, roleKey: e.target.value })}>
              <option value="">Select</option>
              {(data?.roles || []).map((r) => <option key={r} value={r}>{label(r)}</option>)}
            </Select>
          </Field>
          <Field label="Approver" required>
            <Select value={f.approverEmployeeId} onChange={(e) => setF({ ...f, approverEmployeeId: e.target.value })}>
              <option value="">Select employee</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}{m.employee_code ? ` · ${m.employee_code}` : ''}</option>)}
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
          <div className="flex gap-2">
            <div className="flex-1">
              <Field label="Zone (optional)">
                <Select value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })}>
                  <option value="">All zones</option>
                  {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </Select>
              </Field>
            </div>
            <Button onClick={save} disabled={busy || !f.roleKey || !f.approverEmployeeId} className="shrink-0">
              {busy ? <Spinner /> : 'Save'}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {data === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : !data.rows.length ? <Empty title="No approvers assigned yet" subtitle="Chains skip unassigned optional stages; HR can always act as override." />
          : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Stage / role</th>
                  <th className="text-left px-5 py-3 font-medium">Approver</th>
                  <th className="text-left px-5 py-3 font-medium">Scope</th>
                  <th className="text-right px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-medium text-ink">{label(r.roleKey)}</td>
                    <td className="px-5 py-3 text-ink-soft">{r.approver}{r.employeeCode ? ` · ${r.employeeCode}` : ''}</td>
                    <td className="px-5 py-3 text-ink-soft">
                      {[r.project, r.category, r.zone].filter(Boolean).join(' · ') ||
                        <span className="text-ink-faint">Everywhere</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <ConfirmClick onConfirm={() => remove(r.id)} confirmLabel="Confirm?"
                        className="text-xs font-medium text-rose-600 hover:underline">Remove</ConfirmClick>
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
