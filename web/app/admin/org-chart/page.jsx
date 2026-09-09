'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Field, Spinner, Empty, Badge, Avatar, PageHeader, StatTile } from '@/components/ui.jsx';
import { downloadCsv } from '@/lib/csv.js';

const LINKS = [
  { key: 'managerId', label: 'Reporting manager' },
  { key: 'functionManagerId', label: 'Functional manager' },
  { key: 'operationalManagerId', label: 'Operational manager' },
];
const STATUS_TONE = { ACTIVE: 'ok', PENDING: 'warn', SUBMITTED: 'warn', APPROVED: 'brand', DRAFT: 'neutral' };

/**
 * Build a forest from a flat employee list.
 * Anyone whose manager is missing, inactive or outside the current filter
 * becomes a root, so nobody is silently dropped. A manager cycle is broken by
 * treating the second visit as a root rather than recursing forever.
 */
function buildForest(people, linkKey) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const kids = new Map();
  const roots = [];
  for (const p of people) {
    const mid = p[linkKey];
    if (mid != null && mid !== p.id && byId.has(mid)) {
      if (!kids.has(mid)) kids.set(mid, []);
      kids.get(mid).push(p);
    } else roots.push(p);
  }
  const seen = new Set();
  const walk = (p, depth) => {
    if (seen.has(p.id) || depth > 12) return { ...p, children: [], truncated: depth > 12 };
    seen.add(p.id);
    const cs = (kids.get(p.id) || []).map((c) => walk(c, depth + 1));
    return { ...p, children: cs };
  };
  return roots.map((r) => walk(r, 0));
}

const maxDepth = (nodes, d = 1) => nodes.reduce((m, x) => Math.max(m, x.children.length ? maxDepth(x.children, d + 1) : d), 0);

function Node({ node, open, toggle, q }) {
  const isOpen = open.has(node.id);
  const has = node.children.length > 0;
  const hit = q && `${node.name} ${node.code || ''} ${node.designation || ''}`.toLowerCase().includes(q);
  return (
    <li>
      <div className={`flex items-center gap-2.5 rounded px-2 py-1.5 ${hit ? 'bg-brand-50 ring-1 ring-inset ring-brand-200' : 'hover:bg-canvas'}`}>
        <button
          onClick={() => toggle(node.id)}
          disabled={!has}
          aria-label={has ? (isOpen ? 'Collapse' : 'Expand') : 'No reports'}
          className={`grid place-items-center h-5 w-5 shrink-0 rounded border text-[11px] font-bold ${
            has ? 'border-line bg-white text-ink-soft hover:border-brand-600 hover:text-brand-600' : 'border-transparent text-transparent'}`}>
          {has ? (isOpen ? '−' : '+') : '·'}
        </button>
        <Avatar name={node.name} size={26} />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink truncate">
            {node.name}
            <span className="text-ink-faint font-mono text-[11px] ml-2">{node.code || '—'}</span>
          </div>
          <div className="text-[11.5px] text-ink-faint truncate">
            {[node.designation, node.department, node.company].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {has && <span className="text-[11px] text-ink-faint tabular-nums">{node.children.length} report{node.children.length === 1 ? '' : 's'}</span>}
          {node.status && node.status !== 'ACTIVE' && <Badge tone={STATUS_TONE[node.status] || 'neutral'}>{node.status}</Badge>}
        </div>
      </div>
      {has && isOpen && (
        <ul className="ml-[18px] border-l border-line pl-3 mt-0.5 space-y-0.5">
          {node.children.map((c) => <Node key={c.id} node={c} open={open} toggle={toggle} q={q} />)}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const [people, setPeople] = useState(null);
  const [link, setLink] = useState('managerId');
  const [company, setCompany] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(new Set());

  useEffect(() => { api.get('/admin/org-chart').then(setPeople).catch(() => setPeople([])); }, []);

  const companies = useMemo(
    () => Array.from(new Set((people || []).map((p) => p.company).filter(Boolean))).sort(),
    [people]);

  const scoped = useMemo(
    () => (people || []).filter((p) => !company || p.company === company),
    [people, company]);

  const forest = useMemo(() => buildForest(scoped, link), [scoped, link]);

  const stats = useMemo(() => {
    const managers = new Set();
    scoped.forEach((p) => { if (p[link] != null) managers.add(p[link]); });
    const orphans = scoped.filter((p) => p[link] == null).length;
    return { total: scoped.length, managers: managers.size, orphans, depth: maxDepth(forest) };
  }, [scoped, link, forest]);

  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allIds = () => { const ids = []; const walk = (ns) => ns.forEach((n) => { ids.push(n.id); walk(n.children); }); walk(forest); return ids; };

  // Expanding to a search hit is the whole point of searching a collapsed tree.
  useEffect(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return;
    const hits = new Set();
    const walk = (nodes, trail) => nodes.forEach((n) => {
      const isHit = `${n.name} ${n.code || ''} ${n.designation || ''}`.toLowerCase().includes(needle);
      if (isHit) trail.forEach((t) => hits.add(t));
      walk(n.children, [...trail, n.id]);
    });
    walk(forest, []);
    if (hits.size) setOpen((s) => new Set([...s, ...hits]));
  }, [q, forest]);

  useEffect(() => {
    // Start with the top two levels open — a fully collapsed chart tells you nothing.
    if (!forest.length) return;
    setOpen(new Set(forest.flatMap((r) => [r.id, ...r.children.map((c) => c.id)])));
  }, [link, company, people]);

  const needle = q.trim().toLowerCase();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Organisation chart"
        subtitle="Reporting lines as they are recorded on each employee. Change the line type to see the functional or operational view."
        action={
          <Button variant="outline" onClick={() => downloadCsv('org-chart.csv', scoped.map((p) => {
            const byId = new Map(scoped.map((x) => [x.id, x]));
            return {
              'Employee ID': p.code || '', Name: p.name, Designation: p.designation || '',
              Department: p.department || '', Company: p.company || '', Status: p.status || '',
              'Reporting manager': byId.get(p.managerId)?.name || '',
              'Functional manager': byId.get(p.functionManagerId)?.name || '',
              'Operational manager': byId.get(p.operationalManagerId)?.name || '',
            };
          }))}>
            Export CSV
          </Button>
        }
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="People in view" value={stats.total} />
        <StatTile label="People with reports" value={stats.managers} tone="neutral" />
        <StatTile label="Chart depth" value={stats.depth} unit="levels" tone="neutral" />
        <StatTile label="No manager set" value={stats.orphans} tone={stats.orphans ? 'warn' : 'ok'}
          caption={stats.orphans ? 'Shown as top-level nodes' : 'Every line is complete'} />
      </div>

      <Card className="p-3.5">
        <div className="flex flex-wrap items-end gap-2.5">
          <Field label="Line type">
            <Select value={link} onChange={(e) => setLink(e.target.value)}>
              {LINKS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </Select>
          </Field>
          <Field label="Company">
            <Select value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">All companies</option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <div className="min-w-[220px] flex-1">
            <Field label="Find a person">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, employee ID or designation" />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(new Set(allIds()))}>Expand all</Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(new Set())}>Collapse all</Button>
          </div>
        </div>
      </Card>

      <Card className="p-3">
        {people === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
          : forest.length === 0 ? <Empty title="Nobody to chart yet" subtitle="Add employees and set their reporting manager to see the structure here." />
          : (
          <ul className="space-y-0.5">
            {forest.map((r) => <Node key={r.id} node={r} open={open} toggle={toggle} q={needle.length >= 2 ? needle : ''} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}
