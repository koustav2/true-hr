// ============================================================================
// Payslip component engine.
//
// A payslip's lines are per-company data (salary_components), not fixed
// columns, so one client can run Basic/HRA/Conveyance/Food-coupons while
// another runs Basic/HRA/Special with no LTA at all.
//
// The one invariant kept from the old fixed engine: gross earnings reconcile
// to the monthly CTC. That is what the BALANCE component is for — it absorbs
// whatever the named earnings do not cover, so an HR user can add a component
// without having to re-solve the arithmetic by hand.
// ============================================================================
import { query } from '../db/pool.js';

export const KINDS = ['EARNING', 'DEDUCTION'];
export const CALCS = ['PCT_CTC', 'PCT_OF', 'FLAT', 'BALANCE'];
export const STATUTORY_KEYS = ['PF', 'PT', 'WELFARE', 'ESIC', 'TDS'];

// Whole rupees — the same rounding the fixed engine used, so migrated payslips
// come out to the paisa (there are none) identical.
const r2 = (n) => Math.round(Number(n) || 0);

/**
 * The component set that reproduces the legacy fixed payslip exactly.
 *
 * Order matters twice over and the two orders differ: Special Allowance PRINTS
 * third but must be COMPUTED last, because it balances against everything
 * else. sort_order carries the print order; BALANCE carries the compute order.
 */
export function legacyComponents(t) {
  return [
    { code: 'BASIC',    label: 'Basic Salary',            kind: 'EARNING',   calc: 'PCT_CTC', value: t.basicPct,          sortOrder: 10, prorate: true,  taxable: true },
    { code: 'HRA',      label: 'House Rent Allowance',    kind: 'EARNING',   calc: 'PCT_OF',  value: t.hraPctOfBasic,     sortOrder: 20, prorate: true,  taxable: true, basisCode: 'BASIC' },
    { code: 'SPECIAL',  label: 'Special Allowance',       kind: 'EARNING',   calc: 'BALANCE', value: 0,                   sortOrder: 30, prorate: true,  taxable: true, perEmployee: false },
    { code: 'LTA',      label: 'Leave Travel Allowance',  kind: 'EARNING',   calc: 'FLAT',    value: t.lta,               sortOrder: 40, prorate: true,  taxable: true },
    { code: 'PERSONAL', label: 'Personal Allowance',      kind: 'EARNING',   calc: 'FLAT',    value: t.personalAllowance, sortOrder: 50, prorate: true,  taxable: true },
    { code: 'MISC',     label: 'Miscellaneous',           kind: 'EARNING',   calc: 'FLAT',    value: t.miscellaneous,     sortOrder: 60, prorate: true,  taxable: true },
    { code: 'CITY',     label: 'City Allowance',          kind: 'EARNING',   calc: 'FLAT',    value: t.cityAllowance,     sortOrder: 70, prorate: true,  taxable: true },
    { code: 'PERF',     label: 'Performance Pay',         kind: 'EARNING',   calc: 'FLAT',    value: t.performancePay,    sortOrder: 80, prorate: true,  taxable: true },
    { code: 'PF',       label: 'Provident Fund',          kind: 'DEDUCTION', calc: 'PCT_OF',  value: t.employeePfPct,     sortOrder: 10, prorate: false, taxable: false, basisCode: 'BASIC', statutory: 'PF' },
    { code: 'WELFARE',  label: 'Welfare Trust',           kind: 'DEDUCTION', calc: 'FLAT',    value: t.welfareTrust,      sortOrder: 20, prorate: false, taxable: false, statutory: 'WELFARE' },
    { code: 'PT',       label: 'Professional Tax',        kind: 'DEDUCTION', calc: 'FLAT',    value: t.professionalTax,   sortOrder: 30, prorate: false, taxable: false, statutory: 'PT' },
  ];
}

/** Which legacy structure field each component's per-employee value comes from. */
export const LEGACY_FIELD = {
  BASIC: 'basicPct', HRA: 'hraPctOfBasic', LTA: 'lta', PERSONAL: 'personalAllowance',
  MISC: 'miscellaneous', CITY: 'cityAllowance', PERF: 'performancePay',
  PF: 'employeePfPct', WELFARE: 'welfareTrust', PT: 'professionalTax',
};

export const shape = (r) => ({
  id: Number(r.id),
  code: r.code, label: r.label, kind: r.kind, calc: r.calc,
  basisCode: r.basis_code, value: Number(r.value),
  prorate: r.prorate, taxable: r.taxable, statutory: r.statutory,
  perEmployee: r.per_employee, sortOrder: r.sort_order, active: r.active,
  employeeValue: r.employee_value == null ? null : Number(r.employee_value),
});

/**
 * The component set to run for one employee: the company's definitions with
 * that employee's overrides folded in. Inactive components are left out.
 */
export async function loadForEmployee(companyId, employeeId) {
  if (!companyId) return [];
  const { rows } = await query(
    `SELECT c.*, v.value AS employee_value
       FROM salary_components c
       LEFT JOIN employee_component_values v
              ON v.component_id = c.id AND v.employee_id = $2
      WHERE c.company_id = $1 AND c.active
      ORDER BY c.kind DESC, c.sort_order, c.id`,
    [companyId, employeeId || null]);
  return rows.map(shape).map((c) => ({ ...c, value: c.employeeValue ?? c.value }));
}

export async function loadForCompany(companyId) {
  if (!companyId) return [];
  const { rows } = await query(
    `SELECT c.*, NULL::numeric AS employee_value FROM salary_components c
      WHERE c.company_id = $1 ORDER BY c.kind DESC, c.sort_order, c.id`, [companyId]);
  return rows.map(shape);
}

/**
 * Compute a payslip from a component list.
 *
 * Three passes, in this order, because each depends on the one before:
 *   1. Full monthly earnings — PCT_CTC, PCT_OF (on another full earning), FLAT.
 *   2. BALANCE = CTC minus every other full earning, floored at zero. Then the
 *      attendance factor is applied to whichever earnings prorate.
 *   3. Deductions. A deduction PCT_OF reads the FINAL (already prorated)
 *      earning — PF is a percentage of the basic actually paid, not of the
 *      full-month basic — and deductions do not prorate again on top.
 *
 * Rounding happens once per line, at the point the line is finalised, which is
 * what the fixed engine did; rounding earlier would shift totals by a rupee.
 */
export function computeFromComponents(components, {
  monthlyCtc, daysInMonth: dim, daysPaid, arrears = 0, bonus = 0, tds = 0,
}) {
  const ctc = Number(monthlyCtc) || 0;
  const factor = dim > 0 ? Math.min(1, daysPaid / dim) : 1;

  const earningDefs = components.filter((c) => c.kind === 'EARNING');
  const deductionDefs = components.filter((c) => c.kind === 'DEDUCTION');

  // ── pass 1: full monthly earnings ────────────────────────────────────────
  const full = {};
  const named = earningDefs.filter((c) => c.calc !== 'BALANCE');
  // PCT_OF may reference another earning, so resolve plain ones first.
  for (const c of named) {
    if (c.calc === 'PCT_CTC') full[c.code] = (ctc * Number(c.value)) / 100;
    else if (c.calc === 'FLAT') full[c.code] = Number(c.value);
  }
  for (const c of named) {
    if (c.calc !== 'PCT_OF') continue;
    const basis = full[c.basisCode];
    full[c.code] = ((Number(basis) || 0) * Number(c.value)) / 100;
  }

  // ── pass 2: the balancing earning, then prorate ──────────────────────────
  const namedTotal = named.reduce((a, c) => a + (Number(full[c.code]) || 0), 0);
  for (const c of earningDefs) {
    if (c.calc === 'BALANCE') full[c.code] = Math.max(0, ctc - namedTotal);
  }
  const earnings = [];
  const finalEarn = {};
  for (const c of earningDefs) {
    const amount = r2((Number(full[c.code]) || 0) * (c.prorate ? factor : 1));
    finalEarn[c.code] = amount;
    earnings.push({ code: c.code, label: c.label, amount, taxable: c.taxable });
  }
  const bon = r2(bonus);
  if (bon > 0) earnings.push({ code: 'BONUS', label: 'Bonus / Incentive', amount: bon, taxable: true });

  // ── pass 3: deductions ───────────────────────────────────────────────────
  // Nothing was earned, so there is nothing to deduct from. Non-prorated
  // deductions (professional tax, welfare trust) otherwise stayed at their full
  // monthly value against zero earnings and the slip came out NEGATIVE — a
  // payslip telling an employee on a full month of unpaid leave that they owe
  // the company money.
  const nothingEarned = factor === 0;
  const deductions = [];
  for (const c of nothingEarned ? [] : deductionDefs) {
    let amount = 0;
    if (c.calc === 'FLAT') amount = Number(c.value);
    else if (c.calc === 'PCT_CTC') amount = (ctc * Number(c.value)) / 100;
    else if (c.calc === 'PCT_OF') amount = ((Number(finalEarn[c.basisCode]) || 0) * Number(c.value)) / 100;
    // BALANCE is meaningless on a deduction; treated as zero rather than refused
    // mid-payroll, and the component editor blocks it at the door.
    amount = r2(amount * (c.prorate ? factor : 1));
    deductions.push({ code: c.code, label: c.label, amount, statutory: c.statutory || null });
  }
  // TDS is a run input, not a configured component — it comes from the tax
  // engine per month. A company that also defines a TDS component gets that
  // component's amount instead, and this line is skipped so it isn't charged twice.
  const hasTdsComponent = deductionDefs.some((c) => c.statutory === 'TDS' || c.code === 'TDS');
  const tdsAmt = r2(tds);
  if (!hasTdsComponent && !nothingEarned) {
    deductions.push({ code: 'TDS', label: 'TDS', amount: tdsAmt, statutory: 'TDS' });
  }

  const arr = r2(arrears);
  const grossEarnings = earnings.reduce((a, e) => a + e.amount, 0) + arr;
  const totalDeductions = deductions.reduce((a, d) => a + d.amount, 0);

  // The BALANCE earning clamps at zero, which is right, but nothing then checked
  // that the named earnings fit inside the CTC. When they don't, the clamp
  // absorbs nothing and gross simply exceeds the CTC with no error on screen —
  // 20,000 CTC paying 40,000. Surfaced rather than silently corrected, because
  // only HR can say which component is wrong.
  const warnings = [];
  const fullMonthNamed = r2(namedTotal);
  if (ctc > 0 && fullMonthNamed > ctc) {
    warnings.push({
      code: 'EARNINGS_EXCEED_CTC',
      message: `Fixed earnings add up to ${fullMonthNamed} against a monthly CTC of ${r2(ctc)}`
        + ' — the balancing component cannot absorb the difference, so gross pay is above CTC.',
      excess: r2(fullMonthNamed - ctc),
    });
  }

  return {
    earnings, deductions, arrears: arr, grossEarnings, totalDeductions,
    netPay: grossEarnings - totalDeductions,
    warnings,
  };
}

/** Sum of a statutory-tagged deduction, for the PF / ESIC / PT registers. */
export const statutoryAmount = (payslipData, key) =>
  (payslipData?.deductions || []).filter((d) => d.statutory === key)
    .reduce((a, d) => a + (Number(d.amount) || 0), 0);

/**
 * Annexure A rows — [[label, annualAmount], …] — from the company's real
 * component set, so an offer letter promises the same structure the first
 * payslip pays. Previously the annexure used its own hardcoded 50/40/PF split,
 * which meant an offer could say 50% basic while payroll paid 40%.
 *
 * Returns null when the company has no components; the caller then falls back
 * to the indicative split rather than issuing an offer with an empty annexure.
 */
export async function annexureFromComponents(companyId, employeeId, annualCtc) {
  const annual = Number(annualCtc) || 0;
  if (!companyId || annual <= 0) return null;
  try {
    const components = await loadForEmployee(companyId, employeeId);
    if (!components.length) return null;
    // A full month at the employee's monthly CTC, then annualised. Rounding on
    // the monthly figure and multiplying by 12 is what the year actually pays.
    const monthly = annual / 12;
    const { earnings } = computeFromComponents(components, {
      monthlyCtc: monthly, daysInMonth: 30, daysPaid: 30,
    });
    const rows = earnings.filter((e) => e.code !== 'BONUS').map((e) => [e.label, e.amount * 12]);
    return rows.length ? rows : null;
  } catch { return null; }
}

/**
 * The company's components with BOTH values kept apart — what the company runs
 * and what this employee overrides — so a screen can show "inherits 40%" next
 * to "this employee 45%", and a preview can try an unsaved override.
 */
export async function loadDetailedForEmployee(companyId, employeeId) {
  if (!companyId) return [];
  const { rows } = await query(
    `SELECT c.*, v.value AS employee_value
       FROM salary_components c
       LEFT JOIN employee_component_values v
              ON v.component_id = c.id AND v.employee_id = $2
      WHERE c.company_id = $1 AND c.active
      ORDER BY c.kind DESC, c.sort_order, c.id`,
    [companyId, employeeId || null]);
  return rows.map(shape).map((c) => ({ ...c, companyValue: c.value }));
}

/**
 * A company created after the components migration has no rows, and its
 * payslips then ran on the old fixed template (Basic 50 / HRA 50 of Basic).
 * Seed it with the same set the migration gives every older company, built from
 * the company's saved template if it has one, and carry each employee's own
 * structure across as overrides so no figure moves. Idempotent.
 */
export async function ensureCompanyComponents(companyId) {
  if (!companyId) return false;
  const have = (await query(`SELECT 1 FROM salary_components WHERE company_id=$1 LIMIT 1`, [companyId])).rowCount;
  if (have) return false;
  const c = (await query(
    `SELECT c.id, c.organisation_id, t.basic_pct, t.hra_pct_of_basic, t.employee_pf_pct, t.professional_tax,
            t.welfare_trust, t.lta, t.personal_allowance, t.miscellaneous, t.city_allowance, t.performance_pay
       FROM companies c LEFT JOIN company_salary_templates t ON t.company_id = c.id
      WHERE c.id = $1`, [companyId])).rows[0];
  if (!c) return false;
  const n = (v, d) => (v == null ? d : Number(v));
  const tpl = {
    basicPct: n(c.basic_pct, 50), hraPctOfBasic: n(c.hra_pct_of_basic, 50), employeePfPct: n(c.employee_pf_pct, 12),
    professionalTax: n(c.professional_tax, 200), welfareTrust: n(c.welfare_trust, 0), lta: n(c.lta, 0),
    personalAllowance: n(c.personal_allowance, 0), miscellaneous: n(c.miscellaneous, 0),
    cityAllowance: n(c.city_allowance, 0), performancePay: n(c.performance_pay, 0),
  };
  for (const comp of legacyComponents(tpl)) {
    await query(
      `INSERT INTO salary_components
         (organisation_id, company_id, code, label, kind, calc, basis_code, value,
          prorate, taxable, statutory, per_employee, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [c.organisation_id, c.id, comp.code, comp.label, comp.kind, comp.calc, comp.basisCode || null,
       comp.value, comp.prorate, comp.taxable, comp.statutory || null, comp.perEmployee !== false, comp.sortOrder]);
  }
  const comps = (await query(`SELECT id, code, value FROM salary_components WHERE company_id=$1`, [c.id])).rows;
  const structures = (await query(
    `SELECT ss.* FROM salary_structures ss JOIN employees e ON e.id = ss.employee_id WHERE e.company_id = $1`, [c.id])).rows;
  for (const ss of structures) {
    const own = {
      basicPct: ss.basic_pct, hraPctOfBasic: ss.hra_pct_of_basic, employeePfPct: ss.employee_pf_pct,
      professionalTax: ss.professional_tax, welfareTrust: ss.welfare_trust, lta: ss.lta,
      personalAllowance: ss.personal_allowance, miscellaneous: ss.miscellaneous,
      cityAllowance: ss.city_allowance, performancePay: ss.performance_pay,
    };
    for (const comp of comps) {
      const field = LEGACY_FIELD[comp.code];
      if (!field || own[field] == null) continue;
      if (Number(own[field]) === Number(comp.value)) continue;
      await query(
        `INSERT INTO employee_component_values (employee_id, component_id, value)
         VALUES ($1,$2,$3) ON CONFLICT (employee_id, component_id) DO NOTHING`,
        [ss.employee_id, comp.id, Number(own[field])]);
    }
  }
  return true;
}
