export function Logo({ size = 34, light = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src="/tkf-logo.png" alt="True Kind Foundation"
        width={size} height={size}
        className="rounded-full shrink-0 object-contain"
        style={{ boxShadow: '0 6px 16px -6px rgba(37,99,235,.45)' }}
      />
      <div className="leading-tight">
        <div className={`font-bold tracking-tight ${light ? 'text-white' : ''}`}>
          {light ? 'TRUE KIND' : <span><span className="text-brand-700">TRUE</span> <span className="text-leaf-600">KIND</span></span>}
        </div>
        <div className={`text-[10px] uppercase tracking-[0.18em] ${light ? 'text-white/60' : 'text-ink-faint'}`}>Foundation · HR</div>
      </div>
    </div>
  );
}
