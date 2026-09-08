import React from 'react';
import { createPortal } from 'react-dom';

// ============================================================================
// Enterprise console component kit (Fiori-inspired).
//
// Design language: one accent blue, semantic colour reserved for state, compact
// 4–6px radii, hairline borders, shallow crisp shadows, dense spacing. The
// exported API is unchanged so every screen inherits the new look untouched.
// ============================================================================

export function Button({ as: As = 'button', variant = 'primary', size = 'md', className = '', children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded transition-colors duration-100 outline-none focus-visible:shadow-focus disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap';
  const sizes = { lg: 'px-5 py-2.5 text-sm', md: 'px-4 py-2 text-[13px]', sm: 'px-3 py-1.5 text-xs' };
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-btn',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 ring-1 ring-inset ring-brand-200',
    ghost: 'text-ink-soft hover:bg-slate-100 hover:text-ink',
    danger: 'bg-white border border-neg/40 text-neg hover:bg-neg-bg',
    outline: 'bg-white border border-line text-ink-soft hover:bg-canvas hover:text-ink',
  };
  return <As className={`${base} ${sizes[size] || sizes.md} ${styles[variant]} ${className}`} {...props}>{children}</As>;
}

export function Card({ className = '', hover = false, children }) {
  const interactive = hover ? 'lift hover:shadow-lift hover:border-brand-400' : '';
  return <div className={`bg-white rounded-xl2 border border-line shadow-card ${interactive} ${className}`}>{children}</div>;
}

export function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint mb-1.5">
        {label}{required && <span className="text-brand-600"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-[11.5px] text-ink-faint mt-1.5">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded border border-line bg-white px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint outline-none transition-colors hover:border-slate-400 focus:border-brand-600 focus:shadow-focus';
// Callers may pass an explicit width (w-24, w-40, w-[…]); drop the built-in
// w-full then, otherwise the two width utilities conflict and w-full can win.
const inputBase = (extra) => /(^|\s)w-(\d|\[)/.test(extra || '') ? inputCls.replace('w-full ', '') : inputCls;

export function Input(props) { return <input {...props} className={`${inputBase(props.className)} ${props.className || ''}`} />; }
export function Select({ children, ...props }) { return <select {...props} className={`${inputBase(props.className)} appearance-none bg-no-repeat ${props.className || ''}`} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%237a8899' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: 'right 0.65rem center', paddingRight: '2.1rem' }}>{children}</select>; }
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
  const bar = { brand: 'bg-brand-600', danger: 'bg-neg' }[tone] || 'bg-brand-600';
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-shell/45" onClick={onClose} />
      <div className={`relative w-full ${widths[size] || widths.md} bg-white rounded-xl3 border border-line shadow-pop animate-in flex flex-col max-h-[90vh] overflow-hidden`}>
        {title && (
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line bg-canvas shrink-0">
            <span className={`h-4 w-1 rounded-sm shrink-0 ${bar}`} />
            <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          </div>
        )}
        {children && <div className="px-5 py-4 text-[13px] text-ink-soft leading-relaxed overflow-y-auto flex-1">{children}</div>}
        {actions && <div className="flex justify-end gap-2 px-5 py-3 border-t border-line bg-canvas shrink-0">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Empty({ title, subtitle, icon = null }) {
  return (
    <div className="text-center py-14 px-6">
      <div className="mx-auto mb-4 grid place-items-center h-11 w-11 rounded-xl2 bg-canvas text-ink-faint ring-1 ring-inset ring-line">
        {icon || (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>
        )}
      </div>
      <div className="font-semibold text-ink text-[14px]">{title}</div>
      {subtitle && <div className="text-[12.5px] text-ink-faint mt-1 max-w-sm mx-auto leading-relaxed">{subtitle}</div>}
    </div>
  );
}

// Two-step destructive action: first click arms ("Sure?"), second click within
// 2.5s executes. Prevents accidental deletes/rejects without a heavy modal.
export function ConfirmClick({ onConfirm, children, confirmLabel = 'Sure?', className = '', armedClassName = 'text-neg font-bold' }) {
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
        <div className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-line rounded shadow-pop animate-in">
          <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false); }}
            className="block w-full text-left px-3 py-2 text-[13px] text-ink-faint hover:bg-canvas">— None —</button>
          {list.slice(0, 60).map((o) => (
            <button type="button" key={o.id}
              onMouseDown={(e) => { e.preventDefault(); onChange(String(o.id)); setOpen(false); }}
              className={`block w-full text-left px-3 py-2 text-[13px] hover:bg-brand-50 ${String(o.id) === String(value) ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-ink'}`}>
              {getLabel(o)}
            </button>
          ))}
          {!list.length && <div className="px-3 py-2.5 text-[13px] text-ink-faint">No match for “{q}”</div>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives every module adopts.
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#0a5fd1,#12a150)', 'linear-gradient(135deg,#5b3fd1,#9b6ef3)',
  'linear-gradient(135deg,#0891b2,#0a5fd1)', 'linear-gradient(135deg,#0e7a3c,#4ec27f)',
  'linear-gradient(135deg,#c9700c,#e8a34a)', 'linear-gradient(135deg,#b31760,#e0609a)',
  'linear-gradient(135deg,#1a70da,#83b5f1)', 'linear-gradient(135deg,#0848a0,#4a92e8)',
];
export function initialsOf(name) {
  return (name || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
}
function gradientFor(name) {
  let h = 0; const t = name || '';
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}
/** Identity avatar — a compact gradient square with initials. */
export function Avatar({ name, size = 32, className = '' }) {
  return (
    <span className={`grid place-items-center rounded text-white font-bold shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), backgroundImage: gradientFor(name) }}>
      {initialsOf(name)}
    </span>
  );
}

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-ink-soft', brand: 'bg-brand-50 text-brand-700',
  ok: 'bg-pos-bg text-pos', warn: 'bg-crit-bg text-crit', danger: 'bg-neg-bg text-neg',
  info: 'bg-brand-50 text-brand-700', grape: 'bg-grape-50 text-grape-700',
};
/** Status chip. tone: neutral|brand|ok|warn|danger|info|grape */
export function Badge({ tone = 'neutral', dot = false, children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[10.5px] font-bold tracking-[.02em] ${BADGE_TONES[tone] || BADGE_TONES.neutral} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Consistent page header: breadcrumb-quiet title, optional subtitle + action. */
export function PageHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h1 className="page-title text-[20px] font-semibold text-ink">{title}</h1>
        {subtitle && <p className="text-ink-faint text-[13px] mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const TILE_TONE = { brand: 'text-brand-600', ok: 'text-pos', warn: 'text-crit', danger: 'text-neg', neutral: 'text-ink' };
/**
 * Launchpad tile — the enterprise KPI unit: label, big tabular value, optional
 * unit / caption / footer. `Icon` renders a chip for navigation-style tiles.
 */
export function StatTile({ Icon, tone = 'brand', label, value, unit, caption, foot, footTone, className = '' }) {
  return (
    <Card hover className={`p-3.5 min-h-[104px] flex flex-col ${className}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-ink-soft leading-tight">{label}</div>
          {caption && <div className="text-[11px] text-ink-faint mt-0.5">{caption}</div>}
        </div>
        {Icon && <span className="ml-auto grid place-items-center h-7 w-7 rounded bg-brand-50 text-brand-600 shrink-0"><Icon width={15} height={15} /></span>}
      </div>
      <div className={`mt-auto text-[28px] leading-none font-semibold tracking-tight tabular-nums ${TILE_TONE[tone] || TILE_TONE.brand}`}>
        {value}{unit && <span className="text-[12px] text-ink-faint font-medium ml-1">{unit}</span>}
      </div>
      {foot && <div className={`mt-1.5 text-[11.5px] font-semibold ${TILE_TONE[footTone] || 'text-ink-faint'}`}>{foot}</div>}
    </Card>
  );
}

/** Object-page header — big avatar + a row of key facts (Fiori object pattern). */
export function ObjectHeader({ name, subtitle, facts = [], actions = null }) {
  return (
    <Card className="p-4 flex flex-wrap items-start gap-4">
      <Avatar name={name} size={52} className="!rounded-xl2" />
      <div className="min-w-[200px] flex-1">
        <div className="text-[17px] font-semibold text-ink leading-tight">{name}</div>
        {subtitle && <div className="text-[12.5px] text-ink-faint mt-0.5">{subtitle}</div>}
        {facts.length > 0 && (
          <div className="mt-3 grid gap-x-6 gap-y-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(132px,1fr))' }}>
            {facts.map((f) => (
              <div key={f.label}>
                <div className="text-[10.5px] font-bold uppercase tracking-[.06em] text-ink-faint">{f.label}</div>
                <div className="text-[13px] font-semibold text-ink mt-0.5">{f.value ?? '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {actions && <div className="flex gap-2 flex-wrap shrink-0">{actions}</div>}
    </Card>
  );
}
