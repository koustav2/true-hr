'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth.jsx';
import { Logo } from '@/components/Brand.jsx';
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
  { href: '/ess/support', label: 'Support' },
  { href: '/ess/policies', label: 'Policies' },
  { href: '/ess/vendors', label: 'Vendors' },
  { href: '/ess/resignation', label: 'Resignation' },
  { href: '/ess/profile', label: 'Profile' },
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
    <div className="min-h-screen flex flex-col">
      {/* Brand banner (scrolls away) */}
      <div className="relative overflow-hidden text-white"
        style={{ background: 'linear-gradient(135deg,#0f2557 0%,#1d4ed8 48%,#16a34a 120%)' }}>
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute left-1/3 -bottom-28 h-56 w-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Logo light size={32} />
            <div className="hidden sm:block h-6 w-px bg-white/25" />
            <span className="hidden sm:block text-sm font-medium text-white/85 tracking-wide">Employee Self-Service</span>
          </div>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="hidden sm:flex items-center gap-2.5 rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur pl-1.5 pr-4 py-1.5 min-w-0">
              <span className="grid place-items-center h-7 w-7 rounded-full bg-white text-brand-700 text-[11px] font-extrabold shrink-0">{initials}</span>
              <span className="text-xs text-white/90 truncate max-w-[200px]">{email}</span>
            </div>
            <button onClick={logout}
              className="text-xs font-semibold text-white/90 hover:text-white rounded-full ring-1 ring-white/30 hover:ring-white/60 hover:bg-white/10 px-3.5 py-2 transition-all">
              Log out
            </button>
          </div>
        </div>
      </div>

      {/* Sticky glass pill-nav */}
      <header className="sticky top-0 z-40 border-b border-line/80 bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/65">
        <nav className="max-w-6xl mx-auto px-3 flex gap-1 overflow-x-auto py-2 scrollbar-none">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link key={n.href} href={n.href}
                className={`px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap rounded-full transition-all duration-150 ease-premium ${
                  active
                    ? 'text-white bg-brand-gradient shadow-pop'
                    : 'text-ink-soft hover:text-ink hover:bg-slate-100'}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-7 animate-in">{children}</main>

      <footer className="border-t border-line/70 py-5 mt-4">
        <div className="max-w-6xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
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
