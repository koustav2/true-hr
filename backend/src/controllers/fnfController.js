// Full & Final settlement — compute exit pay for a resigned/exiting employee.
// Wraps the pure fnf.js engine; ties onto the existing resignation record but never
// alters the resignation approval chain or the NFA settlement suite.
//
// v2 (QA C27, H90-H95, H109): only an employee with an approved exit can be
// settled; the form is pre-filled from the system (LWD, leave balance, notice
// shortfall, assigned assets, open NFA advances); every amount is checked; a
// draft can be edited or deleted; the PDF shows the settlement's status.
import { query } from '../db/pool.js';
import { ownsEmployee, scopedByEmployee } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { computeFnf } from '../services/fnf.js';
import { buildFnfPdf } from '../services/docPdf.js';
import { brandForEmployee } from '../services/docProfile.js';
import { dmy } from '../services/letters.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST, toNumber } from '../utils/validate.js';
import { isoDate } from '../utils/joining.js';
import { AppError } from '../middleware/error.js';
import { outstandingAdvance } from '../services/exitWorker.js';

// Leave that is paid out on exit. Casual/sick leave lapses; earned/privilege
// leave is encashed.
const ENCASHABLE = ['EL', 'PL', 'AL', 'EARNED'];

// The approved exit: an approved resignation, else an active termination.
async function approvedExit(employeeId) {
  const r = (await query(
    `SELECT id, resignation_date, last_working_date, notice_period_days,
            COALESCE((to_jsonb(r) ->> 'notice_shortfall_days')::int, NULL) AS notice_shortfall_days
       FROM resignations r WHERE employee_id=$1 AND status='APPROVED' ORDER BY id DESC LIMIT 1`, [employeeId])).rows[0];
  if (r) return { kind: 'RESIGNATION', resignationId: r.id, raisedOn: isoDate(r.resignation_date), lastWorkingDate: isoDate(r.last_working_date), noticeDays: r.notice_period_days, shortfall: r.notice_shortfall_days };
  const t = (await query(
    `SELECT id, initiated_at, last_working_date, notice_period_days, notice_waived
       FROM terminations WHERE employee_id=$1 AND status='ACTIVE' ORDER BY id DESC LIMIT 1`, [employeeId])).rows[0];
  if (t) return { kind: 'TERMINATION', resignationId: null, raisedOn: isoDate(t.initiated_at), lastWorkingDate: isoDate(t.last_working_date), noticeDays: t.notice_period_days, shortfall: t.notice_waived ? 0 : null };
  return null;
}

async function leaveBalanceOf(employeeId, encashableOnly) {
  // leave_balances holds allocated and used; there is no balance column, which
  // is why the old SUM(balance) errored, was swallowed, and encashment was
  // always zero.
  const r = (await query(
    `SELECT COALESCE(SUM(GREATEST(lb.allocated - lb.used, 0)),0) AS bal
       FROM leave_balances lb JOIN leave_types lt ON lt.id = lb.leave_type_id
      WHERE lb.employee_id=$1 AND lt.requires_balance
        AND ($2::text[] IS NULL OR upper(lt.code) = ANY($2::text[]))`,
    [employeeId, encashableOnly ? ENCASHABLE : null])).rows[0];
  return Number(r?.bal) || 0;
}

// Assemble engine inputs from the employee's structure + resignation, allowing body overrides.
async function gatherInputs(employeeId, body = {}) {
  const e = (await query(`SELECT * FROM employees WHERE id=$1`, [employeeId])).rows[0];
  if (!e) return { error: 'Employee not found.' };
  const s = (await query(`SELECT * FROM salary_structures WHERE employee_id=$1`, [employeeId])).rows[0] || {};
  // The resignation the settlement belongs to is the APPROVED one — the latest
  // of any status could be a withdrawn or rejected request.
  const resig = (await query(
    `SELECT * FROM resignations WHERE employee_id=$1 AND status='APPROVED' ORDER BY id DESC LIMIT 1`, [employeeId])).rows[0]
    || (await query(`SELECT * FROM resignations WHERE employee_id=$1 ORDER BY id DESC LIMIT 1`, [employeeId])).rows[0] || {};
  let leaveBalanceDays = 0;
  try { leaveBalanceDays = await leaveBalanceOf(employeeId, false); } catch { /* optional */ }

  const monthlyCtc = Number(body.monthlyCtc) || Number(s.monthly_ctc) || 0;
  const basicPct = Number(s.basic_pct) || 50;
  const lastWorkingDate = body.lastWorkingDate || isoDate(resig.last_working_date) || null;
  return {
    employee: e, resignationId: resig.id || null,
    inputs: {
      monthlyCtc,
      basic: Number(body.basic) || Math.round(monthlyCtc * basicPct / 100),
      da: Number(body.da) || 0,
      grossMonthly: Number(body.grossMonthly) || monthlyCtc,
      dateOfJoining: body.dateOfJoining || isoDate(e.date_of_joining),
      lastWorkingDate,
      leaveBalanceDays: body.leaveBalanceDays != null && body.leaveBalanceDays !== '' ? Number(body.leaveBalanceDays) : leaveBalanceDays,
      noticeShortfallDays: Number(body.noticeShortfallDays) || 0,
      arrears: Number(body.arrears) || 0, bonus: Number(body.bonus) || 0, otherEarnings: Number(body.otherEarnings) || 0,
      tds: Number(body.tds) || 0, advances: Number(body.advances) || 0,
      assetRecovery: Number(body.assetRecovery) || 0, otherDeductions: Number(body.otherDeductions) || 0,
      gratuityEligibleYears: body.gratuityEligibleYears != null ? Number(body.gratuityEligibleYears) : 5,
    },
  };
}

// ── v2 helpers ─────────────────────────────────────────────────────────────

const MAX_AMOUNT = 100000000; // ₹10 crore
const AMOUNT_FIELDS = [
  ['arrears', 'Arrears'], ['bonus', 'Bonus'], ['otherEarnings', 'Other earnings'], ['tds', 'TDS'],
  ['advances', 'Advances / loans'], ['assetRecovery', 'Asset recovery'], ['otherDeductions', 'Other deductions'],
];

async function v2Validate(employeeId, body) {
  const e = (await query(`SELECT date_of_joining, employee_code FROM employees WHERE id=$1`, [employeeId])).rows[0] || {};
  const exit = await approvedExit(employeeId);
  if (!exit || !e.employee_code) {
    throw new AppError('A Full & Final settlement can only be made for an employee whose resignation or termination has been approved.', 409,
      { employeeId: 'This employee has no approved resignation or termination' });
  }
  const v = validator();
  const doj = isoDate(e.date_of_joining);
  const today = todayIST();
  const max = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  v.date('lastWorkingDate', body.lastWorkingDate, 'Last working date', {
    required: true, min: doj || undefined, max,
    minMsg: `Last working date cannot be before the joining date (${dmy(doj)})`,
  });
  v.number('leaveBalanceDays', body.leaveBalanceDays, 'Leave balance', { min: 0, max: 365, decimals: 1 });
  v.number('noticeShortfallDays', body.noticeShortfallDays, 'Notice shortfall', { min: 0, max: 365, integer: true });
  for (const [k, label] of AMOUNT_FIELDS) v.number(k, body[k], label, { min: 0, max: MAX_AMOUNT, decimals: 2 });
  v.throwIfAny();
  // Commas are fine on the way in ("50,000"); the engine gets plain numbers.
  const clean = { ...body };
  for (const k of ['leaveBalanceDays', 'noticeShortfallDays', ...AMOUNT_FIELDS.map(([x]) => x)]) {
    if (clean[k] !== undefined && clean[k] !== null && clean[k] !== '') clean[k] = toNumber(clean[k]);
  }
  return { exit, body: clean };
}

// POST /fnf/preview/:employeeId — compute without saving.
export async function preview(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  // gatherInputs reads the employee, their salary structure, resignation and
  // leave balances by raw id. Unscoped, this returned another tenant's CTC,
  // exit date and full settlement arithmetic.
  if (!(await ownsEmployee(req, employeeId))) return res.status(404).json({ error: 'Employee not found.' });
  let body = req.body || {};
  if (isV2(req)) ({ body } = await v2Validate(employeeId, body));
  const g = await gatherInputs(employeeId, body);
  if (g.error) return res.status(404).json({ error: g.error });
  const computed = computeFnf(g.inputs);
  res.json({ inputs: g.inputs, computed, resignationId: g.resignationId });
}

// POST /fnf/:employeeId — create or replace the draft settlement.
export async function save(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  // Unscoped, this created or overwrote a settlement row against another
  // tenant's employee.
  if (!(await ownsEmployee(req, employeeId))) return res.status(404).json({ error: 'Employee not found.' });
  let body = req.body || {};
  const existing = (await query(`SELECT id, status FROM fnf_settlements WHERE employee_id=$1 AND status<>'cancelled' ORDER BY id DESC LIMIT 1`, [employeeId])).rows[0];
  if (isV2(req)) {
    ({ body } = await v2Validate(employeeId, body));
    if (existing && existing.status !== 'draft') {
      return res.status(409).json({ error: `This employee's settlement is already ${existing.status}. It cannot be replaced.` });
    }
  }
  const g = await gatherInputs(employeeId, body);
  if (g.error) return res.status(404).json({ error: g.error });
  const computed = computeFnf(g.inputs);
  let row;
  if (existing && existing.status === 'draft') {
    row = (await query(
      `UPDATE fnf_settlements SET inputs=$2, computed=$3, net_amount=$4, payable_by=$5,
         last_working_date=$6, resignation_id=$7 WHERE id=$1 RETURNING *`,
      [existing.id, g.inputs, computed, computed.net, computed.payableBy, g.inputs.lastWorkingDate, g.resignationId])).rows[0];
  } else {
    row = (await query(
      `INSERT INTO fnf_settlements (employee_id, resignation_id, last_working_date, inputs, computed, net_amount, payable_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [employeeId, g.resignationId, g.inputs.lastWorkingDate, g.inputs, computed, computed.net, computed.payableBy, req.user.id])).rows[0];
  }
  await audit(req.user.id, 'FNF_SAVE', 'fnf_settlement', row.id, { employeeId, net: computed.net });
  res.json({ settlement: row, computed });
}

// GET /api/v2/admin/fnf/eligible — employees with an approved exit (H91), with
// the state of their settlement if one exists.
export async function eligible(req, res) {
  const rows = (await query(
    `SELECT e.id, e.first_name, e.last_name, e.employee_code,
            COALESCE(r.last_working_date, t.last_working_date) AS lwd,
            CASE WHEN r.id IS NOT NULL THEN 'RESIGNATION' ELSE 'TERMINATION' END AS kind,
            f.id AS settlement_id, f.status AS settlement_status
       FROM employees e
       LEFT JOIN LATERAL (SELECT id, last_working_date FROM resignations
                           WHERE employee_id=e.id AND status='APPROVED' ORDER BY id DESC LIMIT 1) r ON true
       LEFT JOIN LATERAL (SELECT id, last_working_date FROM terminations
                           WHERE employee_id=e.id AND status='ACTIVE' ORDER BY id DESC LIMIT 1) t ON true
       LEFT JOIN LATERAL (SELECT id, status FROM fnf_settlements
                           WHERE employee_id=e.id AND status<>'cancelled' ORDER BY id DESC LIMIT 1) f ON true
      WHERE (r.id IS NOT NULL OR t.id IS NOT NULL)
        AND e.employee_code IS NOT NULL AND e.employee_code <> ''
        AND ($1::bigint IS NULL OR e.organisation_id=$1) AND ($2::bigint IS NULL OR e.company_id=$2)
      ORDER BY COALESCE(r.last_working_date, t.last_working_date) DESC, e.first_name`,
    [req.orgId || null, req.companyScope || null])).rows;
  res.json(rows.map((r) => ({
    id: Number(r.id), name: `${r.first_name} ${r.last_name}`.trim(), code: r.employee_code,
    lastWorkingDate: isoDate(r.lwd), kind: r.kind,
    settlementId: r.settlement_id ? Number(r.settlement_id) : null, settlementStatus: r.settlement_status || null,
  })));
}

// GET /api/v2/admin/fnf/prefill/:employeeId — what the system already knows (H94, C27, H109).
export async function prefillV2(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  const e = (await query(
    `SELECT e.id, e.date_of_joining, e.notice_period_days, ss.monthly_ctc
       FROM employees e LEFT JOIN salary_structures ss ON ss.employee_id = e.id
      WHERE e.id=$1 AND ($2::bigint IS NULL OR e.organisation_id=$2) AND ($3::bigint IS NULL OR e.company_id=$3)`,
    [employeeId || 0, req.orgId || null, req.companyScope || null])).rows[0];
  if (!e) return res.status(404).json({ error: 'Employee not found.' });
  const exit = await approvedExit(employeeId);
  if (!exit) return res.status(409).json({ error: 'This employee has no approved resignation or termination.' });

  // Notice shortfall: what the exit record says, else the notice period less
  // the days actually served between raising the exit and the LWD.
  // A recorded shortfall wins; 0 on an older record only means "not captured".
  let shortfall = Number(exit.shortfall) > 0 ? Number(exit.shortfall) : null;
  if (shortfall == null) {
    const notice = Number(exit.noticeDays ?? e.notice_period_days ?? 0);
    const served = exit.raisedOn && exit.lastWorkingDate
      ? Math.round((Date.parse(`${exit.lastWorkingDate}T00:00:00Z`) - Date.parse(`${exit.raisedOn}T00:00:00Z`)) / 86400000) + 1 : notice;
    shortfall = Math.max(0, notice - Math.max(0, served));
  }

  const assets = (await query(
    `SELECT a.id, a.asset_tag, a.category, a.brand, a.model, a.cost, aa.assigned_at
       FROM asset_assignments aa JOIN assets a ON a.id = aa.asset_id
      WHERE aa.employee_id=$1 AND aa.returned_at IS NULL ORDER BY aa.assigned_at`, [employeeId])).rows
    .map((a) => ({ id: Number(a.id), tag: a.asset_tag, description: [a.category, a.brand, a.model].filter(Boolean).join(' '), cost: a.cost == null ? null : Number(a.cost), assignedOn: isoDate(a.assigned_at) }));

  let advances = [];
  try {
    advances = (await query(
      `SELECT n.id, n.nfa_code, n.purpose, n.grand_total,
              COALESCE((SELECT SUM(s.amount) FROM nfa_settlements s WHERE s.nfa_id=n.id AND s.status='CLOSED'),0) AS settled
         FROM nfas n
        WHERE n.employee_id=$1 AND n.payment_type='ADVANCE_SELF' AND n.status='PAYMENT_RELEASED'
          AND COALESCE(n.settlement_status,'') <> 'CLOSE'
        ORDER BY n.created_at`, [employeeId])).rows
      .map((n) => ({ id: Number(n.id), code: n.nfa_code, purpose: n.purpose, amount: Number(n.grand_total), settled: Number(n.settled), outstanding: Math.max(0, Number(n.grand_total) - Number(n.settled)) }))
      .filter((n) => n.outstanding > 0);
  } catch { advances = []; }

  let outstanding = { amount: advances.reduce((a, n) => a + n.outstanding, 0), nfas: advances.length, codes: advances.map((n) => n.code) };
  try { outstanding = await outstandingAdvance(employeeId); } catch { /* fall back to the list above */ }
  res.json({
    exit,
    values: {
      lastWorkingDate: exit.lastWorkingDate,
      leaveBalanceDays: await leaveBalanceOf(employeeId, true),
      noticeShortfallDays: shortfall,
      // H109: the advances still open on NFA, by the exit worker's own reckoning.
      advances: outstanding.amount,
    },
    dateOfJoining: isoDate(e.date_of_joining),
    monthlyCtc: e.monthly_ctc == null ? null : Number(e.monthly_ctc),
    assets, openAdvances: advances, outstandingAdvance: outstanding,
  });
}

// GET /api/v2/admin/fnf/:id — one settlement with its inputs, for editing.
export async function detail(req, res) {
  const row = await scopedByEmployee(req, 'fnf_settlements', req.params.id,
    { cols: `t.*, e.first_name, e.last_name, e.employee_code` });
  if (!row) return res.status(404).json({ error: 'Settlement not found.' });
  res.json({ settlement: { ...row, last_working_date: isoDate(row.last_working_date) } });
}

// DELETE /api/v2/admin/fnf/:id — drafts only (C27).
export async function removeDraft(req, res) {
  const row = await scopedByEmployee(req, 'fnf_settlements', req.params.id, { cols: 't.id, t.status' });
  if (!row) return res.status(404).json({ error: 'Settlement not found.' });
  if (row.status !== 'draft') return res.status(409).json({ error: 'Only a draft settlement can be deleted.' });
  await query(`DELETE FROM fnf_settlements WHERE id=$1`, [row.id]);
  await audit(req.user.id, 'FNF_DELETE', 'fnf_settlement', row.id, {});
  res.json({ ok: true });
}

export async function finalise(req, res) {
  const id = parseInt(req.params.id, 10);
  // fnf_settlements carries no organisation_id: reach the tenant through the
  // employee. Unscoped, this finalised another tenant's exit settlement.
  const mine = await scopedByEmployee(req, 'fnf_settlements', id, { cols: 't.id' });
  if (!mine) return res.status(404).json({ error: 'Settlement not found.' });
  const row = (await query(
    `UPDATE fnf_settlements SET status='finalised', finalised_by=$2, finalised_at=now()
      WHERE id=$1 AND status='draft' RETURNING *`, [mine.id, req.user.id])).rows[0];
  if (!row) return res.status(409).json({ error: 'Only a draft settlement can be finalised.' });
  await audit(req.user.id, 'FNF_FINALISE', 'fnf_settlement', id, {});
  res.json({ settlement: row });
}

export async function markPaid(req, res) {
  const id = parseInt(req.params.id, 10);
  // Unscoped, this marked another tenant's settlement as paid.
  const mine = await scopedByEmployee(req, 'fnf_settlements', id, { cols: 't.id' });
  if (!mine) return res.status(404).json({ error: 'Settlement not found.' });
  const row = (await query(
    `UPDATE fnf_settlements SET status='paid', paid_at=now() WHERE id=$1 AND status='finalised' RETURNING *`, [mine.id])).rows[0];
  if (!row) return res.status(409).json({ error: 'Only a finalised settlement can be marked paid.' });
  await audit(req.user.id, 'FNF_PAID', 'fnf_settlement', id, {});
  res.json({ settlement: row });
}

export async function list(req, res) {
  // The join to employees was already there but carried no org predicate, so the
  // settlement list showed every tenant's exits and net payable amounts.
  const rows = (await query(
    `SELECT f.id, f.status, f.net_amount, f.payable_by, f.last_working_date, f.created_at, f.employee_id,
            e.first_name, e.last_name, e.employee_code
       FROM fnf_settlements f JOIN employees e ON e.id=f.employee_id
      WHERE ($1::text IS NULL OR f.status=$1)
        AND ($2::bigint IS NULL OR e.organisation_id=$2)
        AND ($3::bigint IS NULL OR e.company_id=$3)
      ORDER BY f.created_at DESC`,
    [req.query.status || null, req.orgId || null, req.companyScope || null])).rows;
  res.json({ settlements: rows.map((r) => ({ ...r, last_working_date: isoDate(r.last_working_date) })) });
}

const STATUS_LABEL = { draft: 'Draft', finalised: 'Finalised', paid: 'Paid', cancelled: 'Cancelled' };

export async function pdf(req, res) {
  const id = parseInt(req.params.id, 10);
  // Same missing predicate on the employees join: unscoped, this served another
  // tenant's settlement PDF (name, designation, LWD, every pay component).
  const row = (await query(
    `SELECT f.*, e.first_name, e.last_name, e.employee_code, d.title AS designation
       FROM fnf_settlements f
       JOIN employees e ON e.id=f.employee_id
       LEFT JOIN designations d ON d.id=e.designation_id
      WHERE f.id=$1
        AND ($2::bigint IS NULL OR e.organisation_id=$2)
        AND ($3::bigint IS NULL OR e.company_id=$3)`,
    [id, req.orgId || null, req.companyScope || null])).rows[0];
  if (!row) return res.status(404).json({ error: 'Settlement not found.' });
  const computed = row.computed || {};
  const status = STATUS_LABEL[row.status] || row.status;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="fnf-${row.employee_code || row.employee_id}.pdf"`);
  // H93: the statement says what state it is in. The PDF layout has no status
  // slot of its own yet, so it rides next to the last working date.
  buildFnfPdf({
    ...computed,
    meta: { name: `${row.first_name || ''} ${row.last_name || ''}`.trim(), employeeCode: row.employee_code,
      designation: row.designation, lastWorkingDate: `${dmy(row.last_working_date)}   ·   Status: ${status}`, status },
  }, res, await brandForEmployee(row.employee_id));
}
