'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { can } from '@/lib/permissions.js';
import { Card, Spinner, Empty } from '@/components/ui.jsx';
import { IconActivity } from '@/components/icons.jsx';

const ACTION_LABEL = {
  LOGIN: 'Signed in', CREATE_EMPLOYEE: 'Onboarded employee', OFFER_ACCEPTED: 'Offer accepted',
  DETAILS_SUBMITTED: 'Submitted onboarding', APPROVE_ONBOARDING: 'Approved onboarding',
  SEND_BACK: 'Sent form back', CREATE_USER: 'Created user', SET_USER_STATUS: 'Changed user status',
};

export default function AuditPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/admin/audit').then(setRows).catch(() => setRows([])); }, []);

  if (user && !can.admin(user.role)) {
    return <Card className="p-8 max-w-lg"><p className="text-ink-soft">This area is restricted to IT Admins and Super Admins.</p></Card>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-ink tracking-tight">Audit log</h1>
        <p className="text-ink-faint text-sm mt-0.5">The 200 most recent system actions.</p>
      </div>

      <Card className="overflow-hidden">
        {!rows ? (
          <div className="grid place-items-center py-20"><Spinner className="text-brand-600 h-6 w-6" /></div>
        ) : rows.length === 0 ? (
          <Empty title="No activity yet" icon={<IconActivity width={22} height={22} />} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint bg-slate-50/60 border-b border-line">
                <th className="font-medium px-5 py-3">When</th>
                <th className="font-medium px-5 py-3">Action</th>
                <th className="font-medium px-5 py-3 hidden md:table-cell">By</th>
                <th className="font-medium px-5 py-3 hidden lg:table-cell">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="px-5 py-3 font-medium text-ink">{ACTION_LABEL[a.action] || a.action}</td>
                  <td className="px-5 py-3 hidden md:table-cell text-ink-soft">{a.actor_email || 'system / candidate'}</td>
                  <td className="px-5 py-3 hidden lg:table-cell text-ink-faint">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
