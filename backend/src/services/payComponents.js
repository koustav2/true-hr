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
  const deductions = [];
  for (const c of deductionDefs) {
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
  if (!hasTdsComponent) deductions.push({ code: 'TDS', label: 'TDS', amount: tdsAmt, statutory: 'TDS' });

  const arr = r2(arrears);
  const grossEarnings = earnings.reduce((a, e) => a + e.amount, 0) + arr;
  const totalDeductions = deductions.reduce((a, d) => a + d.amount, 0);
  return { earnings, deductions, arrears: arr, grossEarnings, totalDeductions, netPay: grossEarnings - totalDeductions };
}

/** Sum of a statutory-tagged deduction, for the PF / ESIC / PT registers. */
export const statutoryAmount = (payslipData, key) =>
  (payslipData?.deductions || []).filter((d) => d.statutory === key)
    .reduce((a, d) => a + (Number(d.amount) || 0), 0);
