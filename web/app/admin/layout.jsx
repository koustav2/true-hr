'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth.jsx';
import { can, ROLE_LABEL } from '@/lib/permissions.js';
import { Logo } from '@/components/Brand.jsx';
import { Spinner } from '@/components/ui.jsx';
import { IconDashboard, IconUsers, IconReview, IconLogout, IconShield, IconActivity, IconClock } from '@/components/icons.jsx';

// Each item declares which capability gates it.
const WORKSPACE = [
  { href: '/admin', label: 'Dashboard', Icon: IconDashboard, show: can.hr },
  { href: '/admin/employees', label: 'Employees', Icon: IconUsers, show: can.hr },
  { href: '/admin/review', label: 'Review queue', Icon: IconReview, show: can.hr },
  { href: '/admin/leave-config', label: 'Leave config', Icon: IconClock, show: can.hr },
];
const ADMINISTRATION = [
  { href: '/admin/users', label: 'Users & roles', Icon: IconShield, show: can.admin },
  { href: '/admin/audit', label: 'Audit log', Icon: IconActivity, show: can.admin },
];

function NavItem({ item: { href, label, Icon }, active }) {
  return (
    <Link href={href}
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ease-premium ${
        active
          ? 'bg-gradient-to-r from-brand-50 to-brand-50/30 text-brand-700 ring-1 ring-inset ring-brand-100 shadow-soft'
          : 'text-ink-soft hover:bg-slate-50 hover:text-ink'}`}>
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-gradient-to-b from-brand-400 to-brand-600" />}
      <Icon className={active ? 'text-brand-600' : 'text-ink-faint'} />
      {label}
    </Link>
  );
}

function NavGroup({ title, items, role, isActive }) {
  const visible = items.filter((i) => i.show(role));
  if (visible.length === 0) return null;
  return (
    <>
      <div className="px-3 mt-6 first:mt-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint mb-2">{title}</div>
      <nav className="space-y-0.5">
        {visible.map((item) => <NavItem key={item.href} item={item} active={isActive(item.href)} />)}
      </nav>
    </>
  );
}

const ROLE_BADGE = {
  SUPER_ADMIN: 'bg-violet-50 text-violet-700 ring-violet-200',
  HR_ADMIN: 'bg-brand-50 text-brand-700 ring-brand-200',
  IT_ADMIN: 'bg-sky-50 text-sky-700 ring-sky-200',
};

export default function AdminLayout({ children }) {
  const { auth, user, logout, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const role = user?.role;

  useEffect(() => {
    if (ready && !auth?.token) router.replace('/login');
  }, [ready, auth, router]);

  if (!ready || !auth?.token) {
    return <div className="min-h-screen grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  }

  const initials = (user?.email || 'HR').slice(0, 2).toUpperCase();
  const isActive = (href) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));

  return (
    <div className="h-screen flex overflow-hidden bg-canvas">
      {/* Sidebar (fixed) */}
      <aside className="w-[252px] shrink-0 hidden md:flex flex-col bg-white/95 backdrop-blur-sm border-r border-line h-screen overflow-y-auto">
        <div className="h-16 flex items-center px-5 border-b border-line"><Logo size={32} /></div>
        <div className="px-3 pt-5">
          <NavGroup title="Workspace" items={WORKSPACE} role={role} isActive={isActive} />
          <NavGroup title="Administration" items={ADMINISTRATION} role={role} isActive={isActive} />
        </div>
        {/* Account card */}
        <div className="mt-auto p-3 border-t border-line">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="grid place-items-center h-9 w-9 rounded-full bg-brand-gradient text-white text-xs font-bold shrink-0 shadow-pop">{initials}</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink truncate">{user?.email}</div>
              <span className={`inline-flex mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${ROLE_BADGE[role] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}>{ROLE_LABEL[role] || 'Staff'}</span>
            </div>
          </div>
          <button onClick={() => { logout(); router.replace('/login'); }}
            className="mt-1 flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-slate-50 transition-colors">
            <IconLogout className="text-ink-faint" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <header className="h-16 shrink-0 bg-white/80 backdrop-blur-md border-b border-line/80 flex items-center justify-between px-6 sticky top-0 z-30">
          <div className="md:hidden"><Logo size={28} /></div>
          <div className="hidden md:flex items-center gap-2 text-sm text-ink-faint">
            <span className="font-semibold text-ink-soft">True HR Pvt Ltd</span>
            <span className="text-line">·</span>
            <span>Admin Console</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`hidden sm:inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${ROLE_BADGE[role] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}>{ROLE_LABEL[role] || 'Staff'}</span>
            <div className="grid place-items-center h-9 w-9 rounded-full bg-brand-gradient text-white text-xs font-bold ring-2 ring-brand-100 shadow-pop">{initials}</div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1440px] animate-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
