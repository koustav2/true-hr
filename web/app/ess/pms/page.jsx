'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Card, Button, Input, Textarea, Spinner, Empty, Modal, Field, Select, ErrorSummary, useConfirm } from '@/components/ui.jsx';
import { label } from '@/lib/labels.js';
import { useHasTeam } from '@/lib/perms.jsx';
import { validator } from '@/lib/validate.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Readable status (KPI and PMS) — never the raw code.
const kpiStatus = (s, hr) => (s === 'RM_PENDING' && hr ? 'Pending with HR' : label(s));
const pmsStatus = (s) => label(s);
const GRADE_TONE = { OAT: 'text-emerald-700', SAT: 'text-emerald-600', AT: 'text-lime-600', BT: 'text-rose-600', SBT: 'text-rose-700' };

// GreenHR "My Performance" (MyKpi.aspx): monthly KPI list, Create KPI, Submit PMS.
export default function MyPerformancePage() {
  const year = new Date().getFullYear();
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState(0);
  // Team approvals only for someone with a team (null = still loading → hidden).
  const hasTeam = useHasTeam() === true;
  const load = () => api.get(`/kpi?year=${year}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (tab === 1 && hasTeam) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="page-title text-ink">Team KPI & PMS Approvals</h1>
          <Button size="sm" variant="outline" onClick={() => setTab(0)}>← My Performance</Button>
        </div>
        <TeamTab />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title text-ink">My Performance — {year}</h1>
        <div className="flex gap-2">
          {hasTeam && <Button size="sm" variant="outline" onClick={() => setTab(1)}>Team Approvals</Button>}
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
                  <td className="px-2 py-2.5 text-xs">{kpiStatus(r.kpiStatus, r.routedToHr)}</td>
                  <td className="px-2 py-2.5 text-xs">{pmsStatus(r.pmsStatus)}</td>
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
      {openId && <KpiDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load}
        onEdit={(d) => { setOpenId(null); setEditing(d); }} />}
      {editing && <CreateKpiModal edit={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function CreateKpiModal({ onClose, onDone, edit = null }) {
  const [allowed, setAllowed] = useState(null); // { months:[{year,month,reason}], hasManager }
  const [period, setPeriod] = useState(edit ? `${edit.year}-${edit.month}` : '');
  const [copyPrevious, setCopyPrevious] = useState(false);
  const [kras, setKras] = useState(edit
    ? edit.kras.map((k) => ({ description: k.description, weightage: String(k.weightage), target: k.target || '' }))
    : [{ description: '', weightage: '', target: '' }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState({});
  const sum = Math.round(kras.reduce((a, k) => a + Number(String(k.weightage || 0).replace(/,/g, '')), 0) * 100) / 100;

  useEffect(() => {
    if (edit) return;
    api.get('/kpi/allowed-months').then((a) => {
      setAllowed(a);
      if (a.months?.length) setPeriod(`${a.months[0].year}-${a.months[0].month}`);
    }).catch(() => setAllowed({ months: [], hasManager: true }));
  }, [edit]);

  function check() {
    const v = validator();
    if (!edit) v.require('month', period, 'Month');
    if (!copyPrevious) {
      if (!kras.length) v.add('kras', 'Add at least one KRA');
      kras.forEach((k, i) => {
        v.text(`kras.${i}.description`, k.description, `KRA ${i + 1} description`, { required: true, min: 3, max: 500 });
        v.number(`kras.${i}.weightage`, k.weightage, `KRA ${i + 1} weightage`, { required: true, min: 1, max: 100, decimals: 2 });
      });
      if (kras.length && sum !== 100) v.add('kras', `KRA weightages must add up to 100% (now ${sum}%)`);
    }
    setErrors(v.fields);
    return v.ok;
  }

  async function submit() {
    setMsg('');
    if (!check()) return;
    setBusy(true);
    const body = {
      kras: copyPrevious ? undefined : kras.map((k) => ({
        description: k.description.trim(), weightage: Number(String(k.weightage).replace(/,/g, '')), target: k.target.trim() || undefined,
      })),
    };
    try {
      if (edit) await api.put(`/kpi/${edit.id}`, body);
      else {
        const [y, m] = period.split('-').map(Number);
        const r = await api.post('/kpi', { ...body, year: y, month: m, copyPrevious: copyPrevious || undefined });
        if (r?.notice) window.alert(r.notice);
      }
      onDone();
    } catch (e) { setErrors(e.fields || {}); setMsg(e.fields ? '' : e.message); } finally { setBusy(false); }
  }

  const setK = (i, key) => (e) => setKras((ks) => ks.map((x, j) => (j === i ? { ...x, [key]: e.target.value } : x)));

  return (
    <Modal open onClose={onClose} title={edit ? `Edit KPI — ${MONTHS[edit.month - 1]} ${edit.year}` : 'Create KPI'} size="lg"
      actions={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : edit ? 'Save & resubmit' : 'Create KPI'}</Button>
      </>}>
      <div className="space-y-3">
        {!edit && (
          <div className="flex items-end gap-3">
            <div className="w-56">
              <Field label="Month" required error={errors.month}>
                {!allowed ? <Spinner /> : (
                  <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
                    {!allowed.months.length && <option value="">No month is open</option>}
                    {allowed.months.map((a) => (
                      <option key={`${a.year}-${a.month}`} value={`${a.year}-${a.month}`}>{MONTHS[a.month - 1]} {a.year} — {a.reason}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm pb-2.5">
              <input type="checkbox" checked={copyPrevious} onChange={(e) => setCopyPrevious(e.target.checked)} />
              Copy previous KPI
            </label>
          </div>
        )}
        {allowed && !allowed.hasManager && !edit && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            You have no reporting manager assigned, so your KPI will go to HR for approval.
          </p>
        )}
        {!copyPrevious && (
          <div className="space-y-3">
            {kras.map((k, i) => (
              <div key={i} className="space-y-1">
                <div className="flex gap-2 items-start">
                  <Textarea rows={2} className="flex-1 min-w-0" placeholder={`KRA ${i + 1} description`} value={k.description} onChange={setK(i, 'description')} />
                  <Input className="w-32 shrink-0" placeholder="Target" value={k.target} onChange={setK(i, 'target')} />
                  <Input type="number" min="1" max="100" step="0.01" className="w-24 shrink-0" placeholder="Wt %" value={k.weightage} onChange={setK(i, 'weightage')} />
                  <button type="button" onClick={() => setKras((ks) => ks.filter((_, j) => j !== i))} className="text-xs text-red-600 mt-3 shrink-0">Remove</button>
                </div>
                {[errors[`kras.${i}.description`], errors[`kras.${i}.weightage`], errors[`kras.${i}.target`]].filter(Boolean)
                  .map((m) => <p key={m} className="text-[11.5px] text-neg">{m}</p>)}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button size="sm" variant="outline" onClick={() => setKras((ks) => [...ks, { description: '', weightage: '', target: '' }])}>+ Add KRA</Button>
              <span className={`text-sm font-semibold ${sum === 100 ? 'text-emerald-700' : 'text-amber-700'}`}>Total weightage: {sum}%</span>
            </div>
            {errors.kras && <p className="text-[11.5px] text-neg">{errors.kras}</p>}
            <p className="text-xs text-ink-faint">
              Each KRA scores on the standard bands — below 60% → 1 · 60% to below 90% → 2 · 90% to below 105% → 3 ·
              105% to below 120% → 4 · 120% and above → 5. Your rating is worked out from the actual against the target when you submit the PMS.
            </p>
          </div>
        )}
        {Object.keys(errors).length > 2 && <ErrorSummary errors={errors} />}
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </div>
    </Modal>
  );
}

// Live preview of what the measurement band will score. The SERVER is
// authoritative on submit (services/kpiBands.js) — this only shows the employee
// the number their entry produces before they send it, so the band on screen is
// no longer a decoration.
const numeric = (v) => {
  if (v == null) return null;
  const c = String(v).replace(/[,\s%\u20b9]/g, '');
  return c !== '' && /^-?\d*\.?\d+$/.test(c) ? Number(c) : null;
};
const pctOf = (target, achieved) => {
  const t = numeric(target), a = numeric(achieved);
  return t == null || a == null || t === 0 ? null : Math.round((a / t) * 10000) / 100;
};
// A band covers [its floor, the next floor) — same rule as the server, so
// 104.5% scores instead of falling between "90–104" and "105–119".
const sortedBands = (bands) => (Array.isArray(bands) ? bands : [])
  .map((b) => ({ min: numeric(b?.min), rating: b?.rating }))
  .filter((b) => b.min != null && b.rating != null)
  .sort((x, y) => x.min - y.min);
const bandRating = (bands, pct) => {
  if (pct == null) return null;
  const rows = sortedBands(bands);
  for (let i = rows.length - 1; i >= 0; i--) if (pct >= rows[i].min) return Number(rows[i].rating);
  return null;
};
const rangeText = (min, next) => (next == null ? `${min}% and above` : min === 0 ? `Below ${next}%` : `${min}% to below ${next}%`);
const bandText = (bands) => {
  const rows = sortedBands(bands);
  return rows.length ? rows.map((b, i) => `${rangeText(b.min, rows[i + 1]?.min ?? null)} \u2192 ${b.rating}`).join(' \u00b7 ') : '\u2014';
};

function KpiDetailModal({ id, onClose, onChanged, onEdit }) {
  const [confirm, confirmUi] = useConfirm();
  const [d, setD] = useState(null);
  const [scores, setScores] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get(`/kpi/${id}`).then(setD).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmitPms = d && d.status === 'LOCKED' && !d.pms;
  const pendingApproval = d && ['RM_PENDING', 'DISCUSS'].includes(d.status);

  async function withdraw() {
    if (!(await confirm({ title: 'Withdraw this KPI?', body: 'It is removed and you can submit a new KPI for this month.', confirmLabel: 'Withdraw', tone: 'danger' }))) return;
    setBusy(true); setMsg('');
    try { await api.del(`/kpi/${id}`); onChanged(); onClose(); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function submitPms() {
    setBusy(true); setMsg('');
    try {
      await api.post(`/kpi/${id}/pms`, {
        scores: d.kras.map((k) => {
          const s = scores[k.id] || {};
          const pct = pctOf(s.mtdTarget, s.mtdAchieved);
          const banded = bandRating(k.measurementBands, pct);
          return {
            kraId: k.id, mtdTarget: s.mtdTarget ?? k.target ?? '', mtdAchieved: s.mtdAchieved,
            // Sent only for a KRA the band cannot score; the server ignores it otherwise.
            selfRating: banded != null ? undefined : (s.selfRating ?? ''),
            selfRemarks: s.selfRemarks,
          };
        }),
      });
      onChanged(); load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={d ? `${MONTHS[d.month - 1]} ${d.year} — ${kpiStatus(d.status, d.routedToHr)}` : 'KPI'} size="lg"
      actions={d && pendingApproval ? <>
        <Button variant="outline" onClick={withdraw} disabled={busy}>Withdraw</Button>
        <Button onClick={() => onEdit(d)} disabled={busy}>Edit</Button>
      </> : null}>
      {confirmUi}
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
                <div className="text-sm font-semibold">KRA {k.seq} — {k.weightage}%{k.target ? <span className="font-normal text-ink-faint"> · Target {k.target}</span> : null}</div>
                <p className="text-sm text-ink-soft">{k.description}</p>
                <p className="text-[11px] text-ink-faint">Bands: {bandText(k.measurementBands)}</p>
                {existing ? (
                  <div className="text-xs space-y-0.5">
                    <div><span className="text-ink-faint">Target:</span> {existing.mtdTarget || '—'} · <span className="text-ink-faint">Actual:</span> {existing.mtdAchieved || '—'}
                      {existing.achievementPct != null && <span className="text-ink-faint"> · {existing.achievementPct}% of target</span>}
                    </div>
                    <div>
                      <span className="text-ink-faint">Self:</span> {existing.selfRating}
                      {existing.ratingSource === 'BAND'
                        ? <span className="text-ink-faint"> (from the band)</span>
                        : existing.ratingSource === 'ENTERED'
                          ? <span className="text-ink-faint"> (entered — not measurable)</span> : null}
                      {existing.selfRemarks && ` — “${existing.selfRemarks}”`}
                    </div>
                    {existing.mgrRating != null && <div><span className="text-ink-faint">Manager:</span> {existing.mgrRating} {existing.mgrRemarks && `— “${existing.mgrRemarks}”`}</div>}
                  </div>
                ) : canSubmitPms && (() => {
                  const tgt = s.mtdTarget ?? k.target ?? '';
                  const pct = pctOf(tgt, s.mtdAchieved);
                  const banded = bandRating(k.measurementBands, pct);
                  return (
                    <div className="space-y-2">
                      <div className="grid sm:grid-cols-2 gap-2">
                        <Field label="Target"><Input placeholder="Target" value={tgt} onChange={setS('mtdTarget')} /></Field>
                        <Field label="Actual"><Input placeholder="Actual achieved" value={s.mtdAchieved || ''} onChange={setS('mtdAchieved')} /></Field>
                      </div>
                      {banded != null ? (
                        <div className="rounded border border-line bg-canvas px-2.5 py-2 text-xs">
                          <b className="text-ink">{pct}% of target</b>
                          <span className="text-ink-faint"> → rating </span>
                          <b className="text-ink">{banded}</b>
                          <span className="text-ink-faint"> from this KRA&rsquo;s band</span>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <p className="text-[11px] text-ink-faint">
                            {pct == null
                              ? 'Enter a numeric target and achievement and the band will score it. If this KRA is not measurable that way, rate it yourself.'
                              : `${pct}% of target falls outside this KRA’s bands — rate it yourself.`}
                          </p>
                          <Select value={s.selfRating ?? ''} onChange={setS('selfRating')}>
                            <option value="">— rating —</option>
                            {[['5', '5 — OAT'], ['4', '4 — SAT'], ['3', '3 — AT'], ['2', '2 — BT'], ['1', '1 — SBT']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </Select>
                        </div>
                      )}
                      <Input placeholder="Self remarks" value={s.selfRemarks || ''} onChange={setS('selfRemarks')} />
                    </div>
                  );
                })()}
              </Card>
            );
          })}
          {!!d.pms?.levelRatings?.length && (
            <div className="space-y-1">
              <div className="font-semibold text-sm">Rating chain</div>
              {d.pms.levelRatings.map((l) => (
                <div key={l.roleKey} className="flex justify-between text-xs border border-line rounded px-2.5 py-1">
                  <span>{label(l.roleKey)} <span className="text-ink-soft">{l.ratedBy || ''}</span></span>
                  <span className="font-medium">PLI {l.pliPct ? Number(l.pliPct).toFixed(0) : '—'}% (rating {l.pliRating ?? '—'})</span>
                </div>
              ))}
            </div>
          )}
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          {canSubmitPms && <Button onClick={submitPms} disabled={busy}>{busy ? 'Submitting…' : 'Submit PMS'}</Button>}
          {d.status === 'RM_PENDING' && <p className="text-xs text-amber-700">{d.routedToHr ? 'You have no reporting manager, so HR will approve this KPI.' : 'Waiting for your reporting manager to approve this KPI.'} You can still edit or withdraw it.</p>}
          {d.status === 'DISCUSS' && <p className="text-xs text-sky-700">Your manager wants to discuss this KPI — use Edit to update and resubmit it.</p>}
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
                  <div className="text-xs text-ink-faint">{MONTHS[k.month - 1]} {k.year} · {kpiStatus(k.status, k.routedToHr)}{k.routedToHr ? ' · no reporting manager' : ''}</div>
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
                  <div className="text-xs text-ink-faint">{MONTHS[r.month - 1]} {r.year} · your stage: {label(r.stage.roleKey)} · self rating {r.selfRating ?? '—'}</div>
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
                  {sc && <div className="text-ink-faint">Target {sc.mtdTarget || '—'} · Actual {sc.mtdAchieved || '—'} · Self {sc.selfRating}{sc.selfRemarks ? ` — “${sc.selfRemarks}”` : ''}</div>}
                </div>
              );
            })}
            {!!d.pms?.levelRatings?.length && (
              <div className="space-y-1">
                <div className="font-semibold text-sm">Approval chain</div>
                {d.pms.levelRatings.map((l) => (
                  <div key={l.roleKey} className="flex justify-between text-xs border border-line rounded px-2.5 py-1">
                    <span>{label(l.roleKey)} <span className="text-ink-soft">{l.ratedBy || ''}</span></span>
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

