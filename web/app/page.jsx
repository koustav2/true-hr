'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth.jsx';
import { homeFor } from '@/lib/permissions.js';
import { Logo } from '@/components/Brand.jsx';
import {
  IconClock, IconMoney, IconActivity, IconFile, IconShield, IconSupport, IconChevronRight,
} from '@/components/icons.jsx';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.truehr.app';

const FEATURES_LIST = [
  [IconClock, 'Attendance & Leave', 'Geo-tagged punches, monthly calendars, miss-punch regularisation, comp-off and multi-level leave approvals.', 'from-sky-500 to-blue-600'],
  [IconMoney, 'NFA & Settlements', 'Raise expense/advance notes with cascading masters, watch the approval chain live, release payments and settle with a full ledger.', 'from-emerald-500 to-green-600'],
  [IconActivity, 'Performance (KPI & PMS)', 'Monthly KPIs with weighted KRAs, self-rating, multi-level PLI review and automatic grades — OAT to SBT.', 'from-violet-500 to-purple-600'],
  [IconFile, 'Payroll & Payslips', 'Generate, publish and download payslips as PDFs — on the web or in the app.', 'from-amber-500 to-orange-600'],
  [IconSupport, 'Support & Vendors', 'HR / IT / Admin ticketing, vendor registration with approvals, and agreement tracking.', 'from-teal-500 to-cyan-600'],
  [IconShield, 'Enterprise-grade security', 'Encrypted PII at rest, role-based access, audit logging, rate-limited APIs and hardened HTTPS.', 'from-slate-500 to-slate-700'],
];

export default function LandingPage() {
  const { auth, user } = useAuth();
  const signedIn = !!auth?.token;
  const portalHref = signedIn ? homeFor(user?.role) : '/login';

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-line/70 bg-white/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Logo size={34} />
          <nav className="flex items-center gap-2">
            <a href="#features" className="hidden sm:block text-sm font-medium text-ink-soft hover:text-ink px-3 py-2">Features</a>
            <a href={PLAY_URL} target="_blank" rel="noreferrer" className="hidden sm:block text-sm font-medium text-ink-soft hover:text-ink px-3 py-2">Get the app</a>
            <Link href={portalHref}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-brand-gradient rounded-full px-5 py-2 shadow-pop hover:shadow-lift transition-shadow">
              {signedIn ? 'Open my portal' : 'Sign in'}
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden text-white" style={{ background: 'linear-gradient(150deg,#0f2557 0%,#1d4ed8 55%,#16a34a 130%)' }}>
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 py-20 sm:py-28 text-center">
          <span className="inline-flex items-center gap-2 text-[12px] font-semibold tracking-wide uppercase bg-white/10 ring-1 ring-white/25 rounded-full px-4 py-1.5 backdrop-blur">
            TRUE KIND Foundation · HR Platform
          </span>
          <h1 className="mt-6 text-4xl sm:text-[56px] leading-[1.08] font-extrabold tracking-tight">
            People first.<br />Paperwork automated.
          </h1>
          <p className="mt-5 max-w-2xl mx-auto text-white/85 text-base sm:text-lg leading-relaxed">
            TRUE HR runs the entire employee journey — offer letter to attendance, leave, expenses,
            performance and payroll — on the web and in your pocket.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href={portalHref}
              className="inline-flex items-center gap-2 rounded-full bg-white text-brand-700 font-bold px-7 py-3 shadow-pop hover:-translate-y-0.5 transition-transform">
              {signedIn ? 'Open my portal' : 'Sign in to your portal'} <IconChevronRight width={16} height={16} />
            </Link>
            <a href={PLAY_URL} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full ring-1 ring-white/40 hover:ring-white/70 hover:bg-white/10 text-white font-semibold px-7 py-3 transition-all">
              Download the Android app
            </a>
          </div>
          <div className="mt-12 flex flex-wrap justify-center gap-2.5">
            {['Automated onboarding', 'E-signed documents', 'NFA approvals', 'KPI & PMS grades', 'Encrypted PII'].map((t) => (
              <span key={t} className="text-[13px] rounded-full bg-white/12 ring-1 ring-white/20 px-3.5 py-1.5 backdrop-blur">{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-4 py-16 sm:py-20">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl font-extrabold text-ink tracking-tight">Everything HR, one platform</h2>
          <p className="text-ink-faint mt-3">The same engine powers the admin console, the employee self-service portal and the mobile app — so nothing ever falls out of sync.</p>
        </div>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES_LIST.map(([Icon, title, sub, tint]) => (
            <div key={title} className="lift rounded-xl2 border border-line bg-white shadow-card p-6 hover:shadow-lift">
              <span className={`grid place-items-center h-11 w-11 rounded-xl bg-gradient-to-br ${tint} text-white shadow-btn`}>
                <Icon />
              </span>
              <div className="mt-4 font-bold text-ink">{title}</div>
              <p className="mt-1.5 text-sm text-ink-soft leading-relaxed">{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Portals strip */}
      <section className="border-t border-line bg-canvas">
        <div className="max-w-6xl mx-auto px-4 py-14 grid sm:grid-cols-2 gap-5">
          <div className="rounded-xl2 border border-line bg-white shadow-card p-7">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-brand-700">For employees</div>
            <h3 className="mt-2 text-xl font-bold text-ink">Employee Self-Service</h3>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">Attendance, leave, NFAs, settlements, performance, payslips, support and more — from any browser, or one tap in the app.</p>
            <Link href="/login" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
              Sign in to /ess <IconChevronRight width={14} height={14} />
            </Link>
          </div>
          <div className="rounded-xl2 border border-line bg-white shadow-card p-7">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-leaf-700">For HR & admins</div>
            <h3 className="mt-2 text-xl font-bold text-ink">Admin Console</h3>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">Onboarding pipeline, approvals, NFA queue and reports, masters, PMS, payroll, policies, banners and audit — all in one console.</p>
            <Link href="/login" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-leaf-700 hover:underline">
              Sign in to /admin <IconChevronRight width={14} height={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-faint">
          <div className="flex items-center gap-3"><Logo size={26} /> <span>© {new Date().getFullYear()} True HR Pvt Ltd</span></div>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-ink-soft">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-ink-soft">Terms & Conditions</Link>
            <a href={PLAY_URL} target="_blank" rel="noreferrer" className="hover:text-ink-soft">Android app</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
