import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Card, Button, Input, Spinner, Empty } from '../../components/ui.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';

export default function Employees() {
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
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Employees</h1>
          <p className="text-ink-faint text-sm">{rows ? `${rows.length} total` : 'Loading…'}</p>
        </div>
        <Button as={Link} to="/admin/employees/new">＋ Onboard employee</Button>
      </div>

      <div className="max-w-xs"><Input placeholder="Search name, email, ID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>

      <Card className="overflow-hidden">
        {!rows ? (
          <div className="grid place-items-center py-20"><Spinner className="text-brand-600 h-6 w-6" /></div>
        ) : filtered.length === 0 ? (
          <Empty title="No employees found" subtitle="Try a different search, or onboard a new employee." icon="🧑‍💼" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint border-b border-slate-100">
                <th className="font-medium px-5 py-3">Employee</th>
                <th className="font-medium px-5 py-3 hidden md:table-cell">Designation</th>
                <th className="font-medium px-5 py-3 hidden lg:table-cell">Employee ID</th>
                <th className="font-medium px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <Link to={`/admin/employees/${r.id}`} className="flex items-center gap-3">
                      <span className="grid place-items-center h-9 w-9 rounded-full bg-brand-50 text-brand-700 text-xs font-bold">
                        {(r.first_name[0] + r.last_name[0]).toUpperCase()}</span>
                      <span>
                        <span className="font-medium text-ink block">{r.first_name} {r.last_name}</span>
                        <span className="text-xs text-ink-faint">{r.official_email}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell text-ink-soft">{r.designation || '—'}</td>
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
