'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Textarea, Spinner, Empty, ConfirmClick } from '@/components/ui.jsx';

const TABS = ['Business Operations', 'Companies (CTC)', 'Zones', 'Projects', 'Locations', 'Clients / Vendors', 'Expense Hierarchy'];

export default function MastersPage() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-[26px] font-extrabold tracking-tight text-ink">NFA Masters</h1>
        <p className="text-ink-faint text-sm mt-0.5">Master data driving the NFA form&apos;s cascading dropdowns and approver matrix.</p>
      </div>
      <div className="flex gap-1.5 border-b border-line overflow-x-auto">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition-colors ${
              tab === i ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 0 && <SimpleMaster type="business-operations" label="business operation" />}
      {tab === 1 && <SimpleMaster type="group-companies" label="cost-to-company entity" />}
      {tab === 2 && <SimpleMaster type="cost-zones" label="cost approval zone" />}
      {tab === 3 && <Projects />}
      {tab === 4 && <SimpleMaster type="locations" label="location"
        extraFields={[{ key: 'kind', label: 'Kind', options: ['CITY', 'OFFICE', 'CENTER', 'SPECIAL'] }]} />}
      {tab === 5 && <SimpleMaster type="clients-vendors" label="client / vendor"
        extraFields={[{ key: 'type', label: 'Type', options: ['CLIENT', 'VENDOR', 'BOTH'] }]} />}
      {tab === 6 && <ExpenseHierarchy />}
    </div>
  );
}

function useMaster(type) {
  const [rows, setRows] = useState(null);
  const load = () => api.get(`/admin/masters/${type}?all=1`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  return [rows, load];
}

/* ── Generic name(+enum) master ─────────────────────────────────────────── */
function SimpleMaster({ type, label, extraFields = [] }) {
  const [rows, load] = useMaster(type);
  const [name, setName] = useState('');
  const [extra, setExtra] = useState({});
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) { setMsg('Name is required.'); return; }
    setBusy(true); setMsg('');
    try { await api.post(`/admin/masters/${type}`, { name: name.trim(), ...extra }); setName(''); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function toggle(r) { try { await api.put(`/admin/masters/${type}/${r.id}`, { active: !r.active }); load(); } catch (e) { setMsg(e.message); } }
  async function remove(r) {
    try { await api.del(`/admin/masters/${type}/${r.id}`); load(); }
    catch (e) { setMsg(e.message); }
  }

  const filtered = useMemo(() => (rows || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())), [rows, q]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-3">
        <div className="font-semibold text-ink text-sm capitalize">Add {label}</div>
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        {extraFields.map((f) => (
          <Select key={f.key} value={extra[f.key] || f.options[0]} onChange={(e) => setExtra((x) => ({ ...x, [f.key]: e.target.value }))}>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ))}
        <Button onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-line"><Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !filtered.length ? <Empty title="No entries" subtitle="Add the first one on the left." /> : (
          <table className="w-full text-sm">
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className={`px-4 py-2.5 ${r.active ? 'text-ink' : 'text-ink-faint line-through'}`}>{r.name}</td>
                  {extraFields.map((f) => <td key={f.key} className="px-2 py-2.5 text-ink-faint text-xs">{r[f.key]}</td>)}
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => toggle(r)} className="text-xs text-brand-700 hover:underline mr-3">{r.active ? 'Deactivate' : 'Activate'}</button>
                    <ConfirmClick onConfirm={() => remove(r)} confirmLabel="Confirm delete?" className="text-xs text-red-600 hover:underline">Delete</ConfirmClick>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ── Projects (linked to operation + entity) ────────────────────────────── */
function Projects() {
  const [rows, load] = useMaster('projects');
  const [ops] = useMaster('business-operations');
  const [companies] = useMaster('group-companies');
  const [name, setName] = useState('');
  const [opId, setOpId] = useState('');
  const [coId, setCoId] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const opName = (id) => (ops || []).find((o) => o.id === id)?.name || '—';
  const coName = (id) => (companies || []).find((c) => c.id === id)?.name || '—';

  async function add() {
    if (!name.trim()) { setMsg('Name is required.'); return; }
    setBusy(true); setMsg('');
    try {
      await api.post('/admin/masters/projects', {
        name: name.trim(),
        businessOperationId: opId ? Number(opId) : undefined,
        groupCompanyId: coId ? Number(coId) : undefined,
      });
      setName(''); await load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function toggle(r) { try { await api.put(`/admin/masters/projects/${r.id}`, { active: !r.active }); load(); } catch (e) { setMsg(e.message); } }
  async function remove(r) { try { await api.del(`/admin/masters/projects/${r.id}`); load(); } catch (e) { setMsg(e.message); } }

  const filtered = useMemo(() => (rows || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())), [rows, q]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
      <Card className="p-4 space-y-3">
        <div className="font-semibold text-ink text-sm">Add project</div>
        <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={opId} onChange={(e) => setOpId(e.target.value)}>
          <option value="">Business operation (any)</option>
          {(ops || []).filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select value={coId} onChange={(e) => setCoId(e.target.value)}>
          <option value="">Cost-to-company entity (any)</option>
          {(companies || []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Button onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-line"><Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !filtered.length ? <Empty title="No projects" subtitle="Add the first one on the left." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2">Project</th><th className="px-2 py-2">Operation</th><th className="px-2 py-2">Entity</th><th /></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className={`px-4 py-2.5 ${r.active ? 'text-ink' : 'text-ink-faint line-through'}`}>{r.name}</td>
                  <td className="px-2 py-2.5 text-ink-faint text-xs">{opName(r.businessOperationId)}</td>
                  <td className="px-2 py-2.5 text-ink-faint text-xs">{coName(r.groupCompanyId)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => toggle(r)} className="text-xs text-brand-700 hover:underline mr-3">{r.active ? 'Deactivate' : 'Activate'}</button>
                    <ConfirmClick onConfirm={() => remove(r)} confirmLabel="Confirm delete?" className="text-xs text-red-600 hover:underline">Delete</ConfirmClick>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ── Expense hierarchy: Category → Header → SubHeader ───────────────────── */
function ExpenseHierarchy() {
  const [cats, loadCats] = useMaster('expense-categories');
  const [headers, loadHeaders] = useMaster('expense-headers');
  const [subs, loadSubs] = useMaster('expense-subheaders');
  const [catId, setCatId] = useState(null);
  const [hdrId, setHdrId] = useState(null);
  const [msg, setMsg] = useState('');
  const [showImport, setShowImport] = useState(false);
  const reload = () => { loadCats(); loadHeaders(); loadSubs(); };

  const hdrsOfCat = (headers || []).filter((h) => h.categoryId === catId);
  const subsOfHdr = (subs || []).filter((s) => s.headerId === hdrId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-faint">Three-level hierarchy used for NFA line items. Click a category, then a header, to drill down.</p>
        <Button variant="outline" onClick={() => setShowImport((v) => !v)}>{showImport ? 'Close import' : 'Bulk import'}</Button>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {showImport && <ImportBox onDone={() => { reload(); setShowImport(false); }} />}
      <div className="grid md:grid-cols-3 gap-4 items-start">
        <Column title="Categories" rows={cats} selectedId={catId} onSelect={(id) => { setCatId(id); setHdrId(null); }}
          onAdd={(name) => api.post('/admin/masters/expense-categories', { name }).then(reload).catch((e) => setMsg(e.message))}
          type="expense-categories" onChanged={reload} setMsg={setMsg} />
        <Column title={catId ? 'Headers' : 'Headers — select a category'} rows={catId ? hdrsOfCat : []} selectedId={hdrId} onSelect={setHdrId}
          disabled={!catId}
          onAdd={(name) => api.post('/admin/masters/expense-headers', { name, categoryId: catId }).then(reload).catch((e) => setMsg(e.message))}
          type="expense-headers" onChanged={reload} setMsg={setMsg} />
        <Column title={hdrId ? 'Sub-headers' : 'Sub-headers — select a header'} rows={hdrId ? subsOfHdr : []} selectedId={null} onSelect={() => {}}
          disabled={!hdrId}
          onAdd={(name) => api.post('/admin/masters/expense-subheaders', { name, headerId: hdrId }).then(reload).catch((e) => setMsg(e.message))}
          type="expense-subheaders" onChanged={reload} setMsg={setMsg} />
      </div>
    </div>
  );
}

function Column({ title, rows, selectedId, onSelect, onAdd, disabled, type, onChanged, setMsg }) {
  const [name, setName] = useState('');
  async function toggle(r, e) { e.stopPropagation(); try { await api.put(`/admin/masters/${type}/${r.id}`, { active: !r.active }); onChanged(); } catch (er) { setMsg(er.message); } }
  async function remove(r, e) { e.stopPropagation(); try { await api.del(`/admin/masters/${type}/${r.id}`); onChanged(); } catch (er) { setMsg(er.message); } }
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-line font-semibold text-sm text-ink">{title}</div>
      <div className="max-h-[420px] overflow-y-auto">
        {rows === null ? <div className="p-6 flex justify-center"><Spinner /></div> :
          rows.map((r) => (
            <div key={r.id} onClick={() => onSelect(r.id)}
              className={`px-3 py-2 text-sm flex items-center justify-between cursor-pointer border-b border-line last:border-0 ${
                selectedId === r.id ? 'bg-brand-50 text-brand-800' : r.active ? 'text-ink hover:bg-slate-50' : 'text-ink-faint line-through'}`}>
              <span className="truncate pr-2">{r.name}</span>
              <span className="whitespace-nowrap">
                <button onClick={(e) => toggle(r, e)} className="text-[11px] text-brand-700 hover:underline mr-2">{r.active ? 'off' : 'on'}</button>
                <ConfirmClick onConfirm={() => remove(r, { stopPropagation: () => {} })} confirmLabel="sure?" className="text-[11px] text-red-600 hover:underline">del</ConfirmClick>
              </span>
            </div>
          ))}
      </div>
      {!disabled && (
        <div className="p-2 border-t border-line flex gap-2">
          <Input placeholder="Add…" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onAdd(name.trim()); setName(''); } }} />
        </div>
      )}
    </Card>
  );
}

function ImportBox({ onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function run() {
    // Accept "Category | Header | SubHeader" or tab-separated lines (paste from Excel).
    const rows = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const parts = l.includes('|') ? l.split('|') : l.split('\t');
      return { category: (parts[0] || '').trim(), header: (parts[1] || '').trim(), subheader: (parts[2] || '').trim() };
    });
    if (!rows.length) { setMsg('Nothing to import.'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await api.post('/admin/masters/expense-hierarchy/import', { rows });
      setMsg(`Imported — ${r.created.categories} categories, ${r.created.headers} headers, ${r.created.subheaders} sub-headers added.`);
      onDone();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Card className="p-4 space-y-3">
      <p className="text-sm text-ink-faint">Paste rows from the expense-master Excel — one per line: <code>Category | Header | SubHeader</code> (tabs from Excel also work). Existing entries are kept.</p>
      <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'General Administrative Expenses | Utility Expenses | Electricity Bill'} />
      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={busy}>{busy ? 'Importing…' : 'Import'}</Button>
        {msg && <span className="text-sm text-ink-faint">{msg}</span>}
      </div>
    </Card>
  );
}
