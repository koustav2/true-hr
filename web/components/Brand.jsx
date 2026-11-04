// The product mark on public pages (sign-in, password screens, legal pages).
//
// This used to be one client's logo and name ("True Kind Foundation") on every
// tenant's sign-in page. With no organisation context it is now the neutral
// TrueHR mark; a caller that does know the organisation can pass its own name
// and logo URL (`orgName`, `logoSrc`) and the mark follows that instead.
export function Logo({ size = 34, light = false, compact = false, orgName = null, logoSrc = null }) {
  const title = orgName || 'TrueHR';
  return (
    <div className="flex items-center gap-2.5">
      {logoSrc ? (
        <img
          src={logoSrc} alt={title}
          width={size} height={size}
          className="rounded-lg shrink-0 object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="shrink-0 inline-flex items-center justify-center rounded-lg bg-brand-600 text-white font-bold"
          style={{ width: size, height: size, fontSize: Math.round(size * 0.5), boxShadow: '0 6px 16px -6px rgba(37,99,235,.45)' }}
        >
          {(orgName || 'T').trim().charAt(0).toUpperCase()}
        </span>
      )}
      {compact ? null : (
        <div className="leading-tight">
          <div className={`font-bold tracking-tight ${light ? 'text-white' : ''}`}>
            {orgName ? orgName : (light ? 'TrueHR' : <span><span className="text-brand-700">True</span><span className="text-leaf-600">HR</span></span>)}
          </div>
          <div className={`text-[10px] uppercase tracking-[0.18em] ${light ? 'text-white/60' : 'text-ink-faint'}`}>
            {orgName ? 'Powered by TrueHR' : 'HR platform'}
          </div>
        </div>
      )}
    </div>
  );
}
