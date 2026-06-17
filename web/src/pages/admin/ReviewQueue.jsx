import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Card, Button, Spinner, Empty } from '../../components/ui.jsx';

export default function ReviewQueue() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/onboarding/queue').then(setRows).catch(() => setRows([])); }, []);

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Review queue</h1>
        <p className="text-ink-faint text-sm">Submissions waiting for HR approval.</p>
      </div>
      <Card className="overflow-hidden">
        {!rows ? (
          <div className="grid place-items-center py-20"><Spinner className="text-brand-600 h-6 w-6" /></div>
        ) : rows.length === 0 ? (
          <Empty title="All caught up" subtitle="No submissions are waiting for review." icon="🎉" />
        ) : (
          <ul className="divide-y divide-slate-50">
            {rows.map((r) => (
              <li key={r.onboarding_id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/60">
                <div className="grid place-items-center h-10 w-10 rounded-full bg-violet-50 text-violet-700 text-xs font-bold">
                  {(r.first_name[0] + r.last_name[0]).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-ink">{r.first_name} {r.last_name}</div>
                  <div className="text-xs text-ink-faint">{r.designation || '—'} · submitted {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '—'}</div>
                </div>
                <Button as={Link} to={`/admin/employees/${r.employee_id}`} variant="soft">Review →</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
