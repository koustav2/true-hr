'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth.jsx';
import { can, ROLE_LABEL } from '@/lib/permissions.js';
import { Logo } from '@/components/Brand.jsx';
import { Spinner } from '@/components/ui.jsx';
import {
  IconDashboard, IconUsers, IconReview, IconLogout, IconShield, IconActivity,
  IconClock, IconSupport, IconFile, IconMoney, IconMenu, IconChevronLeft, IconX,
} from '@/components/icons.jsx';

const WORKSPACE = [
  { href: '/admin', label: 'Dashboard', Icon: IconDashboard, show: can.hr },
  { href: '/admin/employees', label: 'Employees', Icon: IconUsers, show: can.hr },
  { href: '/admin/review', label: 'Review queue', Icon: IconReview, show: can.hr },
  { href: '/admin/leave-config', label: 'Leave config', Icon: IconClock, show: can.hr },
  { href: '/admin/support', label: 'Support Desk', Icon: IconSupport, show: can.hr },
  { href: '/admin/policies', label: 'Policies', Icon: IconFile, show: can.hr },
  { href: '/admin/payroll', label: 'Payroll', Icon: IconMoney, show: can.hr },
];
const ADMINISTRATION = [
  { href: '/admin/users', label: 'Users & roles', Icon: IconShield, show: can.admin },
  { href: '/admin/audit', label: 'Audit log', Icon: IconActivity, show: can.admin },
];
const ALL = [...WORKSPACE, ...ADMINISTRATION];

const ROLE_BADGE = {
  SUPER_ADMIN: 'bg-grape-50 text-grape-700 ring-grape-200',
  HR_ADMIN: 'bg-brand-50 text-brand-700 ring-brand-200',
  IT_ADMIN: 'bg-sky-50 text-sky-700 ring-sky-200',
};

function NavItem({ item: { href, label, Icon }, active, collapsed, onNavigate }) {
  return (
    <Link href={href} title={collapsed ? label : undefined} onClick={onNavigate}
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ease-premium ${collapsed ? 'justify-center' : ''} ${
        active
          ? 'bg-gradient-to-r from-brand-50 to-brand-50/30 text-brand-700 ring-1 ring-inset ring-brand-100 shadow-soft'
          : 'text-ink-soft hover:bg-slate-50 hover:text-ink'}`}>
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-gradient-to-b from-brand-400 to-brand-600" />}
      <Icon className={active ? 'text-brand-600' : 'text-ink-faint'} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function NavGroup({ title, items, role, isActive, collapsed, onNavigate }) {
  const visible = items.filter((i) => i.show(role));
  if (visible.length === 0) return null;
  return (
    <div className="mt-6 first:mt-0">
      {!collapsed && <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint mb-2">{title}</div>}
      {collapsed && <div className="mx-3 mb-2 border-t border-line" />}
      <nav className="space-y-0.5">
        {visible.map((item) => <NavItem key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} onNavigate={onNavigate} />)}
      </nav>
    </div>
  );
}

export default function AdminLayout({ children }) {
  const { auth, user, logout, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const role = user?.role;

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setCollapsed(localStorage.getItem('truehr_nav_collapsed') === '1'); }, []);
  useEffect(() => { setMobileOpen(false); setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (ready && !auth?.token) router.replace('/login');
  }, [ready, auth, router]);

  function toggleCollapse() {
    setCollapsed((c) => { localStorage.setItem('truehr_nav_collapsed', c ? '0' : '1'); return !c; });
  }

  if (!ready || !auth?.token) {
    return <div className="min-h-screen grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  }

  const initials = (user?.email || 'HR').slice(0, 2).toUpperCase();
  const isActive = (href) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));
  const current = [...ALL].sort((a, b) => b.href.length - a.href.length).find((i) => isActive(i.href));
  const pageTitle = current?.label || 'Admin Console';

  const SidebarBody = ({ collapsed }) => (
    <>
      <div className={`h-16 flex items-center border-b border-line ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
        <Logo size={collapsed ? 30 : 32} compact={collapsed} />
      </div>
      <div className={`pt-5 flex-1 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'}`}>
        <NavGroup title="Workspace" items={WORKSPACE} role={role} isActive={isActive} collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />
        <NavGroup title="Administration" items={ADMINISTRATION} role={role} isActive={isActive} collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />
      </div>
      <div className={`mt-auto border-t border-line ${collapsed ? 'p-2' : 'p-3'}`}>
        <div className={`flex items-center gap-3 py-2 ${collapsed ? 'justify-center' : 'px-2'}`}>
          <div className="grid place-items-center h-9 w-9 rounded-full bg-brand-gradient text-white text-xs font-bold shrink-0 shadow-pop">{initials}</div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink truncate">{user?.email}</div>
              <span className={`inline-flex mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${ROLE_BADGE[role] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}>{ROLE_LABEL[role] || 'Staff'}</span>
            </div>
          )}
        </div>
        <button onClick={() => { logout(); router.replace('/login'); }} title="Sign out"
          className={`mt-1 flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-slate-50 transition-colors ${collapsed ? 'justify-center' : ''}`}>
          <IconLogout className="text-ink-faint" />{!collapsed && 'Sign out'}
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen flex overflow-hidden bg-canvas">
      {/* Desktop sidebar */}
      <aside className={`shrink-0 hidden md:flex flex-col bg-white/95 backdrop-blur-sm border-r border-line h-screen transition-[width] duration-200 ease-premium ${collapsed ? 'w-[76px]' : 'w-[252px]'}`}>
        <SidebarBody collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed z-50 md:hidden top-0 left-0 h-screen w-[260px] flex flex-col bg-white border-r border-line shadow-pop transition-transform duration-200 ease-premium ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-3 text-ink-faint hover:text-ink"><IconX /></button>
        <SidebarBody collapsed={false} />
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <header className="h-16 shrink-0 bg-white/80 backdrop-blur-md border-b border-line/80 flex items-center justify-between gap-3 px-4 sm:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setMobileOpen(true)} className="md:hidden grid place-items-center h-9 w-9 rounded-lg text-ink-soft hover:bg-slate-100"><IconMenu /></button>
            <button onClick={toggleCollapse} className="hidden md:grid place-items-center h-9 w-9 rounded-lg text-ink-soft hover:bg-slate-100" title={collapsed ? 'Expand' : 'Collapse'}>
              <IconChevronLeft className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
            </button>
            <div className="min-w-0">
              <h1 className="text-[15px] font-bold text-ink leading-tight truncate">{pageTitle}</h1>
              <div className="hidden sm:block text-[11px] text-ink-faint leading-tight">True HR Pvt Ltd · Admin Console</div>
            </div>
          </div>
          <div className="relative flex items-center gap-3">
            <span className={`hidden sm:inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${ROLE_BADGE[role] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}>{ROLE_LABEL[role] || 'Staff'}</span>
            <button onClick={() => setMenuOpen((o) => !o)} className="grid place-items-center h-9 w-9 rounded-full bg-brand-gradient text-white text-xs font-bold ring-2 ring-brand-100 shadow-pop">{initials}</button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-12 z-40 w-60 rounded-xl2 border border-line bg-white shadow-pop p-2 animate-in">
                  <div className="px-3 py-2 border-b border-line mb-1">
                    <div className="text-sm font-semibold text-ink truncate">{user?.email}</div>
                    <span className={`inline-flex mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${ROLE_BADGE[role] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}>{ROLE_LABEL[role] || 'Staff'}</span>
                  </div>
                  <button onClick={() => { logout(); router.replace('/login'); }} className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-slate-50">
                    <IconLogout className="text-ink-faint" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1440px] animate-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
