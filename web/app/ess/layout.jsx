'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth.jsx';
import { Spinner } from '@/components/ui.jsx';
import { FEATURES } from '@/lib/flags.js';

// Employee self-service portal (GreenHR-style: everything usable from the web,
// desktop or phone browser). Brand banner + sticky glass pill-nav shell.
const NAV = [
  { href: '/ess', label: 'Dashboard' },
  { href: '/ess/attendance', label: 'Attendance' },
  { href: '/ess/leave', label: 'Leave' },
  { href: '/ess/nfa', label: 'NFA' },
  { href: '/ess/approvals', label: 'Approvals' },
  { href: '/ess/pms', label: 'Performance' },
  { href: '/ess/tasks', label: 'Tasks' },
  { href: '/ess/payslips', label: 'Payslips' },
  { href: '/ess/tax', label: 'Tax' },
  { href: '/ess/letters', label: 'Letters' },
  { href: '/ess/assets', label: 'My Assets' },
  { href: '/ess/support', label: 'Support' },
  { href: '/ess/policies', label: 'Policies' },
  { href: '/ess/vendors', label: 'Vendors' },
  { href: '/ess/resignation', label: 'Resignation' },
  { href: '/ess/profile', label: 'Profile' },
  { href: '/ess/change-request', label: 'Request a change' },
];

export default function EssLayout({ children }) {
  const { auth, user, logout, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => { if (ready && !auth?.token) router.replace('/login'); }, [ready, auth, router]);

  if (!ready || !auth?.token) {
    return <div className="min-h-screen grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  }

  // Portal is flag-gated for this release (see lib/flags.js).
  if (!FEATURES.nfaSuite) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <div className="text-lg font-semibold text-ink">Employee portal coming soon</div>
          <p className="text-sm text-ink-faint mt-1">This section isn&apos;t available yet. Please use the TrueHR mobile app.</p>
        </div>
      </div>
    );
  }

  const isActive = (href) => (href === '/ess' ? pathname === '/ess' : pathname.startsWith(href));
  const email = user?.email || '';
  const initials = email.slice(0, 2).toUpperCase() || 'ME';

  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      {/* ── Shell bar ─────────────────────────────────────────────────── */}
      <header className="h-12 shrink-0 bg-shell text-white flex items-center gap-2.5 px-3 sm:px-4 sticky top-0 z-40">
        <Link href="/ess" className="flex items-center gap-2.5 shrink-0">
          <span className="grid place-items-center h-6 w-6 rounded bg-brand-gradient text-[9.5px] font-bold">TK</span>
          <span className="hidden sm:block font-semibold text-[14px] tracking-tight">True HR</span>
        </Link>
        <span className="hidden md:block h-5 w-px bg-white/20 shrink-0" />
        <span className="hidden md:block text-[12.5px] text-white/70 truncate">Employee Self-Service</span>
        <div className="ml-auto flex items-center gap-2 min-w-0">
          <span className="hidden sm:block text-[11.5px] text-white/70 truncate max-w-[190px] font-mono">{email}</span>
          <span className="grid place-items-center h-7 w-7 rounded-full bg-white/[.18] text-[10.5px] font-bold shrink-0">{initials}</span>
          <button onClick={logout}
            className="text-[11.5px] font-semibold text-white/85 hover:text-white rounded-sm bg-white/10 hover:bg-white/[.18] px-2.5 py-1.5 transition-colors">
            Sign out
          </button>
        </div>
      </header>

      {/* ── Section tabs ──────────────────────────────────────────────── */}
      <div className="sticky top-12 z-30 border-b border-line bg-white">
        <nav className="max-w-[1400px] mx-auto px-3 flex gap-1 overflow-x-auto scrollbar-none">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link key={n.href} href={n.href}
                className={`px-3 py-2.5 text-[13px] whitespace-nowrap border-b-2 transition-colors duration-100 ${
                  active
                    ? 'text-brand-600 border-brand-600 font-semibold'
                    : 'text-ink-faint hover:text-ink border-transparent font-medium'}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 py-5 animate-in">{children}</main>

      <footer className="border-t border-line bg-white py-4 mt-2">
        <div className="max-w-[1400px] mx-auto px-4 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-faint">
          <span>© {new Date().getFullYear()} TRUE KIND Foundation · TRUE HR</span>
          <span className="flex gap-4">
            <Link href="/privacy" className="hover:text-ink-soft">Privacy</Link>
            <Link href="/terms" className="hover:text-ink-soft">Terms</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
