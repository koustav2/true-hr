'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { label as codeLabel, fmtDate } from '@/lib/labels.js';
import { downloadCsv } from '@/lib/csv.js';
import { Card, Button, Input, Select, Spinner, Empty } from '@/components/ui.jsx';

// ============================================================================
// Audit log (C43).
//
// Server-side paging and filters over the organisation's whole history (the
// old screen fetched 200 rows and showed them 15 at a time, so yesterday's
// entries looked "gone" as soon as today's sign-ins pushed them to page 2).
// Rows show who did what to which named record, with the details on demand.
// ============================================================================

const ACTION_LABEL = {
  LOGIN: 'Signed in', LOGIN_WEB_SSO: 'Signed in from the app', LOGIN_OTP_SENT: 'Sign-in code sent',
  LOGIN_OTP_SEND_FAILED: 'Sign-in code could not be sent', CREATE_EMPLOYEE: 'Onboarded employee',
  OFFER_ACCEPTED: 'Offer accepted', DETAILS_SUBMITTED: 'Submitted onboarding', APPROVE_ONBOARDING: 'Approved onboarding',
  SEND_BACK: 'Sent form back', CREATE_USER: 'Created login', SET_USER_STATUS: 'Changed login status',
  SET_USER_ROLE: 'Changed role', SET_USER_ORG_ROLE: 'Changed role', SET_USER_NAME: 'Named login',
  CREATE_ROLE: 'Created role', UPDATE_ROLE: 'Changed role permissions', DELETE_ROLE: 'Deleted role',
  PASSWORD_CHANGED: 'Changed password', PASSWORD_RESET: 'Reset password', PASSWORD_RESET_REQUESTED: 'Requested password reset',
  PASSWORD_RESET_BY_STAFF: 'Reset an employee password', PASSWORD_SET_FROM_LINK: 'Set password from link',
  SWITCH_ORGANISATION: 'Switched organisation', CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted',
};
const actionLabel = (a) => ACTION_LABEL[a] || codeLabel(a);

// Readable names for the raw table names stored in the log.
const ENTITY_LABEL = {
  user_account: 'Login', org_role: 'Role', employee: 'Employee', onboarding: 'Onboarding', organisation: 'Organisation',
  company: 'Company', department: 'Department', designation: 'Designation', leave_type: 'Leave type', holiday: 'Holiday',
  cost_zone: 'Cost zone', org_master: 'Master data', policy: 'Policy', app_banner: 'App banner', payslip: 'Payslip',
  salary_increment: 'Increment', salary_structure: 'Salary structure', salary_component: 'Payslip component',
  letter_template: 'Letter template', issued_letter: 'Letter', scheduled_notification: 'Scheduled notification',
  approver_matrix: 'Approver matrix', fnf_settlement: 'Full & final settlement', employee_change_request: 'Change request',
  investment_declaration: 'Investment declaration', nfa: 'NFA', nfa_settlement: 'NFA settlement', vendor_registration: 'Vendor',
  agreement: 'Agreement', kpi: 'KPI', pms: 'PMS', resignation: 'Resignation', termination: 'Termination', asset: 'Asset',
  leave_request: 'Leave request', comp_off_request: 'Comp-off request', miss_punch: 'Miss-punch', on_duty: 'On-duty',
  support_ticket: 'Support ticket', platform_ticket: 'Master ticket', document: 'Document', statutory_profile: 'Statutory profile',
  statutory_nominee: 'Nominee', email_queue: 'Email',
};
const entityLabel = (e) => (e ? ENTITY_LABEL[e] || codeLabel(e) : '—');
const when = (iso) => {
  const d = new Date(iso);
  return `${fmtDate(iso)} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

function Details({ meta }) {
  if (!meta || typeof meta !== 'object' || !Object.keys(meta).length) return <span className="text-ink-faint">No further details</span>;
  const flat = { ...meta };
  const changes = flat.changes; delete flat.changes;
  const rows = [...Object.entries(flat), ...(changes && typeof changes === 'object' ? Object.entries(changes).map(([k, v]) => [`→ ${k}`, v]) : [])];
  return (
    <dl className="grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-4 gap-y-1 text-[12px]">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-ink-faint">{k}</dt>
          <dd className="text-ink-soft break-all">{v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export default function AuditPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ q: '', action: '', entity: '', actor: '', from: '', to: '', hideLogins: true });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const qs = useCallback((p, size = pageSize) => {
    const u = new URLSearchParams({ page: String(p), pageSize: String(size) });
    for (const [k, v] of Object.entries(applied)) {
      if (k === 'hideLogins') { if (v) u.set('hideLogins', '1'); continue; }
      if (String(v || '').trim()) u.set(k, String(v).trim());
    }
    return u.toString();
  }, [applied]);

  useEffect(() => {
    setData(null);
    api.get(`/admin/audit?${qs(page)}`).then((d) => { setData(d); setErr(''); })
      .catch((e) => { setErr(e.message); setData({ rows: [], total: 0, actions: [], entities: [] }); });
  }, [qs, page]);

  function apply(e) {
    e?.preventDefault();
    if (f.from && f.to && f.from > f.to) { setErr('“From” date cannot be after “To” date'); return; }
    setErr(''); setPage(1); setApplied({ ...f });
  }
  function reset() {
    const blank = { q: '', action: '', entity: '', actor: '', from: '', to: '', hideLogins: true };
    setF(blank); setApplied(blank); setPage(1);
  }
  async function exportCsv() {
    const d = await api.get(`/admin/audit?${qs(1, 200)}`);
    downloadCsv('audit-log.csv', (d.rows || []).map((a) => ({
      When: a.created_at, Action: actionLabel(a.action), By: a.actor_name || a.actor_email || 'System / candidate',
      Record: `${entityLabel(a.entity)}${a.entity_name ? `: ${a.entity_name}` : a.entity_id ? ` #${a.entity_id}` : ''}`,
      Details: JSON.stringify(a.metadata || {}),
    })));
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[12px] text-ink-faint">Administration › Audit log</div>
          <h1 className="page-title text-ink">Audit log</h1>
          <p className="text-ink-faint text-sm mt-0.5">Every change made in this organisation, newest first. Nothing is removed.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!data?.total}>Export CSV</Button>
      </div>

      <Card className="p-4">
        <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
          <label className="lg:col-span-2 block">
            <span className="block text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">Search</span>
            <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Action, record, details…" />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">Action</span>
            <Select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
              <option value="">All actions</option>
              {(data?.actions || []).map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </Select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">Record type</span>
            <Select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
              <option value="">All records</option>
              {(data?.entities || []).map((x) => <option key={x} value={x}>{entityLabel(x)}</option>)}
            </Select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">By</span>
            <Input value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} placeholder="Name or email" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">From</span>
              <Input type="date" value={f.from} max={f.to || undefined} onChange={(e) => setF({ ...f, from: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">To</span>
              <Input type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF({ ...f, to: e.target.value })} />
            </label>
          </div>
          <div className="sm:col-span-2 lg:col-span-6 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-[13px] text-ink-soft">
              <input type="checkbox" checked={f.hideLogins} onChange={(e) => setF({ ...f, hideLogins: e.target.checked })} className="h-4 w-4 accent-brand-600" />
              Hide sign-ins
            </label>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" onClick={reset}>Clear</Button>
              <Button type="submit">Apply filters</Button>
            </div>
          </div>
        </form>
        {err && <div className="mt-3 text-sm text-rose-700 bg-rose-50 rounded px-3 py-2">{err}</div>}
      </Card>

      <Card className="overflow-hidden">
        {!data ? (
          <div className="grid place-items-center py-16"><Spinner className="text-brand-600 h-6 w-6" /></div>
        ) : data.rows.length === 0 ? (
          <Empty title="No activity found" subtitle="Nothing matches these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-faint bg-slate-50/60 border-b border-line">
                  <th className="font-medium px-4 py-2.5">When</th>
                  <th className="font-medium px-4 py-2.5">Action</th>
                  <th className="font-medium px-4 py-2.5">Record</th>
                  <th className="font-medium px-4 py-2.5 hidden md:table-cell">By</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((a) => (
                  <Fragment key={a.id}>
                    <tr className="hover:bg-slate-50/60 align-top">
                      <td className="px-4 py-2.5 whitespace-nowrap text-ink-soft">{when(a.created_at)}</td>
                      <td className="px-4 py-2.5 font-medium text-ink">{actionLabel(a.action)}</td>
                      <td className="px-4 py-2.5 text-ink-soft">
                        <span className="text-ink-faint">{entityLabel(a.entity)}</span>
                        {a.entity_name ? <span className="text-ink"> · {a.entity_name}</span> : a.entity_id ? <span className="text-ink-faint"> #{a.entity_id}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell text-ink-soft">
                        {a.actor_name || a.actor_email || <span className="text-ink-faint">System / candidate</span>}
                        {a.actor_name && <div className="text-[11px] text-ink-faint">{a.actor_email}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="text-[12.5px] font-semibold text-brand-600 hover:underline">
                          {open === a.id ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {open === a.id && (
                      <tr className="bg-canvas/60"><td colSpan={5} className="px-4 py-3"><Details meta={a.metadata} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-line text-[12.5px] text-ink-faint">
            <span>
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {data.total.toLocaleString('en-IN')} entries
            </span>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
              <span>Page {page} of {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Older</Button>
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
