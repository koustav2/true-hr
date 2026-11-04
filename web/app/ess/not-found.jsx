import Link from 'next/link';

// Shown inside the ESS shell (header + menu) for an unknown /ess address (E65).
export default function EssNotFound() {
  return (
    <div className="grid place-items-center py-16">
      <div className="max-w-md text-center">
        <div className="text-[44px] font-semibold tracking-tight text-ink-faint/70 tabular-nums">404</div>
        <h1 className="mt-1 text-lg font-semibold text-ink">This page doesn&rsquo;t exist</h1>
        <p className="mt-1.5 text-sm text-ink-faint">
          The address may be mistyped, or the page has moved. Use the menu above, or go back to your dashboard.
        </p>
        <Link href="/ess"
          className="mt-5 inline-flex items-center rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Go to my dashboard
        </Link>
      </div>
    </div>
  );
}
