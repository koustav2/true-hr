export function Button({ as: As = 'button', variant = 'primary', className = '', children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-xl px-4 py-2.5 text-sm transition active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary: 'bg-brand-600 text-white shadow-pop hover:bg-brand-700',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
    ghost: 'text-ink-soft hover:bg-black/5',
    danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100',
    outline: 'border border-slate-200 text-ink-soft hover:border-slate-300 hover:bg-white',
  };
  return <As className={`${base} ${styles[variant]} ${className}`} {...props}>{children}</As>;
}

export function Card({ className = '', children }) {
  return <div className={`bg-white rounded-xl2 shadow-card border border-slate-100 ${className}`}>{children}</div>;
}

export function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink-soft mb-1.5">
        {label}{required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-ink-faint mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100';

export function Input(props) { return <input {...props} className={`${inputCls} ${props.className || ''}`} />; }
export function Select({ children, ...props }) { return <select {...props} className={`${inputCls} ${props.className || ''}`}>{children}</select>; }
export function Textarea(props) { return <textarea {...props} className={`${inputCls} ${props.className || ''}`} />; }

export function Spinner({ className = '' }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function Empty({ title, subtitle, icon = '📭' }) {
  return (
    <div className="text-center py-16">
      <div className="text-4xl mb-3">{icon}</div>
      <div className="font-semibold text-ink">{title}</div>
      {subtitle && <div className="text-sm text-ink-faint mt-1">{subtitle}</div>}
    </div>
  );
}
