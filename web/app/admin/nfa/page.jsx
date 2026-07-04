'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Select, Textarea, Spinner, Empty, Modal } from '@/components/ui.jsx';

const STATUS_TONE = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  QUERY: 'bg-sky-50 text-sky-700 border-sky-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAYMENT_RELEASED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};
const fmtMoney = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

export default function NfaAdminPage() {
  const [rows, setRows] = useState(null);
  const [masters, setMasters] = useState(null);
  const [f, setF] = useState({ status: '', q: '', projectId: '', companyId: '', paymentType: '' });
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState('');

  const load = () => {
    const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    api.get(`/admin/nfa${qs ? `?${qs}` : ''}`).then(setRows).catch((e) => { setRows([]); setMsg(e.message); });
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/meta/nfa-masters').then(setMasters).catch(() => {}); }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-bold text-ink tracking-tight">NFA — Note For Approval</h1>
        <p className="text-ink-faint text-sm mt-0.5">Expense / advance requests, approval chains and payment release.</p>
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-end">
        <div className="w-44"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All statuses</option>
          {['PENDING', 'QUERY', 'APPROVED', 'PAYMENT_RELEASED', 'REJECTED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
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
          {['ADVANCE_SELF', 'ADVANCE_VENDOR', 'REIMB_SELF', 'REIMB_VENDOR', 'PPS_CANDIDATE', 'INCENTIVE'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </Select></div>
        <div className="flex-1 min-w-[180px]"><Input placeholder="Search NFA code / employee…" value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && load()} /></div>
        <Button onClick={load}>Filter</Button>
      </Card>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <Card className="p-0 overflow-x-auto">
        {!rows ? <div className="p-10 flex justify-center"><Spinner /></div> :
          !rows.length ? <Empty title="No NFAs" subtitle="Nothing matches the current filters." /> : (
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-xs text-ink-faint border-b border-line">
                <th className="px-4 py-2.5">NFA Code</th><th className="px-2 py-2.5">Employee</th>
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
                  <td className="px-2 py-2.5 text-xs">{r.paymentType.replace(/_/g, ' ')}</td>
                  <td className="px-2 py-2.5 text-right font-medium">{fmtMoney(r.totals.grand)}</td>
                  <td className="px-2 py-2.5 text-ink-faint text-xs">{fmtDate(r.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <StatusChip status={r.status} label={r.statusLabel} />
                    {r.settlementStatus && <div className="mt-1 text-[10px] text-ink-faint">Settlement: {r.settlementStatus}</div>}
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
  const [s, setS] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get(`/nfa/${nfaId}/settlement`).then(setS).catch(() => setS(false));
  useEffect(() => { load(); }, [nfaId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action) {
    if (action !== 'APPROVED' && !remarks.trim()) { setMsg('Remarks required.'); return; }
    setBusy(true); setMsg('');
    try { await api.post(`/settlements/${s.id}/act`, { action, remarks }); setRemarks(''); load(); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-line pt-3">
      <div className="font-semibold text-sm mb-1.5">Settlement <span className="text-xs font-normal text-ink-faint">({settlementStatus || '—'})</span></div>
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
                  <span>{st.seq}. {st.roleKey.replace(/_/g, ' ')} <span className="text-ink-soft ml-1">{st.approver?.name || '—'}</span></span>
                  <span className={`font-semibold ${STAGE_TONE[st.status] || ''}`}>{st.status}</span>
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

function StatusChip({ status, label }) {
  return <span title={label} className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_TONE[status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
    {(label || status).length > 34 ? `${(label || status).slice(0, 32)}…` : (label || status)}
  </span>;
}

const STAGE_TONE = {
  APPROVED: 'text-emerald-700', REJECTED: 'text-red-700', BYPASSED: 'text-slate-400',
  PENDING: 'text-amber-700', QUERY: 'text-sky-700', WAITING: 'text-ink-faint',
};

function NfaDetail({ id, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => api.get(`/nfa/${id}`).then(setD).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action) {
    if ((action === 'REJECTED' || action === 'QUERY_HOLD') && !remarks.trim()) { setMsg('Remarks are required for reject / query.'); return; }
    setBusy(true); setMsg('');
    try { setD(await api.post(`/nfa/${id}/act`, { action, remarks })); setRemarks(''); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function release() {
    setBusy(true); setMsg('');
    try { setD(await api.post(`/nfa/${id}/release-payment`)); onChanged(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  const rows = useMemo(() => d ? [
    ['Raise for', d.raiseFor], ['Business operation', d.businessOperation.name],
    ['Cost to company', d.company.name], ['Project', d.project.name],
    ['Expense category', d.expenseCategory.name], ['Zone', d.zone.name],
    ['Location', d.location.name], ['Client / vendor', d.clientVendor?.name || '—'],
    ['Month', `${d.expenseMonth}/${d.expenseYear}`], ['Payment type', d.paymentType.replace(/_/g, ' ')],
    ['Billable type', d.billableType.replace(/_/g, ' ')], ['Settlement due', fmtDate(d.settlementDueDate)],
    ['Priority', d.priority], ['Purpose', d.purpose],
  ] : [], [d]);

  return (
    <Modal open onClose={onClose} title={d ? `${d.nfaCode} — ${d.employee.name}` : 'NFA'} size="lg">
      {!d ? <div className="p-8 flex justify-center"><Spinner /></div> : (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="flex items-center justify-between">
            <StatusChip status={d.status} label={d.statusLabel} />
            <span className="text-lg font-semibold">{fmtMoney(d.totals.grand)}</span>
          </div>

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1">
                <span className="text-ink-faint">{k}</span><span className="text-ink text-right">{v}</span>
              </div>
            ))}
          </div>

          <div>
            <div className="font-semibold text-sm mb-1.5">Expense lines</div>
            <table className="w-full text-sm border border-line rounded">
              <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
                <th className="px-3 py-1.5">#</th><th className="px-2 py-1.5">Header</th><th className="px-2 py-1.5">Sub-header</th>
                <th className="px-2 py-1.5 text-right">NFA</th><th className="px-2 py-1.5 text-right">Logistic</th><th className="px-3 py-1.5 text-right">Total</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.seq} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5">{l.seq}</td><td className="px-2 py-1.5">{l.header.name}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{l.subheader?.name || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(l.nfaAmount)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(l.logisticAmount)}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{fmtMoney(l.totalAmount)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td colSpan={3} className="px-3 py-1.5 text-right text-xs text-ink-faint">Totals</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(d.totals.nfa)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(d.totals.logistic)}</td>
                  <td className="px-3 py-1.5 text-right">{fmtMoney(d.totals.grand)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {d.approval && (
            <div>
              <div className="font-semibold text-sm mb-1.5">Approval chain</div>
              <div className="space-y-1">
                {d.approval.chain.map((s) => (
                  <div key={s.seq} className="flex items-center justify-between text-sm border border-line rounded px-3 py-1.5">
                    <div>
                      <span className="text-ink-faint text-xs mr-2">{s.seq}.</span>
                      <span className="font-medium">{s.roleKey.replace(/_/g, ' ')}</span>
                      <span className="text-ink-soft ml-2">{s.approver ? s.approver.name : '—'}</span>
                      {s.remarks && <span className="text-ink-faint text-xs ml-2">“{s.remarks}”</span>}
                    </div>
                    <span className={`text-xs font-semibold ${STAGE_TONE[s.status] || ''}`}>{s.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {d.status === 'PAYMENT_RELEASED' && <SettlementBlock nfaId={id} settlementStatus={d.settlementStatus} onChanged={() => { load(); onChanged(); }} />}

          {msg && <p className="text-sm text-red-600">{msg}</p>}

          {['PENDING', 'APPROVED'].includes(d.status) && (
            <div className="space-y-2 border-t border-line pt-3">
              {d.status === 'PENDING' && <>
                <Textarea rows={2} placeholder="Remarks (required for reject / query)…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={() => act('APPROVED')} disabled={busy}>Approve</Button>
                  <Button variant="outline" onClick={() => act('QUERY_HOLD')} disabled={busy}>Query / Hold</Button>
                  <Button variant="danger" onClick={() => act('REJECTED')} disabled={busy}>Reject</Button>
                </div>
                <p className="text-xs text-ink-faint">Acting as HR override if you are not the current-stage approver.</p>
              </>}
              {d.status === 'APPROVED' && (
                <div className="flex items-center gap-3">
                  <Button onClick={release} disabled={busy}>{busy ? 'Releasing…' : 'Release payment'}</Button>
                  <span className="text-xs text-ink-faint">Marks the NFA as PAYMENT RELEASED and opens the settlement window.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
