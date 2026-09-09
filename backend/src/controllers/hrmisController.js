// ============================================================================
// HRMIS reports — the "give me everything in one workbook" export.
//
// GreenHR parity: its HRMIS Reports menu. Every sheet here already exists as a
// screen; what was missing was one download an HR head can hand to finance, an
// auditor or a new payroll vendor without clicking through eleven exports.
//
// PII discipline: PAN and Aadhaar are stored encrypted and are NOT decrypted
// into this workbook — the sheet reports whether each is on file. Anyone who
// legitimately needs the number reads it on the employee's own screen, where
// the access is audited per employee rather than in a bulk dump.
// ============================================================================
import ExcelJS from 'exceljs';
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

const d10 = (v) => (v ? String(v).slice(0, 10) : '');
const nameOf = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
const yn = (v) => (v ? 'Yes' : 'No');

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  rows.forEach((r) => ws.addRow(r));
  return ws;
}

const SCOPE = `($1::bigint IS NULL OR e.organisation_id = $1) AND ($2::bigint IS NULL OR e.company_id = $2)`;

// GET /admin/reports/hrmis?status=ALL|ACTIVE
export async function workbook(req, res, next) {
  try {
    const p = [req.orgId || null, req.companyScope || null];
    const onlyActive = String(req.query.status || 'ALL').toUpperCase() === 'ACTIVE';
    const statusClause = onlyActive ? ` AND e.onboarding_status='ACTIVE'` : '';

    const people = (await query(
      `SELECT e.*, dep.name AS department, dg.title AS designation, dg.grade AS designation_grade,
              co.name AS company,
              rm.first_name AS rm_first, rm.last_name AS rm_last, rm.employee_code AS rm_code,
              fm.first_name AS fm_first, fm.last_name AS fm_last,
              om.first_name AS om_first, om.last_name AS om_last,
              ua.email AS login_email, ua.status AS login_status, ua.last_login_at
         FROM employees e
         LEFT JOIN departments dep ON dep.id = e.department_id
         LEFT JOIN designations dg ON dg.id = e.designation_id
         LEFT JOIN companies co ON co.id = e.company_id
         LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
         LEFT JOIN employees fm ON fm.id = e.function_manager_id
         LEFT JOIN employees om ON om.id = e.operational_manager_id
         LEFT JOIN user_accounts ua ON ua.employee_id = e.id
        WHERE ${SCOPE}${statusClause}
        ORDER BY e.employee_code`, p)).rows;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'TRUE HR';
    wb.created = new Date();

    sheet(wb, 'People', [
      { header: 'Employee Code', key: 'code', width: 16 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Company', key: 'company', width: 24 },
      { header: 'Department', key: 'dep', width: 22 },
      { header: 'Designation', key: 'desig', width: 26 },
      { header: 'Grade', key: 'grade', width: 10 },
      { header: 'Employment Type', key: 'etype', width: 18 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Date of Joining', key: 'doj', width: 15 },
      { header: 'Location', key: 'loc', width: 18 },
      { header: 'Official Email', key: 'omail', width: 30 },
      { header: 'Personal Email', key: 'pmail', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Date of Birth', key: 'dob', width: 14 },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Reporting Manager', key: 'rm', width: 24 },
      { header: 'Functional Manager', key: 'fm', width: 24 },
      { header: 'Operational Manager', key: 'om', width: 24 },
      { header: 'Login Email', key: 'login', width: 30 },
      { header: 'Login Status', key: 'lstatus', width: 14 },
      { header: 'Last Login', key: 'llogin', width: 20 },
    ], people.map((r) => ({
      code: r.employee_code || '', name: nameOf(r), company: r.company || '',
      dep: r.department || '', desig: r.designation || '', grade: r.designation_grade || '',
      etype: r.employment_type || '', status: r.onboarding_status || '',
      doj: d10(r.date_of_joining), loc: r.location || '',
      omail: r.official_email || '', pmail: r.personal_email || '', phone: r.phone || '',
      dob: d10(r.dob), gender: r.gender || '',
      rm: r.rm_first ? `${r.rm_first} ${r.rm_last}` : '',
      fm: r.fm_first ? `${r.fm_first} ${r.fm_last}` : '',
      om: r.om_first ? `${r.om_first} ${r.om_last}` : '',
      login: r.login_email || '', lstatus: r.login_status || '',
      llogin: r.last_login_at ? String(r.last_login_at).slice(0, 16).replace('T', ' ') : '',
    })));

    const comp = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name, e.ctc, e.onboarding_status,
              ss.grade, ss.monthly_ctc, ss.basic_pct, ss.hra_pct_of_basic, ss.employee_pf_pct,
              ss.professional_tax, ss.welfare_trust, ss.lta, ss.personal_allowance,
              ss.city_allowance, ss.performance_pay, ss.updated_at,
              b.bank_name, b.branch, b.ifsc, b.account_holder,
              (b.account_number_enc IS NOT NULL) AS has_account
         FROM employees e
         LEFT JOIN salary_structures ss ON ss.employee_id = e.id
         LEFT JOIN employee_bank b ON b.employee_id = e.id
        WHERE ${SCOPE}${statusClause}
        ORDER BY e.employee_code`, p)).rows;

    sheet(wb, 'Compensation', [
      { header: 'Employee Code', key: 'code', width: 16 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Grade', key: 'grade', width: 10 },
      { header: 'Monthly CTC', key: 'mctc', width: 15 },
      { header: 'Annual CTC', key: 'actc', width: 15 },
      { header: 'Basic %', key: 'basic', width: 10 },
      { header: 'HRA % of Basic', key: 'hra', width: 15 },
      { header: 'Employee PF %', key: 'pf', width: 14 },
      { header: 'Professional Tax', key: 'pt', width: 16 },
      { header: 'Welfare Trust', key: 'wt', width: 14 },
      { header: 'LTA', key: 'lta', width: 12 },
      { header: 'Personal Allowance', key: 'pa', width: 18 },
      { header: 'City Allowance', key: 'ca', width: 15 },
      { header: 'Performance Pay', key: 'pp', width: 16 },
      { header: 'Bank', key: 'bank', width: 22 },
      { header: 'Branch', key: 'branch', width: 20 },
      { header: 'IFSC', key: 'ifsc', width: 14 },
      { header: 'Account Holder', key: 'holder', width: 24 },
      { header: 'Account Number On File', key: 'hasacct', width: 20 },
      { header: 'Structure Updated', key: 'upd', width: 18 },
    ], comp.map((r) => ({
      code: r.employee_code || '', name: nameOf(r), grade: r.grade || '',
      mctc: r.monthly_ctc == null ? '' : Number(r.monthly_ctc),
      actc: r.ctc == null ? (r.monthly_ctc == null ? '' : Number(r.monthly_ctc) * 12) : Number(r.ctc),
      basic: r.basic_pct == null ? '' : Number(r.basic_pct),
      hra: r.hra_pct_of_basic == null ? '' : Number(r.hra_pct_of_basic),
      pf: r.employee_pf_pct == null ? '' : Number(r.employee_pf_pct),
      pt: r.professional_tax == null ? '' : Number(r.professional_tax),
      wt: r.welfare_trust == null ? '' : Number(r.welfare_trust),
      lta: r.lta == null ? '' : Number(r.lta),
      pa: r.personal_allowance == null ? '' : Number(r.personal_allowance),
      ca: r.city_allowance == null ? '' : Number(r.city_allowance),
      pp: r.performance_pay == null ? '' : Number(r.performance_pay),
      bank: r.bank_name || '', branch: r.branch || '', ifsc: r.ifsc || '',
      holder: r.account_holder || '', hasacct: yn(r.has_account),
      upd: d10(r.updated_at),
    })));

    const stat = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name,
              s.uan, s.pf_number, s.esi_number,
              (s.pan_enc IS NOT NULL) AS has_pan, (s.aadhaar_enc IS NOT NULL) AS has_aadhaar
         FROM employees e LEFT JOIN employee_statutory s ON s.employee_id = e.id
        WHERE ${SCOPE}${statusClause}
        ORDER BY e.employee_code`, p)).rows;

    sheet(wb, 'Statutory', [
      { header: 'Employee Code', key: 'code', width: 16 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'UAN', key: 'uan', width: 18 },
      { header: 'PF Number', key: 'pf', width: 22 },
      { header: 'ESIC Number', key: 'esi', width: 20 },
      { header: 'PAN On File', key: 'pan', width: 14 },
      { header: 'Aadhaar On File', key: 'aad', width: 16 },
    ], stat.map((r) => ({
      code: r.employee_code || '', name: nameOf(r),
      uan: r.uan || '', pf: r.pf_number || '', esi: r.esi_number || '',
      pan: yn(r.has_pan), aad: yn(r.has_aadhaar),
    })));

    const leave = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name, lt.code, lt.name,
              lb.allocated, lb.used
         FROM leave_balances lb
         JOIN employees e ON e.id = lb.employee_id
         JOIN leave_types lt ON lt.id = lb.leave_type_id
        WHERE ${SCOPE}${statusClause}
        ORDER BY e.employee_code, lt.sort_order, lt.code`, p)).rows;

    sheet(wb, 'Leave balances', [
      { header: 'Employee Code', key: 'code', width: 16 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Leave Type', key: 'lt', width: 12 },
      { header: 'Leave Name', key: 'ltn', width: 22 },
      { header: 'Allocated', key: 'alloc', width: 12 },
      { header: 'Used', key: 'used', width: 12 },
      { header: 'Balance', key: 'bal', width: 12 },
    ], leave.map((r) => ({
      code: r.employee_code || '', name: nameOf(r), lt: r.code, ltn: r.name,
      alloc: Number(r.allocated || 0), used: Number(r.used || 0),
      bal: Number(r.allocated || 0) - Number(r.used || 0),
    })));

    const assets = (await query(
      `SELECT a.asset_tag, a.category, a.brand, a.model, a.serial_no, a.status, a.condition,
              a.purchase_date, a.cost, a.vendor,
              e.employee_code, e.first_name, e.last_name,
              aa.assigned_at, aa.returned_at, aa.acknowledged
         FROM assets a
         LEFT JOIN asset_assignments aa ON aa.asset_id = a.id AND aa.returned_at IS NULL
         LEFT JOIN employees e ON e.id = aa.employee_id
        WHERE ($1::bigint IS NULL OR a.organisation_id = $1)
          AND ($2::bigint IS NULL OR a.company_id = $2)
        ORDER BY a.asset_tag`, p)).rows;

    sheet(wb, 'Assets', [
      { header: 'Asset Tag', key: 'tag', width: 16 },
      { header: 'Category', key: 'cat', width: 16 },
      { header: 'Brand', key: 'brand', width: 16 },
      { header: 'Model', key: 'model', width: 18 },
      { header: 'Serial No', key: 'sn', width: 22 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Condition', key: 'cond', width: 14 },
      { header: 'Purchase Date', key: 'pd', width: 15 },
      { header: 'Cost', key: 'cost', width: 12 },
      { header: 'Vendor', key: 'vendor', width: 20 },
      { header: 'Assigned To Code', key: 'ecode', width: 18 },
      { header: 'Assigned To', key: 'ename', width: 24 },
      { header: 'Assigned On', key: 'aon', width: 15 },
      { header: 'Acknowledged', key: 'ack', width: 14 },
    ], assets.map((r) => ({
      tag: r.asset_tag, cat: r.category || '', brand: r.brand || '', model: r.model || '',
      sn: r.serial_no || '', status: r.status || '', cond: r.condition || '',
      pd: d10(r.purchase_date), cost: r.cost == null ? '' : Number(r.cost), vendor: r.vendor || '',
      ecode: r.employee_code || '', ename: r.employee_code ? nameOf(r) : '',
      aon: d10(r.assigned_at), ack: r.employee_code ? yn(r.acknowledged) : '',
    })));

    const exits = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name, dep.name AS department,
              'RESIGNATION' AS kind, r.resignation_date AS raised_on, r.last_working_date,
              r.status, r.reason, r.notice_period_days
         FROM resignations r JOIN employees e ON e.id = r.employee_id
         LEFT JOIN departments dep ON dep.id = e.department_id
        WHERE ${SCOPE}
        UNION ALL
       SELECT e.employee_code, e.first_name, e.last_name, dep.name,
              'TERMINATION: ' || t.type, t.initiated_at::date, t.last_working_date,
              t.status, t.reason, t.notice_period_days
         FROM terminations t JOIN employees e ON e.id = t.employee_id
         LEFT JOIN departments dep ON dep.id = e.department_id
        WHERE ${SCOPE}
        ORDER BY 6 DESC NULLS LAST`, p)).rows;

    sheet(wb, 'Exits', [
      { header: 'Employee Code', key: 'code', width: 16 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Department', key: 'dep', width: 22 },
      { header: 'Kind', key: 'kind', width: 14 },
      { header: 'Raised On', key: 'raised', width: 14 },
      { header: 'Last Working Date', key: 'lwd', width: 18 },
      { header: 'Notice Days', key: 'notice', width: 13 },
      { header: 'Status', key: 'status', width: 13 },
      { header: 'Reason', key: 'reason', width: 44 },
    ], exits.map((r) => ({
      code: r.employee_code || '', name: nameOf(r), dep: r.department || '',
      kind: r.kind, raised: d10(r.raised_on), lwd: d10(r.last_working_date),
      notice: r.notice_period_days == null ? '' : Number(r.notice_period_days),
      status: r.status || '', reason: r.reason || '',
    })));

    // Headcount summary last, so the workbook opens on data rather than a pivot.
    const head = (await query(
      `SELECT co.name AS company, dep.name AS department, e.onboarding_status AS status,
              COUNT(*)::int AS headcount,
              COALESCE(SUM(ss.monthly_ctc), 0) AS monthly_cost
         FROM employees e
         LEFT JOIN companies co ON co.id = e.company_id
         LEFT JOIN departments dep ON dep.id = e.department_id
         LEFT JOIN salary_structures ss ON ss.employee_id = e.id
        WHERE ${SCOPE}${statusClause}
        GROUP BY co.name, dep.name, e.onboarding_status
        ORDER BY co.name, dep.name, e.onboarding_status`, p)).rows;

    sheet(wb, 'Headcount', [
      { header: 'Company', key: 'company', width: 24 },
      { header: 'Department', key: 'dep', width: 24 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Headcount', key: 'hc', width: 12 },
      { header: 'Monthly Salary Cost', key: 'cost', width: 20 },
    ], head.map((r) => ({
      company: r.company || '(none)', dep: r.department || '(none)', status: r.status || '',
      hc: r.headcount, cost: Number(r.monthly_cost || 0),
    })));

    await audit(req.user.id, 'HRMIS_EXPORT', 'employees', null,
      { people: people.length, scope: onlyActive ? 'ACTIVE' : 'ALL' });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="hrmis-${stamp}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
}

// GET /admin/reports/hrmis/summary — what the screen shows before you download.
export async function summary(req, res, next) {
  try {
    const p = [req.orgId || null, req.companyScope || null];
    const r = (await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE e.onboarding_status='ACTIVE')::int AS active,
              COUNT(*) FILTER (WHERE e.onboarding_status <> 'ACTIVE')::int AS non_active
         FROM employees e WHERE ${SCOPE}`, p)).rows[0];
    const gaps = (await query(
      `SELECT
         COUNT(*) FILTER (WHERE ss.employee_id IS NULL)::int AS no_structure,
         COUNT(*) FILTER (WHERE b.employee_id IS NULL)::int AS no_bank,
         COUNT(*) FILTER (WHERE s.uan IS NULL OR s.uan = '')::int AS no_uan,
         COUNT(*) FILTER (WHERE e.reporting_manager_id IS NULL)::int AS no_manager
       FROM employees e
       LEFT JOIN salary_structures ss ON ss.employee_id = e.id
       LEFT JOIN employee_bank b ON b.employee_id = e.id
       LEFT JOIN employee_statutory s ON s.employee_id = e.id
      WHERE ${SCOPE} AND e.onboarding_status='ACTIVE'`, p)).rows[0];
    res.json({ ...r, gaps });
  } catch (e) { next(e); }
}
