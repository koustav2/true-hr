export function Logo({ size = 34, light = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="grid place-items-center rounded-full font-extrabold text-white shrink-0"
        style={{
          width: size, height: size,
          background: 'linear-gradient(135deg,#2563eb 0%,#1d8bd6 45%,#16a34a 100%)',
          boxShadow: '0 6px 16px -6px rgba(37,99,235,.55)',
        }}
      >
        <span style={{ fontSize: size * 0.44, lineHeight: 1 }}>T</span>
      </div>
      <div className="leading-tight">
        <div className={`font-bold tracking-tight ${light ? 'text-white' : ''}`}>
          {light ? 'TRUE KIND' : <span><span className="text-brand-700">TRUE</span> <span className="text-leaf-600">KIND</span></span>}
        </div>
        <div className={`text-[10px] uppercase tracking-[0.18em] ${light ? 'text-white/60' : 'text-ink-faint'}`}>Foundation · HR</div>
      </div>
    </div>
  );
}
