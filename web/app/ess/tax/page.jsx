'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Field, Input, Select, Spinner } from '@/components/ui.jsx';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

export default function EssTaxPage() {
  const [data, setData] = useState(null);
  const [regime, setRegime] = useState('new');
  const [items, setItems] = useState([]);
  const [sections, setSections] = useState([]);
  const [msg, setMsg] = useState('');

  const load = () => api.get('/me/tax-declaration').then((r) => {
    setData(r); setRegime(r.declaration?.regime || 'new');
    setItems((r.declaration?.items || []).map((i) => ({ section: i.section, amount: i.declared_amount })));
  }).catch((e) => { setMsg(e.message); setData({}); });
  useEffect(() => { load(); api.get('/me/tax-declaration/sections').then((r) => setSections(r.sections || [])).catch(() => {}); }, []);

  const locked = data?.declaration?.status === 'verified';
  const addRow = () => setItems([...items, { section: '80C', amount: '' }]);
  const setRow = (i, k, v) => { const n = [...items]; n[i] = { ...n[i], [k]: v }; setItems(n); };
  const delRow = (i) => setItems(items.filter((_, x) => x !== i));

  async function save(submit) {
    try {
      await api.post('/me/tax-declaration', { fy: data.fy, regime, items });
      if (submit) await api.post('/me/tax-declaration/submit', { fy: data.fy });
      setMsg(submit ? 'Submitted to HR.' : 'Saved.'); load();
    } catch (e) { setMsg(e.message); }
  }

  if (!data) return <Spinner className="text-brand-600 h-6 w-6" />;
  const est = data.estimate || {};
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">Investment Declaration</h1>
        <p className="text-ink-faint text-sm mt-0.5">FY {data.fy} · status: <b>{data.declaration?.status || 'not started'}</b>. Declare your tax-saving investments so TDS is computed correctly.</p>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}

      <Card className="p-4 grid grid-cols-3 gap-3 text-sm">
        <div><div className="text-ink-faint text-xs">Gross annual</div><div className="font-semibold">₹{inr(data.grossAnnual)}</div></div>
        <div><div className="text-ink-faint text-xs">Old regime tax</div><div className="font-semibold">₹{inr(est.old?.totalTax)}</div></div>
        <div><div className="text-ink-faint text-xs">New regime tax</div><div className="font-semibold">₹{inr(est.new?.totalTax)} {est.recommended && <span className="text-brand-600">({est.recommended} better)</span>}</div></div>
      </Card>

      <Card className="p-4 space-y-3">
        <Field label="Tax regime"><Select value={regime} onChange={(e) => setRegime(e.target.value)} disabled={locked}><option value="new">New regime</option><option value="old">Old regime</option></Select></Field>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex gap-2 items-end">
              <div className="flex-1"><Field label={i === 0 ? 'Section' : ''}><Select value={it.section} disabled={locked} onChange={(e) => setRow(i, 'section', e.target.value)}>{sections.map((s) => <option key={s.code} value={s.code}>{s.code}{s.cap ? ` (max ₹${inr(s.cap)})` : ''}</option>)}</Select></Field></div>
              <div className="flex-1"><Field label={i === 0 ? 'Amount' : ''}><Input type="number" value={it.amount} disabled={locked} onChange={(e) => setRow(i, 'amount', e.target.value)} /></Field></div>
              {!locked && <button onClick={() => delRow(i)} className="text-rose-600 pb-2.5">✕</button>}
            </div>
          ))}
          {!locked && <Button size="sm" variant="soft" onClick={addRow}>Add investment</Button>}
        </div>
      </Card>

      {!locked && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => save(false)}>Save draft</Button>
          <Button onClick={() => save(true)}>Submit to HR</Button>
        </div>
      )}
    </div>
  );
}
