'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { downloadCsv } from '@/lib/csv.js';
import { Button, Select } from '@/components/ui.jsx';
import DataTable from '@/components/DataTable.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { IconPlus } from '@/components/icons.jsx';

export default function EmployeesPage() {
  const [rows, setRows] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const router = useRouter();
  useEffect(() => { api.get('/employees').then(setRows).catch(() => setRows([])); }, []);

  const visible = (rows || []).filter((r) => !statusFilter || r.onboarding_status === statusFilter);
  const exportCsv = () => downloadCsv('employees.csv', visible.map((r) => ({
    'Employee ID': r.employee_code || '', Name: `${r.first_name} ${r.last_name}`.trim(),
    Designation: r.designation || '', Department: r.department || '',
    'Official email': r.official_email || '', Status: r.onboarding_status || '',
    'Date of joining': r.date_of_joining ? String(r.date_of_joining).slice(0, 10) : '',
  })));

  const columns = [
    {
      key: 'name', label: 'Employee', sortable: true,
      sortValue: (r) => `${r.first_name} ${r.last_name}`,
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="grid place-items-center h-9 w-9 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold shrink-0">
            {((r.first_name?.[0] || '') + (r.last_name?.[0] || '')).toUpperCase()}</span>
          <span className="min-w-0">
            <span className="font-medium text-ink block">{r.first_name} {r.last_name}</span>
            <span className="text-xs text-ink-faint">{r.official_email}</span>
          </span>
        </div>
      ),
    },
    { key: 'designation', label: 'Designation', sortable: true, className: 'hidden md:table-cell', cellClassName: 'hidden md:table-cell text-ink-soft', render: (r) => r.designation || '—' },
    { key: 'department', label: 'Department', sortable: true, className: 'hidden md:table-cell', cellClassName: 'hidden md:table-cell text-ink-soft', render: (r) => r.department || '—' },
    // Shown only when the organisation runs more than one company, so a
    // single-entity setup keeps the table uncluttered.
    { key: 'company', label: 'Company', sortable: true, className: 'hidden xl:table-cell', cellClassName: 'hidden xl:table-cell text-ink-soft', render: (r) => r.company || '—' },
    { key: 'employee_code', label: 'Employee ID', sortable: true, className: 'hidden lg:table-cell', cellClassName: 'hidden lg:table-cell text-ink-soft', render: (r) => r.employee_code || '—' },
    { key: 'onboarding_status', label: 'Status', sortable: true, render: (r) => <StatusBadge status={r.onboarding_status} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">Employees</h1>
          <p className="text-ink-faint text-sm mt-0.5">{rows ? `${rows.length} total` : 'Loading…'}</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-44">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="OFFER_SENT">Offer sent</option>
            <option value="DETAILS_SUBMITTED">Awaiting review</option>
            <option value="REJECTED">Rejected</option>
          </Select>
          <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
          <Button as={Link} href="/admin/employees/new"><IconPlus width={16} height={16} /> Onboard employee</Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={visible}
        loading={!rows}
        searchKeys={['first_name', 'last_name', 'official_email', 'employee_code', 'designation', 'department']}
        searchPlaceholder="Search name, email, ID…"
        onRowClick={(r) => router.push(`/admin/employees/${r.id}`)}
        emptyTitle="No employees found"
        emptySubtitle="Onboard a new employee to get started."
      />
    </div>
  );
}
