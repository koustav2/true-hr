'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Field, Spinner, Empty, Badge, PageHeader, StatTile } from '@/components/ui.jsx';
import { downloadCsv } from '@/lib/csv.js';
import StructureEditor from '@/components/StructureEditor.jsx';

// Grades in this product read like M5 > M4 > … > M1 > L3 > L2 > L1: a letter
// for the track (management above individual contributor) and a number for
// depth within it. Sorting by that is what lets a ladder be built straight from
// the grades HR has already typed, rather than asking them to invent rungs and
// then place every title by hand.
function gradesBySeniority(designations) {
  const seen = new Map();
  for (const d of designations) {
    const g = String(d.grade || '').trim().toUpperCase();
    if (g) seen.set(g, (seen.get(g) || 0) + 1);
  }
  const rank = (g) => {
    const m = /^([A-Z]+)\s*(\d+)?$/.exec(g);
    if (!m) return [99, 0, g];
    const track = m[1] === 'M' ? 0 : m[1] === 'L' ? 1 : 2;   // M first, then L
    return [track, -(parseInt(m[2] || '0', 10)), g];          // higher number = more senior
  };
  return [...seen.keys()].sort((a, b) => {
    const [ta, na, sa] = rank(a); const [tb, nb, sb] = rank(b);
    return ta - tb || na - nb || sa.localeCompare(sb);
  }).map((g) => ({ grade: g, titles: seen.get(g) }));
}

const PRESETS = [
  { label: 'Four rungs', names: ['Board', 'Leadership', 'Management', 'Executive'] },
  { label: 'Five rungs', names: ['Board', 'Leadership', 'Senior Management', 'Management', 'Executive'] },
  { label: 'Grades L1-L6', names: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] },
];

export default function HierarchyPage() {
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);          // the editable ladder
  const [count, setCount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // One ladder, one department list, one designation list for the whole
  // organisation — there is nothing to pick between any more.
  const load = () => {
    setData(null); setErr(''); setMsg('');
    api.get('/admin/hierarchy')
      .then((d) => { setData(d); setRows(d.levels.map((l) => ({ ...l }))); })
      .catch((e) => { setErr(e.message); setData({ levels: [], designations: [], departments: [] }); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Refresh in place after a structure change — no spinner, because blanking the
  // whole page for a one-row edit reads as a crash.
  const refresh = () => {
    api.get('/admin/hierarchy').then((d) => setData(d)).catch((e) => setErr(e.message));
  };

  const dirty = useMemo(() => {
    if (!data) return false;
    const a = JSON.stringify(data.levels.map((l) => [l.id, l.name, l.description || '']));
    const b = JSON.stringify(rows.map((l) => [l.id ?? null, l.name, l.description || '']));
    return a !== b;
  }, [data, rows]);

  const setRow = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => setRows((r) => {
    const n = [...r]; const j = i + d;
    if (j < 0 || j >= n.length) return r;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  function generate() {
    const n = parseInt(count, 10);
    if (!Number.isFinite(n) || n < 1 || n > (data?.maxLevels || 20)) {
      setErr(`Enter a number between 1 and ${data?.maxLevels || 20}.`); return;
    }
    setErr('');
    // Keep whatever is already named; extend or trim to the requested depth.
    setRows((r) => Array.from({ length: n }, (_, i) => r[i] || { name: `L${i + 1}`, description: '' }));
  }

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.put('/admin/hierarchy', {
        levels: rows.map((l) => ({ id: l.id, name: l.name, description: l.description || null })),
      });
      setData(d); setRows(d.levels.map((l) => ({ ...l })));
      setMsg(d.unhooked
        ? `Saved. ${d.unhooked} designation${d.unhooked === 1 ? '' : 's'} lost its level because that rung was removed — reassign below.`
        : 'Hierarchy saved.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function assign(designationId, levelId) {
    setErr('');
    try {
      await api.put(`/admin/designations/${designationId}/level`, { levelId: levelId || null });
      refresh();
    } catch (e) { setErr(e.message); }
  }

  const unassigned = (data?.designations || []).filter((d) => !d.levelId).length;
  const gradeLadder = useMemo(() => gradesBySeniority(data?.designations || []), [data]);
  const ungraded = (data?.designations || []).filter((d) => !String(d.grade || '').trim()).length;

  // One click from "every title says not placed" to a working ladder: make a
  // rung per grade, most senior first, then put every title on its own grade's
  // rung. Saved through the same two endpoints the manual path uses, so there
  // is no second code path to keep honest.
  async function buildFromGrades() {
    if (!gradeLadder.length) { setErr('No grades are set on any designation yet.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const saved = await api.put('/admin/hierarchy', {
        levels: gradeLadder.map((g) => ({
          name: g.grade,
          description: `${g.titles} title${g.titles === 1 ? '' : 's'} on grade ${g.grade}`,
        })),
      });
      const rungOf = new Map(saved.levels.map((l) => [l.name.toUpperCase(), l.id]));
      const placements = (saved.designations || [])
        .map((d) => ({ designationId: d.id, levelId: rungOf.get(String(d.grade || '').trim().toUpperCase()) ?? null }))
        .filter((p) => p.levelId != null);
      const placed = placements.length
        ? await api.put('/admin/designation-levels', { placements })
        : saved;
      setData(placed);
      setRows(placed.levels.map((l) => ({ ...l })));
      setMsg(`Built ${saved.levels.length} rung${saved.levels.length === 1 ? '' : 's'} from the grades and placed `
        + `${placements.length} title${placements.length === 1 ? '' : 's'}.`
        + (ungraded ? ` ${ungraded} title${ungraded === 1 ? ' has' : 's have'} no grade — place those by hand.` : ''));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Organisation hierarchy"
        subtitle={`One ladder for ${data?.organisation || 'the organisation'} — every company in the group shares it. A title sits on a rung, so everybody holding that title inherits the level. Grade is the code on the title itself; level is where it sits here.`}
      />

      {err && <p className="text-sm text-neg">{err}</p>}
      {msg && <p className="text-sm text-pos">{msg}</p>}

      {data === null ? (
        <Card><div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div></Card>
      ) : (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Levels" value={data.levels.length} tone="neutral" />
            <StatTile label="Designations" value={(data.designations || []).length} tone="neutral" />
            <StatTile label="Departments" value={(data.departments || []).length} tone="neutral" />
            <StatTile label="Without a level" value={unassigned} tone={unassigned ? 'warn' : 'ok'}
              caption={unassigned ? 'They will not appear by level in reports' : 'Every title is placed'} />
            <StatTile label="People placed" value={data.levels.reduce((a, l) => a + l.employees, 0)} tone="ok" />
          </div>

          <Card className="p-3.5">
            <div className="flex flex-wrap items-end gap-2.5">
              <Field label="How many levels?" hint={`1 to ${data.maxLevels || 20}`}>
                <Input type="number" min="1" max={data.maxLevels || 20} value={count}
                  onChange={(e) => setCount(e.target.value)} placeholder="e.g. 4" className="w-32" />
              </Field>
              <Button variant="outline" onClick={generate}>Generate rows</Button>
              <span className="text-[11.5px] text-ink-faint mb-2.5">or start from</span>
              {PRESETS.map((p) => (
                <Button key={p.label} variant="ghost" size="sm" className="mb-1"
                  onClick={() => { setCount(String(p.names.length)); setRows(p.names.map((n, i) => ({ ...(rows[i] || {}), name: n }))); }}>
                  {p.label}
                </Button>
              ))}
            </div>
          </Card>

          {gradeLadder.length > 0 && unassigned === (data.designations || []).length && (
            <Card className="p-4 border-warn-line bg-warn-bg/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-ink">
                    No title is on a rung yet, but every title already has a grade.
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink-soft">
                    Build the ladder from those grades — {gradeLadder.map((g) => g.grade).join(' › ')} — and
                    place all {(data.designations || []).length - ungraded} graded titles in one go. Rename or
                    reorder the rungs afterwards if that is not your shape.
                  </p>
                </div>
                <Button onClick={buildFromGrades} disabled={busy} className="shrink-0">
                  {busy ? <Spinner /> : 'Build ladder from grades'}
                </Button>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-canvas">
              <span className="text-[12.5px] font-semibold text-ink-soft">The ladder — level 1 is the top of the house</span>
              <div className="flex items-center gap-2">
                {dirty && <Badge tone="warn">Unsaved</Badge>}
                <Button size="sm" disabled={busy || !rows.length || !dirty} onClick={save}>
                  {busy ? <Spinner /> : 'Save hierarchy'}
                </Button>
              </div>
            </div>
            {rows.length === 0 ? (
              <Empty title="No levels yet"
                subtitle="Say how many rungs this company has and generate the rows, or pick a preset above." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-left w-16">Level</th>
                      <th className="text-left">Name</th>
                      <th className="text-left">Description</th>
                      <th className="num w-28">In use</th>
                      <th className="text-right w-32">Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((l, i) => (
                      <tr key={l.id ?? `new-${i}`}>
                        <td className="px-4 font-mono text-[12.5px] text-ink-soft">L{i + 1}</td>
                        <td className="px-4">
                          <Input value={l.name || ''} onChange={(e) => setRow(i, { name: e.target.value })}
                            placeholder="e.g. Senior Management" />
                        </td>
                        <td className="px-4">
                          <Input value={l.description || ''} onChange={(e) => setRow(i, { description: e.target.value })}
                            placeholder="Optional — who belongs on this rung" />
                        </td>
                        <td className="num px-4 text-[12px] text-ink-faint whitespace-nowrap">
                          {l.id ? `${l.designations || 0} titles · ${l.employees || 0} people` : 'new'}
                        </td>
                        <td className="px-4 text-right whitespace-nowrap">
                          <button onClick={() => move(i, -1)} disabled={i === 0}
                            className="text-brand-600 text-[12px] font-semibold hover:underline disabled:opacity-30 mr-2.5">Up</button>
                          <button onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                            className="text-brand-600 text-[12px] font-semibold hover:underline disabled:opacity-30 mr-2.5">Down</button>
                          <button onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                            className="text-neg text-[12px] font-semibold hover:underline">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-line flex items-center gap-3">
                  <Button variant="outline" size="sm"
                    onClick={() => setRows((r) => [...r, { name: `L${r.length + 1}`, description: '' }])}>
                    Add a level
                  </Button>
                  <span className="text-[11.5px] text-ink-faint">
                    Removing a rung unhooks its designations rather than blocking you — they show as unplaced below.
                  </span>
                </div>
              </div>
            )}
          </Card>

          <section>
            <h2 className="mb-2.5">Designations on the ladder</h2>
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-canvas">
                <span className="text-[12.5px] font-semibold text-ink-soft">
                  Set the rung once per title; every holder inherits it
                  {unassigned > 0 && data.levels.length > 0 && (
                    <span className="ml-2 font-normal text-warn">
                      · {unassigned} still unplaced
                    </span>
                  )}
                </span>
                <Button variant="outline" size="sm" onClick={() => downloadCsv('designation-levels.csv',
                  (data.designations || []).map((d) => ({
                    Designation: d.title, Grade: d.grade || '',
                    Level: data.levels.find((l) => l.id === d.levelId)?.name || '',
                    'Level no': data.levels.find((l) => l.id === d.levelId)?.levelNo || '',
                  })))}>
                  Export CSV
                </Button>
              </div>
              {(data.designations || []).length === 0 ? (
                <Empty title="No designations yet" subtitle="Add them in Structure below, then place each on a rung." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="text-left">Designation</th>
                        <th className="text-left w-24">Grade</th>
                        <th className="text-left w-72">Level</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.designations.map((d) => (
                        <tr key={d.id}>
                          <td className="px-4 text-ink font-medium">{d.title}</td>
                          <td className="px-4 text-ink-faint text-[12.5px]">{d.grade || '—'}</td>
                          <td className="px-4">
                            {data.levels.length === 0 ? (
                              <span className="text-[12.5px] text-ink-faint">
                                No rungs yet — build the ladder above
                              </span>
                            ) : (
                              <Select value={d.levelId ?? ''} onChange={(e) => assign(d.id, e.target.value)}>
                                <option value="">— not placed —</option>
                                {data.levels.map((l) => <option key={l.id} value={l.id}>L{l.levelNo} · {l.name}</option>)}
                              </Select>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </section>

          <section>
            <h2 className="mb-2.5">Structure</h2>
            <p className="mb-2.5 text-[12.5px] text-ink-faint">
              Departments and designations belong to the organisation, so every company in the group draws on the
              same two lists. Anything somebody currently holds cannot be deleted — move those people first.
            </p>
            <div className="grid gap-3.5 lg:grid-cols-2">
              <StructureEditor kind="departments" rows={data.departments || []} onChanged={refresh} />
              <StructureEditor kind="designations" rows={data.designations || []} onChanged={refresh} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
