'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { can } from '@/lib/permissions.js';
import { Card, Button, Spinner } from '@/components/ui.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { IconPlus, IconUsers, IconClock, IconReview, IconCheck, IconChevronRight, IconUserPlus } from '@/components/icons.jsx';

const PIPELINE = [
  { label: 'Offer sent', keys: ['OFFER_SENT'], color: '#f59e0b' },
  { label: 'Filling details', keys: ['OFFER_ACCEPTED', 'DETAILS_PENDING', 'SENT_BACK'], color: '#0ea5e9' },
  { label: 'In review', keys: ['DETAILS_SUBMITTED', 'HR_REVIEW'], color: '#8b5cf6' },
  { label: 'Active', keys: ['ACTIVE'], color: '#10b981' },
];

function Stat({ Icon, tint, label, value, caption }) {
  return (
    <Card className="p-5 transition-colors hover:border-slate-300">
      <div className="flex items-start justify-between">
        <div className={`grid place-items-center h-10 w-10 rounded-xl ${tint}`}><Icon width={18} height={18} /></div>
      </div>
      <div className="text-[32px] leading-none font-bold mt-4 text-ink tracking-tight">{value}</div>
      <div className="text-[13px] text-ink-soft mt-1.5">{label}</div>
      {caption && <div className="text-xs text-ink-faint mt-0.5">{caption}</div>}
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState(null);

  // IT Admins have no HR access — send them to their home (Users).
  useEffect(() => { if (user && !can.hr(user.role)) router.replace('/admin/users'); }, [user, router]);

  useEffect(() => { if (user && can.hr(user.role)) api.get('/employees').then(setRows).catch(() => setRows([])); }, [user]);

  if (user && !can.hr(user.role)) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (!rows) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;

  const count = (keys) => rows.filter((r) => keys.includes(r.onboarding_status)).length;
  const total = rows.length;
  const inProgress = count(['OFFER_SENT', 'OFFER_ACCEPTED', 'DETAILS_PENDING', 'SENT_BACK']);
  const awaiting = count(['DETAILS_SUBMITTED', 'HR_REVIEW']);
  const active = count(['ACTIVE']);
  const recent = rows.slice(0, 6);
  const seg = PIPELINE.map((s) => ({ ...s, n: count(s.keys) }));
  const pipeTotal = seg.reduce((a, s) => a + s.n, 0) || 1;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-ink tracking-tight">Dashboard</h1>
          <p className="text-ink-faint text-sm mt-0.5">Welcome back — here's your onboarding overview.</p>
        </div>
        <Button as={Link} href="/admin/employees/new"><IconPlus width={16} height={16} /> Onboard employee</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat Icon={IconUsers} tint="bg-slate-100 text-slate-600" label="Total employees" value={total} caption="across the company" />
        <Stat Icon={IconClock} tint="bg-amber-50 text-amber-600" label="Onboarding in progress" value={inProgress} caption="offer to e-sign" />
        <Stat Icon={IconReview} tint="bg-violet-50 text-violet-600" label="Awaiting your review" value={awaiting} caption={awaiting ? 'needs approval' : 'all clear'} />
        <Stat Icon={IconCheck} tint="bg-brand-50 text-brand-700" label="Active" value={active} caption="fully onboarded" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* Recent activity */}
        <Card className="lg:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-semibold text-ink">Recent activity</h2>
            <Link href="/admin/employees" className="inline-flex items-center gap-1 text-sm text-brand-700 font-medium hover:text-brand-800">View all <IconChevronRight width={14} height={14} /></Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-3 grid place-items-center h-11 w-11 rounded-full bg-brand-50 text-brand-700"><IconUserPlus width={20} height={20} /></div>
              <div className="font-medium text-ink">No employees yet</div>
              <div className="text-sm text-ink-faint mt-0.5 mb-4">Onboard your first employee to get started.</div>
              <Button as={Link} href="/admin/employees/new" variant="soft"><IconPlus width={15} height={15} /> Onboard employee</Button>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
                  <div className="grid place-items-center h-9 w-9 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold">
                    {(r.first_name[0] + r.last_name[0]).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/employees/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.first_name} {r.last_name}</Link>
                    <div className="text-xs text-ink-faint truncate">{r.designation || '—'} · {r.official_email}</div>
                  </div>
                  <StatusBadge status={r.onboarding_status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Right rail */}
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-semibold text-ink">Onboarding pipeline</h2>
            <p className="text-xs text-ink-faint mt-0.5 mb-4">{pipeTotal === 1 && seg.every((s) => !s.n) ? 'No one in the pipeline yet.' : `${pipeTotal} ${pipeTotal === 1 ? 'person' : 'people'} in flight`}</p>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              {seg.map((s) => s.n > 0 && (
                <div key={s.label} style={{ width: `${(s.n / pipeTotal) * 100}%`, background: s.color }} />
              ))}
            </div>
            <ul className="mt-4 space-y-2.5">
              {seg.map((s) => (
                <li key={s.label} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-ink-soft">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}
                  </span>
                  <span className="font-semibold text-ink tabular-nums">{s.n}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-ink mb-3">Quick actions</h2>
            <div className="space-y-2">
              <Button as={Link} href="/admin/employees/new" className="w-full justify-start"><IconUserPlus width={16} height={16} /> Onboard employee</Button>
              <Button as={Link} href="/admin/review" variant="outline" className="w-full justify-between">Review queue <span className="inline-flex items-center gap-2">{awaiting > 0 && <span className="rounded-full bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-0.5">{awaiting}</span>}<IconChevronRight width={14} height={14} /></span></Button>
              <Button as={Link} href="/admin/employees" variant="outline" className="w-full justify-between">All employees <IconChevronRight width={14} height={14} /></Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
