'use client';
import { useEffect, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { label } from '@/lib/labels.js';
import { toNumber } from '@/lib/validate.js';
import { Card, Button, Field, Input, Select, Spinner, Badge, ErrorSummary, useConfirm } from '@/components/ui.jsx';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');
const statusText = (s) => (s === 'rejected' ? 'Sent back by HR' : label(s || 'not started'));

export default function EssTaxPage() {
  const [confirm, confirmUi] = useConfirm();
  const [data, setData] = useState(null);
  const [regime, setRegime] = useState('new');
  const [items, setItems] = useState([]);
  const [sections, setSections] = useState([]);
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/me/tax-declaration').then((r) => {
    setData(r); setRegime(r.declaration?.regime || 'new');
    setItems((r.declaration?.items || []).map((i) => ({ id: i.id, section: i.section, description: i.description || '', amount: String(Number(i.declared_amount)), approved: i.approved_amount, proof: i.proof, remark: i.admin_remark })));
  }).catch((e) => { setMsg(e.message); setData({}); });
  useEffect(() => { load(); api.get('/me/tax-declaration/sections').then((r) => setSections(r.sections || [])).catch(() => {}); }, []);

  const status = data?.declaration?.status;
  const locked = status === 'verified' || status === 'submitted';
  const capOf = (code) => sections.find((s) => s.code === code)?.cap ?? null;
  const used = new Set(items.map((i) => i.section));
  const addRow = () => { const free = sections.find((s) => !used.has(s.code)); setItems([...items, { section: free?.code || '80C', description: '', amount: '' }]); };
  const setRow = (i, k, v) => { const n = [...items]; n[i] = { ...n[i], [k]: v }; setItems(n); };
  const delRow = (i) => setItems(items.filter((_, x) => x !== i));

  function validate() {
    const e = {};
    if (!items.length) e.items = 'Add at least one investment with an amount';
    const seen = new Set();
    items.forEach((it, i) => {
      if (seen.has(it.section)) e[`items.${i}.section`] = `Row ${i + 1}: ${it.section} is already declared — put the total in one row`;
      seen.add(it.section);
      const n = toNumber(it.amount); const cap = capOf(it.section);
      if (n === null) e[`items.${i}.amount`] = `Row ${i + 1} (${it.section}) amount is required`;
      else if (Number.isNaN(n)) e[`items.${i}.amount`] = `Row ${i + 1} (${it.section}) amount must be a number`;
      else if (n < 1) e[`items.${i}.amount`] = `Row ${i + 1} (${it.section}) amount must be more than zero`;
      else if (cap && n > cap) e[`items.${i}.amount`] = `Row ${i + 1} (${it.section}) amount cannot be more than ${cap.toLocaleString('en-IN')}`;
    });
    setErrors(e);
    return !Object.keys(e).length;
  }
  async function save(submit) {
    setMsg('');
    if (!validate()) return;
    if (submit && !(await confirm({ title: 'Submit to HR?', body: 'Once submitted, the declaration is locked until HR verifies it or sends it back. Upload your proofs first.', confirmLabel: 'Submit' }))) return;
    setBusy(true);
    try {
      await api.post('/me/tax-declaration', { fy: data.fy, regime, items: items.map((i) => ({ section: i.section, description: i.description, amount: i.amount })) });
      if (submit) await api.post('/me/tax-declaration/submit', { fy: data.fy });
      setMsg(submit ? 'Submitted to HR.' : 'Draft saved. Upload a proof for each investment, then submit.'); load();
    } catch (e) { setErrors(e.fields || {}); setMsg(e.message); } finally { setBusy(false); }
  }
  async function uploadProof(it, file) {
    if (!file) return;
    if (!it.id) { setMsg('Save the draft first, then attach the proof.'); return; }
    if (file.size > 5 * 1024 * 1024) { setMsg('The proof is larger than 5MB.'); return; }
    try {
      const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(file); });
      await api.post(`/me/tax-declaration/items/${it.id}/proof`, { file: b64, mime: file.type, name: file.name });
      setMsg(`Proof attached to ${it.section}.`); load();
    } catch (e) { setMsg(e.message); }
  }

  if (!data) return <Spinner className="text-brand-600 h-6 w-6" />;
  const est = data.estimate || {};
  const blocked = data.hasStructure === false;
  return (
    <div className="space-y-4 max-w-3xl">
      {confirmUi}
      <div>
        <h1 className="page-title text-ink">Investment Declaration</h1>
        <p className="text-ink-faint text-sm mt-0.5">FY {data.fy} · <Badge tone={status === 'verified' ? 'ok' : status === 'submitted' ? 'warn' : status === 'rejected' ? 'danger' : 'neutral'}>{statusText(status)}</Badge> Declare your tax-saving investments so TDS is worked out correctly.</p>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}
      {status === 'rejected' && data.declaration?.remarks && <p className="text-sm text-neg">HR&apos;s note: {data.declaration.remarks}</p>}
      {blocked && <Card className="p-4 text-sm text-crit">Your salary structure has not been set up yet, so tax cannot be worked out. You can declare once HR has set it up.</Card>}

      <Card className="p-4 grid grid-cols-3 gap-3 text-sm">
        <div><div className="text-ink-faint text-xs">Salary for the year</div><div className="font-semibold">₹{inr(data.grossAnnual)}</div>
          {data.projection && data.projection.months < 12 && <div className="text-[11px] text-ink-faint">{data.projection.months} months from your joining date × ₹{inr(data.projection.monthlyCtc)}</div>}</div>
        <div><div className="text-ink-faint text-xs">Old regime tax</div><div className="font-semibold">₹{inr(est.old?.totalTax)}</div></div>
        <div><div className="text-ink-faint text-xs">New regime tax</div><div className="font-semibold">₹{inr(est.new?.totalTax)} {est.recommended && <span className="text-brand-600">({est.recommended === 'old' ? 'old' : 'new'} is lower)</span>}</div></div>
      </Card>

      <Card className="p-4 space-y-3">
        <ErrorSummary errors={errors} />
        <Field label="Tax regime"><Select value={regime} onChange={(e) => setRegime(e.target.value)} disabled={locked || blocked}><option value="new">New regime</option><option value="old">Old regime</option></Select></Field>
        <div className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_140px_auto] gap-2 items-start">
              <Field label={i === 0 ? 'Section' : ''} error={errors[`items.${i}.section`]}>
                <Select value={it.section} disabled={locked} onChange={(e) => setRow(i, 'section', e.target.value)}>
                  {sections.map((s) => <option key={s.code} value={s.code}>{s.code}{s.cap ? ` (max ₹${inr(s.cap)})` : ''}</option>)}
                </Select>
              </Field>
              <Field label={i === 0 ? 'Description' : ''}><Input value={it.description} disabled={locked} onChange={(e) => setRow(i, 'description', e.target.value)} placeholder="e.g. PPF" /></Field>
              <Field label={i === 0 ? 'Amount (₹)' : ''} error={errors[`items.${i}.amount`]}>
                <Input inputMode="decimal" value={it.amount} disabled={locked} onChange={(e) => setRow(i, 'amount', e.target.value)} />
                {it.approved != null && <span className="block text-[11px] text-pos mt-1">Approved ₹{inr(it.approved)}</span>}
              </Field>
              <div className={`${i === 0 ? 'pt-6' : 'pt-1'} text-[12px] whitespace-nowrap`}>
                {it.proof ? <button className="text-brand-700 hover:underline mr-2" onClick={() => downloadFile(`/me/tax-declaration/items/${it.id}/proof`, it.proof.name).catch((e) => setMsg(e.message))}>Proof ✓</button> : null}
                {!locked && it.id && (
                  <label className="cursor-pointer text-brand-700 hover:underline mr-2">{it.proof ? 'Replace' : 'Attach proof'}<input type="file" accept=".pdf,image/png,image/jpeg" className="hidden" onChange={(e) => uploadProof(it, e.target.files?.[0])} /></label>
                )}
                {!locked && !it.id && <span className="text-ink-faint mr-2">Save to attach proof</span>}
                {!locked && <button onClick={() => delRow(i)} className="text-rose-600">Remove</button>}
              </div>
            </div>
          ))}
          {!items.length && <p className="text-sm text-ink-faint">No investments added yet.</p>}
          {!locked && !blocked && used.size < sections.length && <Button size="sm" variant="soft" onClick={addRow}>Add investment</Button>}
        </div>
      </Card>

      {locked ? (
        <p className="text-sm text-ink-soft">{status === 'verified' ? 'HR has verified this declaration; it is locked for the year.' : 'Submitted to HR — locked until HR verifies it or sends it back.'}</p>
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => save(false)} disabled={busy || blocked}>Save draft</Button>
          <Button onClick={() => save(true)} disabled={busy || blocked}>Submit to HR</Button>
        </div>
      )}
    </div>
  );
}
