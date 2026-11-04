'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, openFile } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { Card, Button, Input, Textarea, Spinner, Empty, Modal, Field, useConfirm } from '@/components/ui.jsx';
import { fmtMoney, STAGE_TONE, StatusChip, ChainList, LinesTable, DocList, readFiles, facts } from './NfaParts.jsx';

const FILTERS = ['', 'PENDING', 'QUERY', 'APPROVED', 'PAYMENT_RELEASED', 'REJECTED', 'WITHDRAWN'];

// GreenHR "NFA Report" — my NFAs with settlement actions.
export default function MyNfasPage() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = () => api.get(`/nfa${status ? `?status=${status}` : ''}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title text-ink">My NFAs</h1>
        <Link href="/ess/nfa/create"><Button size="sm">Create NFA</Button></Link>
      </div>
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 text-xs rounded-full border ${status === s ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-line text-ink-soft'}`}>
            {s === '' ? 'All' : label(s)}
          </button>
        ))}
      </div>
      <Card className="p-0 overflow-x-auto">
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !rows.length ? (status
            ? <Empty title="No NFAs with this status" subtitle={`You have no NFAs that are ${label(status).toLowerCase()}.`} />
            : <Empty title="No NFAs yet" subtitle="Create your first NFA to see it here." />) : (
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">NFA No.</th><th className="px-2 py-2.5">Project</th>
              <th className="px-2 py-2.5">Payment type</th><th className="px-2 py-2.5 text-right">Grand total</th>
              <th className="px-2 py-2.5">Raised on</th>
              <th className="px-2 py-2.5">Status</th><th className="px-4 py-2.5">Settlement</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="border-b border-line last:border-0 hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-medium text-brand-700">{r.nfaCode}</td>
                  <td className="px-2 py-2.5">{r.project.name}</td>
                  <td className="px-2 py-2.5 text-xs">{label(r.paymentType)}</td>
                  <td className="px-2 py-2.5 text-right font-medium">{fmtMoney(r.totals.grand)}</td>
                  <td className="px-2 py-2.5 text-xs text-ink-faint">{fmtDate(r.createdAt)}</td>
                  <td className="px-2 py-2.5"><StatusChip d={r} /></td>
                  <td className="px-4 py-2.5 text-xs text-ink-faint">{r.settlementStatus ? label(r.settlementStatus) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {openId && <NfaDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function NfaDetailModal({ id, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirm, confirmUi] = useConfirm();
  const load = () => api.get(`/nfa/${id}`).then(setD).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(list) {
    const { files: got, errors } = await readFiles(list, 'QUERY_REPLY');
    setFiles((x) => [...x, ...got].slice(0, 10));
    setMsg(errors.join('; '));
  }
  async function resubmit() {
    if (!remarks.trim()) { setErr({ remarks: 'Your reply is required' }); return; }
    setBusy(true); setMsg(''); setErr({});
    try { setD(await api.post(`/nfa/${id}/resubmit`, { remarks: remarks.trim(), documents: files })); setRemarks(''); setFiles([]); onChanged(); }
    catch (e) { setErr(e.fields || {}); setMsg(e.message); } finally { setBusy(false); }
  }
  async function withdraw() {
    if (!(await confirm({ title: `Withdraw ${d.nfaCode}?`, tone: 'danger', confirmLabel: 'Withdraw NFA',
      body: 'The NFA is cancelled and removed from every approver\'s queue. This cannot be undone — raise a new NFA if you need it again.' }))) return;
    setBusy(true); setMsg('');
    try { setD(await api.post(`/nfa/${id}/withdraw`, {})); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={d ? `${d.nfaCode} · ${label(d.raiseFor)}` : 'NFA'} size="xl">
      {confirmUi}
      {!d ? <div className="p-6 flex justify-center">{msg ? <p className="text-sm text-red-600">{msg}</p> : <Spinner />}</div> : (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <StatusChip d={d} />
            <span className="text-lg font-semibold">{fmtMoney(d.totals.grand)}</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {facts(d).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1">
                <span className="text-ink-faint">{k}</span><span className="text-right text-ink">{v || '—'}</span>
              </div>
            ))}
          </div>

          <div><div className="font-semibold text-sm mb-1.5">Expense lines</div><LinesTable d={d} /></div>
          <div><div className="font-semibold text-sm mb-1.5">Attachments</div><DocList nfaId={d.id} docs={d.documents} onError={setMsg} /></div>
          {d.approval && <div><div className="font-semibold text-sm mb-1.5">Approval chain</div><ChainList approval={d.approval} /></div>}

          {d.status === 'QUERY' && (
            <div className="space-y-2 border-t border-line pt-3">
              <div className="font-semibold text-sm">Reply to the query and resubmit</div>
              <Field label="Your reply" required error={err.remarks}>
                <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Cab bill attached" />
              </Field>
              <div>
                <input type="file" accept="application/pdf,image/*" multiple
                  className="block w-full text-xs text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
                  onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
                {files.map((f, i) => (
                  <div key={i} className="flex justify-between text-xs border border-line rounded px-2 py-1 mt-1">
                    <span className="truncate">{f.filename}</span>
                    <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="text-rose-600 ml-2">Remove</button>
                  </div>
                ))}
                <p className="text-[11px] text-ink-faint mt-1">Attach the bill or document the approver asked for (PDF/image, max 5MB each).</p>
              </div>
              <Button size="sm" onClick={resubmit} disabled={busy}>{busy ? 'Resubmitting…' : 'Resubmit'}</Button>
            </div>
          )}

          {d.status === 'PAYMENT_RELEASED' && <SettlementBlock nfaId={id} settlementStatus={d.settlementStatus} onChanged={() => { load(); onChanged(); }} />}
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <div className="flex justify-between items-center border-t border-line pt-3">
            {['PENDING', 'QUERY'].includes(d.status)
              ? <Button size="sm" variant="danger" onClick={withdraw} disabled={busy}>Withdraw NFA</Button> : <span />}
            <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Attached bills on a submitted settlement (visible to owner, approvers, staff).
function SettlementDocs({ settlementId }) {
  const [docs, setDocs] = useState([]);
  useEffect(() => { api.get(`/settlements/${settlementId}/documents`).then(setDocs).catch(() => {}); }, [settlementId]);
  if (!docs.length) return null;
  const [err, setErr] = useState('');
  const open = (docId) => openFile(`/settlements/${settlementId}/documents/${docId}`).catch((e) => setErr(e.message));
  return (
    <div className="flex flex-wrap gap-1.5">
      {docs.map((d) => (
        <button key={d.id} onClick={() => open(d.id)}
          className="text-[11px] text-brand-700 bg-brand-50 border border-brand-100 rounded-full px-2.5 py-1 hover:bg-brand-100">
          {d.filename || `Document ${d.id}`}
        </button>
      ))}
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </div>
  );
}

// GreenHR "Submit Your Settlement" / "Check Settlement".
function SettlementBlock({ nfaId, settlementStatus, onChanged }) {
  const [s, setS] = useState(null);
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [files, setFiles] = useState([]); // [{ file, mime, filename }]
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get(`/nfa/${nfaId}/settlement`).then(setS).catch(() => setS(false));
  useEffect(() => { load(); }, [nfaId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickFiles(list) {
    const out = [];
    for (const f of Array.from(list || [])) {
      if (f.size > 5 * 1024 * 1024) { setMsg(`${f.name}: larger than 5MB`); continue; }
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej; r.readAsDataURL(f);
      });
      out.push({ file: b64, mime: f.type, filename: f.name });
    }
    setFiles((x) => [...x, ...out].slice(0, 10));
  }

  async function submit() {
    setBusy(true); setMsg('');
    const n = Number(String(amount).replace(/,/g, ''));
    if (!(n > 0) || Math.round(n * 100) !== n * 100) { setMsg('Enter a settlement amount greater than zero, with at most 2 decimals'); setBusy(false); return; }
    try { await api.post(`/nfa/${nfaId}/settlement`, { amount: n, remarks, documents: files }); setFiles([]); load(); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  const canSubmit = ['PENDING', 'AUTO_REJECTED'].includes(settlementStatus) || s?.status === 'REJECTED';

  return (
    <div className="border-t border-line pt-3 space-y-2">
      <div className="font-semibold text-sm">Settlement <span className="text-xs font-normal text-ink-faint">({settlementStatus ? label(settlementStatus) : '—'})</span></div>
      {settlementStatus === 'AUTO_REJECTED' && <p className="text-xs text-rose-600">Your settlement was auto-rejected by the system — please resubmit.</p>}
      {s && s !== false && s.status !== 'REJECTED' ? (
        <>
          <div className="text-sm flex justify-between"><span className="text-ink-faint">Settlement amount</span><span className="font-medium">{fmtMoney(s.amount)}</span></div>
          <SettlementDocs settlementId={s.id} />
          {s.approval?.chain.map((st) => (
            <div key={st.seq} className="flex justify-between text-xs border border-line rounded px-2.5 py-1">
              <span>{st.seq}. {st.roleLabel || label(st.roleKey)} <span className="text-ink-soft">{st.approver?.name || '—'}</span></span>
              <span className={`font-semibold ${STAGE_TONE[st.status] || ''}`}>{label(st.status)}</span>
            </div>
          ))}
        </>
      ) : canSubmit ? (
        <div className="space-y-2">
          <Input inputMode="decimal" placeholder="Settlement amount (₹)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Textarea rows={1} placeholder="Remarks / expense proof notes" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          <div>
            <input type="file" accept="application/pdf,image/*" multiple
              className="block w-full text-xs text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
              onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
            {files.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex justify-between items-center text-xs text-ink-soft border border-line rounded px-2 py-1">
                    <span className="truncate">{f.filename}</span>
                    <button onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="text-rose-600 shrink-0 ml-2">remove</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-ink-faint mt-1">Attach all supporting bills (PDF/image, max 5MB each).</p>
          </div>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <Button size="sm" onClick={submit} disabled={busy || !amount}>{busy ? 'Submitting…' : 'Submit Your Settlement'}</Button>
        </div>
      ) : <p className="text-xs text-ink-faint">No settlement yet.</p>}
    </div>
  );
}
