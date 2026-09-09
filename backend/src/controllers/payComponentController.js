// ============================================================================
// Per-company payslip components — the configuration side of the payroll engine.
//
// GreenHR parity: its Salary Component % / Annexure-header screens. The point
// is that one client's payslip reads Basic / HRA / Conveyance / Food Coupons
// while another's reads Basic / HRA / Special, without either needing a code
// change.
//
// The guards here are the interesting part: a component set that does not
// reconcile to the CTC, or that references a component that is not there, would
// produce a wrong payslip rather than an error — so those shapes are refused at
// the door instead.
// ============================================================================
import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { KINDS, CALCS, STATUTORY_KEYS, loadForCompany, shape } from '../services/payComponents.js';

const CODE_RE = /^[A-Z][A-Z0-9_]{1,23}$/;

async function scopedCompany(req, raw) {
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) return null;
  return (await query(
    `SELECT id, organisation_id FROM companies
      WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
    [id, req.orgId || null])).rows[0] || null;
}

// GET /admin/companies/:companyId/salary-components
export async function list(req, res, next) {
  try {
    const co = await scopedCompany(req, req.params.companyId);
    if (!co) return res.status(404).json({ error: 'Company not found in your organisation.' });
    res.json({
      companyId: co.id,
      components: await loadForCompany(co.id),
      calcs: CALCS, kinds: KINDS, statutoryKeys: STATUTORY_KEYS,
    });
  } catch (e) { next(e); }
}

/**
 * Validate a whole proposed set. Whole-set rather than per-row because the
 * things that go wrong are relationships: a percentage of a component that
 * isn't there, two balancing lines, or nothing to absorb the remainder.
 */
function validate(rows) {
  if (!Array.isArray(rows) || !rows.length) return 'Give at least one component.';
  const seen = new Set();
  const earningCodes = new Set(rows.filter((r) => r.kind === 'EARNING').map((r) => String(r.code || '').toUpperCase()));

  for (const r of rows) {
    const code = String(r.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return `"${r.code}" is not a valid code — use 2-24 characters, A-Z, 0-9 and _ , starting with a letter.`;
    if (seen.has(code)) return `${code} appears twice.`;
    seen.add(code);
    if (!String(r.label || '').trim()) return `${code} needs a label — it is what the payslip prints.`;
    if (!KINDS.includes(r.kind)) return `${code}: kind must be EARNING or DEDUCTION.`;
    if (!CALCS.includes(r.calc)) return `${code}: calc must be one of ${CALCS.join(', ')}.`;
    if (r.calc === 'BALANCE' && r.kind !== 'EARNING') return `${code}: only an earning can balance the CTC.`;
    if (r.calc === 'PCT_OF') {
      const basis = String(r.basisCode || '').toUpperCase();
      if (!basis) return `${code}: choose the component it is a percentage of.`;
      if (basis === code) return `${code} cannot be a percentage of itself.`;
      if (!earningCodes.has(basis)) return `${code}: ${basis} is not an earning in this list.`;
      const b = rows.find((x) => String(x.code).toUpperCase() === basis);
      if (b && b.calc === 'PCT_OF') return `${code}: ${basis} is itself a percentage of something else — chain it off a direct component instead.`;
      if (b && b.calc === 'BALANCE') return `${code}: ${basis} is the balancing line, so it has no fixed value to take a percentage of.`;
    }
    const v = Number(r.value);
    if (!Number.isFinite(v) || v < 0) return `${code}: value must be zero or more.`;
    if ((r.calc === 'PCT_CTC' || r.calc === 'PCT_OF') && v > 100) return `${code}: a percentage cannot exceed 100.`;
    if (r.statutory && !STATUTORY_KEYS.includes(r.statutory)) return `${code}: unknown statutory tag.`;
  }

  const balances = rows.filter((r) => r.calc === 'BALANCE');
  if (balances.length > 1) return 'Only one component can balance the CTC.';
  if (!balances.length) {
    // Without a balancing line the named earnings must add to exactly 100% of
    // CTC — and flat-rupee components make that impossible to check here, so
    // this is only enforced when every earning is a percentage.
    const earn = rows.filter((r) => r.kind === 'EARNING');
    if (earn.every((r) => r.calc === 'PCT_CTC')) {
      const total = earn.reduce((a, r) => a + Number(r.value), 0);
      if (Math.abs(total - 100) > 0.001) {
        return `Earnings add up to ${total}% of CTC, not 100%. Add a balancing component or fix the percentages.`;
      }
    } else {
      return 'Add one balancing component (calc = BALANCE) so gross always reconciles to the CTC.';
    }
  }
  for (const k of ['PF', 'PT']) {
    if (rows.filter((r) => r.statutory === k).length > 1) return `More than one component is tagged ${k}.`;
  }
  return null;
}

// PUT /admin/companies/:companyId/salary-components { components: [...] }
// Replaces the set. Deleting a component drops its per-employee overrides with
// it (ON DELETE CASCADE) — published payslips are untouched, because a payslip
// stores its own lines rather than re-deriving them.
export async function replace(req, res, next) {
  try {
    const co = await scopedCompany(req, req.params.companyId);
    if (!co) return res.status(404).json({ error: 'Company not found in your organisation.' });

    const rows = (req.body?.components || []).map((r) => ({
      ...r,
      code: String(r.code || '').toUpperCase().trim(),
      basisCode: r.basisCode ? String(r.basisCode).toUpperCase().trim() : null,
      kind: String(r.kind || 'EARNING').toUpperCase(),
      calc: String(r.calc || 'FLAT').toUpperCase(),
    }));
    const bad = validate(rows);
    if (bad) return res.status(400).json({ error: bad });

    await tx(async (c) => {
      const keep = rows.filter((r) => r.id).map((r) => Number(r.id));
      await c.query(
        `DELETE FROM salary_components
          WHERE company_id=$1 AND ($2::bigint[] IS NULL OR NOT (id = ANY($2::bigint[])))`,
        [co.id, keep.length ? keep : null]);
      for (const [i, r] of rows.entries()) {
        const order = Number.isFinite(Number(r.sortOrder)) ? Number(r.sortOrder) : (i + 1) * 10;
        if (r.id) {
          await c.query(
            `UPDATE salary_components SET code=$3, label=$4, kind=$5, calc=$6, basis_code=$7,
                    value=$8, prorate=$9, taxable=$10, statutory=$11, per_employee=$12,
                    sort_order=$13, active=$14
              WHERE id=$1 AND company_id=$2`,
            [r.id, co.id, r.code, r.label, r.kind, r.calc, r.basisCode, Number(r.value),
             r.prorate !== false, r.taxable !== false, r.statutory || null,
             r.perEmployee !== false, order, r.active !== false]);
        } else {
          await c.query(
            `INSERT INTO salary_components
               (organisation_id, company_id, code, label, kind, calc, basis_code, value,
                prorate, taxable, statutory, per_employee, sort_order, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [co.organisation_id, co.id, r.code, r.label, r.kind, r.calc, r.basisCode,
             Number(r.value), r.prorate !== false, r.taxable !== false, r.statutory || null,
             r.perEmployee !== false, order, r.active !== false]);
        }
      }
    });
    await audit(req.user.id, 'SALARY_COMPONENTS_SAVE', 'company', co.id, { count: rows.length });
    res.json({ companyId: co.id, components: await loadForCompany(co.id) });
  } catch (e) {
    if (e.code === '23505' || e.code === '23514' || e.code === '23P01') {
      return res.status(409).json({ error: 'Two components share a code.' });
    }
    next(e);
  }
}

// ── Per-employee overrides ─────────────────────────────────────────────────
// A component's value is the company's unless this employee has a row of their
// own. Absent row = inherit, which is why a new joiner needs no rows at all and
// why raising the company's HRA lifts everyone who was never overridden.

async function scopedEmployee(req, raw) {
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) return null;
  return (await query(
    `SELECT e.id, e.company_id, e.first_name, e.last_name, e.employee_code
       FROM employees e
      WHERE e.id=$1 AND ($2::bigint IS NULL OR e.organisation_id=$2)
        AND ($3::bigint IS NULL OR e.company_id=$3)`,
    [id, req.orgId || null, req.companyScope || null])).rows[0] || null;
}

// GET /admin/employees/:id/salary-components
export async function forEmployee(req, res, next) {
  try {
    const e = await scopedEmployee(req, req.params.id);
    if (!e) return res.status(404).json({ error: 'Employee not found in your scope.' });
    const { rows } = await query(
      `SELECT c.*, v.value AS employee_value
         FROM salary_components c
         LEFT JOIN employee_component_values v ON v.component_id=c.id AND v.employee_id=$2
        WHERE c.company_id=$1 AND c.active
        ORDER BY c.kind DESC, c.sort_order, c.id`,
      [e.company_id, e.id]);
    const ctc = Number((await query(
      `SELECT monthly_ctc FROM salary_structures WHERE employee_id=$1`, [e.id])).rows[0]?.monthly_ctc || 0);
    res.json({
      employee: { id: Number(e.id), name: `${e.first_name} ${e.last_name}`.trim(), code: e.employee_code },
      monthlyCtc: ctc,
      components: rows.map(shape),
    });
  } catch (err) { next(err); }
}

// PUT /admin/employees/:id/salary-components { values: { HRA: 45, LTA: 2000 } }
// A code set to null or "" clears the override and the employee goes back to
// inheriting the company value — that is the only way back, so it must work.
export async function setForEmployee(req, res, next) {
  try {
    const e = await scopedEmployee(req, req.params.id);
    if (!e) return res.status(404).json({ error: 'Employee not found in your scope.' });
    const values = req.body?.values || {};

    const comps = (await query(
      `SELECT id, code, kind, calc, per_employee FROM salary_components WHERE company_id=$1 AND active`,
      [e.company_id])).rows;
    const byCode = new Map(comps.map((c) => [c.code, c]));

    const writes = [], clears = [];
    for (const [rawCode, rawVal] of Object.entries(values)) {
      const code = String(rawCode).toUpperCase();
      const c = byCode.get(code);
      if (!c) return res.status(400).json({ error: `${code} is not a component on this employee's company.` });
      if (rawVal === null || rawVal === '' || rawVal === undefined) { clears.push(c.id); continue; }
      if (!c.per_employee) return res.status(400).json({ error: `${code} is fixed for the whole company and cannot be set per employee.` });
      if (c.calc === 'BALANCE') return res.status(400).json({ error: `${code} balances the CTC, so it has no value of its own.` });
      const v = Number(rawVal);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${code}: value must be zero or more.` });
      if ((c.calc === 'PCT_CTC' || c.calc === 'PCT_OF') && v > 100) return res.status(400).json({ error: `${code}: a percentage cannot exceed 100.` });
      writes.push([c.id, v]);
    }

    await tx(async (cx) => {
      for (const id of clears) {
        await cx.query(`DELETE FROM employee_component_values WHERE employee_id=$1 AND component_id=$2`, [e.id, id]);
      }
      for (const [id, v] of writes) {
        await cx.query(
          `INSERT INTO employee_component_values (employee_id, component_id, value)
           VALUES ($1,$2,$3)
           ON CONFLICT (employee_id, component_id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
          [e.id, id, v]);
      }
    });
    await audit(req.user.id, 'EMPLOYEE_COMPONENTS_SAVE', 'employee', e.id,
      { set: writes.length, cleared: clears.length });
    req.params.id = String(e.id);
    return forEmployee(req, res, next);
  } catch (err) { next(err); }
}
