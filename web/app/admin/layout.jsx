'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth.jsx';
import { can, ROLE_LABEL } from '@/lib/permissions.js';
import { PermProvider, usePerms } from '@/lib/perms.jsx';
import { FEATURES } from '@/lib/flags.js';
import { Spinner, Button, Card } from '@/components/ui.jsx';
import {
  IconDashboard, IconUsers, IconReview, IconLogout, IconShield, IconActivity,
  IconClock, IconSupport, IconFile, IconMoney, IconMenu, IconChevronLeft, IconX, IconExit,
  IconBriefcase, IconTicket, IconCheck, IconSparkle, IconUpload, IconUser, IconChevronRight,
} from '@/components/icons.jsx';

// Navigation is driven by module permissions, not by hardcoded role checks: a
// Super Admin ticking a box on the Roles screen moves this sidebar for everyone
// holding that role. `module` is the permission key the server reports via
// /me/permissions; `nfa` marks entries still gated by the release flag.
//
// Grouped by the job being done, not by which table the data sits in — an HR
// user thinks "someone is leaving" (Separation), not "resignations table". One
// flat Workspace list of twenty-odd entries is unscannable, so each section
// stays small enough to take in at a glance and collapses if it isn't yours.
const SECTIONS = [
  {
    key: 'workspace',
    title: 'Workspace',
    items: [
      { href: '/admin', label: 'Dashboard', Icon: IconDashboard, module: 'DASHBOARD' },
      { href: '/admin/support', label: 'Support Desk', Icon: IconSupport, module: 'SUPPORT' },
    ],
  },
  {
    key: 'people',
    title: 'People',
    items: [
      { href: '/admin/employees', label: 'Employees', Icon: IconUsers, module: 'EMPLOYEES' },
      { href: '/admin/review', label: 'Review queue', Icon: IconReview, module: 'ONBOARDING' },
      { href: '/admin/change-requests', label: 'Change requests', Icon: IconCheck, module: 'CHANGEREQ' },
      { href: '/admin/org-chart', label: 'Org chart', Icon: IconUsers, module: 'ORGCHART' },
      { href: '/admin/leave-config', label: 'Leave config', Icon: IconClock, module: 'LEAVE' },
      { href: '/admin/wishes', label: 'Wishes', Icon: IconSparkle, module: 'EMPLOYEES' },
    ],
  },
  {
    key: 'pay',
    title: 'Pay & Compliance',
    items: [
      { href: '/admin/payroll', label: 'Payroll', Icon: IconMoney, module: 'PAYROLL' },
      { href: '/admin/increments', label: 'Increments', Icon: IconActivity, module: 'INCREMENT' },
      { href: '/admin/statutory', label: 'Statutory', Icon: IconShield, module: 'STATUTORY' },
      { href: '/admin/tax-declarations', label: 'Investment decl.', Icon: IconFile, module: 'INVDECL' },
    ],
  },
  {
    key: 'separation',
    title: 'Separation',
    items: [
      { href: '/admin/resignations', label: 'Resignations', Icon: IconExit, module: 'RESIGNATION' },
      { href: '/admin/terminations', label: 'Terminations', Icon: IconExit, module: 'TERMINATION' },
      { href: '/admin/fnf', label: 'Full & Final', Icon: IconMoney, module: 'FNF' },
    ],
  },
  {
    key: 'comms',
    title: 'Documents & Comms',
    items: [
      { href: '/admin/letters', label: 'Letters', Icon: IconFile, module: 'LETTERS' },
      { href: '/admin/policies', label: 'Policies', Icon: IconFile, module: 'POLICIES' },
      { href: '/admin/banners', label: 'App Banners', Icon: IconSparkle, module: 'BANNERS' },
      { href: '/admin/notification-scheduler', label: 'Scheduler', Icon: IconClock, module: 'BANNERS' },
    ],
  },
  {
    key: 'finance',
    title: 'NFA & Finance',
    items: [
      { href: '/admin/nfa', label: 'NFA queue', Icon: IconMoney, module: 'NFA', nfa: true },
      { href: '/admin/nfa-reports', label: 'Reports', Icon: IconFile, module: 'NFA_REPORTS', nfa: true },
      { href: '/admin/masters', label: 'Masters', Icon: IconBriefcase, module: 'MASTERS', nfa: true },
      { href: '/admin/approvers', label: 'Approvers', Icon: IconShield, module: 'APPROVERS', nfa: true },
      { href: '/admin/vendors', label: 'Vendors & agreements', Icon: IconTicket, module: 'VENDORS', nfa: true },
    ],
  },
  {
    key: 'performance',
    title: 'Performance',
    items: [
      { href: '/admin/pms', label: 'PMS / KPI', Icon: IconActivity, module: 'PMS', nfa: true },
    ],
  },
  {
    key: 'data',
    title: 'Data & Reports',
    items: [
      { href: '/admin/bulk', label: 'Bulk utilities', Icon: IconUpload, module: 'BULK' },
      { href: '/admin/hrmis', label: 'HRMIS reports', Icon: IconFile, module: 'HRMIS' },
    ],
  },
  {
    key: 'admin',
    title: 'Administration',
    items: [
      { href: '/admin/companies', label: 'Companies', Icon: IconBriefcase, module: 'COMPANIES' },
      { href: '/admin/users', label: 'Users & accounts', Icon: IconUser, module: 'USERS' },
      { href: '/admin/roles', label: 'Roles & permissions', Icon: IconShield, module: 'ROLES' },
      { href: '/admin/assets', label: 'Asset management', Icon: IconBriefcase, module: 'ASSETS' },
      { href: '/admin/audit', label: 'Audit log', Icon: IconActivity, module: 'AUDIT' },
      { href: '/admin/organisations', label: 'Master Admin', Icon: IconShield, module: 'ORGANISATIONS' },
    ],
  },
];

const ALL = SECTIONS.flatMap((s) => s.items);
// The platform owner (Master) manages only organisations — nothing else shows.
const MASTER = [{ href: '/admin/organisations', label: 'Organisations', Icon: IconBriefcase, module: 'ORGANISATIONS' }];

const ROLE_BADGE = {
  MASTER: 'bg-shell/10 text-shell',
  SUPER_ADMIN: 'bg-grape-50 text-grape-700',
  HR_ADMIN: 'bg-brand-50 text-brand-700',
  IT_ADMIN: 'bg-crit-bg text-crit',
};

function NavItem({ item: { href, label, Icon }, active, collapsed, onNavigate }) {
  return (
    <Link href={href} title={collapsed ? label : undefined} onClick={onNavigate}
      className={`relative flex items-center gap-2.5 rounded px-2.5 py-[7px] text-[13px] transition-colors duration-100 border-l-[3px] ${collapsed ? 'justify-center' : ''} ${
        active
          ? 'bg-brand-50 text-brand-700 border-brand-600 font-semibold'
          : 'text-ink-soft hover:bg-canvas hover:text-ink border-transparent font-medium'}`}>
      <Icon className={active ? 'text-brand-600' : 'text-ink-faint'} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

/**
 * One sidebar section. Sections start expanded — nothing should be hidden from
 * someone who has never opened this screen — but a section can be folded away,
 * and that choice is remembered per browser. A section containing the current
 * page is always shown open, so a remembered collapse can never hide where you
 * actually are.
 */
function NavGroup({ title, items, canView, isActive, collapsed, onNavigate, open = true, onToggle, hasActive }) {
  const visible = items.filter((i) => (i.nfa ? FEATURES.nfaSuite : true) && canView(i.module));
  if (visible.length === 0) return null;
  const shown = open || hasActive;
  return (
    <div className="mt-3.5 first:mt-0">
      {collapsed ? (
        <div className="mx-2.5 mb-1.5 border-t border-line" />
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={shown}
          className="group flex w-full items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint hover:text-ink-soft">
          <IconChevronRight
            width={11} height={11}
            className={`shrink-0 transition-transform duration-100 ${shown ? 'rotate-90' : ''} text-ink-faint/70`} />
          <span className="truncate">{title}</span>
          {!shown && <span className="ml-auto tabular-nums text-ink-faint/70">{visible.length}</span>}
        </button>
      )}
      {(shown || collapsed) && (
        <nav className="space-y-px mt-0.5">
          {visible.map((item) => <NavItem key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} onNavigate={onNavigate} />)}
        </nav>
      )}
    </div>
  );
}

/** Remembered per browser; a bad or absent value just means "all expanded". */
const NAV_KEY = 'truehr.nav.collapsed';
function useCollapsedSections() {
  const [set, setSet] = useState(() => new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NAV_KEY);
      if (raw) setSet(new Set(JSON.parse(raw)));
    } catch { /* private mode, cleared storage — expanded is the safe default */ }
  }, []);
  const toggle = (key) => setSet((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    try { window.localStorage.setItem(NAV_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });
  return [set, toggle];
}

export default function AdminLayout({ children }) {
  return (
    <PermProvider>
      <AdminShell>{children}</AdminShell>
    </PermProvider>
  );
}

// ── The organisation switcher ───────────────────────────────────────────────
// Only the platform owner can switch. Everyone else sees their organisation's
// name as a plain label, so it is always obvious whose data is on screen.
function OrgSwitcher() {
  const { orgs, activeOrg, switchOrg } = usePerms();
  const [open, setOpen] = useState(false);
  if (!orgs || !activeOrg) return null;

  const list = (orgs.organisations || []).filter((o) => o.status === 'ACTIVE');
  if (!orgs.canSwitch || list.length <= 1) {
    return (
      <span className="hidden md:inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-2.5 py-1 text-[11.5px] font-semibold text-white/80 max-w-[210px]">
        <IconBriefcase className="text-white/55 shrink-0" />
        <span className="truncate">{activeOrg.name}</span>
      </span>
    );
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 hover:bg-white/[.18] px-2.5 py-1.5 text-[11.5px] font-semibold text-white/90 max-w-[230px] transition-colors"
        title="Switch organisation">
        <IconBriefcase className="text-white/60 shrink-0" />
        <span className="truncate">{activeOrg.name}</span>
        <IconChevronLeft className="-rotate-90 text-white/60 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-72 rounded-xl2 border border-line bg-white shadow-pop p-1.5 animate-in">
            <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">
              Switch organisation
            </div>
            <div className="max-h-72 overflow-y-auto">
              {list.map((o) => {
                const active = String(o.id) === String(orgs.activeOrganisationId);
                return (
                  <button key={o.id} disabled={active}
                    onClick={() => { setOpen(false); switchOrg(o.id); }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                      active ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-ink-soft hover:bg-slate-50'}`}>
                    <span className="min-w-0">
                      <span className="block truncate">{o.name}</span>
                      <span className="block text-[11px] text-ink-faint">{o.employees ?? 0} employees</span>
                    </span>
                    {active && <IconCheck className="text-brand-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 border-t border-line pt-1">
              <Link href="/admin/organisations" onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-slate-50">
                Manage organisations
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Shown when a role opens a section it cannot access (e.g. by typing the URL).
// The sidebar already hides the link; this stops the page itself from rendering
// and firing requests the server would only 403. Grant it from Roles & Permissions.
function AccessDenied({ label, onHome }) {
  return (
    <div className="mx-auto max-w-lg">
      <Card className="p-6">
        <div className="flex items-start gap-3.5">
          <span className="grid place-items-center h-9 w-9 rounded bg-crit-bg text-crit shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink">Restricted section</div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
              You don&rsquo;t have access to <b className="text-ink-soft">{label}</b>. A Super Admin can grant it from Roles &amp; Permissions.
            </p>
            <div className="mt-4"><Button size="sm" onClick={onHome}>Go to a section you can open</Button></div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AdminShell({ children }) {
  const { auth, user, logout, ready } = useAuth();
  const { canView, loading: permsLoading, role: liveRole, activeOrg, isPlatformAdmin } = usePerms();
  const pathname = usePathname();
  const router = useRouter();
  const role = user?.role;
  // Prefer the custom role's label ("Chief Technology Officer") over the base
  // enum, so a CEO is not shown as "HR Admin".
  // The platform owner sits above the per-organisation role matrix, so its
  // org role ("Super Admin" of the seed org) is the wrong thing to show.
  const roleLabel = isPlatformAdmin ? 'Master' : (liveRole?.label || ROLE_LABEL[role] || 'Staff');
  const badgeRole = isPlatformAdmin ? 'MASTER' : (liveRole?.baseRole || role);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidden, toggleSection] = useCollapsedSections();

  useEffect(() => { setCollapsed(localStorage.getItem('truehr_nav_collapsed') === '1'); }, []);
  useEffect(() => { setMobileOpen(false); setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (ready && !auth?.token) router.replace('/login');
  }, [ready, auth, router]);
  // The Master (platform owner) works only in the Master Admin section — any
  // other admin route bounces back, so the organisation list is the whole surface.
  useEffect(() => {
    if (ready && auth?.token && isPlatformAdmin && !pathname.startsWith('/admin/organisations')) {
      router.replace('/admin/organisations');
    }
  }, [ready, auth, isPlatformAdmin, pathname, router]);

  function toggleCollapse() {
    setCollapsed((c) => { localStorage.setItem('truehr_nav_collapsed', c ? '0' : '1'); return !c; });
  }

  if (!ready || !auth?.token || permsLoading) {
    return <div className="min-h-screen grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>;
  }

  const initials = (user?.email || 'HR').slice(0, 2).toUpperCase();
  const isActive = (href) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));
  const current = [...ALL].sort((a, b) => b.href.length - a.href.length).find((i) => isActive(i.href));
  const pageTitle = current?.label || 'Admin Console';
  // Route-level permission gate. Nav hides links, but a directly-typed URL would
  // still render; block it unless the live permissions allow this section.
  const firstAllowed = ALL.find((i) => canView(i.module));
  const masterElsewhere = isPlatformAdmin && !pathname.startsWith('/admin/organisations');
  const blocked = !isPlatformAdmin && current && !canView(current.module);

  const SidebarBody = ({ collapsed }) => (
    <>
      <div className={`pt-3 flex-1 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-2'}`}>
        {isPlatformAdmin ? (
          <NavGroup title="Platform" items={MASTER} canView={() => true} isActive={isActive} collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />
        ) : (
          <>
            {SECTIONS.map((sec) => (
              <NavGroup
                key={sec.key}
                title={sec.title}
                items={sec.items}
                canView={canView}
                isActive={isActive}
                collapsed={collapsed}
                onNavigate={() => setMobileOpen(false)}
                open={!hidden.has(sec.key)}
                onToggle={() => toggleSection(sec.key)}
                hasActive={sec.items.some((i) => isActive(i.href))}
              />
            ))}
          </>
        )}
      </div>
      <div className={`mt-auto border-t border-line ${collapsed ? 'p-1.5' : 'p-2'}`}>
        {!collapsed && (
          <div className="px-2.5 py-2 min-w-0">
            <div className="text-[12px] font-semibold text-ink truncate">{user?.email}</div>
            <span className={`inline-flex mt-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${ROLE_BADGE[badgeRole] || 'bg-slate-100 text-ink-soft'}`}>{roleLabel}</span>
          </div>
        )}
        <button onClick={() => { logout(); router.replace('/login'); }} title="Sign out"
          className={`flex items-center gap-2.5 w-full rounded px-2.5 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink transition-colors ${collapsed ? 'justify-center' : ''}`}>
          <IconLogout className="text-ink-faint" />{!collapsed && 'Sign out'}
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-canvas">
      {/* ── Shell bar: the console's fixed chrome ───────────────────────── */}
      <header className="h-12 shrink-0 bg-shell text-white flex items-center gap-2.5 px-2.5 sm:px-3.5 z-40">
        <button onClick={() => setMobileOpen(true)} className="md:hidden grid place-items-center h-8 w-8 rounded text-white/85 hover:bg-white/10"><IconMenu /></button>
        <button onClick={toggleCollapse} className="hidden md:grid place-items-center h-8 w-8 rounded text-white/85 hover:bg-white/10" title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
          <IconChevronLeft className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
        <Link href="/admin" className="flex items-center gap-2.5 shrink-0">
          <span className="grid place-items-center h-6 w-6 rounded bg-brand-gradient text-[9.5px] font-bold">TK</span>
          <span className="hidden sm:block font-semibold text-[14px] tracking-tight">True HR</span>
        </Link>
        <span className="hidden md:block h-5 w-px bg-white/20 shrink-0" />
        <div className="hidden md:block min-w-0 text-[12.5px] text-white/70 truncate">
          {activeOrg?.name || 'True HR'} · {pageTitle}
        </div>
        <div className="ml-auto flex items-center gap-2 relative">
          <OrgSwitcher />
          <span className="hidden sm:inline-flex rounded-sm bg-white/10 px-2 py-0.5 text-[10.5px] font-bold text-white/85">{roleLabel}</span>
          <button onClick={() => setMenuOpen((o) => !o)} title={user?.email}
            className="grid place-items-center h-7 w-7 rounded-full bg-white/[.18] hover:bg-white/25 text-[10.5px] font-bold transition-colors">{initials}</button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-40 w-60 rounded-xl2 border border-line bg-white shadow-pop p-1.5 animate-in">
                <div className="px-2.5 py-2 border-b border-line mb-1">
                  <div className="text-[12.5px] font-semibold text-ink truncate">{user?.email}</div>
                  <span className={`inline-flex mt-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${ROLE_BADGE[badgeRole] || 'bg-slate-100 text-ink-soft'}`}>{roleLabel}</span>
                </div>
                <button onClick={() => { logout(); router.replace('/login'); }} className="flex items-center gap-2.5 w-full rounded px-2.5 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink">
                  <IconLogout className="text-ink-faint" /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 min-w-0 flex overflow-hidden">
        {/* Desktop navigation */}
        <aside className={`shrink-0 hidden md:flex flex-col bg-white border-r border-line overflow-hidden transition-[width] duration-150 ${collapsed ? 'w-[60px]' : 'w-[228px]'}`}>
          <SidebarBody collapsed={collapsed} />
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && <div className="fixed inset-0 z-40 bg-shell/50 md:hidden" onClick={() => setMobileOpen(false)} />}
        <aside className={`fixed z-50 md:hidden top-0 left-0 h-screen w-[248px] flex flex-col bg-white border-r border-line shadow-pop transition-transform duration-150 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="h-12 flex items-center justify-between px-3 bg-shell text-white shrink-0">
            <span className="font-semibold text-[13.5px]">True HR</span>
            <button onClick={() => setMobileOpen(false)} className="text-white/80 hover:text-white"><IconX /></button>
          </div>
          <SidebarBody collapsed={false} />
        </aside>

        {/* Work area */}
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-5 lg:p-6 animate-in">
            {masterElsewhere ? (
              <div className="grid place-items-center py-24"><Spinner className="text-brand-600 h-6 w-6" /></div>
            ) : blocked ? (
              <AccessDenied label={pageTitle} onHome={() => router.replace(firstAllowed?.href || '/ess')} />
            ) : children}
          </div>
        </main>
      </div>
    </div>
  );
}
