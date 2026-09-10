// Full & Final settlement — compute exit pay for a resigned/exiting employee.
// Wraps the pure fnf.js engine; ties onto the existing resignation record but never
// alters the resignation approval chain or the NFA settlement suite.
import { query } from '../db/pool.js';
import { ownsEmployee, scopedByEmployee } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { computeFnf } from '../services/fnf.js';
import { buildFnfPdf } from '../services/docPdf.js';
import { brandForEmployee } from '../services/docProfile.js';

// Assemble engine inputs from the employee's structure + resignation, allowing body overrides.
async function gatherInputs(employeeId, body = {}) {
  const e = (await query(`SELECT * FROM employees WHERE id=$1`, [employeeId])).rows[0];
  if (!e) return { error: 'Employee not found.' };
  const s = (await query(`SELECT * FROM salary_structures WHERE employee_id=$1`, [employeeId])).rows[0] || {};
  const resig = (await query(
    `SELECT * FROM resignations WHERE employee_id=$1 ORDER BY id DESC LIMIT 1`, [employeeId])).rows[0] || {};
  // Best-effort leave balance (table may vary); default 0 on any error.
  let leaveBalanceDays = 0;
  try {
    const lb = (await query(`SELECT COALESCE(SUM(balance),0) AS bal FROM leave_balances WHERE employee_id=$1`, [employeeId])).rows[0];
    leaveBalanceDays = Number(lb?.bal) || 0;
  } catch { /* optional */ }

  const monthlyCtc = Number(body.monthlyCtc) || Number(s.monthly_ctc) || 0;
  const basicPct = Number(s.basic_pct) || 50;
  const lastWorkingDate = body.lastWorkingDate || resig.last_working_date || null;
  return {
    employee: e, resignationId: resig.id || null,
    inputs: {
      monthlyCtc,
      basic: Number(body.basic) || Math.round(monthlyCtc * basicPct / 100),
      da: Number(body.da) || 0,
      grossMonthly: Number(body.grossMonthly) || monthlyCtc,
      dateOfJoining: body.dateOfJoining || e.date_of_joining,
      lastWorkingDate,
      leaveBalanceDays: body.leaveBalanceDays != null ? Number(body.leaveBalanceDays) : leaveBalanceDays,
      noticeShortfallDays: Number(body.noticeShortfallDays) || 0,
      arrears: Number(body.arrears) || 0, bonus: Number(body.bonus) || 0, otherEarnings: Number(body.otherEarnings) || 0,
      tds: Number(body.tds) || 0, advances: Number(body.advances) || 0,
      assetRecovery: Number(body.assetRecovery) || 0, otherDeductions: Number(body.otherDeductions) || 0,
      gratuityEligibleYears: body.gratuityEligibleYears != null ? Number(body.gratuityEligibleYears) : 5,
    },
  };
}

// POST /fnf/preview/:employeeId — compute without saving.
export async function preview(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  // gatherInputs reads the employee, their salary structure, resignation and
  // leave balances by raw id. Unscoped, this returned another tenant's CTC,
  // exit date and full settlement arithmetic.
  if (!(await ownsEmployee(req, employeeId))) return res.status(404).json({ error: 'Employee not found.' });
  const g = await gatherInputs(employeeId, req.body || {});
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
  const g = await gatherInputs(employeeId, req.body || {});
  if (g.error) return res.status(404).json({ error: g.error });
  const computed = computeFnf(g.inputs);
  const existing = (await query(`SELECT id, status FROM fnf_settlements WHERE employee_id=$1 ORDER BY id DESC LIMIT 1`, [employeeId])).rows[0];
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
    `SELECT f.id, f.status, f.net_amount, f.payable_by, f.last_working_date, f.created_at,
            e.first_name, e.last_name, e.employee_code
       FROM fnf_settlements f JOIN employees e ON e.id=f.employee_id
      WHERE ($1::text IS NULL OR f.status=$1)
        AND ($2::bigint IS NULL OR e.organisation_id=$2)
        AND ($3::bigint IS NULL OR e.company_id=$3)
      ORDER BY f.created_at DESC`,
    [req.query.status || null, req.orgId || null, req.companyScope || null])).rows;
  res.json({ settlements: rows });
}

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
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="fnf-${row.employee_code || row.employee_id}.pdf"`);
  buildFnfPdf({
    ...computed,
    meta: { name: `${row.first_name || ''} ${row.last_name || ''}`.trim(), employeeCode: row.employee_code,
      designation: row.designation, lastWorkingDate: row.last_working_date },
  }, res, await brandForEmployee(row.employee_id));
}
