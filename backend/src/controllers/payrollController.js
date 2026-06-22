import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { decrypt, mask } from '../utils/crypto.js';
import { buildPayslipPdf } from '../services/paySlipPdf.js';

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
export function computePayslip(s, { daysInMonth: dim, daysPaid, arrears = 0, bonus = 0, tds = 0 }) {
  const factor = dim > 0 ? Math.min(1, daysPaid / dim) : 1;
  const fullBasic = (s.monthlyCtc * s.basicPct) / 100;
  const basic = r2(fullBasic * factor);
  const hra = r2(((fullBasic * s.hraPctOfBasic) / 100) * factor);
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

// GET /payslips — rolling list of recent months with availability (published only).
export async function list(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const published = (await query(
      `SELECT id, year, month, net_pay FROM payslips
        WHERE employee_id=$1 AND status='PUBLISHED'`, [empId])).rows;
    const byKey = new Map(published.map((p) => [`${p.year}-${p.month}`, p]));
    const now = new Date();
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = dt.getFullYear(); const m = dt.getMonth() + 1;
      const hit = byKey.get(`${y}-${m}`);
      rows.push({ year: y, month: m, monthName: MONTHS[m - 1], available: !!hit, id: hit?.id ?? null });
    }
    const code = (await query(`SELECT employee_code FROM employees WHERE id=$1`, [empId])).rows[0]?.employee_code || null;
    res.json(rows.map((r) => ({ ...r, employeeCode: code })));
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
export async function getStructure(req, res, next) {
  try {
    const row = (await query(`SELECT * FROM salary_structures WHERE employee_id=$1`, [req.params.employeeId])).rows[0];
    res.json(shapeStructure(row));
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
    res.json({
      year, month, monthName: MONTHS[month - 1],
      rows: rows.map((r) => ({
        employeeId: r.employee_id, employeeCode: r.employee_code,
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        hasStructure: r.has_structure, monthlyCtc: r.monthly_ctc != null ? Number(r.monthly_ctc) : null,
        payslipId: r.payslip_id, status: r.status, netPay: r.net_pay != null ? Number(r.net_pay) : null,
      })),
    });
  } catch (e) { next(e); }
}

// POST /admin/payslips/generate { employeeId, year, month, daysPaid, arrears, bonus, tds }
export async function generate(req, res, next) {
  try {
    const { employeeId, year, month } = req.body;
    if (!employeeId || !year || !month) return res.status(400).json({ error: 'employeeId, year and month are required' });
    const sRow = (await query(`SELECT * FROM salary_structures WHERE employee_id=$1`, [employeeId])).rows[0];
    if (!sRow) return res.status(409).json({ error: 'Set a salary structure for this employee first' });
    const s = shapeStructure(sRow);
    const dim = daysInMonth(Number(year), Number(month));
    const daysPaid = req.body.daysPaid != null ? Number(req.body.daysPaid) : dim;
    const calc = computePayslip(s, {
      daysInMonth: dim, daysPaid, arrears: Number(req.body.arrears) || 0,
      bonus: Number(req.body.bonus) || 0, tds: Number(req.body.tds) || 0,
    });
    const meta = await loadMeta(employeeId);
    meta.grade = s.grade;
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
      [employeeId, year, month, dim, daysPaid, calc.arrears, Number(req.body.bonus) || 0, Number(req.body.tds) || 0,
       calc.grossEarnings, calc.totalDeductions, calc.netPay, JSON.stringify(data), req.user.employeeId || null])).rows[0];
    await audit(req.user.id, 'PAYSLIP_GENERATE', 'payslip', row.id, { employeeId, year, month });
    res.json(shapePayslip(row));
  } catch (e) { next(e); }
}

// POST /admin/payslips/:id/publish
export async function publish(req, res, next) {
  try {
    const row = (await query(
      `UPDATE payslips SET status='PUBLISHED', published_at=now() WHERE id=$1 RETURNING id`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    await audit(req.user.id, 'PAYSLIP_PUBLISH', 'payslip', row.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/payslips/:id
export async function remove(req, res, next) {
  try {
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
