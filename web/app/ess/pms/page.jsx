'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Textarea, Spinner, Empty, Modal, Field, Select } from '@/components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const GRADE_TONE = { OAT: 'text-emerald-700', SAT: 'text-emerald-600', AT: 'text-lime-600', BT: 'text-rose-600', SBT: 'text-rose-700' };

// GreenHR "My Performance" (MyKpi.aspx): monthly KPI list, Create KPI, Submit PMS.
export default function MyPerformancePage() {
  const year = new Date().getFullYear();
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState(0);
  const load = () => api.get(`/kpi?year=${year}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (tab === 1) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">Team KPI & PMS Approvals</h1>
          <Button size="sm" variant="outline" onClick={() => setTab(0)}>← My Performance</Button>
        </div>
        <TeamTab />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title text-[24px] font-extrabold tracking-tight text-ink">My Performance — {year}</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setTab(1)}>Team Approvals</Button>
          <Button size="sm" onClick={() => setCreating(true)}>Submit KPI</Button>
        </div>
      </div>
      <Card className="p-0 overflow-x-auto">
        {!rows ? <div className="p-8 flex justify-center"><Spinner /></div> :
          !rows.length ? <Empty title="No KPIs yet" subtitle="Use Submit KPI to create your first monthly KPI." /> : (
          <table className="w-full text-sm min-w-[680px]">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line">
              <th className="px-4 py-2.5">Month</th><th className="px-2 py-2.5">KPI Status</th>
              <th className="px-2 py-2.5">PMS Status</th><th className="px-2 py-2.5">Self Rating</th>
              <th className="px-2 py-2.5">PLI %</th><th className="px-4 py-2.5">Grade</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="border-b border-line last:border-0 hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-medium">{MONTHS[r.month - 1]}</td>
                  <td className="px-2 py-2.5 text-xs">{r.kpiStatus.replace('_', ' ')}</td>
                  <td className="px-2 py-2.5 text-xs">{r.pmsStatus.replace(/_/g, ' ')}</td>
                  <td className="px-2 py-2.5">{r.selfRating ?? '—'}</td>
                  <td className="px-2 py-2.5">{r.finalPliPct ? `${Number(r.finalPliPct).toFixed(0)}%` : '—'}</td>
                  <td className={`px-4 py-2.5 font-bold ${GRADE_TONE[r.finalGrade] || 'text-ink-faint'}`}>{r.finalGrade || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating && <CreateKpiModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
      {openId && <KpiDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function CreateKpiModal({ onClose, onDone }) {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [copyPrevious, setCopyPrevious] = useState(false);
  const [kras, setKras] = useState([{ description: '', weightage: '' }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const sum = kras.reduce((a, k) => a + Number(k.weightage || 0), 0);

  async function submit() {
    setBusy(true); setMsg('');
    try {
      await api.post('/kpi', {
        year: now.getFullYear(), month: Number(month),
        copyPrevious: copyPrevious || undefined,
        kras: copyPrevious ? undefined : kras.map((k) => ({ description: k.description, weightage: Number(k.weightage) })),
      });
      onDone();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Create KPI" size="lg">
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        <div className="flex items-end gap-3">
          <div className="w-40">
            <Field label="Month" required>
              <Select value={month} onChange={(e) => setMonth(e.target.value)}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm pb-2.5">
            <input type="checkbox" checked={copyPrevious} onChange={(e) => setCopyPrevious(e.target.checked)} />
            Copy Previous KPI
          </label>
        </div>
        {!copyPrevious && (
          <div className="space-y-3">
            {kras.map((k, i) => (
              <div key={i} className="flex gap-2 items-start">
                <Textarea rows={2} className="flex-1 min-w-0" placeholder={`KRA ${i + 1} description`} value={k.description}
                  onChange={(e) => setKras((ks) => ks.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <Input type="number" className="w-24 shrink-0" placeholder="Wt %" value={k.weightage}
                  onChange={(e) => setKras((ks) => ks.map((x, j) => (j === i ? { ...x, weightage: e.target.value } : x)))} />
                <button onClick={() => setKras((ks) => ks.filter((_, j) => j !== i))} className="text-xs text-red-600 mt-3 shrink-0">remove</button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button size="sm" variant="outline" onClick={() => setKras((ks) => [...ks, { description: '', weightage: '' }])}>+ Add KRA</Button>
              <span className={`text-sm font-semibold ${sum === 100 ? 'text-emerald-700' : 'text-amber-700'}`}>Total weightage: {sum}%</span>
            </div>
            <p className="text-xs text-ink-faint">Rating bands: 90–104% → 3 · 105–119% → 4 · 120%+ → 5</p>
          </div>
        )}
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        <Button onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create KPI'}</Button>
      </div>
    </Modal>
  );
}

function KpiDetailModal({ id, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [scores, setScores] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get(`/kpi/${id}`).then(setD).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmitPms = d && d.status === 'LOCKED' && !d.pms;

  async function submitPms() {
    setBusy(true); setMsg('');
    try {
      await api.post(`/kpi/${id}/pms`, {
        scores: d.kras.map((k) => {
          const s = scores[k.id] || {};
          return { kraId: k.id, mtdTarget: s.mtdTarget, mtdAchieved: s.mtdAchieved, selfRating: Number(s.selfRating ?? 3), selfRemarks: s.selfRemarks };
        }),
      });
      onChanged(); load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={d ? `${MONTHS[d.month - 1]} ${d.year} — ${d.status.replace('_', ' ')}` : 'KPI'} size="lg">
      {!d ? <div className="p-6 flex justify-center"><Spinner /></div> : (
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {d.pms?.finalGrade && (
            <p className="text-sm">Final grade: <span className={`font-bold ${GRADE_TONE[d.pms.finalGrade] || ''}`}>{d.pms.finalGrade}</span> ({Number(d.pms.finalPliPct).toFixed(0)}% PLI)</p>
          )}
          {d.kras.map((k) => {
            const existing = d.pms?.scores?.find((s) => s.kraId === k.id);
            const s = scores[k.id] || {};
            const setS = (key) => (e) => setScores((x) => ({ ...x, [k.id]: { ...x[k.id], [key]: e.target.value } }));
            return (
              <Card key={k.id} className="p-3 space-y-2">
                <div className="text-sm font-semibold">KRA {k.seq} — {k.weightage}%</div>
                <p className="text-sm text-ink-soft">{k.description}</p>
                {existing ? (
                  <div className="text-xs space-y-0.5">
                    <div><span className="text-ink-faint">Target:</span> {existing.mtdTarget || '—'} · <span className="text-ink-faint">Achieved:</span> {existing.mtdAchieved || '—'}</div>
                    <div><span className="text-ink-faint">Self:</span> {existing.selfRating} {existing.selfRemarks && `— “${existing.selfRemarks}”`}</div>
                    {existing.mgrRating != null && <div><span className="text-ink-faint">Manager:</span> {existing.mgrRating} {existing.mgrRemarks && `— “${existing.mgrRemarks}”`}</div>}
                  </div>
                ) : canSubmitPms && (
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Input placeholder="MTD Target" value={s.mtdTarget || ''} onChange={setS('mtdTarget')} />
                    <Input placeholder="MTD Achieved" value={s.mtdAchieved || ''} onChange={setS('mtdAchieved')} />
                    <Select value={s.selfRating ?? '3'} onChange={setS('selfRating')}>
                      {[['5', '5 — OAT'], ['4', '4 — SAT'], ['3', '3 — AT'], ['2', '2 — BT'], ['1', '1 — SBT']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <Input placeholder="Self remarks" value={s.selfRemarks || ''} onChange={setS('selfRemarks')} />
                  </div>
                )}
              </Card>
            );
          })}
          {!!d.pms?.levelRatings?.length && (
            <div className="space-y-1">
              <div className="font-semibold text-sm">Rating chain</div>
              {d.pms.levelRatings.map((l) => (
                <div key={l.roleKey} className="flex justify-between text-xs border border-line rounded px-2.5 py-1">
                  <span>{l.roleKey.replace(/_/g, ' ')} <span className="text-ink-soft">{l.ratedBy || ''}</span></span>
                  <span className="font-medium">PLI {l.pliPct ? Number(l.pliPct).toFixed(0) : '—'}% (rating {l.pliRating ?? '—'})</span>
                </div>
              ))}
            </div>
          )}
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          {canSubmitPms && <Button onClick={submitPms} disabled={busy}>{busy ? 'Submitting…' : 'Submit PMS'}</Button>}
          {d.status === 'RM_PENDING' && <p className="text-xs text-amber-700">Waiting for your reporting manager to approve this KPI.</p>}
          {d.status === 'DISCUSS' && <p className="text-xs text-sky-700">Your manager wants to discuss this KPI — edit and resubmit from the app, or update it after discussion.</p>}
        </div>
      )}
    </Modal>
  );
}

/* ── Reporting-manager side (client req #18): KPI approvals + PMS ratings ── */

function TeamTab() {
  const [kpis, setKpis] = useState(null);
  const [ratings, setRatings] = useState(null);
  const [review, setReview] = useState(null); // kpi row being reviewed
  const [rating, setRating] = useState(null); // pending-rating row
  const load = () => {
    api.get('/kpi/team-pending').then(setKpis).catch(() => setKpis([]));
    api.get('/pms/pending').then(setRatings).catch(() => setRatings([]));
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-5">
      <div>
        <div className="font-semibold text-sm text-ink mb-2">KPIs waiting for your approval</div>
        {!kpis ? <Spinner /> : !kpis.length ? <Empty title="No KPIs pending" subtitle="Your team's monthly KPIs appear here for approval." /> : (
          <div className="space-y-2">
            {kpis.map((k) => (
              <Card key={k.id} className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium text-ink">{k.employee?.name} <span className="text-xs text-ink-faint">{k.employee?.employeeCode} · {k.employee?.designation || ''}</span></div>
                  <div className="text-xs text-ink-faint">{MONTHS[k.month - 1]} {k.year} · {k.status.replace('_', ' ')}</div>
                </div>
                <Button size="sm" onClick={() => setReview(k)}>Review</Button>
              </Card>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="font-semibold text-sm text-ink mb-2">PMS ratings waiting for you</div>
        {!ratings ? <Spinner /> : !ratings.length ? <Empty title="No ratings pending" subtitle="Submitted PMS forms reach you here when it's your stage in the chain." /> : (
          <div className="space-y-2">
            {ratings.map((r) => (
              <Card key={r.submissionId} className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium text-ink">{r.employee?.name} <span className="text-xs text-ink-faint">{r.employee?.employeeCode}</span></div>
                  <div className="text-xs text-ink-faint">{MONTHS[r.month - 1]} {r.year} · your stage: {r.stage.roleKey.replace(/_/g, ' ')} · self rating {r.selfRating ?? '—'}</div>
                </div>
                <Button size="sm" onClick={() => setRating(r)}>Rate</Button>
              </Card>
            ))}
          </div>
        )}
      </div>
      {review && <ReviewKpiModal row={review} onClose={() => setReview(null)} onDone={() => { setReview(null); load(); }} />}
      {rating && <RatePmsModal row={rating} onClose={() => setRating(null)} onDone={() => { setRating(null); load(); }} />}
    </div>
  );
}

// KPI detail + Approve / Discuss for the reporting manager.
function ReviewKpiModal({ row, onClose, onDone }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get(`/kpi/${row.id}`).then(setD).catch((e) => setMsg(e.message)); }, [row.id]);
  async function act(action) {
    setBusy(true); setMsg('');
    try { await api.post(`/kpi/${row.id}/review`, { action }); onDone(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`${row.employee?.name} — ${MONTHS[row.month - 1]} ${row.year}`} size="lg"
      actions={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="outline" onClick={() => act('DISCUSS')} disabled={busy}>Discuss</Button>
        <Button onClick={() => act('APPROVE')} disabled={busy}>{busy ? <Spinner /> : 'Approve KPI'}</Button>
      </>}>
      {!d ? <div className="p-6 flex justify-center"><Spinner /></div> : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {d.kras.map((k) => (
            <div key={k.id} className="border border-line rounded-lg px-3 py-2 text-sm flex justify-between gap-3">
              <span className="text-ink-soft">KRA {k.seq}. {k.description}</span>
              <span className="font-semibold shrink-0">{k.weightage}%</span>
            </div>
          ))}
          <p className="text-xs text-ink-faint">Total weightage: {d.kras.reduce((a, k) => a + Number(k.weightage), 0)}% · Approve locks the KPI; Discuss sends it back to the employee.</p>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
        </div>
      )}
    </Modal>
  );
}

// PMS rating at the manager's stage — shows KRAs + self scores + the chain, records PLI.
function RatePmsModal({ row, onClose, onDone }) {
  const [d, setD] = useState(null);
  const [pliRating, setPliRating] = useState('4');
  const [pliPct, setPliPct] = useState('100');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (row.kpiId) api.get(`/kpi/${row.kpiId}`).then(setD).catch(() => setD(false)); }, [row.kpiId]);
  async function submit() {
    setBusy(true); setMsg('');
    try { await api.post(`/pms/${row.submissionId}/rate`, { pliRating: Number(pliRating), pliPct: Number(pliPct), remarks }); onDone(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Rate — ${row.employee?.name} · ${MONTHS[row.month - 1]} ${row.year}`} size="lg"
      actions={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? <Spinner /> : 'Submit rating'}</Button>
      </>}>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        {d && d !== false && (
          <>
            {d.kras.map((k) => {
              const sc = d.pms?.scores?.find((x) => x.kraId === k.id);
              return (
                <div key={k.id} className="border border-line rounded-lg px-3 py-2 text-xs space-y-0.5">
                  <div className="text-sm text-ink-soft">KRA {k.seq}. {k.description} <b>({k.weightage}%)</b></div>
                  {sc && <div className="text-ink-faint">Target {sc.mtdTarget || '—'} · Achieved {sc.mtdAchieved || '—'} · Self {sc.selfRating}{sc.selfRemarks ? ` — “${sc.selfRemarks}”` : ''}</div>}
                </div>
              );
            })}
            {!!d.pms?.levelRatings?.length && (
              <div className="space-y-1">
                <div className="font-semibold text-sm">Approval chain</div>
                {d.pms.levelRatings.map((l) => (
                  <div key={l.roleKey} className="flex justify-between text-xs border border-line rounded px-2.5 py-1">
                    <span>{l.roleKey.replace(/_/g, ' ')} <span className="text-ink-soft">{l.ratedBy || ''}</span></span>
                    <span className="font-medium">{l.pliPct ? `PLI ${Number(l.pliPct).toFixed(0)}% (rating ${l.pliRating})` : 'Pending'}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label="PLI rating (1–5)" required>
            <Select value={pliRating} onChange={(e) => setPliRating(e.target.value)}>
              {[['5', '5 — OAT'], ['4', '4 — SAT'], ['3', '3 — AT'], ['2', '2 — BT'], ['1', '1 — SBT']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="PLI %" required><Input type="number" min="0" max="200" value={pliPct} onChange={(e) => setPliPct(e.target.value)} /></Field>
        </div>
        <Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </div>
    </Modal>
  );
}

