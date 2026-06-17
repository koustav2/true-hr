'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Spinner, Empty } from '@/components/ui.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { IconPlus, IconSearch, IconUsers } from '@/components/icons.jsx';

export default function EmployeesPage() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api.get('/employees').then(setRows).catch(() => setRows([])); }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const t = q.toLowerCase();
    return rows.filter((r) =>
      `${r.first_name} ${r.last_name} ${r.official_email} ${r.employee_code || ''}`.toLowerCase().includes(t));
  }, [rows, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-ink tracking-tight">Employees</h1>
          <p className="text-ink-faint text-sm mt-0.5">{rows ? `${rows.length} total` : 'Loading…'}</p>
        </div>
        <Button as={Link} href="/admin/employees/new"><IconPlus width={16} height={16} /> Onboard employee</Button>
      </div>

      <div className="relative max-w-xs">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"><IconSearch width={16} height={16} /></span>
        <Input placeholder="Search name, email, ID…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>

      <Card className="overflow-hidden">
        {!rows ? (
          <div className="grid place-items-center py-20"><Spinner className="text-brand-600 h-6 w-6" /></div>
        ) : filtered.length === 0 ? (
          <Empty title="No employees found" subtitle="Try a different search, or onboard a new employee." icon={<IconUsers width={22} height={22} />} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint bg-slate-50/60 border-b border-line">
                <th className="font-medium px-5 py-3">Employee</th>
                <th className="font-medium px-5 py-3 hidden md:table-cell">Designation</th>
                <th className="font-medium px-5 py-3 hidden md:table-cell">Department</th>
                <th className="font-medium px-5 py-3 hidden lg:table-cell">Employee ID</th>
                <th className="font-medium px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-5 py-3.5">
                    <Link href={`/admin/employees/${r.id}`} className="flex items-center gap-3 group">
                      <span className="grid place-items-center h-9 w-9 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold">
                        {(r.first_name[0] + r.last_name[0]).toUpperCase()}</span>
                      <span>
                        <span className="font-medium text-ink block group-hover:text-brand-700">{r.first_name} {r.last_name}</span>
                        <span className="text-xs text-ink-faint">{r.official_email}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell text-ink-soft">{r.designation || '—'}</td>
                  <td className="px-5 py-3.5 hidden md:table-cell text-ink-soft">{r.department || '—'}</td>
                  <td className="px-5 py-3.5 hidden lg:table-cell text-ink-soft">{r.employee_code || <span className="text-ink-faint">—</span>}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={r.onboarding_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
