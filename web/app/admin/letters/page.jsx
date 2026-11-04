'use client';
import { useEffect, useState } from 'react';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate, todayIso } from '@/lib/labels.js';
import { validator, addYears, toNumber } from '@/lib/validate.js';
import { Card, Button, Field, Input, Textarea, Select, Modal, Spinner, Empty, Badge, SearchPicker, ErrorSummary, useConfirm } from '@/components/ui.jsx';

const day = (v) => fmtDate(v ? String(v).slice(0, 10) : null);
const RULE_HINT = {
  EXIT: 'Only employees whose resignation or termination has been approved.',
  EXIT_OR_ACTIVE: 'Current employees, or those with an approved exit.',
  REVISION: 'Only employees with an applied revision under Increments — the letter is filled in from it.',
  ACTIVE: 'Current employees only.',
};

export default function LettersPage() {
  const [confirm, confirmUi] = useConfirm();
  const [tab, setTab] = useState('issued');
  const [types, setTypes] = useState(null);
  const [issued, setIssued] = useState([]);
  const [requests, setRequests] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [emps, setEmps] = useState([]);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [empId, setEmpId] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [requestId, setRequestId] = useState(null);
  const [pre, setPre] = useState(null);
  const [extra, setExtra] = useState({});
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revokeRow, setRevokeRow] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const [declineRow, setDeclineRow] = useState(null);

  const load = () => {
    api.get('/admin/letters/types').then(setTypes).catch(() => setTypes({ builtin: [], custom: [] }));
    api.get('/admin/letters/issued').then((r) => setIssued(r.letters || [])).catch((e) => setMsg(e.message));
    api.get('/admin/letter-requests').then((r) => setRequests(r.requests || [])).catch(() => setRequests([]));
  };
  useEffect(() => { load(); api.get('/meta/designations').then((r) => setDesignations(Array.isArray(r) ? r : [])).catch(() => {}); }, []);

  const allTypes = types ? [...(types.builtin || []), ...(types.custom || [])] : [];
  const chosen = allTypes.find((t) => t.code === typeCode);
  const fields = (chosen?.fieldTypes || []).filter((f) => f.kind !== 'auto');
  const locked = pre?.locked || [];

  // H96/H99: the employee list follows the letter type's rule.
  useEffect(() => {
    setEmps([]);
    if (!typeCode) return;
    api.get(`/admin/letters/employees?typeCode=${encodeURIComponent(typeCode)}`).then((r) => setEmps(Array.isArray(r) ? r : [])).catch(() => setEmps([]));
  }, [typeCode]);
  // Pre-fill from the employee record, the approved exit or the applied revision.
  useEffect(() => {
    setPre(null); setPreview(null);
    if (!empId || !typeCode || !chosen) return;
    const q = chosen.custom ? `templateId=${chosen.id}` : `typeCode=${typeCode}`;
    api.get(`/admin/letters/prefill?employeeId=${empId}&${q}`).then((p) => {
      setPre(p);
      setExtra(Object.fromEntries(fields.map((f) => [f.key, p.values[f.key] != null ? String(p.values[f.key]) : ''])));
    }).catch((e) => setErrors({ form: e.message }));
    // eslint-disable-next-line
  }, [empId, typeCode]);

  function startIssue(req = null) {
    setOpen(true); setPreview(null); setErrors({}); setExtra({}); setPre(null);
    setRequestId(req?.id || null);
    setTypeCode(req && allTypes.some((t) => t.code === req.type_code) ? req.type_code : '');
    setEmpId(req ? String(req.employee_id) : '');
  }

  function validate() {
    const v = validator();
    v.require('typeCode', typeCode, 'Letter type');
    v.require('employeeId', empId, 'Employee');
    for (const f of fields) {
      if (locked.includes(f.key)) continue;
      const val = extra[f.key];
      if (f.kind === 'date') v.date(f.key, val, f.label, { required: true, min: '2000-01-01', max: addYears(todayIso(), 1) });
      else if (f.kind === 'money') v.number(f.key, val, f.label, { required: true, min: 1, max: 1000000000 });
      else if (f.kind === 'name') v.name(f.key, val, f.label, { required: true });
      else if (f.kind === 'designation' || f.kind === 'choice') v.require(f.key, val, f.label);
      else v.text(f.key, val, f.label, { required: true, min: 2, max: 300 });
    }
    return v;
  }
  async function issue() {
    const v = validate();
    setErrors(v.fields);
    if (!v.ok) return;
    if (pre && !pre.eligible) { setErrors({ employeeId: pre.reason }); return; }
    if (!(await confirm({ title: `Issue ${chosen.title}?`, body: 'The letter is stored with the next reference number and the employee can download it.', confirmLabel: 'Issue' }))) return;
    setBusy(true);
    try {
      const data = Object.fromEntries(Object.entries(extra).filter(([k]) => !locked.includes(k)));
      const r = await api.post('/admin/letters/issue', { employeeId: Number(empId), ...(chosen.custom ? { templateId: chosen.id } : { typeCode }), data, requestId: requestId || undefined });
      setPreview(r); load();
    } catch (e) { setErrors(e.fields || { form: e.message }); } finally { setBusy(false); }
  }
  async function revoke() {
    if (reason.trim().length < 5) { setReasonErr('Give a reason (at least 5 characters)'); return; }
    try { await api.post(`/admin/letters/${revokeRow.id}/revoke`, { reason: reason.trim() }); setRevokeRow(null); load(); }
    catch (e) { setReasonErr(e.fields?.reason || e.message); }
  }
  async function decline() {
    if (reason.trim().length < 5) { setReasonErr('Tell the employee why (at least 5 characters)'); return; }
    try { await api.post(`/admin/letter-requests/${declineRow.id}/decide`, { action: 'REJECT', note: reason.trim() }); setDeclineRow(null); load(); }
    catch (e) { setReasonErr(e.fields?.note || e.message); }
  }
  const pdf = (id) => openFile(`/admin/letters/${id}/pdf`).catch((e) => setMsg(e.message));
  const pending = requests.filter((r) => r.status === 'PENDING').length;

  function input(f) {
    const dis = locked.includes(f.key);
    const val = extra[f.key] ?? '';
    const on = (x) => setExtra({ ...extra, [f.key]: x });
    if (f.kind === 'date') return <Input type="date" disabled={dis} min="2000-01-01" max={addYears(todayIso(), 1)} value={String(val).slice(0, 10)} onChange={(e) => on(e.target.value)} />;
    if (f.kind === 'money') return <Input inputMode="decimal" disabled={dis} value={val} onChange={(e) => on(e.target.value)} placeholder="e.g. 6,00,000" />;
    if (f.kind === 'designation') return <Select disabled={dis} value={val} onChange={(e) => on(e.target.value)}><option value="">— choose —</option>{designations.map((d) => <option key={d.id} value={d.title || d.name}>{d.title || d.name}</option>)}{dis && val && !designations.some((d) => (d.title || d.name) === val) && <option value={val}>{val}</option>}</Select>;
    if (f.kind === 'choice') return <Select disabled={dis} value={val} onChange={(e) => on(e.target.value)}><option value="">— choose —</option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</Select>;
    return <Input disabled={dis} value={val} onChange={(e) => on(e.target.value)} />;
  }

  return (
    <div className="space-y-5">
      {confirmUi}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-ink">Letters</h1>
          <p className="text-ink-faint text-sm mt-0.5">Issue confirmation, transfer, promotion, experience, relieving and other letters from templates, and handle employees&apos; letter requests.</p>
        </div>
        <Button onClick={() => startIssue()}>Issue a letter</Button>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}

      <div className="flex gap-1.5">
        {[['issued', 'Issued letters'], ['requests', `Requests${pending ? ` (${pending})` : ''}`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded border px-3 py-1.5 text-[12.5px] font-semibold ${tab === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-soft'}`}>{l}</button>
        ))}
      </div>

      {tab === 'issued' ? (
        <Card className="overflow-hidden">
          {types === null ? <div className="p-10 grid place-items-center"><Spinner className="text-brand-600 h-6 w-6" /></div>
            : issued.length === 0 ? <Empty title="No letters issued yet" subtitle="Issued letters are kept here with their reference number." />
            : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['Ref', 'Letter', 'Employee', 'Issued', 'Status', ''].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {issued.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-[12px]">{l.ref_no}</td>
                    <td className="px-4 py-3">{l.title}</td>
                    <td className="px-4 py-3">{`${l.first_name || ''} ${l.last_name || ''}`} <span className="text-ink-faint">{l.employee_code}</span></td>
                    <td className="px-4 py-3 text-ink-faint">{day(l.issued_at)}</td>
                    <td className="px-4 py-3">{l.status === 'REVOKED' ? <span title={l.revoke_reason || ''}><Badge tone="danger">Revoked</Badge></span> : <Badge tone="ok">Issued</Badge>}</td>
                    <td className="px-4 py-3 whitespace-nowrap space-x-3">
                      <button onClick={() => pdf(l.id)} className="text-brand-700 font-medium">PDF</button>
                      {l.status !== 'REVOKED' && <button onClick={() => { setRevokeRow(l); setReason(''); setReasonErr(''); }} className="text-rose-600 font-medium">Revoke</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {requests.length === 0 ? <Empty title="No letter requests" subtitle="Requests employees raise from My Letters appear here." /> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-ink-faint border-b border-line"><tr>{['Employee', 'Letter', 'Purpose', 'Raised', 'Status', ''].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">{`${r.first_name} ${r.last_name}`} <span className="text-ink-faint">{r.employee_code}</span></td>
                    <td className="px-4 py-3">{r.typeLabel}</td>
                    <td className="px-4 py-3 max-w-[280px]">{r.purpose}</td>
                    <td className="px-4 py-3 text-ink-faint">{day(r.created_at)}</td>
                    <td className="px-4 py-3"><Badge tone={r.status === 'PENDING' ? 'warn' : r.status === 'ISSUED' ? 'ok' : 'neutral'}>{label(r.status)}</Badge>{r.ref_no && <div className="text-[11px] text-ink-faint font-mono">{r.ref_no}</div>}{r.hr_note && <div className="text-[11px] text-ink-faint">{r.hr_note}</div>}</td>
                    <td className="px-4 py-3 whitespace-nowrap space-x-3">
                      {r.status === 'PENDING' && <button onClick={() => startIssue(r)} className="text-brand-700 font-medium">Issue</button>}
                      {r.status === 'PENDING' && <button onClick={() => { setDeclineRow(r); setReason(''); setReasonErr(''); }} className="text-rose-600 font-medium">Decline</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Issue a letter" size="lg"
        actions={<><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>{!preview && <Button onClick={issue} disabled={busy || (pre && !pre.eligible)}>{busy ? <Spinner /> : 'Generate'}</Button>}</>}>
        {preview ? (
          <div className="rounded-xl border border-line bg-slate-50 p-4">
            <div className="text-[13px] font-semibold text-ink mb-1">{preview.title} · {preview.letter?.ref_no}</div>
            <pre className="whitespace-pre-wrap text-[12px] text-ink-soft font-sans">{preview.text}</pre>
            <div className="mt-3"><Button size="sm" onClick={() => pdf(preview.letter.id)}>Open PDF</Button></div>
          </div>
        ) : (
          <div className="space-y-4">
            <ErrorSummary errors={errors} />
            <Field label="Letter type" required error={errors.typeCode} hint={chosen ? RULE_HINT[chosen.rule] : null}>
              <Select value={typeCode} onChange={(e) => { setTypeCode(e.target.value); setEmpId(''); setExtra({}); }}>
                <option value="">Select a type…</option>
                {allTypes.map((t) => <option key={`${t.custom ? 'c' : 'b'}${t.code}${t.id || ''}`} value={t.code}>{t.title}{t.custom ? ' (custom)' : ''}</option>)}
              </Select>
            </Field>
            {typeCode && (
              <Field label="Employee" required error={errors.employeeId} hint={emps.length ? null : 'Nobody is eligible for this letter right now'}>
                <SearchPicker value={empId} onChange={setEmpId} options={emps} getLabel={(e) => `${e.name} (${e.code})`} />
              </Field>
            )}
            {pre && !pre.eligible && <p className="text-[12.5px] text-neg">{pre.reason}</p>}
            {pre?.eligible && (
              <>
                <p className="text-[12px] text-ink-faint">Name, employee ID, designation, department and joining date come from the employee record{locked.length ? '; greyed fields come from the approved exit or applied revision' : ''}.</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {fields.map((f) => <Field key={f.key} label={f.label} required error={errors[f.key]}>{input(f)}</Field>)}
                </div>
                {fields.some((f) => f.kind === 'money') && extra.revisedCtc && <p className="text-[12px] text-ink-faint">Prints as INR {Number(toNumber(extra.revisedCtc) || 0).toLocaleString('en-IN')}</p>}
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!revokeRow || !!declineRow} onClose={() => { setRevokeRow(null); setDeclineRow(null); }} tone="danger"
        title={revokeRow ? `Revoke ${revokeRow.ref_no}?` : `Decline ${declineRow?.first_name || ''}'s request?`}
        actions={<><Button variant="ghost" onClick={() => { setRevokeRow(null); setDeclineRow(null); }}>Cancel</Button><Button variant="danger" onClick={revokeRow ? revoke : decline}>{revokeRow ? 'Revoke letter' : 'Decline request'}</Button></>}>
        <p className="mb-3">{revokeRow ? 'The letter stays on record marked revoked; its PDF is stamped REVOKED.' : 'The employee sees your reason on My Letters.'}</p>
        <Field label="Reason" required error={reasonErr}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
