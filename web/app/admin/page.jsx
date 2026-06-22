'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { can } from '@/lib/permissions.js';
import { Card, Button, Spinner } from '@/components/ui.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { IconPlus, IconUsers, IconReview, IconChevronRight, IconUserPlus, IconClock, IconSupport, IconMoney, IconCheck } from '@/components/icons.jsx';

const PIPELINE = [
  { key: 'offerSent', label: 'Offer sent', color: '#f59e0b' },
  { key: 'filling', label: 'Filling details', color: '#0ea5e9' },
  { key: 'review', label: 'In review', color: '#8b5cf6' },
  { key: 'active', label: 'Active', color: '#16a34a' },
];

function Stat({ Icon, tint, accent, label, value, caption, href }) {
  const body = (
    <Card hover className="relative p-5 overflow-hidden h-full">
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${accent}, transparent 85%)` }} />
      <div className="flex items-start justify-between">
        <div className={`grid place-items-center h-10 w-10 rounded-xl ring-1 ring-inset ${tint}`}><Icon width={18} height={18} /></div>
        {href && <IconChevronRight width={16} height={16} className="text-ink-faint" />}
      </div>
      <div className="text-[32px] leading-none font-bold mt-4 text-ink tracking-tight tabular-nums">{value}</div>
      <div className="text-[13px] font-medium text-ink-soft mt-1.5">{label}</div>
      {caption && <div className="text-xs text-ink-faint mt-0.5">{caption}</div>}
    </Card>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [s, setS] = useState(null);

  useEffect(() => { if (user && !can.hr(user.role)) router.replace('/admin/users'); }, [user, router]);
  useEffect(() => { if (user && can.hr(user.role)) api.get('/admin/stats').then(setS).catch(() => setS(false)); }, [user]);

  if (user && !can.hr(user.role)) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (s === null) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (s === false) return <Card className="p-10 text-center text-ink-faint">Couldn't load dashboard stats.</Card>;

  const pipe = PIPELINE.map((p) => ({ ...p, n: s.pipeline[p.key] || 0 }));
  const pipeTotal = pipe.reduce((a, p) => a + p.n, 0) || 1;
  const inProgress = (s.pipeline.offerSent || 0) + (s.pipeline.filling || 0);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-ink tracking-tight">Welcome back</h1>
          <p className="text-ink-faint text-sm mt-0.5">Here's what's happening across True HR today.</p>
        </div>
        <Button as={Link} href="/admin/employees/new"><IconPlus width={16} height={16} /> Onboard employee</Button>
      </div>

      {/* Primary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat Icon={IconUsers} tint="bg-slate-100 text-slate-600 ring-slate-200/70" accent="#94a3b8" label="Total employees" value={s.headcount} caption="across the company" href="/admin/employees" />
        <Stat Icon={IconReview} tint="bg-violet-50 text-violet-600 ring-violet-200/70" accent="#8b5cf6" label="Awaiting review" value={s.pipeline.review} caption={s.pipeline.review ? 'needs approval' : 'all clear'} href="/admin/review" />
        <Stat Icon={IconSupport} tint="bg-sky-50 text-sky-600 ring-sky-200/70" accent="#0ea5e9" label="Open tickets" value={s.openTickets} caption="support desk" href="/admin/support" />
        <Stat Icon={IconMoney} tint="bg-brand-50 text-brand-700 ring-brand-200/70" accent="#2563eb" label={`Payroll · ${s.payroll.monthName}`} value={`${s.payroll.published}/${s.payroll.headcount}`} caption="payslips published" href="/admin/payroll" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* Recent employees */}
        <Card className="lg:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-semibold text-ink">Recent employees</h2>
            <Link href="/admin/employees" className="inline-flex items-center gap-1 text-sm text-brand-700 font-medium hover:text-brand-800">View all <IconChevronRight width={14} height={14} /></Link>
          </div>
          {(!s.recentEmployees || s.recentEmployees.length === 0) ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-3 grid place-items-center h-11 w-11 rounded-full bg-brand-50 text-brand-700"><IconUserPlus width={20} height={20} /></div>
              <div className="font-medium text-ink">No employees yet</div>
              <div className="text-sm text-ink-faint mt-0.5 mb-4">Onboard your first employee to get started.</div>
              <Button as={Link} href="/admin/employees/new" variant="soft"><IconPlus width={15} height={15} /> Onboard employee</Button>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {s.recentEmployees.map((r) => (
                <li key={r.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
                  <div className="grid place-items-center h-9 w-9 rounded-full bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 text-xs font-semibold ring-1 ring-inset ring-brand-100">
                    {(r.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/employees/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.name}</Link>
                    <div className="text-xs text-ink-faint truncate">{r.designation || '—'} · {r.email}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Right rail */}
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-semibold text-ink">Onboarding pipeline</h2>
            <p className="text-xs text-ink-faint mt-0.5 mb-4">{inProgress + s.pipeline.review} in flight · {s.pipeline.active} active</p>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              {pipe.map((p) => p.n > 0 && <div key={p.key} style={{ width: `${(p.n / pipeTotal) * 100}%`, background: p.color }} />)}
            </div>
            <ul className="mt-4 space-y-2.5">
              {pipe.map((p) => (
                <li key={p.key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-ink-soft"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.label}</span>
                  <span className="font-semibold text-ink tabular-nums">{p.n}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-ink">Pending approvals</h2>
              <span className="rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5">{s.approvals.total}</span>
            </div>
            <ul className="space-y-2.5 text-sm">
              {[['Leave', s.approvals.leave], ['On-duty', s.approvals.od], ['Miss-punch', s.approvals.missPunch], ['Comp-off', s.approvals.compOff]].map(([l, n]) => (
                <li key={l} className="flex items-center justify-between">
                  <span className="text-ink-soft">{l}</span>
                  <span className="font-semibold text-ink tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-faint mt-3">Managers action these in the employee app.</p>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-ink mb-3">Quick actions</h2>
            <div className="space-y-2">
              <Button as={Link} href="/admin/employees/new" className="w-full justify-start"><IconUserPlus width={16} height={16} /> Onboard employee</Button>
              <Button as={Link} href="/admin/review" variant="outline" className="w-full justify-between">Review queue <span className="inline-flex items-center gap-2">{s.pipeline.review > 0 && <span className="rounded-full bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-0.5">{s.pipeline.review}</span>}<IconChevronRight width={14} height={14} /></span></Button>
              <Button as={Link} href="/admin/payroll" variant="outline" className="w-full justify-between">Run payroll <IconChevronRight width={14} height={14} /></Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
