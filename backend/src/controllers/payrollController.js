import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { decrypt, mask } from '../utils/crypto.js';
import { buildPayslipPdf } from '../services/paySlipPdf.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { payslipPublishedEmail } from '../services/emailTemplates.js';
import { isoDate } from '../utils/joining.js';

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
  return (await query(`SELECT id FROM companies ORDER BY id LIMIT 1`)).rows[0]?.id || null;
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

// Core engine — compute a payslip from a structure + that month's run inputs.
// Earnings prorate by daysPaid/daysInMonth; PF on prorated basic; PT/Welfare are fixed.
// Whatever part of the monthly CTC is not covered by Basic/HRA/fixed allowances
// flows into a balancing "Special Allowance", so gross always equals the CTC.
export function computePayslip(s, { daysInMonth: dim, daysPaid, arrears = 0, bonus = 0, tds = 0 }) {
  const factor = dim > 0 ? Math.min(1, daysPaid / dim) : 1;
  const fullBasic = (s.monthlyCtc * s.basicPct) / 100;
  const fullHra = (fullBasic * s.hraPctOfBasic) / 100;
  const fullFixed = Number(s.lta) + Number(s.personalAllowance) + Number(s.miscellaneous)
    + Number(s.cityAllowance) + Number(s.performancePay);
  const fullSpecial = Math.max(0, s.monthlyCtc - fullBasic - fullHra - fullFixed);

  const basic = r2(fullBasic * factor);
  const hra = r2(fullHra * factor);
  const special = r2(fullSpecial * factor);
  const lta = r2(s.lta * factor);
  const personal = r2(s.personalAllowance * factor);
  const misc = r2(s.miscellaneous * factor);
  const city = r2(s.cityAllowance * factor);
  const perf = r2(s.performancePay * factor);
  const arr = r2(arrears);
  const bon = r2(bonus);

  const earnings = [
    { label: 'Basic Salary', amount: basic },
    { label: 'House Rent Allowance', amount: hra },
    { label: 'Special Allowance', amount: special },
    { label: 'Leave Travel Allowance', amount: lta },
    { label: 'Personal Allowance', amount: personal },
    { label: 'Miscellaneous', amount: misc },
    { label: 'City Allowance', amount: city },
    { label: 'Performance Pay', amount: perf },
  ];
  if (bon > 0) earnings.push({ label: 'Bonus / Incentive', amount: bon });

  const pf = r2((basic * s.employeePfPct) / 100);
  const welfare = r2(s.welfareTrust);
  const pt = r2(s.professionalTax);
  const tdsAmt = r2(tds);
  const deductions = [
    { label: 'Provident Fund', amount: pf },
    { label: 'Welfare Trust', amount: welfare },
    { label: 'Professional Tax', amount: pt },
    { label: 'TDS', amount: tdsAmt },
  ];

  const grossEarnings = earnings.reduce((a, e) => a + e.amount, 0) + arr;
  const totalDeductions = deductions.reduce((a, d) => a + d.amount, 0);
  const netPay = grossEarnings - totalDeductions;
  return { earnings, deductions, arrears: arr, grossEarnings, totalDeductions, netPay };
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
    buildPayslipPdf(shapePayslip(row), res);
  } catch (e) { next(e); }
}

// ── HR admin ─────────────────────────────────────────────────────────────────

// GET /admin/salary-structure/:employeeId
// Returns the saved per-employee structure, or — if none — one pre-filled from the
// employee's company template so HR only needs to enter CTC.
export async function getStructure(req, res, next) {
  try {
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

// GET /admin/payslips?year=&month=  — run sheet for all employees
export async function adminList(req, res, next) {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
    const rows = (await query(
      `SELECT e.id AS employee_id, e.employee_code, e.first_name, e.last_name,
              (ss.id IS NOT NULL) AS has_structure, ss.monthly_ctc,
              p.id AS payslip_id, p.status, p.net_pay
         FROM employees e
         LEFT JOIN salary_structures ss ON ss.employee_id=e.id
         LEFT JOIN payslips p ON p.employee_id=e.id AND p.year=$1 AND p.month=$2
        WHERE e.onboarding_status NOT IN ('REJECTED','EXPIRED')
        ORDER BY e.first_name, e.last_name`, [year, month])).rows;
    const shaped = rows.map((r) => ({
      employeeId: r.employee_id, employeeCode: r.employee_code,
      name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      hasStructure: r.has_structure, monthlyCtc: r.monthly_ctc != null ? Number(r.monthly_ctc) : null,
      payslipId: r.payslip_id, status: r.status, netPay: r.net_pay != null ? Number(r.net_pay) : null,
    }));
    res.json({
      year, month, monthName: MONTHS[month - 1],
      summary: {
        employees: shaped.length,
        withStructure: shaped.filter((r) => r.hasStructure).length,
        generated: shaped.filter((r) => r.status).length,
        published: shaped.filter((r) => r.status === 'PUBLISHED').length,
        draft: shaped.filter((r) => r.status === 'DRAFT').length,
        netTotal: shaped.reduce((a, r) => a + (r.netPay || 0), 0),
        publishedNetTotal: shaped.filter((r) => r.status === 'PUBLISHED').reduce((a, r) => a + (r.netPay || 0), 0),
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

  const doj = (await query(`SELECT date_of_joining FROM employees WHERE id=$1`, [employeeId]))
    .rows[0]?.date_of_joining;
  const lwd = (await query(
    `SELECT last_working_date FROM resignations
      WHERE employee_id=$1 AND status='APPROVED' ORDER BY id DESC LIMIT 1`, [employeeId]))
    .rows[0]?.last_working_date;

  let start = 1, end = dim;
  const dojIso = isoDate(doj);
  const lwdIso = isoDate(lwd);
  if (dojIso) {
    if (dojIso > last) return null;                       // joins after this month
    if (dojIso >= first) start = Number(dojIso.slice(8, 10));
  }
  if (lwdIso) {
    if (lwdIso < first) return null;                      // exited before this month
    if (lwdIso <= last) end = Number(lwdIso.slice(8, 10));
  }
  if (end < start) return null;

  const from = `${year}-${mm}-${String(start).padStart(2, '0')}`;
  const to = `${year}-${mm}-${String(end).padStart(2, '0')}`;
  const lop = Number((await query(
    `SELECT COALESCE(SUM(LEAST(lr.to_date,$3::date) - GREATEST(lr.from_date,$2::date) + 1), 0) AS d
       FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id
      WHERE lr.employee_id=$1 AND lr.status='APPROVED' AND lt.code='LWP'
        AND lr.from_date <= $3::date AND lr.to_date >= $2::date`,
    [employeeId, from, to])).rows[0].d) || 0;

  const payableDays = end - start + 1;
  return { dim, daysPaid: Math.max(0, payableDays - lop), lopDays: lop, payableDays };
}

// Shared by single + bulk generation. Returns { ok } or { skip: reason }.
async function generateFor(employeeId, year, month, opts, reqUser) {
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

  const calc = computePayslip(s, {
    daysInMonth: dim, daysPaid, arrears: Number(opts.arrears) || 0,
    bonus: Number(opts.bonus) || 0, tds: Number(opts.tds) || 0,
  });
  const meta = await loadMeta(employeeId);
  meta.grade = s.grade;
  meta.lopDays = auto.lopDays;
  const data = { earnings: calc.earnings, deductions: calc.deductions, arrears: calc.arrears, meta };

  const row = (await query(
    `INSERT INTO payslips
       (employee_id, year, month, status, days_in_month, days_paid, arrears, bonus, tds,
        gross_earnings, total_deductions, net_pay, data, generated_by, generated_at)
     VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (employee_id, year, month) DO UPDATE SET
       status='DRAFT', days_in_month=EXCLUDED.days_in_month, days_paid=EXCLUDED.days_paid,
       arrears=EXCLUDED.arrears, bonus=EXCLUDED.bonus, tds=EXCLUDED.tds,
       gross_earnings=EXCLUDED.gross_earnings, total_deductions=EXCLUDED.total_deductions,
       net_pay=EXCLUDED.net_pay, data=EXCLUDED.data, generated_by=EXCLUDED.generated_by,
       generated_at=now(), published_at=NULL
     RETURNING *`,
    [employeeId, year, month, dim, daysPaid, calc.arrears, Number(opts.bonus) || 0, Number(opts.tds) || 0,
     calc.grossEarnings, calc.totalDeductions, calc.netPay, JSON.stringify(data), reqUser.employeeId || null])).rows[0];
  await audit(reqUser.id, 'PAYSLIP_GENERATE', 'payslip', row.id, { employeeId, year, month });
  return { ok: true, row };
}

// POST /admin/payslips/generate { employeeId, year, month, daysPaid?, arrears, bonus, tds }
// daysPaid left blank ⇒ auto (prorated by joining/exit dates, minus approved LWP days).
export async function generate(req, res, next) {
  try {
    const { employeeId, year, month } = req.body;
    if (!employeeId || !year || !month) return res.status(400).json({ error: 'employeeId, year and month are required' });
    const out = await generateFor(employeeId, year, month, req.body, req.user);
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
    const emps = (await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name
         FROM employees e JOIN salary_structures ss ON ss.employee_id=e.id
        WHERE e.onboarding_status='ACTIVE'
        ORDER BY e.first_name, e.last_name`)).rows;
    let generated = 0;
    const skipped = [];
    for (const e of emps) {
      const out = await generateFor(e.id, year, month, {}, req.user);
      if (out.ok) generated += 1;
      else skipped.push({ employeeCode: e.employee_code, name: `${e.first_name} ${e.last_name}`.trim(), reason: out.skip });
    }
    await audit(req.user.id, 'PAYROLL_RUN_GENERATE_ALL', 'payslip', null, { year, month, generated, skipped: skipped.length });
    res.json({ ok: true, generated, skipped });
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

// POST /admin/payslips/:id/publish
export async function publish(req, res, next) {
  try {
    const row = (await query(
      `UPDATE payslips SET status='PUBLISHED', published_at=now() WHERE id=$1 RETURNING id`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    await audit(req.user.id, 'PAYSLIP_PUBLISH', 'payslip', row.id, {});
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
    const rows = (await query(
      `UPDATE payslips SET status='PUBLISHED', published_at=now()
        WHERE year=$1 AND month=$2 AND status='DRAFT' RETURNING id`, [year, month])).rows;
    for (const r of rows) await notifyPublished(r.id);
    await audit(req.user.id, 'PAYROLL_RUN_PUBLISH_ALL', 'payslip', null, { year, month, published: rows.length });
    res.json({ ok: true, published: rows.length });
  } catch (e) { next(e); }
}

// GET /admin/payslips/export?year=&month= — bank-advice sheet (CSV) of the
// month's published payslips: full account details + net pay for the transfer file.
export async function exportBankSheet(req, res, next) {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    if (!year || !month) return res.status(400).json({ error: 'year and month are required' });
    const rows = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name,
              b.bank_name, b.ifsc, b.account_number_enc, b.account_holder,
              p.net_pay, p.status
         FROM payslips p
         JOIN employees e ON e.id=p.employee_id
         LEFT JOIN employee_bank b ON b.employee_id=e.id
        WHERE p.year=$1 AND p.month=$2 AND p.status='PUBLISHED'
        ORDER BY e.first_name, e.last_name`, [year, month])).rows;
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [
      ['Employee Code', 'Name', 'Account Holder', 'Bank', 'IFSC', 'Account Number', 'Net Pay (INR)'].join(','),
      ...rows.map((r) => [
        r.employee_code, `${r.first_name || ''} ${r.last_name || ''}`.trim(), r.account_holder || '',
        r.bank_name || '', r.ifsc || '', r.account_number_enc ? decrypt(r.account_number_enc) : '',
        Number(r.net_pay).toFixed(2),
      ].map(esc).join(',')),
    ];
    await audit(req.user.id, 'PAYROLL_BANK_SHEET_EXPORT', 'payslip', null, { year, month, rows: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bank-advice-${year}-${String(month).padStart(2, '0')}.csv"`);
    res.send(lines.join('\n'));
  } catch (e) { next(e); }
}

// POST /admin/payslips/:id/unpublish — revert a published payslip to draft so it can be corrected
export async function unpublish(req, res, next) {
  try {
    const row = (await query(
      `UPDATE payslips SET status='DRAFT', published_at=NULL WHERE id=$1 RETURNING id`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    await audit(req.user.id, 'PAYSLIP_UNPUBLISH', 'payslip', row.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/payslips/:id — only drafts can be deleted
export async function remove(req, res, next) {
  try {
    const row = (await query(`SELECT status FROM payslips WHERE id=$1`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    if (row.status === 'PUBLISHED') {
      return res.status(409).json({ error: 'Published payslips cannot be deleted. Unpublish it first.' });
    }
    await query(`DELETE FROM payslips WHERE id=$1`, [req.params.id]);
    await audit(req.user.id, 'PAYSLIP_DELETE', 'payslip', req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /admin/payslips/:id  — HR view (any status)
export async function adminDetail(req, res, next) {
  try {
    const row = (await query(`SELECT * FROM payslips WHERE id=$1`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    res.json(shapePayslip(row));
  } catch (e) { next(e); }
}

// GET /admin/payslips/:id/pdf — HR download (any status)
export async function adminPdf(req, res, next) {
  try {
    const row = (await query(`SELECT * FROM payslips WHERE id=$1`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="payslip-${row.year}-${String(row.month).padStart(2, '0')}.pdf"`);
    buildPayslipPdf(shapePayslip(row), res);
  } catch (e) { next(e); }
}
