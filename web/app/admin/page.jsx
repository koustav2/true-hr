'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { can } from '@/lib/permissions.js';
import { Card, Button, Spinner, Avatar, Badge, StatTile, Empty } from '@/components/ui.jsx';
import { IconPlus, IconUsers, IconReview, IconChevronRight, IconUserPlus, IconSupport, IconMoney, IconExit, IconFile } from '@/components/icons.jsx';

const PIPELINE = [
  { key: 'offerSent', label: 'Offer sent', color: '#c9700c' },
  { key: 'filling', label: 'Filling details', color: '#1a70da' },
  { key: 'review', label: 'In review', color: '#7c3aed' },
  { key: 'active', label: 'Active', color: '#0e7a3c' },
];

const STATUS_TONE = {
  ACTIVE: 'ok', OFFER_SENT: 'warn', OFFER_ACCEPTED: 'info',
  DETAILS_PENDING: 'warn', SENT_BACK: 'warn', DETAILS_SUBMITTED: 'info',
  HR_REVIEW: 'grape', REJECTED: 'danger', EXITED: 'neutral',
};
const pretty = (s) => (s || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [s, setS] = useState(null);

  useEffect(() => { if (user && !can.hr(user.role)) router.replace('/admin/users'); }, [user, router]);
  useEffect(() => { if (user && can.hr(user.role)) api.get('/admin/stats').then(setS).catch(() => setS(false)); }, [user]);

  if (user && !can.hr(user.role)) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (s === null) return <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  if (s === false) return <Card className="p-10 text-center text-ink-faint text-[13px]">Couldn&apos;t load dashboard stats.</Card>;

  const pipe = PIPELINE.map((p) => ({ ...p, n: s.pipeline[p.key] || 0 }));
  const pipeTotal = pipe.reduce((a, p) => a + p.n, 0) || 1;
  const inProgress = (s.pipeline.offerSent || 0) + (s.pipeline.filling || 0);
  const payrollDone = s.payroll.published >= s.payroll.headcount && s.payroll.headcount > 0;

  return (
    <div className="space-y-5">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] text-ink-faint">Workspace › Overview</div>
          <h1 className="page-title text-ink">Organisation Overview</h1>
          <p className="text-[13px] text-ink-faint mt-1">Everything moving across the organisation today.</p>
        </div>
        <Button as={Link} href="/admin/employees/new"><IconPlus width={15} height={15} /> Onboard employee</Button>
      </div>

      {/* ── Launchpad tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Link href="/admin/employees"><StatTile Icon={IconUsers} label="Headcount" caption="Total employees" value={s.headcount} tone="brand" /></Link>
        <Link href="/admin/review"><StatTile Icon={IconReview} label="Awaiting review" caption="Onboarding submissions"
          value={s.pipeline.review} tone={s.pipeline.review ? 'warn' : 'ok'} foot={s.pipeline.review ? 'Needs approval' : 'All clear'} footTone={s.pipeline.review ? 'warn' : 'ok'} /></Link>
        <Link href="/admin/payroll"><StatTile Icon={IconMoney} label={`Payroll · ${s.payroll.monthName}`} caption="Payslips published"
          value={s.payroll.published} unit={`/${s.payroll.headcount}`} tone={payrollDone ? 'ok' : 'warn'}
          foot={payrollDone ? 'Complete' : `${Math.max(0, s.payroll.headcount - s.payroll.published)} pending`} footTone={payrollDone ? 'ok' : 'warn'} /></Link>
        <Link href="/admin/support"><StatTile Icon={IconSupport} label="Open tickets" caption="Support desk" value={s.openTickets} tone={s.openTickets ? 'brand' : 'ok'} /></Link>
        <StatTile Icon={IconExit} label="Pending approvals" caption="Leave · OD · Comp-off" value={s.approvals.total}
          tone={s.approvals.total ? 'warn' : 'ok'} foot={s.approvals.total ? 'Awaiting managers' : 'All clear'} footTone={s.approvals.total ? 'warn' : 'ok'} />
      </div>

      <div className="grid xl:grid-cols-3 gap-4 items-start">
        {/* ── Recent employees ──────────────────────────────────────── */}
        <Card className="xl:col-span-2 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-canvas">
            <span className="text-[13.5px] font-semibold text-ink">Recent employees</span>
            <span className="text-[11.5px] text-ink-faint">{(s.recentEmployees || []).length} of {s.headcount}</span>
            <Link href="/admin/employees" className="ml-auto text-[12.5px] font-semibold text-brand-600 hover:underline">View all</Link>
          </div>
          {(!s.recentEmployees || s.recentEmployees.length === 0) ? (
            <Empty title="No employees yet" subtitle="Onboard your first employee to get started." icon={<IconUserPlus width={19} height={19} />} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className="text-left px-4">Employee</th><th className="text-left px-4">Designation</th><th className="text-left px-4">Status</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {s.recentEmployees.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar name={r.name} size={28} />
                          <span className="min-w-0">
                            <Link href={`/admin/employees/${r.id}`} className="block font-semibold text-ink hover:text-brand-600 text-[13px]">{r.name}</Link>
                            <span className="block text-[11px] text-ink-faint font-mono truncate">{r.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 text-ink-soft">{r.designation || '—'}</td>
                      <td className="px-4"><Badge tone={STATUS_TONE[r.status] || 'neutral'} dot>{pretty(r.status)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── Right rail ────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-canvas">
              <span className="text-[13.5px] font-semibold text-ink">Onboarding pipeline</span>
              <span className="ml-auto text-[11.5px] text-ink-faint">{inProgress + s.pipeline.review} in flight</span>
            </div>
            <div className="p-4">
              <div className="flex h-2 w-full overflow-hidden rounded-sm bg-slate-200">
                {pipe.map((p) => p.n > 0 && <div key={p.key} style={{ width: `${(p.n / pipeTotal) * 100}%`, background: p.color }} />)}
              </div>
              <ul className="mt-3.5 space-y-2">
                {pipe.map((p) => (
                  <li key={p.key} className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2 text-ink-soft"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.label}</span>
                    <span className="font-semibold text-ink tabular-nums">{p.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-canvas">
              <span className="text-[13.5px] font-semibold text-ink">Pending approvals</span>
              <span className="ml-auto"><Badge tone={s.approvals.total ? 'warn' : 'neutral'}>{s.approvals.total}</Badge></span>
            </div>
            <ul className="divide-y divide-line">
              {[['Leave requests', s.approvals.leave], ['On-duty', s.approvals.od], ['Miss-punch', s.approvals.missPunch], ['Comp-off', s.approvals.compOff]].map(([l, n]) => (
                <li key={l} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                  <span className="text-ink-soft">{l}</span>
                  <span className={`font-semibold tabular-nums ${n ? 'text-ink' : 'text-ink-faint'}`}>{n}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-ink-faint px-4 py-2.5 border-t border-line">Managers action these in the employee app.</p>
          </Card>

          <Card>
            <div className="px-4 py-2.5 border-b border-line bg-canvas"><span className="text-[13.5px] font-semibold text-ink">Quick actions</span></div>
            <div className="p-3 grid grid-cols-1 gap-2">
              <Button as={Link} href="/admin/employees/new" className="w-full justify-start"><IconUserPlus width={15} height={15} /> Onboard employee</Button>
              <Button as={Link} href="/admin/review" variant="outline" className="w-full justify-between">
                <span className="inline-flex items-center gap-2"><IconReview width={15} height={15} /> Review queue</span>
                <span className="inline-flex items-center gap-2">{s.pipeline.review > 0 && <Badge tone="grape">{s.pipeline.review}</Badge>}<IconChevronRight width={13} height={13} /></span>
              </Button>
              <Button as={Link} href="/admin/payroll" variant="outline" className="w-full justify-between">
                <span className="inline-flex items-center gap-2"><IconMoney width={15} height={15} /> Run payroll</span><IconChevronRight width={13} height={13} />
              </Button>
              <Button as={Link} href="/admin/letters" variant="outline" className="w-full justify-between">
                <span className="inline-flex items-center gap-2"><IconFile width={15} height={15} /> Issue letter</span><IconChevronRight width={13} height={13} />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
