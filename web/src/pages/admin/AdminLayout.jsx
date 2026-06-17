import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { Logo } from '../../components/Brand.jsx';

const nav = [
  { to: '/admin', label: 'Dashboard', end: true, icon: '◧' },
  { to: '/admin/employees', label: 'Employees', icon: '☷' },
  { to: '/admin/review', label: 'Review queue', icon: '✓' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initials = (user?.email || 'HR').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-full flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 hidden md:flex flex-col bg-white border-r border-slate-100 p-5">
        <div className="px-1 py-2"><Logo size={36} /></div>
        <nav className="mt-6 space-y-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-slate-50'}`}>
              <span className="text-base opacity-70">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-100">
          <button onClick={() => { logout(); navigate('/login'); }}
            className="flex items-center gap-3 w-full rounded-xl px-3.5 py-2.5 text-sm font-medium text-ink-soft hover:bg-slate-50">
            <span className="opacity-70">⤶</span> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white/80 backdrop-blur border-b border-slate-100 flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="md:hidden"><Logo size={30} /></div>
          <div className="hidden md:block text-sm text-ink-faint">True HR Pvt Ltd · Onboarding Console</div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-semibold text-ink">{user?.email}</div>
              <div className="text-xs text-ink-faint">HR Admin</div>
            </div>
            <div className="grid place-items-center h-9 w-9 rounded-full bg-brand-600 text-white text-xs font-bold">{initials}</div>
          </div>
        </header>
        <main className="p-6 flex-1 animate-in"><Outlet /></main>
      </div>
    </div>
  );
}
