export function Logo({ size = 34, light = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="grid place-items-center rounded-[10px] font-extrabold text-white"
        style={{
          width: size, height: size,
          background: 'linear-gradient(135deg,#34d399,#059669 60%,#0d9488)',
          boxShadow: '0 6px 16px -6px rgba(5,150,105,.6)',
        }}
      >
        <span style={{ fontSize: size * 0.44, lineHeight: 1 }}>T</span>
      </div>
      <div className="leading-tight">
        <div className={`font-bold tracking-tight ${light ? 'text-white' : 'text-ink'}`}>TRUE HR</div>
        <div className={`text-[10px] uppercase tracking-[0.18em] ${light ? 'text-white/60' : 'text-ink-faint'}`}>People OS</div>
      </div>
    </div>
  );
}
