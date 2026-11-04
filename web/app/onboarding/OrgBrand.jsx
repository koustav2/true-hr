// The hiring organisation's own name / logo on the public onboarding pages
// (C6) — never the platform's or another tenant's.
export default function OrgBrand({ brand, size = 40 }) {
  if (!brand) return null;
  return (
    <div className="flex items-center gap-2.5">
      {brand.logo
        ? <img src={brand.logo} alt={brand.name} style={{ maxHeight: size, maxWidth: size * 3 }} className="object-contain shrink-0" />
        : <span className="grid place-items-center rounded-full text-white font-bold shrink-0" style={{ width: size, height: size, background: brand.accent || '#059669' }}>
            {String(brand.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
          </span>}
      <div className="leading-tight">
        <div className="font-bold tracking-tight text-ink">{brand.name}</div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-faint">Human Resources</div>
      </div>
    </div>
  );
}
