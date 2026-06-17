export function Logo({ size = 36, light = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="grid place-items-center rounded-xl font-extrabold text-white shadow-pop"
        style={{
          width: size, height: size,
          background: 'linear-gradient(135deg,#6366f1,#4f46e5 55%,#4338ca)',
        }}
      >
        <span style={{ fontSize: size * 0.42 }}>T</span>
      </div>
      <div className="leading-tight">
        <div className={`font-extrabold tracking-tight ${light ? 'text-white' : 'text-ink'}`}>TRUE HR</div>
        <div className={`text-[10px] uppercase tracking-[0.2em] ${light ? 'text-white/60' : 'text-ink-faint'}`}>People OS</div>
      </div>
    </div>
  );
}
