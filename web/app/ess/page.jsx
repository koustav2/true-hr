'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fetchBlob } from '@/lib/api.js';
import { label } from '@/lib/labels.js';
import { useHasTeam } from '@/lib/perms.jsx';
import { Card, Spinner } from '@/components/ui.jsx';
import {
  IconClock, IconSparkle, IconMoney, IconFile, IconCheck, IconActivity, IconReview,
  IconSupport, IconShield, IconBriefcase, IconExit, IconUser, IconChevronRight, IconPlus,
  IconChevronLeft, IconUpload, IconTicket,
} from '@/components/icons.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMoney = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

const GRADE_TONE = {
  OAT: 'bg-emerald-100 text-emerald-800', SAT: 'bg-emerald-50 text-emerald-700',
  AT: 'bg-lime-50 text-lime-700', BT: 'bg-rose-50 text-rose-700', SBT: 'bg-rose-100 text-rose-800',
};

// ── Banner carousel (H105) ──────────────────────────────────────────────────
// Banners HR uploads under App Banners show here, rotating every 6 seconds.
function BannerCarousel() {
  const [slides, setSlides] = useState([]);   // [{ id, url, name }]
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    const urls = [];
    api.get('/banners').then(async (list) => {
      const out = [];
      for (const b of (Array.isArray(list) ? list : []).slice(0, 10)) {
        try {
          const url = URL.createObjectURL(await fetchBlob(`/banners/${b.id}/image`));
          urls.push(url);
          out.push({ id: b.id, url, name: b.filename || 'Banner' });
        } catch { /* skip an image that will not load */ }
      }
      if (alive) setSlides(out);
    }).catch(() => {});
    return () => { alive = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  useEffect(() => {
    if (slides.length < 2) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), 6000);
    return () => clearInterval(t);
  }, [slides.length]);

  if (!slides.length) return null;
  const cur = slides[i % slides.length];
  const go = (d) => setI((x) => (x + d + slides.length) % slides.length);
  return (
    <Card className="relative overflow-hidden">
      <img src={cur.url} alt={cur.name} className="block w-full max-h-[260px] object-cover bg-canvas" />
      {slides.length > 1 && (
        <>
          <button type="button" aria-label="Previous banner" onClick={() => go(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 grid place-items-center h-8 w-8 rounded-full bg-white/80 hover:bg-white text-ink shadow">
            <IconChevronLeft />
          </button>
          <button type="button" aria-label="Next banner" onClick={() => go(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center h-8 w-8 rounded-full bg-white/80 hover:bg-white text-ink shadow">
            <IconChevronRight />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {slides.map((s, k) => (
              <button key={s.id} type="button" aria-label={`Banner ${k + 1}`} onClick={() => setI(k)}
                className={`h-1.5 rounded-full transition-all ${k === i % slides.length ? 'w-5 bg-white' : 'w-1.5 bg-white/60'}`} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// Readable monthly KPI/PMS state (E3): never a raw code like "Pending-RPT".
function monthState(row) {
  if (!row) return { text: 'Not started', tone: 'bg-slate-100 text-slate-500' };
  if (row.pmsStatus === 'FUNCTIONAL_APPROVED' && row.finalGrade) return { text: row.finalGrade, tone: GRADE_TONE[row.finalGrade] || 'bg-slate-100 text-slate-600' };
  if (row.pmsStatus === 'APPROVAL_PENDING') return { text: 'Rating pending approval', tone: 'bg-amber-50 text-amber-700' };
  if (row.kpiStatus === 'RM_PENDING') return { text: label('RM_PENDING'), tone: 'bg-amber-50 text-amber-700' };
  if (row.kpiStatus === 'DISCUSS') return { text: 'Discuss with manager', tone: 'bg-amber-50 text-amber-700' };
  if (row.kpiStatus) return { text: label(row.kpiStatus), tone: 'bg-amber-50 text-amber-700' };
  return { text: 'Pending', tone: 'bg-amber-50 text-amber-700' };
}

// Employee dashboard: a card for every section in the menu (E1), banners,
// a clickable 12-month performance strip and the NFA ledger.
export default function EssDashboard() {
  const [perf, setPerf] = useState(null);
  const [ledger, setLedger] = useState(null);
  const hasTeam = useHasTeam();            // null while loading → neutral wording
  const year = new Date().getFullYear();

  useEffect(() => {
    api.get(`/kpi?year=${year}`).then(setPerf).catch(() => setPerf([]));
    api.get('/nfa/ledger').then(setLedger).catch(() => setLedger(false));
  }, [year]);

  // E2: team wording only for people who have reportees.
  const team = (withTeam, without) => (hasTeam ? withTeam : without);
  // One card per header section, in the header's order (E1).
  const tiles = [
    ['Attendance', '/ess/attendance', team('Calendar, punches, miss-punch & team attendance', 'Calendar, punches & miss-punch'), IconClock, 'from-sky-500 to-blue-600'],
    ['Leave', '/ess/leave', team('Apply, balances, comp-off & team approvals', 'Apply, balances & comp-off'), IconSparkle, 'from-rose-500 to-pink-600'],
    ['Create NFA', '/ess/nfa/create', 'Raise an expense / advance request', IconPlus, 'from-violet-500 to-purple-600'],
    ['My NFAs', '/ess/nfa', 'Track status & submit settlements', IconMoney, 'from-emerald-500 to-green-600'],
    ['Approvals', '/ess/approvals', 'Requests waiting on you', IconCheck, 'from-amber-500 to-orange-600'],
    ['My Performance', '/ess/pms', team('KPI, PMS, monthly grades & team ratings', 'KPI, PMS & monthly grades'), IconActivity, 'from-blue-500 to-indigo-600'],
    ['Tasks', '/ess/tasks', team('My tasks, assign & team', 'My tasks'), IconReview, 'from-teal-500 to-cyan-600'],
    ['Salary Slips', '/ess/payslips', 'Download published payslips', IconFile, 'from-green-500 to-emerald-600'],
    ['Tax', '/ess/tax', 'Investment declarations & tax regime', IconMoney, 'from-lime-500 to-green-600'],
    ['Letters', '/ess/letters', 'Your issued letters', IconFile, 'from-cyan-500 to-sky-600'],
    ['My Assets', '/ess/assets', 'Laptops, phones & other assets with you', IconBriefcase, 'from-stone-500 to-stone-700'],
    ['Support Desk', '/ess/support', 'HR / IT / Admin tickets', IconSupport, 'from-orange-500 to-amber-600'],
    ['Policies', '/ess/policies', 'Company policies & formats', IconShield, 'from-slate-500 to-slate-700'],
    ['Vendors & Agreements', '/ess/vendors', 'Register vendors, upload agreements', IconTicket, 'from-fuchsia-500 to-purple-600'],
    ['Resignation', '/ess/resignation', team('Apply, track & team approvals', 'Apply & track'), IconExit, 'from-red-500 to-rose-600'],
    ['My Profile', '/ess/profile', team('Profile, team & address book', 'Profile & address book'), IconUser, 'from-indigo-500 to-violet-600'],
    ['Request a change', '/ess/change-request', 'Update profile, address or bank details', IconUpload, 'from-pink-500 to-rose-600'],
    ['Contact TrueHR', '/ess/help', 'Reach the TrueHR team directly', IconSupport, 'from-gray-500 to-gray-700'],
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-ink">My Dashboard</h1>
        <p className="text-sm text-ink-faint mt-0.5">Everything you need, in one place.</p>
      </div>

      <BannerCarousel />

      <Link href="/ess/pms" className="block group">
        <Card hover className="p-4 cursor-pointer">
          <div className="font-semibold text-sm text-ink mb-2.5 flex items-center gap-1.5">
            Monthly Performance — {year}
            <IconChevronRight className="h-3.5 w-3.5 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          {perf === null ? <Spinner /> : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {MONTHS.map((m, i) => {
                const st = monthState((perf || []).find((x) => x.month === i + 1));
                return (
                  <div key={m} className={`rounded-lg px-2.5 py-2 text-center shrink-0 w-[92px] ${st.tone}`} title={st.text}>
                    <div className="text-xs font-bold">{m}</div>
                    <div className="text-[10px] leading-tight mt-0.5">{st.text}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </Link>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map(([title, href, sub, Icon, tint]) => (
          <Link key={href} href={href}>
            <Card hover className="group p-4 h-full cursor-pointer">
              <div className="flex items-start gap-3.5">
                <span className={`grid place-items-center h-11 w-11 rounded-xl bg-gradient-to-br ${tint} text-white shadow-btn shrink-0 transition-transform duration-200 ease-premium group-hover:scale-105`}>
                  <Icon />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink flex items-center gap-1.5">
                    <span className="truncate">{title}</span>
                    <IconChevronRight className="h-3.5 w-3.5 text-ink-faint opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0" />
                  </div>
                  <div className="text-xs text-ink-faint mt-1 leading-relaxed">{sub}</div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        <Link href="/ess/nfa">
          <Card hover className="p-4 h-full cursor-pointer bg-gradient-to-br from-white to-emerald-50/50">
            <div className="flex items-center gap-2 mb-2">
              <span className="grid place-items-center h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 text-white"><IconMoney className="h-4 w-4" /></span>
              <div className="font-semibold text-ink text-sm">My NFA Ledger {ledger?.financialYear ? `(FY ${ledger.financialYear})` : ''}</div>
              <IconChevronRight className="ml-auto h-3.5 w-3.5 text-ink-faint" />
            </div>
            {ledger === null ? <Spinner /> : ledger === false ? <p className="text-xs text-ink-faint">No NFA activity yet.</p> : (
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
        </Link>
      </div>
    </div>
  );
}
