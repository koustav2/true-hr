'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { Card, Input, Spinner, Empty, Avatar, Badge } from '@/components/ui.jsx';
import DataTable from '@/components/DataTable.jsx';

// H49: key details per submission, search/sort, and a history tab of what HR
// already approved or sent back.
const TABS = [{ key: 'pending', label: 'Waiting for review' }, { key: 'history', label: 'Reviewed / sent back' }];
const name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
const day = (v) => (v ? fmtDate(String(v).slice(0, 10)) : '—');

export default function ReviewQueuePage() {
  const router = useRouter();
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    setRows(null);
    api.get(tab === 'history' ? '/onboarding/queue?view=history' : '/onboarding/queue').then(setRows).catch(() => setRows([]));
  }, [tab]);

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows || []).filter((r) => !n || [name(r), r.designation, r.department, r.official_email, r.employee_code]
      .some((v) => String(v || '').toLowerCase().includes(n)));
  }, [rows, q]);

  const person = {
    key: 'name', label: 'Candidate', sortable: true, sortValue: name,
    render: (r) => (
      <div className="flex items-center gap-2.5">
        <Avatar name={name(r)} size={28} />
        <span className="min-w-0"><span className="font-semibold text-ink block leading-tight">{name(r)}</span>
          <span className="sub block truncate">{r.designation || '—'}</span></span>
      </div>
    ),
  };
  const pendingCols = [
    person,
    { key: 'department', label: 'Department', sortable: true, render: (r) => r.department || '—' },
    { key: 'date_of_joining', label: 'Joining', sortable: true, render: (r) => day(r.date_of_joining) },
    { key: 'document_count', label: 'Documents', sortable: true, render: (r) => `${r.verified_count || 0}/${r.document_count || 0} verified` },
    { key: 'submitted_at', label: 'Submitted', sortable: true, render: (r) => day(r.submitted_at) },
    { key: 'days_pending', label: 'Waiting', sortable: true, render: (r) => <Badge tone={r.days_pending > 3 ? 'warn' : 'neutral'}>{r.days_pending} day{r.days_pending === 1 ? '' : 's'}</Badge> },
  ];
  const historyCols = [
    person,
    { key: 'department', label: 'Department', sortable: true, render: (r) => r.department || '—' },
    { key: 'state', label: 'Outcome', sortable: true, render: (r) => <Badge tone={r.state === 'SENT_BACK' ? 'warn' : r.state === 'REJECTED' ? 'danger' : 'ok'}>{r.state === 'ACTIVE' ? 'Approved' : label(r.state)}</Badge> },
    { key: 'employee_code', label: 'Employee ID', sortable: true, render: (r) => r.employee_code || '—' },
    { key: 'reviewed_at', label: 'Reviewed', sortable: true, render: (r) => `${day(r.reviewed_at)}${r.reviewed_by ? ` · ${r.reviewed_by}` : ''}` },
    { key: 'review_notes', label: 'Note', render: (r) => <span className="text-ink-soft text-[12.5px]">{r.review_notes || '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Review queue</h1>
        <p className="text-ink-faint text-sm">E-joining submissions waiting for HR, and the ones already decided.</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5 border-b border-line">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 ${tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t.label}</button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, department, designation…" className="!w-72" />
      </div>
      {!rows ? <Card className="grid place-items-center py-20"><Spinner className="text-brand-600 h-6 w-6" /></Card>
        : !rows.length ? <Card><Empty title={tab === 'pending' ? 'All caught up' : 'Nothing reviewed yet'} subtitle={tab === 'pending' ? 'No submissions are waiting for review.' : 'Approved and sent-back submissions appear here.'} /></Card>
        : (
          <DataTable columns={tab === 'pending' ? pendingCols : historyCols} rows={visible} rowKey="onboarding_id"
            onRowClick={(r) => router.push(`/admin/employees/${r.employee_id}`)}
            emptyTitle="No submissions match" emptySubtitle="Try a different search." />
        )}
    </div>
  );
}
