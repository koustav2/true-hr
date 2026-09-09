'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Select } from '@/components/ui.jsx';

/**
 * Pickers backed by the organisation's master lists (/admin/org-masters).
 *
 * Two shapes, because the columns they feed are two different things:
 *
 *  MasterText  — for a free-text column that predates the master (an
 *                employee's bank name, an asset's brand, a designation's
 *                grade). It suggests the list but still accepts anything
 *                typed, so existing records and one-off values keep working
 *                while new entries converge on the list.
 *
 *  MasterSelect — for a real foreign key (an employee's sub-department or
 *                branch). Only ids on the list are valid, so this is a select.
 *
 * A failed fetch is silent and leaves a plain input: a master list being
 * unreachable must not stop HR filling in an employee.
 */
function useMaster(kind, parentRef) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let live = true;
    api.get(`/meta/org-masters?kind=${encodeURIComponent(kind)}`)
      .then((r) => { if (live) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [kind]);
  return parentRef == null || parentRef === ''
    ? rows
    : rows.filter((r) => r.parentRef == null || String(r.parentRef) === String(parentRef));
}

const inputCls = 'w-full rounded border border-line bg-white px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint outline-none transition-colors hover:border-slate-400 focus:border-brand-600 focus:shadow-focus';

export function MasterText({ kind, value, onChange, placeholder, className = '' }) {
  const rows = useMaster(kind);
  const listId = `master-${kind.toLowerCase()}`;
  return (
    <>
      <input className={`${inputCls} ${className}`} list={listId} value={value ?? ''}
        onChange={onChange} placeholder={placeholder} />
      <datalist id={listId}>
        {rows.map((r) => <option key={r.id} value={r.name}>{r.code ? `${r.name} (${r.code})` : r.name}</option>)}
      </datalist>
    </>
  );
}

export function MasterSelect({ kind, value, onChange, parentRef, emptyLabel = '— none —' }) {
  const rows = useMaster(kind, parentRef);
  return (
    <Select value={value ?? ''} onChange={onChange}>
      <option value="">{emptyLabel}</option>
      {rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </Select>
  );
}
