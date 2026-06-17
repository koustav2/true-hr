export function Button({ as: As = 'button', variant = 'primary', size = 'md', className = '', children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 ease-premium outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap active:scale-[.985]';
  const sizes = { md: 'px-4 py-2.5 text-sm', sm: 'px-3 py-1.5 text-[13px]' };
  const styles = {
    primary: 'text-white bg-brand-gradient bg-[length:140%_140%] bg-[position:0%] hover:bg-[position:100%] transition-[background-position,box-shadow] shadow-btn hover:shadow-pop',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 ring-1 ring-inset ring-brand-100',
    ghost: 'text-ink-soft hover:bg-slate-100',
    danger: 'bg-white border border-rose-200 text-rose-600 hover:bg-rose-50',
    outline: 'bg-white border border-line text-ink-soft hover:bg-slate-50 hover:text-ink hover:border-slate-300',
  };
  return <As className={`${base} ${sizes[size]} ${styles[variant]} ${className}`} {...props}>{children}</As>;
}

export function Card({ className = '', hover = false, children }) {
  const interactive = hover ? 'lift hover:shadow-lift hover:border-slate-300/80' : '';
  return <div className={`bg-white rounded-xl2 border border-line shadow-card ${interactive} ${className}`}>{children}</div>;
}

export function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ink-soft mb-1.5">
        {label}{required && <span className="text-brand-600"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-ink-faint mt-1.5">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 outline-none transition focus:border-brand-500 focus:shadow-focus';

export function Input(props) { return <input {...props} className={`${inputCls} ${props.className || ''}`} />; }
export function Select({ children, ...props }) { return <select {...props} className={`${inputCls} appearance-none bg-no-repeat ${props.className || ''}`} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: 'right 0.75rem center', paddingRight: '2.25rem' }}>{children}</select>; }
export function Textarea(props) { return <textarea {...props} className={`${inputCls} ${props.className || ''}`} />; }

export function Spinner({ className = '' }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function Modal({ open, onClose, title, children, actions, tone = 'brand' }) {
  if (!open) return null;
  const ring = { brand: 'bg-brand-50 text-brand-700', danger: 'bg-rose-50 text-rose-600' }[tone] || 'bg-brand-50 text-brand-700';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-xl2 border border-line shadow-pop p-6 animate-in">
        {title && (
          <div className="flex items-start gap-3">
            <span className={`grid place-items-center h-9 w-9 rounded-full shrink-0 ${ring}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
            </span>
            <h3 className="text-base font-bold text-ink pt-1.5">{title}</h3>
          </div>
        )}
        {children && <div className="mt-3 text-sm text-ink-soft leading-relaxed">{children}</div>}
        {actions && <div className="mt-6 flex justify-end gap-2.5">{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, subtitle, icon = null }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="mx-auto mb-4 grid place-items-center h-12 w-12 rounded-full bg-slate-100 text-ink-faint">
        {icon || (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>
        )}
      </div>
      <div className="font-semibold text-ink">{title}</div>
      {subtitle && <div className="text-sm text-ink-faint mt-1">{subtitle}</div>}
    </div>
  );
}
