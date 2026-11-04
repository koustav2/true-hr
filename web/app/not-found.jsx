'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getStoredAuth } from '@/lib/api.js';
import { homeFor } from '@/lib/permissions.js';

// Branded 404 for any unknown address (E65), with a way back to the right
// dashboard for whoever is signed in (or to sign-in when nobody is).
export default function NotFound() {
  const [home, setHome] = useState({ href: '/login', label: 'Go to sign in' });
  useEffect(() => {
    const a = getStoredAuth();
    if (a?.token && a.user?.role) setHome({ href: homeFor(a.user.role), label: 'Go to my dashboard' });
  }, []);
  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <header className="h-12 shrink-0 bg-shell text-white flex items-center gap-2.5 px-3 sm:px-4">
        <Link href={home.href} className="flex items-center gap-2.5">
          <span className="grid place-items-center h-6 w-6 rounded bg-brand-gradient text-[9.5px] font-bold">TK</span>
          <span className="font-semibold text-[14px] tracking-tight">True HR</span>
        </Link>
      </header>
      <main className="flex-1 grid place-items-center p-6">
        <div className="max-w-md text-center">
          <div className="text-[56px] font-semibold tracking-tight text-ink-faint/70 tabular-nums">404</div>
          <h1 className="mt-1 text-xl font-semibold text-ink">Page not found</h1>
          <p className="mt-1.5 text-sm text-ink-faint">
            The address may be mistyped, or the page has moved.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href={home.href}
              className="inline-flex items-center rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              {home.label}
            </Link>
            <button type="button" onClick={() => window.history.back()}
              className="inline-flex items-center rounded border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-canvas">
              Go back
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
