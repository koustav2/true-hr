import { query } from '../db/pool.js';
import { ownsEmployee, scopedByEmployee } from '../utils/scope.js';
import { legacyComponents, loadForEmployee, computeFromComponents } from '../services/payComponents.js';
import { brandForEmployee, resolveBrand, BANK_SHEET_COLUMNS, DEFAULT_OPTIONS } from '../services/docProfile.js';
import { audit } from '../utils/audit.js';
import { decrypt, mask } from '../utils/crypto.js';
import { buildPayslipPdf } from '../services/paySlipPdf.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { payslipPublishedEmail } from '../services/emailTemplates.js';
import { isoDate } from '../utils/joining.js';
import { classifyMonth, loadPayrollPolicy, warningsFor } from '../services/attendancePayroll.js';
import { professionalTax as ptForState } from '../services/statutoryRates.js';
import { config } from '../config/index.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST, canonicalState, toNumber } from '../utils/validate.js';
import { activeEmployeeSql } from '../utils/people.js';
import { AppError } from '../middleware/error.js';
import { ensureCompanyComponents, loadDetailedForEmployee } from '../services/payComponents.js';
import { fyOf, projectedAnnualGross, computeRegimeTax, aggregateDeductions, monthlyTdsFor } from '../services/incomeTax.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
const r2 = (n) => Math.round((Number(n) || 0));

// Default structure for an employee who has none yet (mirrors the % calculator defaults).
function defaultStructure() {
  return {
    grade: null, monthlyCtc: 0, basicPct: 50, hraPctOfBasic: 50, employeePfPct: 12,
    professionalTax: 200, welfareTrust: 0,
    lta: 0, personalAllowance: 0, miscellaneous: 0, cityAllowance: 0, performancePay: 0,
  };
}

/**
 * Resolve an optional company filter for a payroll run.
 *
 * An organisation may run several companies, each its own legal/payroll entity
 * with its own bank relationship — so a run is normally scoped to one of them.
 * Returns { companyId } or { error } when the id does not belong to this tenant.
 */
async function companyFilter(req, raw) {
  const v = raw ?? req.query?.companyId ?? req.body?.companyId;
  if (v === undefined || v === null || v === '' || v === 'all') return { companyId: null };
  const id = parseInt(v, 10);
  if (!Number.isFinite(id)) return { error: 'Invalid company' };
  const row = (await query(
    `SELECT id FROM companies WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
    [id, req.orgId || null])).rows[0];
  if (!row) return { error: 'That company does not belong to this organisation.' };
  return { companyId: id };
}

// Resolve the company the requesting HR belongs to (single-org fallback otherwise).
async function resolveCompanyId(req, employeeId) {
  if (employeeId) {
    const r = (await query(`SELECT company_id FROM employees WHERE id=$1`, [employeeId])).rows[0];
    if (r?.company_id) return r.company_id;
  }
  if (req?.user?.employeeId) {
    const r = (await query(`SELECT company_id FROM employees WHERE id=$1`, [req.user.employeeId])).rows[0];
    if (r?.company_id) return r.company_id;
  }
  // Never fall back to "the first company in the database" — that is another
  // tenant's company for every organisation but the first, and its template was
  // read and overwritten from here. Stay inside the caller's organisation.
  return (await query(
    `SELECT id FROM companies WHERE ($1::bigint IS NULL OR organisation_id=$1) ORDER BY id LIMIT 1`,
    [req?.orgId || null])).rows[0]?.id || null;
}

function shapeTemplate(row) {
  if (!row) {
    const d = defaultStructure();
    return {
      basicPct: d.basicPct, hraPctOfBasic: d.hraPctOfBasic, employeePfPct: d.employeePfPct,
      professionalTax: d.professionalTax, welfareTrust: d.welfareTrust,
      lta: d.lta, personalAllowance: d.personalAllowance, miscellaneous: d.miscellaneous,
      cityAllowance: d.cityAllowance, performancePay: d.performancePay,
    };
  }
  return {
    basicPct: Number(row.basic_pct), hraPctOfBasic: Number(row.hra_pct_of_basic),
    employeePfPct: Number(row.employee_pf_pct), professionalTax: Number(row.professional_tax),
    welfareTrust: Number(row.welfare_trust), lta: Number(row.lta),
    personalAllowance: Number(row.personal_allowance), miscellaneous: Number(row.miscellaneous),
    cityAllowance: Number(row.city_allowance), performancePay: Number(row.performance_pay),
  };
}

// Build an (unsaved) employee structure pre-filled from a company template.
function structureFromTemplate(t) {
  return { grade: null, monthlyCtc: 0, ...shapeTemplate(t) };
}

async function loadTemplate(companyId) {
  if (!companyId) return null;
  let row = (await query(`SELECT * FROM company_salary_templates WHERE company_id=$1`, [companyId])).rows[0];
  if (!row) {
    await query(`INSERT INTO company_salary_templates (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING`, [companyId]);
    row = (await query(`SELECT * FROM company_salary_templates WHERE company_id=$1`, [companyId])).rows[0];
  }
  return row;
}

function shapeStructure(row) {
  if (!row) return defaultStructure();
  return {
    grade: row.grade, monthlyCtc: Number(row.monthly_ctc), basicPct: Number(row.basic_pct),
    hraPctOfBasic: Number(row.hra_pct_of_basic), employeePfPct: Number(row.employee_pf_pct),
    professionalTax: Number(row.professional_tax), welfareTrust: Number(row.welfare_trust),
    lta: Number(row.lta), personalAllowance: Number(row.personal_allowance),
    miscellaneous: Number(row.miscellaneous), cityAllowance: Number(row.city_allowance),
    performancePay: Number(row.performance_pay),
  };
}

// Core engine — compute a payslip from a component list + that month's run inputs.
//
// The lines a payslip carries are per-company data now (salary_components), so
// one client can run Basic/HRA/Conveyance and another Basic/HRA/Special with no
// LTA. The arithmetic lives in services/payComponents.js.
//
// `components` omitted (or empty) means: synthesise the component set that the
// old fixed columns described. That is not a second engine — the same code path
// runs either way — it is what keeps a company created before the components
// migration, or one whose components were all deleted, computing exactly as it
// did before. Proven equal across 40,000 randomised payslips.
export function computePayslip(s, run, components) {
  const comps = components && components.length ? components : legacyComponents(s);
  return computeFromComponents(comps, { monthlyCtc: s.monthlyCtc, ...run });
}

// Load the snapshot meta (name, bank, statutory, location) for an employee.
async function loadMeta(employeeId) {
  const e = (await query(
    `SELECT e.employee_code, e.first_name, e.last_name, e.location,
            d.title AS designation
       FROM employees e LEFT JOIN designations d ON d.id=e.designation_id
      WHERE e.id=$1`, [employeeId])).rows[0] || {};
  const bank = (await query(`SELECT bank_name, branch, account_number_enc FROM employee_bank WHERE employee_id=$1`, [employeeId])).rows[0] || {};
  const stat = (await query(`SELECT pan_enc, uan FROM employee_statutory WHERE employee_id=$1`, [employeeId])).rows[0] || {};
  const addr = (await query(`SELECT state, city FROM employee_addresses WHERE employee_id=$1 LIMIT 1`, [employeeId])).rows[0] || {};
  return {
    employeeCode: e.employee_code || null,
    name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
    designation: e.designation || null,
    bankName: bank.bank_name || null,
    accountNumber: bank.account_number_enc ? mask(decrypt(bank.account_number_enc)) : null,
    pan: stat.pan_enc ? decrypt(stat.pan_enc) : null,
    uan: stat.uan || null,
    location: e.location || addr.city || null,
    state: addr.state || null,
  };
}

// ── One compute path (H78) ───────────────────────────────────────────────────
// The structure preview, the components preview and the payroll run all come
// through computeForEmployee, so what HR previews is what the payslip pays.

// Where the employee works, for the Professional Tax slab (H69): the posting
// state, else a location that is a state name, else the current address.
export async function workStateOf(employeeId) {
  const e = (await query(
    `SELECT e.posting_state, e.location,
            (SELECT a.state FROM employee_addresses a WHERE a.employee_id=e.id
              ORDER BY (a.type='CURRENT') DESC, a.id LIMIT 1) AS addr_state
       FROM employees e WHERE e.id=$1`, [employeeId])).rows[0] || {};
  return canonicalState(e.posting_state) || canonicalState(e.location) || canonicalState(e.addr_state) || null;
}

async function ptOverridesFor(orgId, state) {
  if (!state) return null;
  try {
    const rows = (await query(
      `SELECT upto_gross AS upto, amount FROM professional_tax_slabs
        WHERE lower(state)=lower($1) AND organisation_id IS NOT DISTINCT FROM $2 ORDER BY upto_gross`,
      [state, orgId || null])).rows;
    return rows.length ? rows : null;
  } catch { return null; }
}

/**
 * Compute a payslip for one employee.
 *  monthlyCtc   the CTC to compute on (defaults to the saved structure)
 *  overrides    { CODE: value | null } unsaved per-employee values to try (null = company value)
 *  statePt      derive PT from the work-state slab on this month's gross (v2 / STATE_PT)
 * Returns { calc, components, pt: { state, amount, source } }.
 */
export async function computeForEmployee(employeeId, {
  monthlyCtc, overrides = null, year, month, daysInMonth: dim, daysPaid, arrears = 0, bonus = 0, tds = 0,
  statePt = false, structure = null,
} = {}) {
  const emp = (await query(`SELECT company_id, organisation_id FROM employees WHERE id=$1`, [employeeId])).rows[0] || {};
  const sRow = structure ? null : (await query(`SELECT * FROM salary_structures WHERE employee_id=$1`, [employeeId])).rows[0];
  const s = structure || shapeStructure(sRow);
  const ctc = monthlyCtc != null ? Number(monthlyCtc) : Number(s.monthlyCtc) || 0;
  let components = (await loadDetailedForEmployee(emp.company_id, employeeId))
    .map((c) => ({ ...c, value: c.employeeValue ?? c.companyValue }));
  if (overrides && components.length) {
    components = components.map((c) => {
      if (!Object.prototype.hasOwnProperty.call(overrides, c.code)) return c;
      const v = overrides[c.code];
      return { ...c, value: v === null || v === '' || v === undefined ? c.companyValue : Number(v) };
    });
  }
  const d = dim || 30;
  const run = { daysInMonth: d, daysPaid: daysPaid ?? d, arrears, bonus, tds };
  let calc = computePayslip({ ...s, monthlyCtc: ctc }, run, components);
  let pt = { state: null, amount: null, source: 'component' };
  if (statePt) {
    const state = await workStateOf(employeeId);
    if (state) {
      // PT is levied on the month's gross earnings, on the state's slab.
      const ov = await ptOverridesFor(emp.organisation_id, state);
      const amount = ptForState(state, calc.grossEarnings, { month, overrides: ov });
      const comps = components.length ? components : legacyComponents({ ...s, monthlyCtc: ctc });
      const hasPt = comps.some((c) => c.statutory === 'PT');
      if (hasPt) {
        components = comps.map((c) => (c.statutory === 'PT' ? { ...c, value: amount, prorate: false, calc: 'FLAT' } : c));
        calc = computePayslip({ ...s, monthlyCtc: ctc }, run, components);
      }
      pt = { state, amount, source: ov ? 'organisation slab' : 'state slab' };
    }
  }
  return { calc, components, pt, monthlyCtc: ctc };
}

// TDS for one month from the income-tax engine (v2 run): the year's tax on the
// projected salary, less the FY's verified declarations (old regime), less TDS
// already deducted this FY, spread over the months left.
export async function autoTdsFor(employeeId, year, month, monthlyCtc) {
  const fy = fyOf(year, month);
  const e = (await query(`SELECT date_of_joining FROM employees WHERE id=$1`, [employeeId])).rows[0] || {};
  const grossAnnual = projectedAnnualGross({ monthlyCtc, doj: isoDate(e.date_of_joining), fyStartYear: fy.startYear });
  const decl = (await query(
    `SELECT id, regime, status FROM investment_declarations WHERE employee_id=$1 AND financial_year=$2`,
    [employeeId, fy.label])).rows[0];
  let items = [];
  if (decl?.status === 'verified') {
    items = (await query(
      `SELECT section, COALESCE(approved_amount, declared_amount) AS amount
         FROM investment_declaration_items WHERE declaration_id=$1`, [decl.id])).rows
      .map((i) => ({ section: i.section, amount: Number(i.amount) }));
  }
  const regime = decl?.regime === 'old' ? 'old' : 'new';
  const annualTax = computeRegimeTax({ grossAnnual, regime, deductions: aggregateDeductions(items) }).totalTax;
  // Months already behind us in this FY (April = index 0).
  const idx = (Number(year) - fy.startYear) * 12 + (Number(month) - 4);
  const dojIso = isoDate(e.date_of_joining);
  let startIdx = 0;
  if (dojIso) {
    const di = (Number(dojIso.slice(0, 4)) - fy.startYear) * 12 + (Number(dojIso.slice(5, 7)) - 4);
    startIdx = Math.max(0, di);
  }
  const remaining = 12 - Math.max(idx, startIdx);
  const already = Number((await query(
    `SELECT COALESCE(SUM(tds),0) AS t FROM payslips
      WHERE employee_id=$1 AND ((year=$2 AND month>=4) OR (year=$3 AND month<=3))
        AND (year*100+month) < ($4::int*100+$5::int)`,
    [employeeId, fy.startYear, fy.startYear + 1, year, month])).rows[0].t) || 0;
  return { tds: monthlyTdsFor({ annualTax, alreadyDeducted: already, remainingMonths: remaining }), annualTax, grossAnnual, regime, verified: decl?.status === 'verified' };
}

// ── Employee ─────────────────────────────────────────────────────────────────

// GET /payslips — only the signed-in employee's own published payslips, newest first.
export async function list(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const code = (await query(`SELECT employee_code FROM employees WHERE id=$1`, [empId])).rows[0]?.employee_code || null;
    const rows = (await query(
      `SELECT id, year, month FROM payslips
        WHERE employee_id=$1 AND status='PUBLISHED'
        ORDER BY year DESC, month DESC`, [empId])).rows;
    res.json(rows.map((r) => ({
      id: r.id, year: r.year, month: r.month, monthName: MONTHS[r.month - 1],
      employeeCode: code, available: true,
    })));
  } catch (e) { next(e); }
}

function shapePayslip(row) {
  return {
    id: row.id, year: row.year, month: row.month, monthName: MONTHS[row.month - 1],
    status: row.status, daysInMonth: row.days_in_month, daysPaid: Number(row.days_paid),
    grossEarnings: Number(row.gross_earnings), totalDeductions: Number(row.total_deductions),
    netPay: Number(row.net_pay), generatedAt: row.generated_at, publishedAt: row.published_at,
    ...row.data, // earnings, deductions, meta, arrears
  };
}

// GET /payslips/:id — own, published
export async function detail(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const row = (await query(`SELECT * FROM payslips WHERE id=$1`, [req.params.id])).rows[0];
    if (!row || row.employee_id !== empId) return res.status(404).json({ error: 'Payslip not found' });
    if (row.status !== 'PUBLISHED') return res.status(404).json({ error: 'Payslip not available yet' });
    res.json(shapePayslip(row));
  } catch (e) { next(e); }
}

// GET /payslips/:id/pdf — own, published
export async function pdf(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const row = (await query(`SELECT * FROM payslips WHERE id=$1`, [req.params.id])).rows[0];
    if (!row || row.employee_id !== empId || row.status !== 'PUBLISHED') return res.status(404).json({ error: 'Payslip not available' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="payslip-${row.year}-${String(row.month).padStart(2, '0')}.pdf"`);
    buildPayslipPdf(shapePayslip(row), res, await brandForEmployee(row.employee_id));
  } catch (e) { next(e); }
}

// ── HR admin ─────────────────────────────────────────────────────────────────

// GET /admin/salary-structure/:employeeId
// Returns the saved per-employee structure, or — if none — one pre-filled from the
// employee's company template so HR only needs to enter CTC.
export async function getStructure(req, res, next) {
  try {
    if (!(await ownsEmployee(req, req.params.employeeId))) return res.status(404).json({ error: 'Employee not found' });
    const row = (await query(`SELECT * FROM salary_structures WHERE employee_id=$1`, [req.params.employeeId])).rows[0];
    if (row) return res.json({ ...shapeStructure(row), saved: true });
    const companyId = await resolveCompanyId(req, req.params.employeeId);
    const t = await loadTemplate(companyId);
    res.json({ ...structureFromTemplate(t), saved: false });
  } catch (e) { next(e); }
}

// GET /admin/salary-template — the company-wide default
export async function getTemplate(req, res, next) {
  try {
    const companyId = await resolveCompanyId(req);
    res.json(shapeTemplate(await loadTemplate(companyId)));
  } catch (e) { next(e); }
}

// PUT /admin/salary-template — update the company-wide default
export async function setTemplate(req, res, next) {
  try {
    const companyId = await resolveCompanyId(req);
    if (!companyId) return res.status(409).json({ error: 'No company found' });
    const b = req.body || {};
    await query(
      `INSERT INTO company_salary_templates
         (company_id, basic_pct, hra_pct_of_basic, employee_pf_pct, professional_tax, welfare_trust,
          lta, personal_allowance, miscellaneous, city_allowance, performance_pay, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (company_id) DO UPDATE SET
         basic_pct=EXCLUDED.basic_pct, hra_pct_of_basic=EXCLUDED.hra_pct_of_basic,
         employee_pf_pct=EXCLUDED.employee_pf_pct, professional_tax=EXCLUDED.professional_tax,
         welfare_trust=EXCLUDED.welfare_trust, lta=EXCLUDED.lta, personal_allowance=EXCLUDED.personal_allowance,
         miscellaneous=EXCLUDED.miscellaneous, city_allowance=EXCLUDED.city_allowance,
         performance_pay=EXCLUDED.performance_pay, updated_at=now()`,
      [companyId, b.basicPct ?? 50, b.hraPctOfBasic ?? 50, b.employeePfPct ?? 12, b.professionalTax ?? 200,
       b.welfareTrust ?? 0, b.lta ?? 0, b.personalAllowance ?? 0, b.miscellaneous ?? 0, b.cityAllowance ?? 0, b.performancePay ?? 0]);
    await audit(req.user.id, 'SALARY_TEMPLATE_SET', 'company_salary_template', companyId, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// PUT /admin/salary-structure/:employeeId
export async function setStructure(req, res, next) {
  try {
    const id = parseInt(req.params.employeeId, 10);
    if (!(await ownsEmployee(req, id))) return res.status(404).json({ error: 'Employee not found' });
    const b = req.body || {};
    await query(
      `INSERT INTO salary_structures
         (employee_id, grade, monthly_ctc, basic_pct, hra_pct_of_basic, employee_pf_pct,
          professional_tax, welfare_trust, lta, personal_allowance, miscellaneous, city_allowance, performance_pay, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       ON CONFLICT (employee_id) DO UPDATE SET
         grade=EXCLUDED.grade, monthly_ctc=EXCLUDED.monthly_ctc, basic_pct=EXCLUDED.basic_pct,
         hra_pct_of_basic=EXCLUDED.hra_pct_of_basic, employee_pf_pct=EXCLUDED.employee_pf_pct,
         professional_tax=EXCLUDED.professional_tax, welfare_trust=EXCLUDED.welfare_trust,
         lta=EXCLUDED.lta, personal_allowance=EXCLUDED.personal_allowance, miscellaneous=EXCLUDED.miscellaneous,
         city_allowance=EXCLUDED.city_allowance, performance_pay=EXCLUDED.performance_pay, updated_at=now()`,
      [id, b.grade || null, b.monthlyCtc || 0, b.basicPct ?? 50, b.hraPctOfBasic ?? 50, b.employeePfPct ?? 12,
       b.professionalTax ?? 200, b.welfareTrust ?? 0, b.lta ?? 0, b.personalAllowance ?? 0,
       b.miscellaneous ?? 0, b.cityAllowance ?? 0, b.performancePay ?? 0]);
    await audit(req.user.id, 'SALARY_STRUCTURE_SET', 'salary_structure', id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// v2 run sheet (H67, D7): employees only — never candidates, never someone
// deactivated — plus anyone who left during or after this month (they are owed
// a final salary) and anyone who already has a slip for it.
const runSheetWhere = `(
  ${activeEmployeeSql('e')}
  OR p.id IS NOT NULL
  OR (e.employee_code IS NOT NULL AND e.employee_code <> '' AND e.onboarding_status <> 'INACTIVE' AND EXISTS (
        SELECT 1 FROM resignations rq WHERE rq.employee_id = e.id AND rq.status = 'APPROVED'
           AND rq.last_working_date >= make_date($1::int, $2::int, 1)))
)`;

// GET /admin/payslips?year=&month=  — run sheet for all employees
export async function adminList(req, res, next) {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
    const cf = await companyFilter(req);
    if (cf.error) return res.status(400).json({ error: cf.error });
    const rows = (await query(
      `SELECT e.id AS employee_id, e.employee_code, e.first_name, e.last_name,
              (ss.id IS NOT NULL) AS has_structure, ss.monthly_ctc,
              p.id AS payslip_id, p.status, p.net_pay, p.days_paid, p.days_in_month,
              p.present_days, p.leave_days, p.lop_days, p.unexplained_days, p.attendance_basis
         FROM employees e
         LEFT JOIN salary_structures ss ON ss.employee_id=e.id
         LEFT JOIN payslips p ON p.employee_id=e.id AND p.year=$1 AND p.month=$2
        WHERE ${isV2(req) ? runSheetWhere : `e.onboarding_status NOT IN ('REJECTED','EXPIRED')`}
          AND ($3::bigint IS NULL OR e.organisation_id = $3)
          AND ($4::bigint IS NULL OR e.company_id = $4)
        ORDER BY e.first_name, e.last_name`, [year, month, req.orgId || null, cf.companyId])).rows;
    const num = (v) => (v != null ? Number(v) : null);
    const shaped = rows.map((r) => ({
      employeeId: r.employee_id, employeeCode: r.employee_code,
      name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      hasStructure: r.has_structure, monthlyCtc: num(r.monthly_ctc),
      payslipId: r.payslip_id, status: r.status, netPay: num(r.net_pay),
      daysPaid: num(r.days_paid), daysInMonth: r.days_in_month ?? null,
      presentDays: num(r.present_days), leaveDays: num(r.leave_days),
      lopDays: num(r.lop_days), unexplainedDays: num(r.unexplained_days),
      attendanceBasis: r.attendance_basis || null,
      // Surfaced on the run sheet so HR can see, before publishing, who has
      // days that attendance cannot account for.
      needsReview: Number(r.unexplained_days || 0) > 0,
    }));
    const policy = await loadPayrollPolicy(req.orgId);
    res.json({
      year, month, monthName: MONTHS[month - 1],
      companyId: cf.companyId,
      policy: { attendanceBased: policy.attendanceBased, deductUnexplained: policy.deductUnexplained },
      summary: {
        employees: shaped.length,
        withStructure: shaped.filter((r) => r.hasStructure).length,
        generated: shaped.filter((r) => r.status).length,
        published: shaped.filter((r) => r.status === 'PUBLISHED').length,
        draft: shaped.filter((r) => r.status === 'DRAFT').length,
        netTotal: shaped.reduce((a, r) => a + (r.netPay || 0), 0),
        publishedNetTotal: shaped.filter((r) => r.status === 'PUBLISHED').reduce((a, r) => a + (r.netPay || 0), 0),
        needingReview: shaped.filter((r) => r.needsReview).length,
        unexplainedDays: shaped.reduce((a, r) => a + (r.unexplainedDays || 0), 0),
      },
      rows: shaped,
    });
  } catch (e) { next(e); }
}

// ── Run engine ───────────────────────────────────────────────────────────────
// Enterprise-style run inputs for one employee & month:
//   · prorated from the joining date (joiners mid-month)
//   · prorated to the approved last working date (leavers mid-month)
//   · LOP: approved Leave-Without-Pay days inside the payable window
// Returns null when the employee is not payable that month at all.
async function runInputs(employeeId, year, month) {
  const dim = daysInMonth(Number(year), Number(month));
  const mm = String(month).padStart(2, '0');
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(dim).padStart(2, '0')}`;

  const emp = (await query(
    `SELECT date_of_joining, organisation_id FROM employees WHERE id=$1`, [employeeId])).rows[0] || {};
  const doj = emp.date_of_joining;

  // An exit can come from either side: an approved resignation, or an
  // employer-initiated termination. Whichever ends the service first wins.
  const resignLwd = (await query(
    `SELECT last_working_date FROM resignations
      WHERE employee_id=$1 AND status='APPROVED' ORDER BY id DESC LIMIT 1`, [employeeId]))
    .rows[0]?.last_working_date;
  const termLwd = (await query(
    `SELECT last_working_date FROM terminations
      WHERE employee_id=$1 AND status='ACTIVE' ORDER BY id DESC LIMIT 1`, [employeeId]))
    .rows[0]?.last_working_date;
  const lwdCandidates = [isoDate(resignLwd), isoDate(termLwd)].filter(Boolean).sort();
  const lwdIso = lwdCandidates[0] || null;

  let start = 1, end = dim;
  const dojIso = isoDate(doj);
  if (dojIso) {
    if (dojIso > last) return null;                       // joins after this month
    if (dojIso >= first) start = Number(dojIso.slice(8, 10));
  }
  if (lwdIso) {
    if (lwdIso < first) return null;                      // exited before this month
    if (lwdIso <= last) end = Number(lwdIso.slice(8, 10));
  }
  if (end < start) return null;

  const policy = await loadPayrollPolicy(emp.organisation_id);

  // ── Attendance-driven (default) ────────────────────────────────────────────
  if (policy.attendanceBased) {
    const c = await classifyMonth(employeeId, year, month, { start, end }, policy);
    return {
      dim, daysPaid: c.daysPaid, lopDays: c.lopDays, payableDays: c.payableDays,
      presentDays: c.presentDays, leaveDays: c.leaveDays, holidayDays: c.holidayDays,
      weekOffDays: c.weekOffDays, unexplainedDays: c.unexplainedDays,
      basis: 'ATTENDANCE', warnings: warningsFor(c), dayMap: c.days,
    };
  }

  // ── Calendar fallback (organisation opted out of attendance-based pay) ─────
  const from = `${year}-${mm}-${String(start).padStart(2, '0')}`;
  const to = `${year}-${mm}-${String(end).padStart(2, '0')}`;
  const lop = Number((await query(
    `SELECT COALESCE(SUM(LEAST(lr.to_date,$3::date) - GREATEST(lr.from_date,$2::date) + 1), 0) AS d
       FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id
      WHERE lr.employee_id=$1 AND lr.status='APPROVED' AND lt.code='LWP'
        AND lr.from_date <= $3::date AND lr.to_date >= $2::date`,
    [employeeId, from, to])).rows[0].d) || 0;

  const payableDays = end - start + 1;
  return {
    dim, daysPaid: Math.max(0, payableDays - lop), lopDays: lop, payableDays,
    basis: 'CALENDAR', warnings: [],
  };
}

// Shared by single + bulk generation. Returns { ok } or { skip: reason }.
// Exported so the demo seed can build its payslips through the real engine
// instead of inserting rows by hand — what a demo shows should be what the
// product computes, so a wrong figure there is a bug and not just bad seed data.
export async function generateFor(employeeId, year, month, opts, reqUser) {
  const existing = (await query(
    `SELECT status FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [employeeId, year, month])).rows[0];
  if (existing?.status === 'PUBLISHED') return { skip: 'already published (unpublish first to regenerate)' };

  const sRow = (await query(`SELECT * FROM salary_structures WHERE employee_id=$1`, [employeeId])).rows[0];
  if (!sRow) return { skip: 'no salary structure' };
  const s = shapeStructure(sRow);
  if (!(s.monthlyCtc > 0)) return { skip: 'monthly CTC is zero' };

  const auto = await runInputs(employeeId, year, month);
  if (!auto) return { skip: 'not payable this month (joined later / exited earlier)' };
  const dim = auto.dim;
  const daysPaid = opts.daysPaid != null && opts.daysPaid !== '' ? Number(opts.daysPaid) : auto.daysPaid;

  const meta = await loadMeta(employeeId);
  // One compute path for preview and run (H78). The component set this
  // employee's company runs, with their own overrides folded in; PT from the
  // work-state slab when asked for (v2) or switched on (STATE_PT).
  let tds = Number(opts.tds) || 0;
  let tdsAuto = null;
  if (opts.autoTds && (opts.tds === undefined || opts.tds === null || opts.tds === '')) {
    tdsAuto = await autoTdsFor(employeeId, year, month, s.monthlyCtc);
    tds = tdsAuto.tds;
  }
  const { calc, pt } = await computeForEmployee(employeeId, {
    structure: s, year, month: Number(month), daysInMonth: dim, daysPaid,
    arrears: Number(opts.arrears) || 0, bonus: Number(opts.bonus) || 0, tds,
    statePt: !!(opts.statePt || config.statePT),
  });
  if (pt.state) { meta.state = meta.state || pt.state; s.professionalTax = pt.amount; }
  if (tdsAuto) meta.tds = { basis: 'AUTO', annualTax: tdsAuto.annualTax, projectedGross: tdsAuto.grossAnnual, regime: tdsAuto.regime, verifiedDeclaration: tdsAuto.verified };
  if (opts.blockNegative && calc.netPay < 0) {
    return { error: `Net pay would be ₹${calc.netPay.toLocaleString('en-IN')} — deductions are more than the earnings. Reduce the TDS or deductions.`, status: 400, field: 'tds' };
  }
  meta.grade = s.grade;
  meta.lopDays = auto.lopDays;
  // Attendance breakdown travels with the slip so a published payslip always
  // explains how its days-paid figure was reached, even if punches change later.
  meta.attendance = auto.basis === 'ATTENDANCE' ? {
    basis: 'ATTENDANCE',
    payableDays: auto.payableDays,
    presentDays: auto.presentDays,
    leaveDays: auto.leaveDays,
    holidayDays: auto.holidayDays,
    weekOffDays: auto.weekOffDays,
    lopDays: auto.lopDays,
    unexplainedDays: auto.unexplainedDays,
    manualOverride: opts.daysPaid != null && opts.daysPaid !== '',
  } : { basis: 'CALENDAR', payableDays: auto.payableDays, lopDays: auto.lopDays };
  // The pay engine's own warnings ride along with the attendance ones, so an
  // over-CTC salary structure shows up on the run sheet HR already reviews
  // instead of being silently paid.
  const warnings = [...(auto.warnings || []), ...(calc.warnings || [])];
  const data = {
    earnings: calc.earnings, deductions: calc.deductions, arrears: calc.arrears, meta,
    warnings,
  };

  const row = (await query(
    `INSERT INTO payslips
       (employee_id, year, month, status, days_in_month, days_paid, arrears, bonus, tds,
        gross_earnings, total_deductions, net_pay, data, generated_by, generated_at,
        present_days, leave_days, holiday_days, weekoff_days, lop_days, unexplained_days, attendance_basis)
     VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(),
             $14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (employee_id, year, month) DO UPDATE SET
       status='DRAFT', days_in_month=EXCLUDED.days_in_month, days_paid=EXCLUDED.days_paid,
       arrears=EXCLUDED.arrears, bonus=EXCLUDED.bonus, tds=EXCLUDED.tds,
       gross_earnings=EXCLUDED.gross_earnings, total_deductions=EXCLUDED.total_deductions,
       net_pay=EXCLUDED.net_pay, data=EXCLUDED.data, generated_by=EXCLUDED.generated_by,
       generated_at=now(), published_at=NULL,
       present_days=EXCLUDED.present_days, leave_days=EXCLUDED.leave_days,
       holiday_days=EXCLUDED.holiday_days, weekoff_days=EXCLUDED.weekoff_days,
       lop_days=EXCLUDED.lop_days, unexplained_days=EXCLUDED.unexplained_days,
       attendance_basis=EXCLUDED.attendance_basis
     RETURNING *`,
    [employeeId, year, month, dim, daysPaid, calc.arrears, Number(opts.bonus) || 0, tds,
     calc.grossEarnings, calc.totalDeductions, calc.netPay, JSON.stringify(data), reqUser.employeeId || null,
     auto.presentDays ?? null, auto.leaveDays ?? null, auto.holidayDays ?? null,
     auto.weekOffDays ?? null, auto.lopDays ?? 0, auto.unexplainedDays ?? 0, auto.basis || 'CALENDAR'])).rows[0];
  await audit(reqUser.id, 'PAYSLIP_GENERATE', 'payslip', row.id, { employeeId, year, month });
  return { ok: true, row, warnings };
}

// v2 (C21): days paid within the month, no negative or absurd amounts. TDS
// left blank is worked out by the tax engine.
const MAX_AMOUNT = 10000000; // ₹1 crore — far above any one month's arrears, bonus or TDS
function validateRunInputs(b) {
  const v = validator();
  const y = Number(b.year); const m = Number(b.month);
  const thisYear = new Date().getFullYear();
  v.number('year', b.year, 'Year', { required: true, integer: true, min: 2000, max: thisYear + 1 });
  v.number('month', b.month, 'Month', { required: true, integer: true, min: 1, max: 12 });
  const dim = (y && m >= 1 && m <= 12) ? daysInMonth(y, m) : 31;
  v.number('daysPaid', b.daysPaid, 'Days paid', { min: 0, max: dim, decimals: 1 });
  v.number('arrears', b.arrears, 'Arrears', { min: 0, max: MAX_AMOUNT, decimals: 2 });
  v.number('bonus', b.bonus, 'Bonus', { min: 0, max: MAX_AMOUNT, decimals: 2 });
  v.number('tds', b.tds, 'TDS', { min: 0, max: MAX_AMOUNT, decimals: 2 });
  v.throwIfAny();
}

// POST /admin/payslips/generate { employeeId, year, month, daysPaid?, arrears, bonus, tds }
// daysPaid left blank ⇒ auto (prorated by joining/exit dates, minus approved LWP days).
export async function generate(req, res, next) {
  try {
    const { employeeId, year, month } = req.body;
    if (!employeeId || !year || !month) return res.status(400).json({ error: 'employeeId, year and month are required' });
    // Unscoped, this generated a payslip for another tenant's employee and
    // returned their gross, deductions and net pay in the response.
    if (!(await ownsEmployee(req, employeeId))) return res.status(404).json({ error: 'Employee not found' });
    let opts = req.body;
    if (isV2(req)) {
      validateRunInputs(req.body);
      const b = req.body;
      opts = { daysPaid: toNumber(b.daysPaid), arrears: toNumber(b.arrears) || 0, bonus: toNumber(b.bonus) || 0,
        tds: toNumber(b.tds), statePt: true, autoTds: true, blockNegative: true };
    }
    const out = await generateFor(employeeId, year, month, opts, req.user);
    if (out.error) throw new AppError(out.error, out.status || 400, { [out.field || 'form']: out.error });
    if (out.skip) return res.status(409).json({ error: `Cannot generate: ${out.skip}` });
    res.json(shapePayslip(out.row));
  } catch (e) { next(e); }
}

// POST /admin/payslips/generate-all { year, month } — one-click payroll run.
// Generates drafts for every active employee with a structure; published slips
// and non-payable employees are skipped and reported back.
export async function generateAll(req, res, next) {
  try {
    const { year, month } = req.body || {};
    if (!year || !month) return res.status(400).json({ error: 'year and month are required' });
    if (isV2(req)) { const vv = validator(); vv.number('year', year, 'Year', { integer: true, min: 2000, max: new Date().getFullYear() + 1 }); vv.number('month', month, 'Month', { integer: true, min: 1, max: 12 }); vv.throwIfAny(); }
    const cf = await companyFilter(req);
    if (cf.error) return res.status(400).json({ error: cf.error });
    // Scoped to the caller's organisation (and optionally one company): without
    // this the run would generate payslips for every tenant in the database.
    const v2 = isV2(req);
    const emps = (await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name
         FROM employees e JOIN salary_structures ss ON ss.employee_id=e.id
        WHERE ${v2 ? `(${activeEmployeeSql('e')} OR (e.employee_code IS NOT NULL AND e.onboarding_status <> 'INACTIVE' AND EXISTS (
                SELECT 1 FROM resignations rq WHERE rq.employee_id=e.id AND rq.status='APPROVED'
                   AND rq.last_working_date >= make_date(${Number(year) | 0}, ${Number(month) | 0}, 1))))` : `e.onboarding_status='ACTIVE'`}
          AND ($1::bigint IS NULL OR e.organisation_id=$1)
          AND ($2::bigint IS NULL OR e.company_id=$2)
        ORDER BY e.first_name, e.last_name`, [req.orgId || null, cf.companyId])).rows;
    let generated = 0;
    const skipped = [];
    for (const e of emps) {
      // v2: PT on the work-state slab and TDS from the tax engine — v1 ran
      // every slip with TDS 0 because no inputs were passed.
      const out = await generateFor(e.id, year, month, v2 ? { statePt: true, autoTds: true, blockNegative: true } : {}, req.user);
      if (out.ok) generated += 1;
      else skipped.push({ employeeCode: e.employee_code, name: `${e.first_name} ${e.last_name}`.trim(), reason: out.skip || out.error });
    }
    await audit(req.user.id, 'PAYROLL_RUN_GENERATE_ALL', 'payslip', null,
      { year, month, generated, skipped: skipped.length, organisationId: req.orgId, companyId: cf.companyId });
    res.json({ ok: true, generated, skipped, companyId: cf.companyId });
  } catch (e) { next(e); }
}

// Fire-and-forget "your payslip is ready" email to the employee.
async function notifyPublished(payslipId) {
  try {
    const row = (await query(
      `SELECT p.year, p.month, p.net_pay, e.first_name, ua.email
         FROM payslips p
         JOIN employees e ON e.id=p.employee_id
         LEFT JOIN user_accounts ua ON ua.employee_id=e.id
        WHERE p.id=$1`, [payslipId])).rows[0];
    if (!row?.email) return;
    const monthName = MONTHS[row.month - 1];
    await enqueueEmail({
      to: row.email,
      subject: `TRUE HR — your payslip for ${monthName} ${row.year} is ready`,
      html: payslipPublishedEmail({ name: row.first_name, monthName, year: row.year, netPay: Number(row.net_pay) }),
      template: 'payslip_published',
    });
  } catch { /* payroll must not fail on mail issues */ }
}

// H68: a month's payroll is published after the month closes. Before that,
// attendance is incomplete — v2 asks for an explicit override.
const truthy = (v) => v === true || v === 'true';
function monthOpen(year, month) {
  const last = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(Number(year), Number(month))).padStart(2, '0')}`;
  return todayIST() <= last; // the last day itself is still open
}
function monthOpenError(year, month) {
  const dim = daysInMonth(Number(year), Number(month));
  return {
    error: `${MONTHS[month - 1]} ${year} has not ended yet (it closes after ${String(dim).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}), so attendance for it is incomplete. Tick "Publish before the month ends" to publish anyway.`,
    code: 'MONTH_OPEN',
    fields: { allowBeforeMonthEnd: 'Confirm publishing before the month ends' },
  };
}

// POST /admin/payslips/:id/publish
export async function publish(req, res, next) {
  try {
    const mine = await scopedByEmployee(req, 'payslips', req.params.id, { cols: 't.id, t.status, t.year, t.month, t.net_pay' });
    if (!mine) return res.status(404).json({ error: 'Payslip not found' });
    let early = false;
    if (isV2(req)) {
      if (mine.status === 'PUBLISHED') return res.status(409).json({ error: 'This payslip is already published.' });
      if (Number(mine.net_pay) < 0) return res.status(409).json({ error: 'Net pay is negative — correct the payslip before publishing.' });
      early = monthOpen(mine.year, mine.month);
      if (early && !truthy(req.body?.allowBeforeMonthEnd)) return res.status(409).json(monthOpenError(mine.year, mine.month));
    }
    const row = (await query(
      `UPDATE payslips SET status='PUBLISHED', published_at=now(), early_publish=$2 WHERE id=$1 RETURNING id`, [mine.id, early])).rows[0];
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    await audit(req.user.id, 'PAYSLIP_PUBLISH', 'payslip', row.id, early ? { beforeMonthEnd: true } : {});
    await notifyPublished(row.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /admin/payslips/publish-all { year, month } — publish every draft of the
// month in one go and email each employee that their payslip is available.
export async function publishAll(req, res, next) {
  try {
    const { year, month } = req.body || {};
    if (!year || !month) return res.status(400).json({ error: 'year and month are required' });
    const cf = await companyFilter(req);
    if (cf.error) return res.status(400).json({ error: cf.error });
    // Publishing emails every affected employee, so the update MUST be limited to
    // the caller's own organisation (and optionally one company). Unscoped, this
    // would finalise and notify another tenant's payroll.
    let early = false;
    if (isV2(req)) {
      early = monthOpen(year, month);
      if (early && !truthy(req.body?.allowBeforeMonthEnd)) return res.status(409).json(monthOpenError(year, month));
    }
    const rows = (await query(
      `UPDATE payslips p SET status='PUBLISHED', published_at=now(), early_publish=${early ? 'true' : 'false'}
         FROM employees e
        WHERE e.id = p.employee_id
          AND p.year=$1 AND p.month=$2 AND p.status='DRAFT'
          AND (${isV2(req) ? 'p.net_pay >= 0' : 'true'})
          AND ($3::bigint IS NULL OR e.organisation_id=$3)
          AND ($4::bigint IS NULL OR e.company_id=$4)
        RETURNING p.id`, [year, month, req.orgId || null, cf.companyId])).rows;
    for (const r of rows) await notifyPublished(r.id);
    await audit(req.user.id, 'PAYROLL_RUN_PUBLISH_ALL', 'payslip', null,
      { year, month, published: rows.length, organisationId: req.orgId, companyId: cf.companyId });
    res.json({ ok: true, published: rows.length, companyId: cf.companyId });
  } catch (e) { next(e); }
}

// GET /admin/payslips/export?year=&month= — bank-advice sheet (CSV) of the
// month's published payslips: full account details + net pay for the transfer file.
export async function exportBankSheet(req, res, next) {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    if (!year || !month) return res.status(400).json({ error: 'year and month are required' });
    const cf = await companyFilter(req);
    if (cf.error) return res.status(400).json({ error: cf.error });
    // Scoped to the caller's organisation: this file carries decrypted bank
    // account numbers, so it must never span tenants. Optionally narrowed to one
    // company, because each legal entity pays from its own bank account.
    const rows = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name,
              d.title AS designation, dep.name AS department, st.uan,
              b.bank_name, b.ifsc, b.account_number_enc, b.account_holder,
              p.net_pay, p.status, p.days_paid, p.days_in_month, p.lop_days,
              p.gross_earnings, p.total_deductions
         FROM payslips p
         JOIN employees e ON e.id=p.employee_id
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
         LEFT JOIN employee_statutory st ON st.employee_id=e.id
         LEFT JOIN employee_bank b ON b.employee_id=e.id
        WHERE p.year=$1 AND p.month=$2 AND p.status='PUBLISHED'
          AND ($3::bigint IS NULL OR e.organisation_id=$3)
          AND ($4::bigint IS NULL OR e.company_id=$4)
        ORDER BY e.first_name, e.last_name`, [year, month, req.orgId || null, cf.companyId])).rows;

    // Which columns, and in what order, is per company: a bank's advice format
    // is the bank's, not ours. An unknown key in a saved profile is skipped
    // rather than emitting an empty column with no header.
    const brand = await resolveBrand({ companyId: cf.companyId, organisationId: req.orgId || null });
    const wanted = (brand.options?.bankSheet?.columns || DEFAULT_OPTIONS.bankSheet.columns)
      .filter((k) => BANK_SHEET_COLUMNS[k]);
    const cols = (wanted.length ? wanted : DEFAULT_OPTIONS.bankSheet.columns).map((k) => BANK_SHEET_COLUMNS[k]);
    const ctx = { decrypt };
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [
      cols.map((c) => c.header).join(','),
      ...rows.map((r) => cols.map((c) => esc(c.get(r, ctx))).join(',')),
    ];
    await audit(req.user.id, 'PAYROLL_BANK_SHEET_EXPORT', 'payslip', null, { year, month, rows: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const prefix = cf.companyId
      ? ((await query(`SELECT code_prefix FROM companies WHERE id=$1`, [cf.companyId])).rows[0]?.code_prefix || 'CO')
      : 'ALL';
    res.setHeader('Content-Disposition',
      `attachment; filename="bank-advice-${prefix}-${year}-${String(month).padStart(2, '0')}.csv"`);
    res.send(lines.join('\n'));
  } catch (e) { next(e); }
}

// POST /admin/payslips/:id/unpublish — revert a published payslip to draft so it can be corrected
export async function unpublish(req, res, next) {
  try {
    const mine = await scopedByEmployee(req, 'payslips', req.params.id, { cols: 't.id, t.status' });
    if (!mine) return res.status(404).json({ error: 'Payslip not found' });
    // v2 (C21): a published payslip is locked. Taking it back is an explicit
    // "Revert to draft" with a recorded reason, and only from PUBLISHED.
    let reason = null;
    if (isV2(req)) {
      if (mine.status !== 'PUBLISHED') return res.status(409).json({ error: 'Only a published payslip can be reverted to draft.' });
      const v = validator();
      v.text('reason', req.body?.reason, 'Reason', { required: true, min: 5, max: 500 });
      v.throwIfAny();
      reason = String(req.body.reason).trim();
    }
    const row = (await query(
      `UPDATE payslips SET status='DRAFT', published_at=NULL,
              reverted_at = CASE WHEN $2::text IS NULL THEN reverted_at ELSE now() END,
              reverted_by = CASE WHEN $2::text IS NULL THEN reverted_by ELSE $3::bigint END,
              revert_reason = COALESCE($2::text, revert_reason)
        WHERE id=$1 RETURNING id`, [mine.id, reason, req.user.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    await audit(req.user.id, 'PAYSLIP_UNPUBLISH', 'payslip', row.id, reason ? { reason } : {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/payslips/:id — only drafts can be deleted
export async function remove(req, res, next) {
  try {
    const row = await scopedByEmployee(req, 'payslips', req.params.id, { cols: 't.id, t.status' });
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    if (row.status === 'PUBLISHED') {
      return res.status(409).json({ error: 'Published payslips cannot be deleted. Unpublish it first.' });
    }
    await query(`DELETE FROM payslips WHERE id=$1`, [row.id]);
    await audit(req.user.id, 'PAYSLIP_DELETE', 'payslip', row.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /admin/payslips/:id  — HR view (any status)
export async function adminDetail(req, res, next) {
  try {
    const row = await scopedByEmployee(req, 'payslips', req.params.id);
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    res.json(shapePayslip(row));
  } catch (e) { next(e); }
}

// GET /admin/payslips/:id/pdf — HR download (any status)
export async function adminPdf(req, res, next) {
  try {
    const row = await scopedByEmployee(req, 'payslips', req.params.id);
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="payslip-${row.year}-${String(row.month).padStart(2, '0')}.pdf"`);
    buildPayslipPdf(shapePayslip(row), res, await brandForEmployee(row.employee_id));
  } catch (e) { next(e); }
}


// ── v2: salary structure follows the company's payslip components (D6) ──────
// "Set structure" is the monthly CTC plus this employee's overrides of the
// company's own components. Basic/HRA/PF as fixed per-person fields are gone:
// they were a second copy of the company's rules that drifted (H80: the set
// said HRA 40% of Basic, the structure defaulted to 50%).

const MAX_MONTHLY_CTC = 10000000; // ₹1 crore a month

async function v2Employee(req, id) {
  return (await query(
    `SELECT e.id, e.company_id, e.organisation_id, e.first_name, e.last_name, e.employee_code, e.ctc,
            e.date_of_joining, d.title AS designation, d.grade AS designation_grade,
            lv.level_no, lv.name AS level_name, ${activeEmployeeSql('e')} AS is_employee
       FROM employees e
       LEFT JOIN designations d ON d.id = e.designation_id
       LEFT JOIN org_levels lv ON lv.id = d.level_id
      WHERE e.id = $1 AND ($2::bigint IS NULL OR e.organisation_id = $2)
        AND ($3::bigint IS NULL OR e.company_id = $3)`,
    [parseInt(id, 10) || 0, req.orgId || null, req.companyScope || null])).rows[0] || null;
}

// Grade comes from the designation master (and its hierarchy level), never free text (H73).
const gradeOf = (e) => e.designation_grade || (e.level_no ? `L${e.level_no}` : null);

const componentView = (c) => ({
  id: c.id, code: c.code, label: c.label, kind: c.kind, calc: c.calc, basisCode: c.basisCode,
  companyValue: c.companyValue, employeeValue: c.employeeValue, perEmployee: c.perEmployee && c.calc !== 'BALANCE',
  statutory: c.statutory,
});

// GET /api/v2/admin/salary-structure/:employeeId
export async function getStructureV2(req, res) {
  const e = await v2Employee(req, req.params.employeeId);
  if (!e) return res.status(404).json({ error: 'Employee not found' });
  await ensureCompanyComponents(e.company_id);
  const row = (await query(`SELECT * FROM salary_structures WHERE employee_id=$1`, [e.id])).rows[0];
  const comps = await loadDetailedForEmployee(e.company_id, e.id);
  const annual = e.ctc != null ? Number(e.ctc) : null;
  res.json({
    saved: !!row,
    isEmployee: !!e.is_employee,
    employee: { id: Number(e.id), name: `${e.first_name} ${e.last_name}`.trim(), code: e.employee_code,
      designation: e.designation || null, level: e.level_no ? `L${e.level_no} ${e.level_name || ''}`.trim() : null },
    grade: gradeOf(e),
    monthlyCtc: row ? Number(row.monthly_ctc) : null,
    // C20: pre-filled from the annual CTC on the employee record.
    suggestedMonthlyCtc: annual ? Math.round((annual / 12) * 100) / 100 : null,
    annualCtc: row ? Number(row.monthly_ctc) * 12 : annual,
    components: comps.map(componentView),
  });
}

function validateStructure(b, comps) {
  const v = validator();
  v.number('monthlyCtc', b.monthlyCtc, 'Monthly CTC', { required: true, min: 1, max: MAX_MONTHLY_CTC, decimals: 2 });
  const overrides = b.overrides && typeof b.overrides === 'object' ? b.overrides : {};
  const byCode = new Map(comps.map((c) => [c.code, c]));
  for (const [rawCode, raw] of Object.entries(overrides)) {
    const code = String(rawCode).toUpperCase();
    const c = byCode.get(code);
    const key = `overrides.${code}`;
    if (!c) { v.add(key, `${code} is not one of this company's payslip components`); continue; }
    if (raw === null || raw === '' || raw === undefined) continue;
    if (!c.perEmployee || c.calc === 'BALANCE') { v.add(key, `${c.label} is fixed for the whole company`); continue; }
    const pct = c.calc === 'PCT_CTC' || c.calc === 'PCT_OF';
    v.number(key, raw, c.label, { min: 0, max: pct ? 100 : MAX_MONTHLY_CTC, decimals: 2 });
  }
  return { v, overrides };
}

// Shared checks on a computed full month: earnings must fit inside the CTC and
// deductions must not exceed gross (C20, C23, H70).
function checkComputed(v, calc) {
  const over = (calc.warnings || []).find((w) => w.code === 'EARNINGS_EXCEED_CTC');
  if (over) v.add('monthlyCtc', `Fixed earnings are ₹${over.excess.toLocaleString('en-IN')} more than the monthly CTC — lower an allowance or raise the CTC`);
  if (calc.totalDeductions > calc.grossEarnings) {
    v.add('deductions', `Deductions (₹${calc.totalDeductions.toLocaleString('en-IN')}) would be more than gross pay (₹${calc.grossEarnings.toLocaleString('en-IN')}) — net pay would be negative`);
  }
}

// PUT /api/v2/admin/salary-structure/:employeeId { monthlyCtc, overrides: { CODE: value | null } }
export async function setStructureV2(req, res) {
  const e = await v2Employee(req, req.params.employeeId);
  if (!e) return res.status(404).json({ error: 'Employee not found' });
  if (!e.is_employee) {
    return res.status(409).json({ error: 'A salary structure can only be set for an active employee. Candidates get one after they join.' });
  }
  await ensureCompanyComponents(e.company_id);
  const comps = await loadDetailedForEmployee(e.company_id, e.id);
  const b = req.body || {};
  const { v, overrides } = validateStructure(b, comps);
  v.throwIfAny();
  const monthlyCtc = toNumber(b.monthlyCtc);
  const ov = Object.fromEntries(Object.entries(overrides).map(([k, x]) => [String(k).toUpperCase(), x === '' || x === undefined ? null : (x === null ? null : toNumber(x))]));
  const { calc } = await computeForEmployee(e.id, { monthlyCtc, overrides: ov, statePt: true, month: new Date().getMonth() + 1 });
  checkComputed(v, calc);
  v.throwIfAny();
  const grade = gradeOf(e);
  await query(
    `INSERT INTO salary_structures (employee_id, grade, monthly_ctc, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (employee_id) DO UPDATE SET grade=EXCLUDED.grade, monthly_ctc=EXCLUDED.monthly_ctc, updated_at=now()`,
    [e.id, grade, monthlyCtc]);
  for (const c of comps) {
    if (!Object.prototype.hasOwnProperty.call(ov, c.code)) continue;
    if (ov[c.code] === null) {
      await query(`DELETE FROM employee_component_values WHERE employee_id=$1 AND component_id=$2`, [e.id, c.id]);
    } else {
      await query(
        `INSERT INTO employee_component_values (employee_id, component_id, value) VALUES ($1,$2,$3)
         ON CONFLICT (employee_id, component_id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [e.id, c.id, ov[c.code]]);
    }
  }
  await audit(req.user.id, 'SALARY_STRUCTURE_SET', 'salary_structure', e.id, { monthlyCtc, overrides: ov });
  res.json({ ok: true, monthlyCtc, annualCtc: monthlyCtc * 12, grade });
}

// POST /api/v2/admin/payroll/preview { employeeId? , companyId?, monthlyCtc, overrides?, components? }
// The same engine the run uses (H78). With an employee: their company set, their
// overrides and their state's PT. With a company and an unsaved component list:
// what the Payslip components page is about to save.
export async function previewV2(req, res) {
  const b = req.body || {};
  const v = validator();
  v.number('monthlyCtc', b.monthlyCtc, 'Monthly CTC', { required: true, min: 0, max: MAX_MONTHLY_CTC });
  v.throwIfAny();
  const monthlyCtc = toNumber(b.monthlyCtc);
  const month = Number(b.month) || new Date().getMonth() + 1;
  let calc; let pt = null;
  if (b.employeeId) {
    const e = await v2Employee(req, b.employeeId);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    await ensureCompanyComponents(e.company_id);
    const ov = b.overrides && typeof b.overrides === 'object' ? b.overrides : null;
    ({ calc, pt } = await computeForEmployee(e.id, { monthlyCtc, overrides: ov, statePt: true, month }));
  } else {
    const co = (await query(`SELECT id FROM companies WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
      [parseInt(b.companyId, 10) || 0, req.orgId || null])).rows[0];
    if (!co) return res.status(404).json({ error: 'Company not found in your organisation.' });
    const comps = Array.isArray(b.components)
      ? b.components.filter((c) => c.active !== false).map((c) => ({ ...c, code: String(c.code || '').toUpperCase(), basisCode: c.basisCode ? String(c.basisCode).toUpperCase() : null, value: Number(toNumber(c.value)) || 0 }))
      : (await loadDetailedForEmployee(co.id, null)).map((c) => ({ ...c, value: c.companyValue }));
    calc = computeFromComponents(comps, { monthlyCtc, daysInMonth: 30, daysPaid: 30 });
  }
  const warnings = [...(calc.warnings || []).map((w) => w.message)];
  if (calc.totalDeductions > calc.grossEarnings) warnings.push('Deductions are more than gross pay — net pay is negative.');
  res.json({ ...calc, pt, warnings });
}

// ── ESS (E33): my CTC and how it splits ──────────────────────────────────────
// GET /api/v2/me/salary-structure
export async function mySalaryV2(req, res) {
  const empId = req.user.employeeId;
  if (!empId) return res.json({ saved: false });
  const row = (await query(`SELECT * FROM salary_structures WHERE employee_id=$1`, [empId])).rows[0];
  if (!row || !(Number(row.monthly_ctc) > 0)) return res.json({ saved: false });
  const { calc, pt } = await computeForEmployee(empId, { statePt: true, month: new Date().getMonth() + 1 });
  res.json({
    saved: true, monthlyCtc: Number(row.monthly_ctc), annualCtc: Number(row.monthly_ctc) * 12,
    grade: row.grade || null, updatedAt: row.updated_at,
    earnings: calc.earnings, deductions: calc.deductions.filter((d) => d.code !== 'TDS'),
    grossMonthly: calc.grossEarnings, pt,
  });
}
