import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Card, Button, Spinner } from '../../components/ui.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';

const STATS = [
  { key: 'total', label: 'Total employees', color: 'text-brand-600' },
  { key: 'inProgress', label: 'Onboarding in progress', color: 'text-amber-600' },
  { key: 'awaiting', label: 'Awaiting your review', color: 'text-violet-600' },
  { key: 'active', label: 'Active', color: 'text-emerald-600' },
];

export default function Dashboard() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/employees').then(setRows).catch(() => setRows([])); }, []);

  if (!rows) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;

  const stats = {
    total: rows.length,
    inProgress: rows.filter((r) => ['OFFER_SENT','OFFER_ACCEPTED','DETAILS_PENDING','SENT_BACK'].includes(r.onboarding_status)).length,
    awaiting: rows.filter((r) => ['DETAILS_SUBMITTED','HR_REVIEW'].includes(r.onboarding_status)).length,
    active: rows.filter((r) => r.onboarding_status === 'ACTIVE').length,
  };
  const recent = rows.slice(0, 6);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
          <p className="text-ink-faint text-sm">Onboarding overview at a glance.</p>
        </div>
        <Button as={Link} to="/admin/employees/new">＋ Onboard employee</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((s) => (
          <Card key={s.key} className="p-5">
            <div className="text-sm text-ink-faint">{s.label}</div>
            <div className={`text-3xl font-extrabold mt-1 ${s.color}`}>{stats[s.key]}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-ink">Recent activity</h2>
          <Link to="/admin/employees" className="text-sm text-brand-600 font-medium">View all →</Link>
        </div>
        {recent.length === 0 ? (
          <div className="p-10 text-center text-ink-faint text-sm">No employees yet. Start by onboarding someone.</div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60">
                <div className="grid place-items-center h-9 w-9 rounded-full bg-brand-50 text-brand-700 text-xs font-bold">
                  {(r.first_name[0] + r.last_name[0]).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/employees/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.first_name} {r.last_name}</Link>
                  <div className="text-xs text-ink-faint truncate">{r.designation || '—'} · {r.official_email}</div>
                </div>
                <StatusBadge status={r.onboarding_status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
