'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api.js';
import { label, fmtDate } from '@/lib/labels.js';
import { Card, Button, Input, Select, Textarea, Spinner, Empty, Modal, useConfirm } from '@/components/ui.jsx';
import { fmtMoney, StatusChip as Chip, ChainList, LinesTable, DocList, facts, STAGE_TONE, stageName } from '@/app/ess/nfa/NfaParts.jsx';

const STATUSES = ['PENDING', 'QUERY', 'APPROVED', 'PAYMENT_RELEASED', 'REJECTED', 'WITHDRAWN'];
const PAYMENT_TYPES = ['ADVANCE_SELF', 'ADVANCE_VENDOR', 'REIMB_SELF', 'REIMB_VENDOR', 'PPS_CANDIDATE', 'INCENTIVE'];


// The HR dashboard deep-links here with ?status= (and ?tab=); useSearchParams
// needs a Suspense boundary on a client page.
export default function NfaAdminPage() {
  return <Suspense fallback={null}><NfaAdmin /></Suspense>;
}

// Nearest queue filter for a status from a link (?status=…).
function nfaStatusFrom(v) {
  const s = String(v || '').toUpperCase();
  if (STATUSES.includes(s)) return s;
  if (['QUERY_HOLD', 'ON_QUERY', 'HOLD'].includes(s)) return 'QUERY';
  if (['PAID', 'RELEASED'].includes(s)) return 'PAYMENT_RELEASED';
  if (['CANCELLED'].includes(s)) return 'WITHDRAWN';
  if (['IN_PROGRESS', 'WAITING'].includes(s)) return 'PENDING';
  return '';
}

function NfaAdmin() {
  const sp = useSearchParams();
  const [rows, setRows] = useState(null);
  const [masters, setMasters] = useState(null);
  const [f, setF] = useState(() => ({ status: nfaStatusFrom(sp.get('status')), q: '', projectId: '', companyId: '', paymentType: '' }));
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState('');

  const load = () => {
    const qs = Object.entries(f).filter(([, v]) => String(v).trim()).map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim())}`).join('&');
    api.get(`/admin/nfa${qs ? `?${qs}` : ''}`).then(setRows).catch((e) => { setRows([]); setMsg(e.message); });
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/meta/nfa-masters').then(setMasters).catch(() => {}); }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title text-ink">NFA — Note For Approval</h1>
        <p className="text-ink-faint text-sm mt-0.5">Expense / advance requests, approval chains and payment release.</p>
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-end">
        <div className="w-44"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select></div>
        <div className="w-48"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
          <option value="">All projects</option>
          {(masters?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select></div>
        <div className="w-48"><Select value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
          <option value="">All entities</option>
          {(masters?.groupCompanies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select></div>
        <div className="w-44"><Select value={f.paymentType} onChange={(e) => setF({ ...f, paymentType: e.target.value })}>
          <option value="">All payment types</option>
          {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </Select></div>
        <div className="flex-1 min-w-[180px]"><Input placeholder="Search NFA code / employee…" value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value.trimStart() })} onKeyDown={(e) => e.key === 'Enter' && load()} /></div>
        <Button onClick={load}>Filter</Button>
      </Card>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <Card className="p-0 overflow-x-auto">
        {!rows ? <div className="p-10 flex justify-center"><Spinner /></div> :
          !rows.length ? <Empty title="No NFAs found" subtitle="No NFA matches the current filters." /> : (
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-xs text-ink-faint border-b border-line">
                <th className="px-4 py-2.5">NFA No.</th><th className="px-2 py-2.5">Employee</th>
                <th className="px-2 py-2.5">Project</th><th className="px-2 py-2.5">Category</th>
                <th className="px-2 py-2.5">Payment</th><th className="px-2 py-2.5 text-right">Grand Total</th>
                <th className="px-2 py-2.5">Raised</th><th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="border-b border-line last:border-0 hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-medium text-brand-700">{r.nfaCode}</td>
                  <td className="px-2 py-2.5">{r.employee.name}<span className="text-ink-faint text-xs ml-1">{r.employee.employeeCode}</span></td>
                  <td className="px-2 py-2.5">{r.project.name}</td>
                  <td className="px-2 py-2.5 text-ink-soft">{r.expenseCategory.name}</td>
                  <td className="px-2 py-2.5 text-xs">{label(r.paymentType)}</td>
                  <td className="px-2 py-2.5 text-right font-medium">{fmtMoney(r.totals.grand)}</td>
                  <td className="px-2 py-2.5 text-ink-faint text-xs">{fmtDate(r.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <Chip d={r} />
                    {r.settlementStatus && <div className="mt-1 text-[10px] text-ink-faint">Settlement: {label(r.settlementStatus)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {openId && <NfaDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function SettlementBlock({ nfaId, settlementStatus, onChanged }) {
  const [confirm, confirmUi] = useConfirm();
  const [s, setS] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get(`/nfa/${nfaId}/settlement`).then(setS).catch(() => setS(false));
  useEffect(() => { load(); }, [nfaId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action) {
    if (action !== 'APPROVED' && !remarks.trim()) { setMsg('Remarks are required to query or reject a settlement.'); return; }
    if (action === 'APPROVED' && !(await confirm({
      title: 'Approve this settlement stage?',
      body: `Settlement of ${fmtMoney(s.amount)}. If you are not the stage approver this is recorded as an HR override under your name.`,
      confirmLabel: 'Approve',
    }))) return;
    if (action === 'REJECTED' && !(await confirm({ title: 'Reject this settlement?', body: 'The employee will have to resubmit it.', confirmLabel: 'Reject', tone: 'danger' }))) return;
    setBusy(true); setMsg('');
    try { await api.post(`/settlements/${s.id}/act`, { action, remarks }); setRemarks(''); load(); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-line pt-3">
      {confirmUi}
      <div className="font-semibold text-sm mb-1.5">Settlement <span className="text-xs font-normal text-ink-faint">({settlementStatus ? label(settlementStatus) : '—'})</span></div>
      {s === null ? <Spinner /> : s === false ? (
        <p className="text-sm text-ink-faint">Not submitted yet{settlementStatus === 'AUTO_REJECTED' ? ' — auto-rejected by the system; the employee must resubmit from the app.' : '.'}</p>
      ) : (
        <div className="space-y-2">
          <div className="text-sm flex justify-between"><span className="text-ink-faint">Settlement amount</span><span className="font-medium">{fmtMoney(s.amount)}</span></div>
          {s.remarks && <p className="text-xs text-ink-faint">“{s.remarks}”</p>}
          {s.approval && (
            <div className="space-y-1">
              {s.approval.chain.map((st) => (
                <div key={st.seq} className="flex items-center justify-between text-xs border border-line rounded px-2.5 py-1">
                  <span>{st.seq}. {stageName(st)} <span className="text-ink-soft ml-1">{st.approver?.name || '—'}</span></span>
                  <span className={`font-semibold ${STAGE_TONE[st.status] || ''}`}>{label(st.status)}</span>
                </div>
              ))}
            </div>
          )}
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          {s.status === 'IN_PROGRESS' && (
            <div className="space-y-1.5">
              <Textarea rows={1} placeholder="Remarks…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => act('APPROVED')} disabled={busy}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => act('QUERY_HOLD')} disabled={busy}>Query</Button>
                <Button size="sm" variant="danger" onClick={() => act('REJECTED')} disabled={busy}>Reject</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NfaDetail({ id, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirm, confirmUi] = useConfirm();

  const load = () => api.get(`/nfa/${id}`).then(setD).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = d?.approval?.chain.find((s) => s.seq === d.approval.currentStageSeq);
  const isApprover = !!d?.viewerIsCurrentApprover;
  const later = d?.approval ? d.approval.chain.filter((s) => s.seq > d.approval.currentStageSeq && !s.approver) : [];

  async function act(action) {
    if ((action === 'REJECTED' || action === 'QUERY_HOLD') && !remarks.trim()) { setMsg('Remarks are required to reject or raise a query.'); return; }
    const verb = { APPROVED: 'Approve', REJECTED: 'Reject', QUERY_HOLD: 'Raise a query on' }[action];
    // C32: an override is never silent — say whose stage it is and what it skips.
    const body = isApprover ? `You are the ${stageName(current)} approver for ${d.nfaCode}.` : (
      <div className="space-y-2">
        <p>You are not the approver for this stage. This is an <b>HR override</b> of the {current ? stageName(current) : 'current'} stage
          {current?.approver ? <> (approver: {current.approver.name})</> : <> (no approver assigned)</>} and will be recorded under your name.</p>
        {action === 'APPROVED' && !!later.length && (
          <p>Later stages with no approver will then be skipped automatically: {later.map(stageName).join(', ')}.</p>
        )}
      </div>
    );
    if (!(await confirm({ title: `${verb} ${d.nfaCode}?`, body, confirmLabel: verb, tone: action === 'APPROVED' ? 'brand' : 'danger' }))) return;
    setBusy(true); setMsg('');
    try { setD(await api.post(`/nfa/${id}/act`, { action, remarks: remarks.trim() })); setRemarks(''); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function release() {
    if (!(await confirm({ title: `Release payment for ${d.nfaCode}?`, confirmLabel: 'Release payment',
      body: `${fmtMoney(d.totals.grand)} is marked as paid to ${d.employee.name} and the settlement window opens. This cannot be undone.` }))) return;
    setBusy(true); setMsg('');
    try { setD(await api.post(`/nfa/${id}/release-payment`)); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={d ? `${d.nfaCode} — ${d.employee.name}` : 'NFA'} size="xl">
      {confirmUi}
      {!d ? <div className="p-8 flex justify-center">{msg ? <p className="text-sm text-red-600">{msg}</p> : <Spinner />}</div> : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Chip d={d} />
            <span className="text-lg font-semibold">{fmtMoney(d.totals.grand)}</span>
          </div>

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {facts(d).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1">
                <span className="text-ink-faint">{k}</span><span className="text-ink text-right">{v || '—'}</span>
              </div>
            ))}
          </div>

          <div><div className="font-semibold text-sm mb-1.5">Expense lines</div><LinesTable d={d} /></div>
          <div><div className="font-semibold text-sm mb-1.5">Attachments</div><DocList nfaId={d.id} docs={d.documents} onError={setMsg} /></div>
          {d.approval && <div><div className="font-semibold text-sm mb-1.5">Approval chain</div><ChainList approval={d.approval} /></div>}

          {d.status === 'PAYMENT_RELEASED' && <SettlementBlock nfaId={id} settlementStatus={d.settlementStatus} onChanged={() => { load(); onChanged(); }} />}

          {msg && <p className="text-sm text-red-600">{msg}</p>}

          {d.status === 'QUERY' && (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-sm text-sky-800">Waiting for {d.employee.name} to reply to the query. The chain resumes at the querying stage once they resubmit.</p>
              <Textarea rows={2} placeholder="Reason (required to close it as rejected)…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              <Button variant="danger" size="sm" onClick={() => act('REJECTED')} disabled={busy}>Reject without waiting</Button>
            </div>
          )}

          {['PENDING', 'APPROVED'].includes(d.status) && (
            <div className="space-y-2 border-t border-line pt-3">
              {d.status === 'PENDING' && <>
                <Textarea rows={2} placeholder="Remarks (required to reject or raise a query)…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={() => act('APPROVED')} disabled={busy}>Approve</Button>
                  <Button variant="outline" onClick={() => act('QUERY_HOLD')} disabled={busy}>Raise query</Button>
                  <Button variant="danger" onClick={() => act('REJECTED')} disabled={busy}>Reject</Button>
                </div>
                {!isApprover && <p className="text-xs text-ink-faint">You are not the current-stage approver: any action is recorded as an HR override under your name.</p>}
              </>}
              {d.status === 'APPROVED' && (
                <div className="flex items-center gap-3">
                  <Button onClick={release} disabled={busy}>{busy ? 'Releasing…' : 'Release payment'}</Button>
                  <span className="text-xs text-ink-faint">Marks the NFA as payment released and opens the settlement window.</span>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end border-t border-line pt-3"><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </Modal>
  );
}
