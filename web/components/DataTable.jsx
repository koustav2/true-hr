'use client';
import { useMemo, useState } from 'react';
import { Spinner, Empty } from '@/components/ui.jsx';
import { IconSearch, IconChevronRight } from '@/components/icons.jsx';

// columns: [{ key, label, render?(row), sortable?, sortValue?(row), className?, align?, width? }]
export default function DataTable({
  columns, rows, loading = false, searchKeys = [], searchPlaceholder = 'Search…',
  pageSize = 10, rowKey = 'id', onRowClick, emptyTitle = 'Nothing here yet', emptySubtitle,
  toolbar = null,
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let data = rows || [];
    if (q && searchKeys.length) {
      const term = q.toLowerCase();
      data = data.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(term)));
    }
    if (sort.key) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
      data = [...data].sort((a, b) => {
        const av = val(a), bv = val(b);
        if (av == null) return 1; if (bv == null) return -1;
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return data;
  }, [rows, q, sort, columns, searchKeys]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const slice = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    setPage(1);
  }

  return (
    <div className="bg-white rounded-xl2 border border-line shadow-card overflow-hidden">
      {(searchKeys.length > 0 || toolbar) && (
        <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5 border-b border-line">
          {searchKeys.length > 0 && (
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <IconSearch width={15} height={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={searchPlaceholder}
                className="w-full rounded border border-line bg-white pl-8 pr-3 py-[7px] text-[13px] text-ink placeholder:text-ink-faint outline-none transition-colors hover:border-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25" />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">{toolbar}</div>
        </div>
      )}

      {loading ? (
        <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
      ) : filtered.length === 0 ? (
        <Empty title={q ? 'No matches' : emptyTitle} subtitle={q ? 'Try a different search.' : emptySubtitle} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/60 text-ink-faint border-b border-line">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} style={c.width ? { width: c.width } : undefined}
                      className={`px-4 py-1.5 font-medium whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.sortable ? 'cursor-pointer select-none hover:text-ink-soft' : ''} ${c.className || ''}`}
                      onClick={c.sortable ? () => toggleSort(c.key) : undefined}>
                      {c.label}
                      {c.sortable && sort.key === c.key && <span className="ml-1 text-brand-600">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {slice.map((r) => (
                  <tr key={r[rowKey]} onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={`transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-4 py-1.5 ${c.align === 'right' ? 'text-right' : ''} ${c.cellClassName || ''}`}>
                        {c.render ? c.render(r) : (r[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-line text-[12.5px]">
              <span className="text-ink-faint">{filtered.length} record{filtered.length === 1 ? '' : 's'}</span>
              <div className="flex items-center gap-2">
                <button disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}
                  className="inline-flex items-center rounded border border-line px-2 py-1 text-ink-soft disabled:opacity-40 hover:bg-canvas"><IconChevronRight width={14} height={14} className="rotate-180" /></button>
                <span className="text-ink-soft tabular-nums">Page {pageSafe} / {totalPages}</span>
                <button disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)}
                  className="inline-flex items-center rounded border border-line px-2 py-1 text-ink-soft disabled:opacity-40 hover:bg-canvas"><IconChevronRight width={14} height={14} /></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
