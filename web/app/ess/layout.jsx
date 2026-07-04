'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth.jsx';
import { Logo } from '@/components/Brand.jsx';
import { Spinner } from '@/components/ui.jsx';
import { FEATURES } from '@/lib/flags.js';

// Employee self-service portal (GreenHR-style: everything usable from the web,
// desktop or phone browser). Simple top-nav shell — no admin sidebar.
const NAV = [
  { href: '/ess', label: 'Dashboard' },
  { href: '/ess/nfa/create', label: 'Create NFA' },
  { href: '/ess/nfa', label: 'My NFAs' },
  { href: '/ess/approvals', label: 'Approvals' },
  { href: '/ess/pms', label: 'My Performance' },
  { href: '/ess/vendors', label: 'Vendors & Agreements' },
];

export default function EssLayout({ children }) {
  const { auth, user, logout, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { if (ready && !auth?.token) router.replace('/login'); }, [ready, auth, router]);
  useEffect(() => { setMenuOpen(false); }, [pathname]);

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-line sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <Logo />
              <span className="text-sm font-semibold text-ink-soft hidden sm:inline">Employee Self-Service</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-faint hidden sm:inline">{user?.email}</span>
              <button onClick={logout} className="text-xs text-ink-soft hover:text-ink border border-line rounded-lg px-3 py-1.5">Log out</button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto -mb-px pb-0">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}
                className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive(n.href) ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
