'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { can } from '@/lib/permissions.js';
import { usePerms } from '@/lib/perms.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';
import { Card, Button, Spinner, Avatar, Badge, StatTile, Empty } from '@/components/ui.jsx';
import { IconPlus, IconUsers, IconReview, IconChevronRight, IconUserPlus, IconSupport, IconMoney, IconExit, IconFile } from '@/components/icons.jsx';

// Each stage opens the employee list filtered to it (H3).
const PIPELINE = [
  { key: 'offerSent', label: 'Offer sent', color: '#c9700c', href: '/admin/employees?status=OFFER_SENT' },
  { key: 'filling', label: 'Filling details', color: '#1a70da', href: '/admin/employees?status=DETAILS_PENDING' },
  { key: 'review', label: 'In review', color: '#7c3aed', href: '/admin/review' },
  { key: 'active', label: 'Active employees', color: '#0e7a3c', href: '/admin/employees?status=ACTIVE' },
];

// Leave-type requests: HR can open and act on them from Attendance (C1/H3).
const APPROVAL_LINES = [
  ['leave', 'Leave requests', '/admin/attendance?tab=leave&status=PENDING'],
  ['od', 'On-duty', '/admin/attendance?tab=onduty&status=PENDING'],
  ['missPunch', 'Miss-punch', '/admin/attendance?tab=misspunch&status=PENDING'],
  ['compOff', 'Comp-off', '/admin/attendance?tab=compoff&status=PENDING'],
];


// Module behind each HR queue, so a role only sees the queues it may open.
const QUEUE_MODULE = {
  onboarding: 'ONBOARDING', changeRequests: 'CHANGEREQ', nfa: 'NFA', nfaQuery: 'NFA', vendors: 'VENDORS',
  agreements: 'VENDORS', taxDeclarations: 'INVDECL', resignations: 'RESIGNATION', kpis: 'PMS', pms: 'PMS',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const { canView } = usePerms();
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
  const queues = (s.queues || []).filter((q) => canView(QUEUE_MODULE[q.key] || 'DASHBOARD'));
  const queuesOpen = queues.reduce((a, q) => a + q.count, 0);
  const canAttendance = canView('ATTENDANCE');

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
        <Link href="/admin/employees?status=ACTIVE"><StatTile Icon={IconUsers} label="Headcount" caption="Active employees" value={s.headcount} tone="brand"
          foot={s.candidates ? `+ ${s.candidates} candidate${s.candidates === 1 ? '' : 's'} in onboarding` : undefined} footTone="brand" /></Link>
        <Link href="/admin/review"><StatTile Icon={IconReview} label="Awaiting review" caption="Onboarding submissions"
          value={s.pipeline.review} tone={s.pipeline.review ? 'warn' : 'ok'} foot={s.pipeline.review ? 'Needs approval' : 'All clear'} footTone={s.pipeline.review ? 'warn' : 'ok'} /></Link>
        <Link href="/admin/payroll"><StatTile Icon={IconMoney} label={`Payroll · ${s.payroll.monthName}`} caption="Payslips published (active employees)"
          value={s.payroll.published} unit={`/${s.payroll.headcount}`} tone={payrollDone ? 'ok' : 'warn'}
          foot={payrollDone ? 'Complete' : `${Math.max(0, s.payroll.headcount - s.payroll.published)} pending`} footTone={payrollDone ? 'ok' : 'warn'} /></Link>
        <Link href="/admin/support"><StatTile Icon={IconSupport} label="Open tickets" caption="Support desk" value={s.openTickets} tone={s.openTickets ? 'brand' : 'ok'} /></Link>
        {/* C1: the label lists everything the number contains. */}
        <Link href={canAttendance ? '/admin/attendance?status=PENDING' : '#pending-approvals'}>
          <StatTile Icon={IconExit} label="Pending approvals" caption="Leave · OD · Miss-punch · Comp-off" value={s.approvals.total}
            tone={s.approvals.total ? 'warn' : 'ok'} foot={s.approvals.total ? (canAttendance ? 'Open Attendance to act' : 'With managers or HR') : 'All clear'} footTone={s.approvals.total ? 'warn' : 'ok'} />
        </Link>
      </div>

      <div className="grid xl:grid-cols-3 gap-4 items-start">
        {/* ── Recent employees ──────────────────────────────────────── */}
        <Card className="xl:col-span-2 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-canvas">
            <span className="text-[13.5px] font-semibold text-ink">Recent employees</span>
            <span className="text-[11.5px] text-ink-faint">Latest {(s.recentEmployees || []).length} people and candidates</span>
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
                      <td className="px-4">
                        {/* H20: the same status vocabulary as the Employees list. */}
                        <StatusBadge status={r.status} />
                        {r.isCandidate && <span className="ml-1.5 text-[11px] text-ink-faint">Candidate</span>}
                      </td>
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
              <ul className="mt-3.5 space-y-0.5">
                {pipe.map((p) => (
                  <li key={p.key}>
                    <Link href={p.href} className="flex items-center justify-between text-[13px] rounded px-1.5 py-1 -mx-1.5 hover:bg-canvas">
                      <span className="flex items-center gap-2 text-ink-soft"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.label}</span>
                      <span className="flex items-center gap-1 font-semibold text-ink tabular-nums">{p.n}<IconChevronRight width={12} height={12} className="text-ink-faint" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card>
            <div id="pending-approvals" className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-canvas">
              <span className="text-[13.5px] font-semibold text-ink">Pending approvals</span>
              <span className="text-[11.5px] text-ink-faint">Leave · OD · Miss-punch · Comp-off</span>
              <span className="ml-auto"><Badge tone={s.approvals.total ? 'warn' : 'neutral'}>{s.approvals.total}</Badge></span>
            </div>
            <ul className="divide-y divide-line">
              {APPROVAL_LINES.map(([k, l, href]) => {
                const n = s.approvals[k] || 0;
                const body = (
                  <>
                    <span className="text-ink-soft">{l}</span>
                    <span className={`flex items-center gap-1 font-semibold tabular-nums ${n ? 'text-ink' : 'text-ink-faint'}`}>
                      {n}{canAttendance && <IconChevronRight width={12} height={12} className="text-ink-faint" />}
                    </span>
                  </>
                );
                return (
                  <li key={k}>
                    {canAttendance
                      ? <Link href={href} className="flex items-center justify-between px-4 py-2.5 text-[13px] hover:bg-canvas">{body}</Link>
                      : <div className="flex items-center justify-between px-4 py-2.5 text-[13px]">{body}</div>}
                  </li>
                );
              })}
            </ul>
            <p className="text-[11.5px] text-ink-faint px-4 py-2.5 border-t border-line">
              Reporting managers approve these. Open a line to view the requests, or act when no manager is available.
            </p>
          </Card>

          {/* C2: every HR approval queue in one place, each opening its list. */}
          {queues.length > 0 && (
            <Card>
              <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-canvas">
                <span className="text-[13.5px] font-semibold text-ink">Waiting on HR</span>
                <span className="ml-auto"><Badge tone={queuesOpen ? 'warn' : 'neutral'}>{queuesOpen}</Badge></span>
              </div>
              <ul className="divide-y divide-line">
                {queues.map((q) => (
                  <li key={q.key}>
                    <Link href={q.href} className="flex items-center justify-between px-4 py-2.5 text-[13px] hover:bg-canvas">
                      <span className="text-ink-soft">{q.label}</span>
                      <span className={`flex items-center gap-1 font-semibold tabular-nums ${q.count ? 'text-ink' : 'text-ink-faint'}`}>
                        {q.count}<IconChevronRight width={12} height={12} className="text-ink-faint" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

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
