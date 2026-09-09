'use client';
// ============================================================================
// Departments and designations for one company: add many, delete many.
//
// The old screens took one name per click, which is unusable when a new tenant
// has thirty departments to type. So the add box is a textarea — paste a column
// straight out of a spreadsheet and every line becomes a row — and delete works
// off tick-boxes.
//
// Rows that somebody is actually in cannot be ticked. Refusing after the click
// would be correct but useless; showing why up front is what HR needs.
// ============================================================================
import { useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Textarea, Badge, Empty, Spinner } from '@/components/ui.jsx';

export default function StructureEditor({
  companyId,
  kind,               // 'departments' | 'designations'
  rows = [],
  onChanged,
}) {
  const isDep = kind === 'departments';
  const label = isDep ? 'Department' : 'Designation';
  const labelPlural = isDep ? 'Departments' : 'Designations';
  const nameOf = (r) => (isDep ? r.name : r.title);

  const [text, setText] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Deduplicated the same way the server does, so the button's count is what
  // will actually be created — not the number of lines typed.
  const lines = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const raw of text.split(/[\n,;]+/)) {
      const name = raw.trim().replace(/\s+/g, ' ');
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
    return out;
  }, [text]);
  const deletable = rows.filter((r) => !r.employees);
  const pickedFree = [...picked].filter((id) => deletable.some((r) => r.id === id));

  const toggle = (id) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function add() {
    if (!lines.length) return;
    setBusy('add'); setErr(''); setMsg('');
    try {
      const body = isDep ? { names: lines } : { titles: lines };
      const r = await api.post(`/admin/companies/${companyId}/${kind}/bulk`, body);
      setText('');
      setMsg(r.message || 'Added.');
      onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  async function removePicked() {
    if (!pickedFree.length) return;
    setBusy('del'); setErr(''); setMsg('');
    try {
      const r = await api.post(`/admin/companies/${companyId}/${kind}/delete`, { ids: pickedFree });
      setPicked(new Set());
      setMsg(r.message || 'Deleted.');
      onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-canvas">
        <span className="text-[12.5px] font-semibold text-ink-soft">
          {labelPlural} <span className="text-ink-faint font-normal">· {rows.length}</span>
        </span>
        {pickedFree.length > 0 && (
          <Button variant="outline" size="sm" className="text-neg" disabled={busy === 'del'} onClick={removePicked}>
            {busy === 'del' ? <Spinner className="h-3.5 w-3.5" /> : `Delete ${pickedFree.length} selected`}
          </Button>
        )}
      </div>

      <div className="p-3.5 border-b border-line grid gap-2">
        <Textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isDep
            ? 'One department per line — Finance, Human Resources, Operations…'
            : 'One designation per line — Manager, Senior Executive, Analyst…'}
        />
        <div className="flex items-center gap-2.5">
          <Button size="sm" disabled={!lines.length || busy === 'add'} onClick={add}>
            {busy === 'add' ? <Spinner className="h-3.5 w-3.5" /> : `Add ${lines.length || ''} ${lines.length === 1 ? label.toLowerCase() : labelPlural.toLowerCase()}`.trim()}
          </Button>
          <span className="text-[11.5px] text-ink-faint">
            Paste a whole column at once. Names you already have are skipped, not duplicated.
          </span>
        </div>
      </div>

      {msg && <div className="px-4 py-2 text-[12.5px] text-pos bg-canvas border-b border-line">{msg}</div>}
      {err && <div className="px-4 py-2 text-[12.5px] text-neg bg-canvas border-b border-line">{err}</div>}

      {rows.length === 0 ? (
        <Empty title={`No ${labelPlural.toLowerCase()} yet`} subtitle={`Type them above — one per line.`} />
      ) : (
        <div className="max-h-72 overflow-y-auto divide-y divide-line">
          {rows.map((r) => (
            <label
              key={r.id}
              className={`flex items-center gap-3 px-4 py-2 ${r.employees ? 'opacity-70' : 'cursor-pointer hover:bg-canvas'}`}
            >
              <input
                type="checkbox"
                disabled={!!r.employees}
                checked={picked.has(r.id)}
                onChange={() => toggle(r.id)}
                className="h-3.5 w-3.5 accent-brand-600 disabled:cursor-not-allowed"
              />
              <span className="flex-1 text-[13px] text-ink font-medium">{nameOf(r)}</span>
              {!isDep && r.grade && <span className="text-[11.5px] text-ink-faint">{r.grade}</span>}
              {r.employees
                ? <Badge tone="warn">{r.employees} {r.employees === 1 ? 'person' : 'people'}</Badge>
                : <Badge tone="neutral">unused</Badge>}
            </label>
          ))}
        </div>
      )}
    </Card>
  );
}
