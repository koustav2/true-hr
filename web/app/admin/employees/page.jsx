'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { downloadCsv } from '@/lib/csv.js';
import { label, fmtDate } from '@/lib/labels.js';
import { Button, Select, Input, Avatar } from '@/components/ui.jsx';
import DataTable from '@/components/DataTable.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { IconPlus } from '@/components/icons.jsx';

// Every status the table can show (H22, C11), in pipeline order. "Joining" =
// approved, before the date of joining; "Exited" = past an approved last
// working day; "On hold" = a candidate HR paused.
const STATUSES = ['OFFER_SENT', 'DETAILS_PENDING', 'SENT_BACK', 'DETAILS_SUBMITTED', 'HR_REVIEW', 'ON_HOLD',
  'JOINING', 'ACTIVE', 'INACTIVE', 'EXITED', 'REJECTED', 'EXPIRED'];
const statusOf = (r) => r.display_status || r.onboarding_status;
const name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
const inr = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-IN'));

export default function EmployeesPage() {
  const [rows, setRows] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const router = useRouter();
  useEffect(() => { api.get('/employees').then(setRows).catch(() => setRows([])); }, []);
  // The dashboard links here with ?status=<CODE> (e.g. ?status=OFFER_SENT).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s && STATUSES.includes(s.toUpperCase())) setStatusFilter(s.toUpperCase());
  }, []);

  // Status first, then a trimmed, case-insensitive search (H23). The header
  // count follows both (C11, H21).
  const visible = useMemo(() => {
    const needle = q.trim().replace(/\s+/g, ' ').toLowerCase();
    return (rows || []).filter((r) => {
      if (statusFilter && statusOf(r) !== statusFilter) return false;
      if (!needle) return true;
      return [name(r), r.official_email, r.personal_email, r.employee_code, r.designation, r.department, r.phone]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [rows, statusFilter, q]);
  const filtered = !!(statusFilter || q.trim());

  // C11: every key field in the export.
  const exportCsv = () => downloadCsv('employees.csv', visible.map((r) => ({
    'Employee ID': r.employee_code || '', Name: name(r), Status: label(statusOf(r)),
    Company: r.company || '', Department: r.department || '', 'Sub-department': r.sub_department || '',
    Designation: r.designation || '', 'Employment type': r.employment_type ? label(r.employment_type) : '',
    'Date of joining': r.date_of_joining ? fmtDate(String(r.date_of_joining).slice(0, 10)) : '',
    'Official email': r.official_email || '', 'Personal email': r.personal_email || '', Phone: r.phone || '',
    Location: r.branch || r.location || '', 'Reporting manager': r.reporting_manager || '',
    'Functional manager': r.functional_manager || '', 'Operational manager': r.operational_manager || '',
    'Annual CTC (INR)': inr(r.annual_ctc),
  })));

  const columns = [
    {
      key: 'name', label: 'Employee', sortable: true,
      sortValue: (r) => name(r),
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={name(r)} size={28} />
          <span className="min-w-0">
            <span className="font-semibold text-ink block leading-tight">{name(r)}</span>
            <span className="sub block truncate">{r.official_email}</span>
          </span>
        </div>
      ),
    },
    { key: 'designation', label: 'Designation', sortable: true, className: 'hidden md:table-cell', cellClassName: 'hidden md:table-cell text-ink-soft', render: (r) => r.designation || '—' },
    { key: 'department', label: 'Department', sortable: true, className: 'hidden md:table-cell', cellClassName: 'hidden md:table-cell text-ink-soft', render: (r) => r.department || '—' },
    { key: 'company', label: 'Company', sortable: true, className: 'hidden xl:table-cell', cellClassName: 'hidden xl:table-cell text-ink-soft', render: (r) => r.company || '—' },
    { key: 'employee_code', label: 'Employee ID', sortable: true, className: 'hidden lg:table-cell', cellClassName: 'hidden lg:table-cell text-ink-soft', render: (r) => r.employee_code || '—' },
    { key: 'onboarding_status', label: 'Status', sortable: true, sortValue: (r) => label(statusOf(r)), render: (r) => <StatusBadge status={statusOf(r)} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title text-ink">Employees</h1>
          <p className="text-ink-faint text-sm mt-0.5">
            {!rows ? 'Loading…' : filtered ? `${visible.length} of ${rows.length}` : `${rows.length} total`}
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, ID, department…" className="!w-64" aria-label="Search employees" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-44" aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
          <Button variant="outline" onClick={exportCsv} disabled={!visible.length}>Export CSV</Button>
          <Button as={Link} href="/admin/employees/new"><IconPlus width={16} height={16} /> Onboard employee</Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={visible}
        loading={!rows}
        onRowClick={(r) => router.push(`/admin/employees/${r.id}`)}
        emptyTitle={filtered ? 'No employees match' : 'No employees yet'}
        emptySubtitle={filtered ? 'Try another status or search.' : 'Onboard a new employee to get started.'}
      />
    </div>
  );
}
