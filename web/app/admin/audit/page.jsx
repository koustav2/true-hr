'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { can } from '@/lib/permissions.js';
import { Card } from '@/components/ui.jsx';
import DataTable from '@/components/DataTable.jsx';

const ACTION_LABEL = {
  LOGIN: 'Signed in', CREATE_EMPLOYEE: 'Onboarded employee', OFFER_ACCEPTED: 'Offer accepted',
  DETAILS_SUBMITTED: 'Submitted onboarding', APPROVE_ONBOARDING: 'Approved onboarding',
  SEND_BACK: 'Sent form back', CREATE_USER: 'Created user', SET_USER_STATUS: 'Changed user status',
};
const label = (a) => ACTION_LABEL[a] || (a || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default function AuditPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/admin/audit').then(setRows).catch(() => setRows([])); }, []);

  if (user && !can.admin(user.role)) {
    return <Card className="p-8 max-w-lg"><p className="text-ink-soft">This area is restricted to IT Admins and Super Admins.</p></Card>;
  }

  const columns = [
    { key: 'created_at', label: 'When', sortable: true, cellClassName: 'text-ink-soft whitespace-nowrap', render: (a) => new Date(a.created_at).toLocaleString() },
    { key: 'action', label: 'Action', sortable: true, sortValue: (a) => label(a.action), render: (a) => <span className="font-medium text-ink">{label(a.action)}</span> },
    { key: 'actor_email', label: 'By', sortable: true, className: 'hidden md:table-cell', cellClassName: 'hidden md:table-cell text-ink-soft', render: (a) => a.actor_email || 'system / candidate' },
    { key: 'entity', label: 'Entity', className: 'hidden lg:table-cell', cellClassName: 'hidden lg:table-cell text-ink-faint', render: (a) => `${a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-ink tracking-tight">Audit log</h1>
        <p className="text-ink-faint text-sm mt-0.5">The 200 most recent system actions.</p>
      </div>
      <DataTable
        columns={columns}
        rows={rows || []}
        loading={!rows}
        pageSize={15}
        searchKeys={['action', 'actor_email', 'entity']}
        searchPlaceholder="Search actions, users…"
        emptyTitle="No activity yet"
      />
    </div>
  );
}
