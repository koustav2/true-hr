'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api.js';
import { usePerms } from '@/lib/perms.jsx';
import { Card, Button, Input, Select, Field, Spinner, Empty, Badge, PageHeader, ConfirmClick } from '@/components/ui.jsx';
import { downloadCsv } from '@/lib/csv.js';

const blank = { name: '', code: '', parentRef: '', note: '', sortOrder: '' };

export default function OrgMastersPage() {
  const { canView } = usePerms();
  const [d, setD] = useState(null);
  const [kind, setKind] = useState(null);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    setErr('');
    api.get('/admin/org-masters').then((r) => {
      setD(r);
      setKind((k) => k || r.kinds[0]?.key || null);
    }).catch((e) => { setErr(e.message); setD(false); });
  };
  useEffect(load, []);

  const spec = useMemo(() => (d?.kinds || []).find((k) => k.key === kind), [d, kind]);
  const rows = (d?.lists?.[kind]) || [];
  const parentOptions = spec?.parent ? (d?.parents?.[spec.parent] || []) : null;

  const reset = () => { setForm(blank); setEditing(null); };

  async function save(e) {
    e?.preventDefault?.();
    setBusy(true); setErr(''); setMsg('');
    const body = {
      name: form.name, code: form.code || null, note: form.note || null,
      parentRef: spec?.parent ? form.parentRef : null,
      sortOrder: form.sortOrder === '' ? null : Number(form.sortOrder),
    };
    try {
      const r = editing
        ? await api.put(`/admin/org-masters/${kind}/${editing}`, body)
        : await api.post(`/admin/org-masters/${kind}`, body);
      setD((s) => ({ ...s, lists: { ...s.lists, [kind]: r.rows },
        kinds: s.kinds.map((k) => (k.key === kind ? { ...k, count: r.rows.length } : k)) }));
      reset();
      setMsg(editing ? 'Updated.' : 'Added.');
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  async function drop(row) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.del(`/admin/org-masters/${kind}/${row.id}`);
      setD((s) => ({ ...s, lists: { ...s.lists, [kind]: r.rows },
        kinds: s.kinds.map((k) => (k.key === kind ? { ...k, count: r.rows.length } : k)) }));
      setMsg(r.message || 'Removed.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master data"
        subtitle="The organisation's reference lists, in one place. Everything here is read by a form or a report — a bank on this list is what HR picks on an employee's bank details, so a bank advice file spells one bank one way."
      />

      {err && <p className="text-sm text-neg">{err}</p>}
      {msg && <p className="text-sm text-pos">{msg}</p>}

      {d === null ? <Card><div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div></Card>
        : d === false ? null : (
        <>
          {/* The hub: one tile per list, count and what reads it. */}
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {d.kinds.map((k) => (
              <button key={k.key} onClick={() => { setKind(k.key); reset(); setMsg(''); setErr(''); }}
                className={`text-left rounded border p-3.5 transition-colors ${
                  kind === k.key ? 'border-brand-600 bg-brand-50' : 'border-line bg-white hover:border-slate-400'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[13.5px] font-semibold ${kind === k.key ? 'text-brand-700' : 'text-ink'}`}>{k.label}</span>
                  <span className="text-[18px] font-semibold tabular-nums text-ink-soft">{k.count}</span>
                </div>
                <p className="text-[11.5px] text-ink-faint mt-1 leading-relaxed">{k.blurb}</p>
                <p className="text-[10.5px] text-ink-faint mt-1.5">Used by: {k.usedBy}</p>
              </button>
            ))}
          </div>

          {spec && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-canvas">
                <div>
                  <div className="text-[12.5px] font-semibold text-ink-soft">{spec.label}</div>
                  <div className="text-[11.5px] text-ink-faint">{spec.usedBy}</div>
                </div>
                <Button variant="outline" size="sm" disabled={!rows.length}
                  onClick={() => downloadCsv(`${kind.toLowerCase()}.csv`, rows.map((r) => ({
                    Name: r.name, Code: r.code || '',
                    [spec.parent === 'company' ? 'Company' : spec.parent === 'department' ? 'Department' : 'Parent']: r.parentName || '',
                    Note: r.note || '', 'In use': r.inUse, Active: r.active ? 'Yes' : 'No',
                  })))}>
                  Export CSV
                </Button>
              </div>

              <form onSubmit={save} className="p-3.5 border-b border-line grid gap-2.5 sm:grid-cols-12 items-end">
                <div className={spec.parent ? 'sm:col-span-3' : 'sm:col-span-4'}>
                  <Field label="Name" required>
                    <Input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                      placeholder={kind === 'BANK' ? 'e.g. HDFC Bank' : kind === 'GRADE' ? 'e.g. M2' : 'Name'} />
                  </Field>
                </div>
                {spec.parent && (
                  <div className="sm:col-span-3">
                    <Field label={spec.parent === 'company' ? 'Company' : 'Department'} required>
                      <Select value={form.parentRef} onChange={(e) => setForm((s) => ({ ...s, parentRef: e.target.value }))}>
                        <option value="">— choose —</option>
                        {(parentOptions || []).map((o) => (
                          <option key={o.id} value={o.id}>{o.company ? `${o.company} · ${o.name}` : o.name}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}
                {spec.code && (
                  <div className="sm:col-span-2">
                    <Field label={spec.code}>
                      <Input value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} />
                    </Field>
                  </div>
                )}
                <div className={spec.code ? 'sm:col-span-3' : 'sm:col-span-5'}>
                  <Field label="Note">
                    <Input value={form.note} onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))} />
                  </Field>
                </div>
                <div className="sm:col-span-1">
                  <Field label="Order">
                    <Input type="number" value={form.sortOrder}
                      onChange={(e) => setForm((s) => ({ ...s, sortOrder: e.target.value }))} placeholder="100" />
                  </Field>
                </div>
                <div className="sm:col-span-12 flex items-center gap-2.5">
                  <Button type="submit" size="sm" disabled={busy || !form.name.trim()}>
                    {busy ? <Spinner /> : editing ? 'Save changes' : 'Add'}
                  </Button>
                  {editing && <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>}
                </div>
              </form>

              {rows.length === 0 ? (
                <Empty title={`${spec.label} is empty`} subtitle={spec.blurb} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="text-left">Name</th>
                        {spec.code && <th className="text-left w-40">{spec.code}</th>}
                        {spec.parent && <th className="text-left w-56">{spec.parent === 'company' ? 'Company' : 'Department'}</th>}
                        <th className="text-left">Note</th>
                        <th className="num w-24">In use</th>
                        <th className="text-right w-40"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((r) => (
                        <tr key={r.id} className={r.active ? '' : 'opacity-55'}>
                          <td className="px-4 text-ink font-medium">
                            {r.name}
                            {!r.active && <span className="ml-2"><Badge tone="neutral">inactive</Badge></span>}
                          </td>
                          {spec.code && <td className="px-4 font-mono text-[12.5px] text-ink-soft">{r.code || '—'}</td>}
                          {spec.parent && <td className="px-4 text-[12.5px] text-ink-soft">{r.parentName || '—'}</td>}
                          <td className="px-4 text-[12.5px] text-ink-faint">{r.note || '—'}</td>
                          <td className="num px-4 tabular-nums text-ink-soft">{r.inUse}</td>
                          <td className="px-4 text-right whitespace-nowrap">
                            <button
                              onClick={() => { setEditing(r.id); setForm({ name: r.name, code: r.code || '', parentRef: r.parentRef ?? '', note: r.note || '', sortOrder: r.sortOrder ?? '' }); }}
                              className="text-brand-600 text-[12px] font-semibold hover:underline mr-3">Edit</button>
                            <ConfirmClick onConfirm={() => drop(r)} className="text-neg text-[12px] font-semibold">
                              {r.inUse > 0 ? 'Deactivate' : 'Delete'}
                            </ConfirmClick>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-4 py-2.5 border-t border-line text-[11.5px] text-ink-faint">
                    A row that records point at is deactivated rather than deleted — it stays readable on those records
                    but can no longer be picked.
                  </p>
                </div>
              )}
            </Card>
          )}

          <section>
            <h2 className="mb-2.5">Masters that live on their own screen</h2>
            <Card className="overflow-hidden">
              <table className="w-full">
                <tbody className="divide-y divide-line">
                  {(d.elsewhere || []).filter((x) => !x.module || canView(x.module)).map((x) => (
                    <tr key={x.href + x.label}>
                      <td className="px-4 w-72">
                        <Link href={x.href} className="text-brand-600 text-[13px] font-semibold hover:underline">{x.label}</Link>
                      </td>
                      <td className="px-4 text-[12.5px] text-ink-faint">{x.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          {!!(d.missing || []).length && (
            <section>
              <h2 className="mb-2.5">Not built yet</h2>
              <Card className="p-4">
                <ul className="space-y-2">
                  {d.missing.map((x) => (
                    <li key={x.label} className="text-[13px]">
                      <b className="text-ink">{x.label}</b>
                      <span className="text-ink-faint"> — {x.note}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
