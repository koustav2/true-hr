import React from 'react';
import { createPortal } from 'react-dom';
export function Button({ as: As = 'button', variant = 'primary', size = 'md', className = '', children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 ease-premium outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap active:scale-[.985]';
  const sizes = { md: 'px-5 py-2.5 text-sm', sm: 'px-3.5 py-1.5 text-[13px]' };
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
  const interactive = hover ? 'lift hover:shadow-lift hover:border-brand-200/70' : '';
  return <div className={`bg-white rounded-xl3 border border-line shadow-card ${interactive} ${className}`}>{children}</div>;
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

const inputCls = 'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 shadow-soft outline-none transition hover:border-slate-300 focus:border-brand-500 focus:shadow-focus';
// Callers may pass an explicit width (w-24, w-40, w-[…]); drop the built-in
// w-full then, otherwise the two width utilities conflict and w-full can win
// (seen live: the KPI "Wt %" input swallowing the whole row).
const inputBase = (extra) => /(^|\s)w-(\d|\[)/.test(extra || '') ? inputCls.replace('w-full ', '') : inputCls;

export function Input(props) { return <input {...props} className={`${inputBase(props.className)} ${props.className || ''}`} />; }
export function Select({ children, ...props }) { return <select {...props} className={`${inputBase(props.className)} appearance-none bg-no-repeat ${props.className || ''}`} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: 'right 0.75rem center', paddingRight: '2.25rem' }}>{children}</select>; }
export function Textarea(props) { return <textarea {...props} className={`${inputBase(props.className)} ${props.className || ''}`} />; }

export function Spinner({ className = '' }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function Modal({ open, onClose, title, children, actions, tone = 'brand', size = 'md' }) {
  // Portal to <body>: ancestor transforms/filters/overflow can trap `fixed`
  // elements (seen live: modal backdrop clipped to the admin content area).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  if (!open || !mounted) return null;
  const ring = { brand: 'bg-brand-50 text-brand-700', danger: 'bg-rose-50 text-rose-600' }[tone] || 'bg-brand-50 text-brand-700';
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative w-full ${widths[size] || widths.md} bg-white rounded-xl2 border border-line shadow-pop animate-in flex flex-col max-h-[90vh]`}>
        {title && (
          <div className={`flex items-start gap-3 px-6 pt-6 ${children ? 'pb-2' : 'pb-4'} shrink-0`}>
            <span className={`grid place-items-center h-9 w-9 rounded-full shrink-0 ${ring}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
            </span>
            <h3 className="text-base font-bold text-ink pt-1.5">{title}</h3>
          </div>
        )}
        {children && <div className={`px-6 ${title ? '' : 'pt-6'} pb-4 text-sm text-ink-soft leading-relaxed overflow-y-auto flex-1`}>{children}</div>}
        {actions && <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-line shrink-0">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Empty({ title, subtitle, icon = null }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="relative mx-auto mb-5 h-16 w-16">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-100 to-emerald-100 blur-[6px] opacity-80" />
        <div className="relative grid place-items-center h-16 w-16 rounded-full bg-gradient-to-br from-brand-50 to-emerald-50 text-brand-500 ring-1 ring-inset ring-brand-100">
          {icon || (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>
          )}
        </div>
      </div>
      <div className="font-bold text-ink text-[15px]">{title}</div>
      {subtitle && <div className="text-sm text-ink-faint mt-1.5 max-w-sm mx-auto leading-relaxed">{subtitle}</div>}
    </div>
  );
}

// Two-step destructive action: first click arms ("Sure?"), second click within
// 2.5s executes. Prevents accidental deletes/rejects without a heavy modal.
export function ConfirmClick({ onConfirm, children, confirmLabel = 'Sure?', className = '', armedClassName = 'text-rose-700 font-bold' }) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 2500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      className={armed ? `${className} ${armedClassName}` : className}>
      {armed ? confirmLabel : children}
    </button>
  );
}
// Type-ahead picker: search options by any text (name / Employee ID) and pick one.
// options: [{ id, ... }], getLabel(option) → display string. Empty value allowed.
export function SearchPicker({ value, onChange, options = [], getLabel, placeholder = 'Type a name or Employee ID…' }) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const sel = options.find((o) => String(o.id) === String(value || ''));
  const list = q ? options.filter((o) => getLabel(o).toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div className="relative">
      <input
        className={inputCls}
        value={open ? q : (sel ? getLabel(sel) : '')}
        placeholder={sel && !open ? undefined : placeholder}
        onFocus={() => { setOpen(true); setQ(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-line rounded-xl shadow-pop animate-in">
          <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false); }}
            className="block w-full text-left px-3.5 py-2 text-sm text-ink-faint hover:bg-slate-50">— None —</button>
          {list.slice(0, 60).map((o) => (
            <button type="button" key={o.id}
              onMouseDown={(e) => { e.preventDefault(); onChange(String(o.id)); setOpen(false); }}
              className={`block w-full text-left px-3.5 py-2 text-sm hover:bg-brand-50 ${String(o.id) === String(value) ? 'bg-brand-50 text-brand-700 font-medium' : 'text-ink'}`}>
              {getLabel(o)}
            </button>
          ))}
          {!list.length && <div className="px-3.5 py-2.5 text-sm text-ink-faint">No match for “{q}”</div>}
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Premium primitives — the shared building blocks the whole app adopts so every
// module reads as one system (identity avatars, status pills, KPI tiles, headers).
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#1d4ed8,#12a150)', 'linear-gradient(135deg,#7c3aed,#a855f7)',
  'linear-gradient(135deg,#0ea5e9,#1d4ed8)', 'linear-gradient(135deg,#12a150,#4ade80)',
  'linear-gradient(135deg,#d68411,#f59e0b)', 'linear-gradient(135deg,#e0416a,#f472b6)',
  'linear-gradient(135deg,#0891b2,#22d3ee)', 'linear-gradient(135deg,#4f46e5,#818cf8)',
];
export function initialsOf(name) {
  return (name || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
}
function gradientFor(name) {
  let h = 0; const t = name || '';
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}
/** Identity avatar — a deterministic gradient squircle with initials. */
export function Avatar({ name, size = 40, className = '' }) {
  return (
    <span className={`grid place-items-center rounded-xl2 text-white font-bold shadow-soft shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.34, backgroundImage: gradientFor(name) }}>
      {initialsOf(name)}
    </span>
  );
}

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  brand:   'bg-brand-50 text-brand-700 ring-brand-200',
  ok:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn:    'bg-amber-50 text-amber-700 ring-amber-200',
  danger:  'bg-rose-50 text-rose-600 ring-rose-200',
  info:    'bg-sky-50 text-sky-700 ring-sky-200',
  grape:   'bg-grape-50 text-grape-700 ring-grape-200',
};
/** Status pill. tone: neutral|brand|ok|warn|danger|info|grape. dot adds a leading dot. */
export function Badge({ tone = 'neutral', dot = false, children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${BADGE_TONES[tone] || BADGE_TONES.neutral} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

/** Consistent page header: gradient-accented title, optional subtitle + action. */
export function PageHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="text-ink-faint text-sm mt-2 max-w-2xl">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const TILE_TONES = {
  brand:  'bg-brand-50 text-brand-700 ring-brand-200/70',
  ok:     'bg-emerald-50 text-emerald-600 ring-emerald-200/70',
  warn:   'bg-amber-50 text-amber-600 ring-amber-200/70',
  grape:  'bg-grape-50 text-grape-600 ring-grape-200/70',
  info:   'bg-sky-50 text-sky-600 ring-sky-200/70',
  neutral:'bg-slate-100 text-slate-600 ring-slate-200/70',
};
const TILE_ACCENT = { brand:'#1d4ed8', ok:'#12a150', warn:'#d68411', grape:'#7c3aed', info:'#0ea5e9', neutral:'#94a3b8' };
/** KPI tile — icon chip, big tabular value, label, optional caption/trend. */
export function StatTile({ Icon, tone = 'brand', label, value, caption, trend, className = '' }) {
  return (
    <Card hover className={`relative p-5 overflow-hidden h-full ${className}`}>
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${TILE_ACCENT[tone] || TILE_ACCENT.brand}, transparent 85%)` }} />
      <div className="flex items-start justify-between">
        <div className={`grid place-items-center h-11 w-11 rounded-xl2 ring-1 ring-inset ${TILE_TONES[tone] || TILE_TONES.brand}`}>{Icon && <Icon width={19} height={19} />}</div>
        {trend && <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">{trend}</span>}
      </div>
      <div className="text-[30px] leading-none font-extrabold mt-4 text-ink tracking-tight tabular-nums">{value}</div>
      <div className="text-[13px] font-semibold text-ink-soft mt-2">{label}</div>
      {caption && <div className="text-xs text-ink-faint mt-0.5">{caption}</div>}
    </Card>
  );
}
