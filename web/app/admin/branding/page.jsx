'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, downloadFile } from '@/lib/api.js';
import { Card, Button, Input, Select, Field, Textarea, Spinner, Empty, Badge, PageHeader, ConfirmClick } from '@/components/ui.jsx';

const TABS = [
  ['identity', 'Identity & letterhead'],
  ['marks', 'Logo & signature'],
  ['look', 'Colours & paper'],
  ['offer', 'Offer letter'],
  ['payslip', 'Payslip'],
  ['sheet', 'Bank sheet'],
];
const TEXT_FIELDS = [
  ['legalName', 'Legal name', 'As registered — this is what a letter is signed by'],
  ['brandName', 'Brand name', 'What the letterhead prints; defaults to the legal name'],
  ['addressLine1', 'Address line 1', ''],
  ['addressLine2', 'Address line 2', ''],
  ['city', 'City', ''],
  ['state', 'State', ''],
  ['pincode', 'PIN code', ''],
  ['country', 'Country', ''],
  ['phone', 'Phone', ''],
  ['email', 'Email', ''],
  ['website', 'Website', ''],
  ['gstin', 'GSTIN', ''],
  ['cin', 'CIN', ''],
  ['pan', 'PAN', ''],
  ['signatoryName', 'Signatory name', 'Printed under the signature line'],
  ['signatoryDesignation', 'Signatory designation', ''],
];
const MAX_KB = 512;

// Read a picked file as a data URL, so it travels inside the profile row.
const asDataUrl = (file) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = no;
  r.readAsDataURL(file);
});

export default function BrandingPage() {
  const [scopeId, setScopeId] = useState('');          // '' = organisation default
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [options, setOptions] = useState({});
  const [tab, setTab] = useState('identity');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = (id) => {
    setData(null); setErr(''); setMsg('');
    api.get(`/admin/branding${id ? `?companyId=${id}` : ''}`)
      .then((d) => { setData(d); setForm({ ...d.profile }); setOptions(d.profile.options || {}); })
      .catch((e) => { setErr(e.message); setData(false); });
  };
  useEffect(() => { load(scopeId); /* eslint-disable-next-line */ }, [scopeId]);

  const key = (f, o) => JSON.stringify([TEXT_FIELDS.map(([k]) => f[k] ?? null),
    f.logo || null, f.signatureImage || null, f.accentColor, f.headBg, f.headText, f.paperSize,
    f.footerNote ?? null, f.watermarkText ?? null, o]);
  const dirty = useMemo(
    () => (data ? key(data.profile, data.profile.options || {}) !== key(form, options) : false),
    [data, form, options]);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const setOpt = (group, k, v) => setOptions((s) => ({ ...s, [group]: { ...(s[group] || {}), [k]: v } }));

  async function pick(field, file) {
    if (!file) return;
    setErr('');
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) { setErr('Choose a PNG or JPEG image.'); return; }
    if (file.size > MAX_KB * 1024 * 0.7) { setErr(`That image is too big — keep it under about ${Math.round(MAX_KB * 0.7 / 1024 * 1024)}KB.`); return; }
    try {
      const url = await asDataUrl(file);
      setForm((s) => ({ ...s, [field]: url }));
    } catch { setErr('Could not read that file.'); }
  }

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    const body = { options };
    for (const [k] of TEXT_FIELDS) body[k] = form[k] ?? '';
    for (const k of ['logo', 'signatureImage', 'footerNote', 'watermarkText']) body[k] = form[k] ?? '';
    for (const k of ['accentColor', 'headBg', 'headText', 'paperSize']) body[k] = form[k];
    try {
      const d = await api.put(`/admin/branding${scopeId ? `?companyId=${scopeId}` : ''}`, body);
      setData(d); setForm({ ...d.profile }); setOptions(d.profile.options || {});
      setMsg(scopeId
        ? 'Saved for this company. Documents it issues use these; everything left blank still follows the organisation.'
        : 'Saved for the organisation. Every company follows this unless it has its own override.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function dropOverride() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.del(`/admin/branding?companyId=${scopeId}`);
      setScopeId(''); setData(d); setForm({ ...d.profile }); setOptions(d.profile.options || {});
      setMsg('Company override removed — it follows the organisation again.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const sample = (kind) => downloadFile(
    `/admin/branding/sample/${kind}${scopeId ? `?companyId=${scopeId}` : ''}`,
    `sample-${kind}.pdf`).catch((e) => setErr(e.message));

  const eff = data?.effective;
  const off = options.offer || {};
  const pay = options.payslip || {};
  const bank = options.bankSheet || {};
  const cols = bank.columns || [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Document branding"
        subtitle="The letterhead, colours and wording every PDF carries — offer letters, payslips, HR letters, F&F statements and the information sheet. Set it once for the organisation; override per company only where the legal entities differ."
        action={
          <div className="flex items-end gap-2.5">
            <Field label="Editing">
              <Select value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
                <option value="">Organisation default</option>
                {(data?.companies || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.configured ? ' — overridden' : ''}</option>
                ))}
              </Select>
            </Field>
            <Button disabled={busy || !dirty} onClick={save}>{busy ? <Spinner /> : 'Save'}</Button>
          </div>
        }
      />

      {err && <p className="text-sm text-neg">{err}</p>}
      {msg && <p className="text-sm text-pos">{msg}</p>}

      {data === null ? <Card><div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div></Card>
        : data === false ? null : (
        <>
          <Card className="p-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-[12.5px] text-ink-soft">
                {scopeId
                  ? <>Editing <b className="text-ink">{data.companyName}</b>. Blank fields follow the organisation.</>
                  : <>Editing the <b className="text-ink">organisation default</b>. This is what a company gets unless it overrides.</>}
              </div>
              {!data.profile.configured && <Badge tone="neutral">not configured yet</Badge>}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span className="text-[11.5px] text-ink-faint">Proof-read:</span>
                <Button variant="outline" size="sm" onClick={() => sample('letter')}>Letter</Button>
                <Button variant="outline" size="sm" onClick={() => sample('payslip')}>Payslip</Button>
                <Button variant="outline" size="sm" onClick={() => sample('offer')}>Offer</Button>
                {scopeId && data.profile.configured && (
                  <ConfirmClick onConfirm={dropOverride} className="text-neg text-[12px] font-semibold ml-2">
                    Remove override
                  </ConfirmClick>
                )}
              </div>
            </div>
          </Card>

          {/* What a PDF prints right now, after the fallback chain. */}
          <Card className="p-4">
            <div className="text-[10.5px] font-bold uppercase tracking-[.07em] text-ink-faint mb-2">Letterhead preview</div>
            <div className="rounded border p-4" style={{ borderColor: eff?.accentColor || '#d9dfe7', background: '#fff' }}>
              <div className="flex items-start gap-3">
                {form.logo || eff?.logo
                  ? <img src={form.logo || eff.logo} alt="" className="h-9 w-auto object-contain" />
                  : null}
                <div className="min-w-0">
                  <div className="font-bold text-[16px] tracking-tight uppercase truncate"
                    style={{ color: eff?.headText || '#065f46' }}>
                    {form.brandName || form.legalName || eff?.brandName || '—'}
                  </div>
                  {eff?.addressLine && <div className="text-[11px] text-ink-faint">{eff.addressLine}</div>}
                  {eff?.contactLine && <div className="text-[11px] text-ink-faint">{eff.contactLine}</div>}
                  {eff?.taxLine && <div className="text-[10.5px] text-ink-faint">{eff.taxLine}</div>}
                </div>
              </div>
              <div className="mt-2.5 h-[2px] rounded" style={{ background: eff?.accentColor || '#16a34a' }} />
              {(form.signatoryName || eff?.signatoryName) && (
                <div className="mt-6">
                  {(form.signatureImage || eff?.signatureImage) && (
                    <img src={form.signatureImage || eff.signatureImage} alt="" className="h-8 w-auto object-contain mb-1" />
                  )}
                  <div className="w-40 border-t border-line" />
                  <div className="text-[12px] font-semibold text-ink mt-1">{form.signatoryName || eff.signatoryName}</div>
                  <div className="text-[11px] text-ink-faint">{form.signatoryDesignation || eff?.signatoryDesignation}</div>
                </div>
              )}
              {(form.footerNote || eff?.footerNote) && (
                <div className="mt-4 pt-2 border-t border-line text-[10px] text-ink-faint text-center">
                  {form.footerNote || eff.footerNote}
                </div>
              )}
            </div>
            <p className="text-[11.5px] text-ink-faint mt-2">
              Shows the values that apply after inheritance — unsaved edits to the name, logo and signature appear
              live; the rest updates on save. Use the proof-read buttons above for the real PDF.
            </p>
          </Card>

          <div className="flex flex-wrap gap-1.5">
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`rounded border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  tab === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-soft hover:border-slate-400'}`}>
                {label}
              </button>
            ))}
            {dirty && <span className="ml-1 self-center"><Badge tone="warn">Unsaved</Badge></span>}
          </div>

          {tab === 'identity' && (
            <Card className="p-4">
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {TEXT_FIELDS.map(([k, label, hint]) => (
                  <Field key={k} label={label} hint={hint || undefined}>
                    <Input value={form[k] ?? ''} onChange={set(k)} placeholder={eff?.[k] || ''} />
                  </Field>
                ))}
              </div>
              <p className="text-[11.5px] text-ink-faint mt-3.5">
                A greyed placeholder is what this field inherits. Clear a field to go back to inheriting it.
              </p>
            </Card>
          )}

          {tab === 'marks' && (
            <Card className="p-4 space-y-5">
              {[['logo', 'Logo', 'Printed at the top-left of every document. PNG or JPEG, roughly 400×120 works well.'],
                ['signatureImage', 'Signature', 'Drawn above the signature line on letters and offers.']].map(([k, label, hint]) => (
                <div key={k} className="flex flex-wrap items-start gap-4">
                  <div className="w-48">
                    <div className="text-[12.5px] font-semibold text-ink">{label}</div>
                    <div className="text-[11.5px] text-ink-faint mt-0.5">{hint}</div>
                  </div>
                  <div className="rounded border border-line bg-white p-3 grid place-items-center min-w-[180px] min-h-[64px]">
                    {form[k]
                      ? <img src={form[k]} alt="" className="max-h-12 w-auto object-contain" />
                      : <span className="text-[11.5px] text-ink-faint">
                          {eff?.[k] ? 'inherited' : 'none'}
                        </span>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="inline-flex">
                      <input type="file" accept="image/png,image/jpeg" className="hidden"
                        onChange={(e) => pick(k, e.target.files?.[0])} />
                      <span className="inline-flex items-center rounded border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft cursor-pointer hover:border-brand-600 hover:text-brand-600">
                        Choose image
                      </span>
                    </label>
                    {form[k] && (
                      <button onClick={() => setForm((s) => ({ ...s, [k]: '' }))}
                        className="text-neg text-[12px] font-semibold hover:underline text-left">Remove</button>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-[11.5px] text-ink-faint">
                Images are checked properly before they are stored — a PNG whose data will not decode is refused here
                rather than breaking every PDF later.
              </p>
            </Card>
          )}

          {tab === 'look' && (
            <Card className="p-4">
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {[['accentColor', 'Accent / rule'], ['headBg', 'Header band'], ['headText', 'Header text']].map(([k, label]) => (
                  <Field key={k} label={label}>
                    <div className="flex items-center gap-2">
                      <input type="color" value={form[k] || '#16a34a'} onChange={set(k)}
                        className="h-9 w-12 rounded border border-line bg-white p-0.5 cursor-pointer" />
                      <Input value={form[k] || ''} onChange={set(k)} placeholder="#16a34a" className="font-mono" />
                    </div>
                  </Field>
                ))}
                <Field label="Paper size">
                  <Select value={form.paperSize || 'A4'} onChange={set('paperSize')}>
                    {(data.paperSizes || ['A4']).map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Footer note" hint="Printed small and centred in the bottom margin of every document.">
                    <Input value={form.footerNote ?? ''} onChange={set('footerNote')}
                      placeholder={eff?.footerNote || 'e.g. Registered office · CIN · electronically issued'} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Watermark" hint="Faint diagonal text behind the content. Leave blank for none.">
                    <Input value={form.watermarkText ?? ''} onChange={set('watermarkText')} placeholder="e.g. CONFIDENTIAL" />
                  </Field>
                </div>
              </div>
            </Card>
          )}

          {tab === 'offer' && (
            <Card className="p-4 space-y-3.5">
              <p className="text-[12.5px] text-ink-soft">
                Placeholders you can use: <span className="font-mono text-[11.5px]">{'{{employeeName}} {{designation}} {{department}} {{joiningDate}} {{location}} {{companyName}} {{ctc}}'}</span>
              </p>
              <div className="grid gap-3.5">
                <Field label="Salutation">
                  <Input value={off.salutation ?? ''} onChange={(e) => setOpt('offer', 'salutation', e.target.value)}
                    placeholder={data.defaults.offer.salutation} />
                </Field>
                <Field label="Opening paragraph">
                  <Textarea rows={3} value={off.intro ?? ''} onChange={(e) => setOpt('offer', 'intro', e.target.value)}
                    placeholder={data.defaults.offer.intro} />
                </Field>
                <Field label="Terms" hint="One paragraph per line. Leave empty for the standard wording.">
                  <Textarea rows={5} value={(off.terms || []).join('\n')}
                    onChange={(e) => setOpt('offer', 'terms', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))}
                    placeholder={data.defaults.offer.terms.join('\n')} />
                </Field>
                <Field label="Closing paragraph">
                  <Textarea rows={2} value={off.closing ?? ''} onChange={(e) => setOpt('offer', 'closing', e.target.value)}
                    placeholder={data.defaults.offer.closing} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-4 pt-1">
                {[['showAnnexure', 'Include Annexure A (the CTC break-up page)'],
                  ['showSignature', 'Print the signature block']].map(([k, label]) => (
                  <label key={k} className="inline-flex items-center gap-2 text-[13px] text-ink-soft">
                    <input type="checkbox" checked={off[k] !== false}
                      onChange={(e) => setOpt('offer', k, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
              <p className="text-[11.5px] text-ink-faint">
                Annexure A is built from this company&rsquo;s payslip components, so the offer promises the structure the
                first payslip actually pays.
              </p>
            </Card>
          )}

          {tab === 'payslip' && (
            <Card className="p-4 space-y-3.5">
              <div className="grid gap-2.5">
                {[['showAttendance', 'Days paid / LOP breakdown'],
                  ['showBank', 'Bank name and masked account number'],
                  ['showStatutory', 'UAN and PAN'],
                ].map(([k, label]) => (
                  <label key={k} className="inline-flex items-center gap-2 text-[13px] text-ink-soft">
                    <input type="checkbox" checked={pay[k] !== false}
                      onChange={(e) => setOpt('payslip', k, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
              <Field label="Footnote" hint="Printed at the foot of the payslip.">
                <Input value={pay.note ?? ''} onChange={(e) => setOpt('payslip', 'note', e.target.value)}
                  placeholder={data.defaults.payslip.note} />
              </Field>
            </Card>
          )}

          {tab === 'sheet' && (
            <Card className="p-4 space-y-3.5">
              <p className="text-[12.5px] text-ink-soft">
                The bank advice CSV — which columns, in which order. Banks each want their own format, so this is per
                company. Click to add; drag is not needed, the order is the order you tick them.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(data.bankSheetColumns || []).map((c) => {
                  const on = cols.includes(c.key);
                  return (
                    <button key={c.key}
                      onClick={() => setOpt('bankSheet', 'columns',
                        on ? cols.filter((k) => k !== c.key) : [...cols, c.key])}
                      className={`rounded border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                        on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-soft hover:border-slate-400'}`}>
                      {on ? `${cols.indexOf(c.key) + 1}. ` : '+ '}{c.header}
                    </button>
                  );
                })}
              </div>
              <div className="rounded border border-line bg-canvas p-3 overflow-x-auto">
                <div className="text-[10.5px] font-bold uppercase tracking-[.07em] text-ink-faint mb-1.5">Header row</div>
                <code className="text-[12px] text-ink whitespace-nowrap">
                  {cols.length
                    ? cols.map((k) => (data.bankSheetColumns || []).find((c) => c.key === k)?.header).filter(Boolean).join(',')
                    : '— pick at least one column —'}
                </code>
              </div>
              <button onClick={() => setOpt('bankSheet', 'columns', data.defaults.bankSheet.columns)}
                className="text-brand-600 text-[12px] font-semibold hover:underline text-left">
                Reset to the standard columns
              </button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
