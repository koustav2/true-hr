'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api.js';
import { Card, Spinner } from '@/components/ui.jsx';

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
    ['Create NFA', '/ess/nfa/create', 'Raise an expense / advance request'],
    ['My NFAs', '/ess/nfa', 'Track status & submit settlements'],
    ['Approvals', '/ess/approvals', 'NFAs & settlements waiting on you'],
    ['My Performance', '/ess/pms', 'KPI, PMS & monthly grades'],
    ['Vendors & Agreements', '/ess/vendors', 'Register vendors, upload agreements'],
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-ink">My Dashboard</h1>

      <Card className="p-4">
        <div className="font-semibold text-sm text-ink mb-2">Monthly Performance — {year}</div>
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
                <div key={m} className={`rounded-lg px-3 py-2 text-center shrink-0 ${tone}`}>
                  <div className="text-xs font-bold">{m}</div>
                  <div className="text-[10px]">{label}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map(([label, href, sub]) => (
          <Link key={href} href={href}>
            <Card hover className="p-4 h-full cursor-pointer">
              <div className="font-semibold text-ink">{label}</div>
              <div className="text-xs text-ink-faint mt-1">{sub}</div>
            </Card>
          </Link>
        ))}
        <Card className="p-4">
          <div className="font-semibold text-ink text-sm mb-1.5">My NFA Ledger {ledger?.financialYear ? `(FY ${ledger.financialYear})` : ''}</div>
          {ledger === null ? <Spinner /> : ledger === false ? <p className="text-xs text-ink-faint">—</p> : (
            <div className="text-xs space-y-1">
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
