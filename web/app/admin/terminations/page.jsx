'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { Button, Card, Field, Input, Modal, Select, Spinner, Textarea, Empty, SearchPicker } from '@/components/ui.jsx';
import { fmtDate, todayIso } from '@/lib/labels.js';
import { IconExit, IconPlus, IconCheck } from '@/components/icons.jsx';

// ============================================================================
// Terminations — the employer-initiated exit.
//
// Distinct from Resignations, which the employee raises and which travels the
// six-stage approval chain. A termination takes effect at once, so the screen is
// deliberately unhurried: the reason is mandatory and kept on the record, the
// consequences are spelled out before confirming, and anything raised in error
// can be reversed.
// ============================================================================

const today = () => todayIso();

function StatusPill({ status }) {
  const map = {
    ACTIVE: 'bg-rose-50 text-rose-700 ring-rose-200',
    REVOKED: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${map[status] || map.REVOKED}`}>
      {status === 'ACTIVE' ? 'In effect' : 'Reversed'}
    </span>
  );
}

export default function TerminationsPage() {
  const { canManage } = usePerms();
  const mayManage = canManage('TERMINATION');

  const [rows, setRows] = useState(null);
  const [types, setTypes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [confirmStage, setConfirmStage] = useState(false);
  const [form, setForm] = useState({
    employeeId: '', type: 'TERMINATION', reason: '', notes: '',
    lastWorkingDate: today(), noticeWaived: false, rehireEligible: true,
  });

  async function load() {
    try {
      const [list, t] = await Promise.all([
        api.get(`/admin/terminations${filter ? `?status=${filter}` : ''}`),
        api.get('/admin/termination-types').catch(() => []),
      ]);
      setRows(list); setTypes(t || []); setError('');
    } catch (e) { setError(e.message); setRows([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  // Only active employees can be terminated (never candidates still in
  // onboarding, nor anyone already under a live termination). Re-read after
  // every record / reverse so the picker is never stale.
  const loadEmployees = () => api.get('/admin/terminations/eligible')
    .then((all) => setEmployees(all || []))
    .catch(() => setEmployees([]));
  useEffect(() => { loadEmployees(); }, []);

  const [revoking, setRevoking] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeErr, setRevokeErr] = useState('');

  const selected = useMemo(
    () => employees.find((e) => String(e.id) === String(form.employeeId)) || null,
    [employees, form.employeeId]);

  function reset() {
    setForm({
      employeeId: '', type: 'TERMINATION', reason: '', notes: '',
      lastWorkingDate: today(), noticeWaived: false, rehireEligible: true,
    });
    setConfirmStage(false);
  }

  async function submit() {
    setSaving(true); setError('');
    try {
      await api.post(`/admin/employees/${form.employeeId}/terminate`, {
        type: form.type,
        reason: form.reason.trim(),
        notes: form.notes.trim() || undefined,
        lastWorkingDate: form.lastWorkingDate,
        noticeWaived: form.noticeWaived,
        rehireEligible: form.rehireEligible,
      });
      setNotice(`${selected ? `${selected.first_name} ${selected.last_name}` : 'The employee'} has been recorded as leaving on ${fmtDate(form.lastWorkingDate)}. Their access is now blocked.`);
      setOpen(false); reset(); await load();
      loadEmployees();
    } catch (e) { setError(e.message); setConfirmStage(false); }
    finally { setSaving(false); }
  }

  function revoke(row) { setRevoking(row); setRevokeReason(''); setRevokeErr(''); }
  async function doRevoke() {
    const reason = revokeReason.trim();
    if (reason.length < 5) { setRevokeErr('Please give a reason of at least 5 characters.'); return; }
    setSaving(true);
    try {
      await api.post(`/admin/terminations/${revoking.id}/revoke`, { reason });
      setNotice(`Reversed. ${revoking.name} is active again and can sign in.`);
      setRevoking(null);
      await Promise.all([load(), loadEmployees()]);
    } catch (e) { setRevokeErr(e.message); }
    finally { setSaving(false); }
  }

  const ready = form.employeeId && form.reason.trim().length >= 5 && form.lastWorkingDate;

  if (rows === null) return <div className="grid place-items-center py-20"><Spinner className="h-6 w-6 text-brand-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Terminations</h2>
          <p className="text-sm text-ink-soft mt-1 max-w-2xl">
            Ending someone's service on the company's initiative. For exits the employee starts themselves,
            use <b>Resignations</b> instead.
          </p>
        </div>
        {mayManage && (
          <Button onClick={() => { reset(); setOpen(true); }} className="shrink-0">
            <IconPlus /> Record a termination
          </Button>
        )}
      </div>

      {error && <div className="rounded-lg bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 px-4 py-3 text-sm">{error}</div>}
      {notice && (
        <div className="rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 px-4 py-3 text-sm flex items-start gap-2">
          <IconCheck className="mt-0.5 shrink-0" /><span>{notice}</span>
        </div>
      )}

      <div className="flex gap-2">
        {[['', 'All'], ['ACTIVE', 'In effect'], ['REVOKED', 'Reversed']].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition ${
              filter === v ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-white text-ink-soft ring-line hover:bg-slate-50'}`}>
            {l}
          </button>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Employee</th>
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-left px-5 py-3 font-medium">Last working day</th>
                <th className="text-left px-5 py-3 font-medium">Reason</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/40 align-top">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-ink">{r.name}</div>
                    <div className="text-[11px] text-ink-faint">
                      {[r.employeeCode, r.designation].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="px-5 py-3">{r.typeLabel}</td>
                  <td className="px-5 py-3 tabular-nums whitespace-nowrap">{fmtDate(r.lastWorkingDate)}</td>
                  <td className="px-5 py-3 max-w-sm">
                    <div className="text-ink-soft">{r.reason}</div>
                    {r.status === 'REVOKED' && r.revokeReason && (
                      <div className="text-[11px] text-ink-faint mt-1">Reversed: {r.revokeReason}</div>
                    )}
                    {r.rehireEligible === false && (
                      <span className="inline-flex mt-1 rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 px-2 py-0.5 text-[10px] font-semibold">
                        Not eligible for rehire
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {mayManage && r.status === 'ACTIVE' && (
                      <Button variant="ghost" size="sm" onClick={() => revoke(r)}>Reverse</Button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10">
                  <Empty title="Nothing here" subtitle="No terminations have been recorded." icon={<IconExit />} />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Record a termination ──────────────────────────────────────────── */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); reset(); }}
        title={confirmStage ? 'Confirm this termination' : 'Record a termination'}
        tone={confirmStage ? 'danger' : 'brand'}
        actions={confirmStage ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmStage(false)}>Back</Button>
            <Button variant="danger" onClick={submit} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : 'Confirm termination'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
            <Button onClick={() => setConfirmStage(true)} disabled={!ready}>Review</Button>
          </>
        )}
      >
        {!confirmStage ? (
          <div className="space-y-4">
            {error && <div role="alert" className="rounded-lg bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 px-3 py-2 text-sm">{error}</div>}
            <Field label="Employee" required hint={employees.length ? 'Search by name or Employee ID — active employees only' : 'No active employees available to terminate'}>
              <SearchPicker
                value={form.employeeId}
                onChange={(v) => setForm({ ...form, employeeId: v })}
                options={employees}
                getLabel={(e) => `${e.first_name} ${e.last_name}${e.employee_code ? ` (${e.employee_code})` : ''}`}
                placeholder="Type a name or Employee ID…"
              />
            </Field>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Type" required>
                <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {(types.length ? types : [{ key: 'TERMINATION', label: 'Termination' }])
                    .map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </Select>
              </Field>
              <Field label="Last working day" required hint="Payroll is paid up to this date">
                <Input type="date" value={form.lastWorkingDate}
                  onChange={(e) => setForm({ ...form, lastWorkingDate: e.target.value })} />
              </Field>
            </div>

            <Field label="Reason" required hint="Kept on the permanent record — at least 5 characters">
              <Textarea rows={3} value={form.reason} placeholder="Repeated unauthorised absence after two written warnings"
                onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>

            <Field label="Internal notes" hint="Not shown to the employee">
              <Textarea rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>

            <div className="space-y-2 rounded-xl border border-line bg-slate-50/60 p-4">
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={form.noticeWaived}
                  onChange={(e) => setForm({ ...form, noticeWaived: e.target.checked })}
                  className="h-4 w-4 accent-brand-600 cursor-pointer" />
                Notice period waived
              </label>
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={form.rehireEligible}
                  onChange={(e) => setForm({ ...form, rehireEligible: e.target.checked })}
                  className="h-4 w-4 accent-brand-600 cursor-pointer" />
                May be considered for rehire in future
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="font-semibold text-rose-800">
                {selected ? `${selected.first_name} ${selected.last_name}` : 'This employee'} will lose access immediately.
              </div>
              <ul className="mt-2 space-y-1 text-rose-700 text-[13px] list-disc pl-5">
                <li>Their login is blocked as soon as you confirm — including the mobile app.</li>
                <li>They are removed from directories, team lists and future payroll runs.</li>
                <li>Payroll pays them up to <b>{fmtDate(form.lastWorkingDate)}</b> and no further.</li>
                <li>The reason below is kept permanently and appears in the audit log.</li>
              </ul>
            </div>

            <dl className="grid grid-cols-3 gap-x-4 gap-y-2">
              <dt className="text-ink-faint">Type</dt>
              <dd className="col-span-2 text-ink font-medium">
                {(types.find((t) => t.key === form.type) || {}).label || form.type}
              </dd>
              <dt className="text-ink-faint">Last working day</dt>
              <dd className="col-span-2 text-ink font-medium tabular-nums">{fmtDate(form.lastWorkingDate)}</dd>
              <dt className="text-ink-faint">Reason</dt>
              <dd className="col-span-2 text-ink">{form.reason}</dd>
              <dt className="text-ink-faint">Rehire</dt>
              <dd className="col-span-2 text-ink">{form.rehireEligible ? 'May be considered' : 'Not eligible'}</dd>
            </dl>

            <p className="text-ink-soft">
              If this turns out to be a mistake you can reverse it from this screen, which restores their
              access and marks them active again.
            </p>
          </div>
        )}
      </Modal>

      <Modal open={!!revoking} onClose={() => setRevoking(null)} title={`Reverse termination — ${revoking?.name || ''}`}
        actions={<>
          <Button variant="ghost" onClick={() => setRevoking(null)}>Cancel</Button>
          <Button onClick={doRevoke} disabled={saving}>{saving ? <Spinner className="h-4 w-4" /> : 'Reverse termination'}</Button>
        </>}>
        <p className="text-sm text-ink-soft mb-3">The employee becomes active again and can sign in. The reason is kept on the record.</p>
        <Field label="Reason" required error={revokeErr}>
          <Textarea rows={3} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
