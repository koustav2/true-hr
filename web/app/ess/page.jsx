'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api.js';
import { Card, Spinner } from '@/components/ui.jsx';
import {
  IconClock, IconSparkle, IconMoney, IconFile, IconCheck, IconActivity, IconReview,
  IconSupport, IconShield, IconBriefcase, IconExit, IconUser, IconChevronRight, IconPlus,
} from '@/components/icons.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMoney = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

const GRADE_TONE = {
  OAT: 'bg-emerald-100 text-emerald-800', SAT: 'bg-emerald-50 text-emerald-700',
  AT: 'bg-lime-50 text-lime-700', BT: 'bg-rose-50 text-rose-700', SBT: 'bg-rose-100 text-rose-800',
};

// GreenHR-style employee dashboard: quick tiles + 12-month performance strip + NFA ledger.
export default function EssDashboard() {
  const [perf, setPerf] = useState(null);
  const [ledger, setLedger] = useState(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    api.get(`/kpi?year=${year}`).then(setPerf).catch(() => setPerf([]));
    api.get('/nfa/ledger').then(setLedger).catch(() => setLedger(false));
  }, [year]);

  const tiles = [
    ['Attendance', '/ess/attendance', 'Calendar, punches & miss-punch', IconClock, 'from-sky-500 to-blue-600'],
    ['Leave', '/ess/leave', 'Apply, balances, comp-off & team approvals', IconSparkle, 'from-rose-500 to-pink-600'],
    ['Create NFA', '/ess/nfa/create', 'Raise an expense / advance request', IconPlus, 'from-violet-500 to-purple-600'],
    ['My NFAs', '/ess/nfa', 'Track status & submit settlements', IconMoney, 'from-emerald-500 to-green-600'],
    ['Approvals', '/ess/approvals', 'NFAs & settlements waiting on you', IconCheck, 'from-amber-500 to-orange-600'],
    ['My Performance', '/ess/pms', 'KPI, PMS & monthly grades', IconActivity, 'from-blue-500 to-indigo-600'],
    ['Tasks', '/ess/tasks', 'My tasks, assign & team', IconReview, 'from-teal-500 to-cyan-600'],
    ['Salary Slips', '/ess/payslips', 'Download published payslips', IconFile, 'from-green-500 to-emerald-600'],
    ['Support Desk', '/ess/support', 'HR / IT / Admin tickets', IconSupport, 'from-orange-500 to-amber-600'],
    ['Policies', '/ess/policies', 'Company policies & formats', IconShield, 'from-slate-500 to-slate-700'],
    ['Vendors & Agreements', '/ess/vendors', 'Register vendors, upload agreements', IconBriefcase, 'from-fuchsia-500 to-purple-600'],
    ['Resignation', '/ess/resignation', 'Apply, track & team approvals', IconExit, 'from-red-500 to-rose-600'],
    ['My Profile', '/ess/profile', 'Profile, team & address book', IconUser, 'from-indigo-500 to-violet-600'],
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">My Dashboard</h1>
        <p className="text-sm text-ink-faint mt-0.5">Everything you need, in one place.</p>
      </div>

      <Card className="p-4">
        <div className="font-semibold text-sm text-ink mb-2.5">Monthly Performance — {year}</div>
        {perf === null ? <Spinner /> : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MONTHS.map((m, i) => {
              const row = (perf || []).find((x) => x.month === i + 1);
              let label = 'N/A', tone = 'bg-slate-100 text-slate-500';
              if (row) {
                if (row.pmsStatus === 'FUNCTIONAL_APPROVED' && row.finalGrade) { label = row.finalGrade; tone = GRADE_TONE[row.finalGrade] || tone; }
                else if (row.pmsStatus === 'APPROVAL_PENDING') { label = 'Pending-RPT'; tone = 'bg-amber-50 text-amber-700'; }
                else if (row.kpiStatus === 'RM_PENDING') { label = 'Pending-RPT'; tone = 'bg-amber-50 text-amber-700'; }
                else { label = 'Pending'; tone = 'bg-amber-50 text-amber-700'; }
              }
              return (
                <div key={m} className={`rounded-lg px-3 py-2 text-center shrink-0 min-w-[58px] ${tone}`}>
                  <div className="text-xs font-bold">{m}</div>
                  <div className="text-[10px]">{label}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map(([label, href, sub, Icon, tint]) => (
          <Link key={href} href={href}>
            <Card hover className="group p-4 h-full cursor-pointer">
              <div className="flex items-start gap-3.5">
                <span className={`grid place-items-center h-11 w-11 rounded-xl bg-gradient-to-br ${tint} text-white shadow-btn shrink-0 transition-transform duration-200 ease-premium group-hover:scale-105`}>
                  <Icon />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink flex items-center gap-1.5">
                    <span className="truncate">{label}</span>
                    <IconChevronRight className="h-3.5 w-3.5 text-ink-faint opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0" />
                  </div>
                  <div className="text-xs text-ink-faint mt-1 leading-relaxed">{sub}</div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        <Card className="p-4 bg-gradient-to-br from-white to-emerald-50/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="grid place-items-center h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 text-white"><IconMoney className="h-4 w-4" /></span>
            <div className="font-semibold text-ink text-sm">My NFA Ledger {ledger?.financialYear ? `(FY ${ledger.financialYear})` : ''}</div>
          </div>
          {ledger === null ? <Spinner /> : ledger === false ? <p className="text-xs text-ink-faint">—</p> : (
            <div className="text-xs space-y-1.5">
              <div className="flex justify-between"><span className="text-ink-faint">Raised / Released / Settled</span>
                <span className="font-medium">{ledger.totalRaised} / {ledger.paymentsReleased} / {ledger.settled}</span></div>
              <div className="flex justify-between"><span className="text-ink-faint">Amount received</span><span className="font-medium">{fmtMoney(ledger.amountReceived)}</span></div>
              <div className="flex justify-between"><span className="text-ink-faint">Settled</span><span className="font-medium">{fmtMoney(ledger.settlementAmount)}</span></div>
              <div className="flex justify-between"><span className={ledger.balanceToSettle > 0 ? 'text-rose-600 font-semibold' : 'text-ink-faint'}>Balance to settle</span>
                <span className={ledger.balanceToSettle > 0 ? 'text-rose-600 font-bold' : 'font-medium'}>{fmtMoney(ledger.balanceToSettle)}</span></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
