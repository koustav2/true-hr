'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api.js';
import { Card, Button, Spinner, Empty, Avatar } from '@/components/ui.jsx';

export default function ReviewQueuePage() {
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
                <Avatar name={`${r.first_name} ${r.last_name}`} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink">{r.first_name} {r.last_name}</div>
                  <div className="text-xs text-ink-faint">{r.designation || '—'} · submitted {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '—'}</div>
                </div>
                <Button as={Link} href={`/admin/employees/${r.employee_id}`} variant="soft">Review →</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
