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
//
// QA v2 (H128-H137): dates are real Excel dates with the year (they were
// String(Date).slice(0,10), "Sat Jul 03"); the last login is a real
// date-time; annual CTC is monthly × 12 from one source; pay columns come from
// the company's payslip components; grades come from the designation master;
// IFSC, UAN, PF and ESIC are format-checked; status words match the portal;
// odd exit dates and active employees with missing basics are flagged.
// ============================================================================
import ExcelJS from 'exceljs';
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { activeEmployeeSql } from '../utils/people.js';
import { patterns } from '../utils/validate.js';
import { isoDate } from '../utils/joining.js';
import { loadForEmployee, computeFromComponents } from '../services/payComponents.js';
import { ensureOrgBalances } from '../services/leaveTypes.js';

// H133: every active employee has balance rows before the Leave balances sheet
// is read. Never lets a leave problem fail the export.
async function ensureBalancesQuietly(orgId) {
  if (!orgId) return;
  try { await ensureOrgBalances(orgId); } catch (e) { console.warn('[hrmis] ensureOrgBalances failed:', e.message); }
}

const nameOf = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
const yn = (v) => (v ? 'Yes' : 'No');

// A calendar date as an Excel date cell (UTC midnight, so no timezone shift).
const xDate = (v) => {
  const s = isoDate(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00Z`);
};
// A timestamp as an Excel date-time in India time.
const xDateTime = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 330 * 60000);
};

// The portal's words for status codes (lib/labels.js), so the workbook and the
// screens say the same thing (H136: REVOKED is "Reversed" on screen).
const LABELS = {
  OFFER_SENT: 'Offer sent', OFFER_ACCEPTED: 'Offer accepted', DETAILS_PENDING: 'Filling details',
  DETAILS_SUBMITTED: 'Awaiting review', HR_REVIEW: 'In review', SENT_BACK: 'Sent back', APPROVED: 'Approved',
  ACTIVE: 'Active', INACTIVE: 'Inactive', REJECTED: 'Rejected', EXPIRED: 'Expired', EXITED: 'Exited',
  PENDING: 'Pending', WITHDRAWN: 'Withdrawn', REVOKED: 'Reversed', DISABLED: 'Disabled',
  FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACT: 'Contract', INTERN: 'Intern',
  MALE: 'Male', FEMALE: 'Female', OTHER: 'Other', RESIGNATION: 'Resignation', TERMINATION: 'Termination',
  DISMISSAL: 'Dismissal', REDUNDANCY: 'Redundancy', END_OF_CONTRACT: 'End of contract', ABANDONMENT: 'Abandonment',
  in_stock: 'In stock', assigned: 'Assigned', repair: 'In repair', retired: 'Retired', lost: 'Lost',
};
const label = (v) => {
  if (v == null || v === '') return '';
  const s = String(v);
  if (LABELS[s]) return LABELS[s];
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const check = (v, re) => (v == null || v === '' ? '' : (re.test(String(v).replace(/\s+/g, '').toUpperCase()) ? 'OK' : 'Invalid'));

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({ ...c, style: c.date ? { numFmt: 'dd-mm-yyyy' } : c.dateTime ? { numFmt: 'dd-mm-yyyy hh:mm' } : (c.style || undefined) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  rows.forEach((r) => ws.addRow(r));
  return ws;
}

const SCOPE = `($1::bigint IS NULL OR e.organisation_id = $1) AND ($2::bigint IS NULL OR e.company_id = $2)`;

// Why a login is not usable, in words (H135).
function loginNote(r) {
  if (!r.login_email) return r.onboarding_status === 'ACTIVE' ? 'No login created' : '';
  if (r.login_status === 'DISABLED' && r.onboarding_status === 'ACTIVE') {
    if (r.exit_lwd) return `Disabled — exit approved, last working day ${isoDate(r.exit_lwd)}`;
    return 'Disabled while the employee is Active — re-enable it under Users if this is wrong';
  }
  if (r.login_status === 'PENDING') return 'Not activated yet (password not set)';
  if (r.onboarding_status === 'ACTIVE' && r.date_of_joining && isoDate(r.date_of_joining) > new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)) {
    return `Opens on the joining date ${isoDate(r.date_of_joining)}`;
  }
  return '';
}

// GET /admin/reports/hrmis?status=ALL|ACTIVE
export async function workbook(req, res, next) {
  try {
    const p = [req.orgId || null, req.companyScope || null];
    await ensureBalancesQuietly(req.orgId);
    const onlyActive = String(req.query.status || 'ALL').toUpperCase() === 'ACTIVE';
    const statusClause = onlyActive ? ` AND ${activeEmployeeSql('e')}` : '';

    const people = (await query(
      `SELECT e.*, dep.name AS department, dg.title AS designation, dg.grade AS designation_grade,
              co.name AS company, sd.name AS sub_department, br.name AS branch,
              lv.level_no, lv.name AS level_name,
              rm.first_name AS rm_first, rm.last_name AS rm_last, rm.employee_code AS rm_code,
              fm.first_name AS fm_first, fm.last_name AS fm_last,
              om.first_name AS om_first, om.last_name AS om_last,
              ua.email AS login_email, ua.status AS login_status, ua.last_login_at,
              (SELECT MIN(x.lwd) FROM (
                 SELECT last_working_date AS lwd FROM resignations WHERE employee_id=e.id AND status='APPROVED'
                 UNION ALL SELECT last_working_date FROM terminations WHERE employee_id=e.id AND status='ACTIVE') x) AS exit_lwd
         FROM employees e
         LEFT JOIN departments dep ON dep.id = e.department_id
         LEFT JOIN designations dg ON dg.id = e.designation_id
         LEFT JOIN companies co ON co.id = e.company_id
         LEFT JOIN org_masters sd ON sd.id = e.sub_department_id
         LEFT JOIN org_masters br ON br.id = e.branch_id
         LEFT JOIN org_levels lv ON lv.id = dg.level_id
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
      { header: 'Sub-Department', key: 'subdep', width: 22 },
      { header: 'Branch', key: 'branch', width: 20 },
      { header: 'Designation', key: 'desig', width: 26 },
      { header: 'Grade', key: 'grade', width: 10 },
      { header: 'Level', key: 'level', width: 20 },
      { header: 'Employment Type', key: 'etype', width: 18 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Date of Joining', key: 'doj', width: 15, date: true },
      { header: 'Location', key: 'loc', width: 18 },
      { header: 'Official Email', key: 'omail', width: 30 },
      { header: 'Personal Email', key: 'pmail', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Date of Birth', key: 'dob', width: 14, date: true },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Reporting Manager', key: 'rm', width: 24 },
      { header: 'Functional Manager', key: 'fm', width: 24 },
      { header: 'Operational Manager', key: 'om', width: 24 },
      { header: 'Login Email', key: 'login', width: 30 },
      { header: 'Login Status', key: 'lstatus', width: 14 },
      { header: 'Login Note', key: 'lnote', width: 44 },
      { header: 'Last Login', key: 'llogin', width: 18, dateTime: true },
    ], people.map((r) => ({
      code: r.employee_code || '', name: nameOf(r), company: r.company || '',
      dep: r.department || '', subdep: r.sub_department || '', branch: r.branch || '',
      desig: r.designation || '', grade: r.designation_grade || (r.level_no ? `L${r.level_no}` : ''),
      level: r.level_no ? `L${r.level_no} ${r.level_name || ''}`.trim() : '',
      etype: label(r.employment_type), status: label(r.onboarding_status),
      doj: xDate(r.date_of_joining), loc: r.location || '',
      omail: r.official_email || '', pmail: r.personal_email || '', phone: r.phone || '',
      dob: xDate(r.dob), gender: label(r.gender),
      rm: r.rm_first ? `${r.rm_first} ${r.rm_last}` : '',
      fm: r.fm_first ? `${r.fm_first} ${r.fm_last}` : '',
      om: r.om_first ? `${r.om_first} ${r.om_last}` : '',
      login: r.login_email || '', lstatus: label(r.login_status), lnote: loginNote(r),
      // String(Date).slice(0,16) on a timestamp lost its first letter and left
      // stray spaces (" ue Aug 11 2026 "); a real date-time cell instead.
      llogin: xDateTime(r.last_login_at),
    })));

    // ── Compensation: one source (the structure), components from the company set.
    const comp = (await query(
      `SELECT e.id, e.company_id, e.employee_code, e.first_name, e.last_name, e.ctc, e.onboarding_status,
              dg.grade AS designation_grade, lv.level_no,
              ss.monthly_ctc, ss.updated_at,
              b.bank_name, b.branch, b.ifsc, b.account_holder,
              (b.account_number_enc IS NOT NULL) AS has_account
         FROM employees e
         LEFT JOIN designations dg ON dg.id = e.designation_id
         LEFT JOIN org_levels lv ON lv.id = dg.level_id
         LEFT JOIN salary_structures ss ON ss.employee_id = e.id
         LEFT JOIN employee_bank b ON b.employee_id = e.id
        WHERE ${SCOPE}${statusClause}
        ORDER BY e.employee_code`, p)).rows;

    const compRows = [];
    const compCols = new Map(); // code -> label, in first-seen order
    for (const r of comp) {
      const monthly = r.monthly_ctc != null ? Number(r.monthly_ctc) : (r.ctc != null ? Math.round(Number(r.ctc) / 12) : null);
      const lines = {};
      if (r.monthly_ctc != null && Number(r.monthly_ctc) > 0) {
        const comps = await loadForEmployee(r.company_id, r.id);
        if (comps.length) {
          const calc = computeFromComponents(comps, { monthlyCtc: Number(r.monthly_ctc), daysInMonth: 30, daysPaid: 30 });
          for (const l of [...calc.earnings, ...calc.deductions.filter((d) => d.code !== 'TDS')]) {
            if (!compCols.has(l.code)) compCols.set(l.code, l.label);
            lines[`c_${l.code}`] = l.amount;
          }
        }
      }
      compRows.push({
        code: r.employee_code || '', name: nameOf(r),
        grade: r.designation_grade || (r.level_no ? `L${r.level_no}` : ''),
        mctc: monthly == null ? '' : monthly,
        actc: monthly == null ? '' : monthly * 12,
        src: r.monthly_ctc != null ? 'Salary structure' : (r.ctc != null ? 'Offer CTC (no structure yet)' : ''),
        ...lines,
        bank: r.bank_name || '', branch: r.branch || '', ifsc: r.ifsc || '',
        ifscOk: check(r.ifsc, patterns.ifsc),
        holder: r.account_holder || '', hasacct: yn(r.has_account),
        upd: xDate(r.updated_at),
      });
    }
    sheet(wb, 'Compensation', [
      { header: 'Employee Code', key: 'code', width: 16 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Grade', key: 'grade', width: 10 },
      { header: 'Monthly CTC', key: 'mctc', width: 15 },
      { header: 'Annual CTC', key: 'actc', width: 15 },
      { header: 'CTC Source', key: 'src', width: 24 },
      ...[...compCols.entries()].map(([code, lbl]) => ({ header: `${lbl} (monthly)`, key: `c_${code}`, width: 18 })),
      { header: 'Bank', key: 'bank', width: 22 },
      { header: 'Branch', key: 'branch', width: 20 },
      { header: 'IFSC', key: 'ifsc', width: 14 },
      { header: 'IFSC Format', key: 'ifscOk', width: 12 },
      { header: 'Account Holder', key: 'holder', width: 24 },
      { header: 'Account Number On File', key: 'hasacct', width: 20 },
      { header: 'Structure Updated', key: 'upd', width: 18, date: true },
    ], compRows);

    const stat = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name,
              COALESCE(NULLIF(s.uan,''), sp.uan) AS uan,
              COALESCE(NULLIF(s.pf_number,''), sp.pf_number) AS pf_number,
              COALESCE(NULLIF(s.esi_number,''), sp.esic_number) AS esi_number,
              (s.pan_enc IS NOT NULL) AS has_pan, (s.aadhaar_enc IS NOT NULL) AS has_aadhaar
         FROM employees e
         LEFT JOIN employee_statutory s ON s.employee_id = e.id
         LEFT JOIN statutory_profiles sp ON sp.employee_id = e.id
        WHERE ${SCOPE}${statusClause}
        ORDER BY e.employee_code`, p)).rows;

    sheet(wb, 'Statutory', [
      { header: 'Employee Code', key: 'code', width: 16 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'UAN', key: 'uan', width: 18 },
      { header: 'UAN Format', key: 'uanOk', width: 12 },
      { header: 'PF Number', key: 'pf', width: 24 },
      { header: 'PF Format', key: 'pfOk', width: 12 },
      { header: 'ESIC Number', key: 'esi', width: 20 },
      { header: 'ESIC Format', key: 'esiOk', width: 12 },
      { header: 'PAN On File', key: 'pan', width: 14 },
      { header: 'Aadhaar On File', key: 'aad', width: 16 },
    ], stat.map((r) => ({
      code: r.employee_code || '', name: nameOf(r),
      uan: r.uan || '', uanOk: check(r.uan, patterns.uan),
      pf: r.pf_number || '', pfOk: check(r.pf_number, patterns.pf),
      esi: r.esi_number || '', esiOk: check(r.esi_number, patterns.esic),
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
      { header: 'Purchase Date', key: 'pd', width: 15, date: true },
      { header: 'Cost', key: 'cost', width: 12 },
      { header: 'Vendor', key: 'vendor', width: 20 },
      { header: 'Assigned To Code', key: 'ecode', width: 18 },
      { header: 'Assigned To', key: 'ename', width: 24 },
      { header: 'Assigned On', key: 'aon', width: 15, date: true },
      { header: 'Acknowledged', key: 'ack', width: 14 },
    ], assets.map((r) => ({
      tag: r.asset_tag, cat: r.category || '', brand: r.brand || '', model: r.model || '',
      sn: r.serial_no || '', status: label(r.status), cond: r.condition || '',
      pd: xDate(r.purchase_date), cost: r.cost == null ? '' : Number(r.cost), vendor: r.vendor || '',
      ecode: r.employee_code || '', ename: r.employee_code ? nameOf(r) : '',
      aon: xDate(r.assigned_at ? new Date(new Date(r.assigned_at).getTime() + 330 * 60000).toISOString().slice(0, 10) : null),
      ack: r.employee_code ? yn(r.acknowledged) : '',
    })));

    const exits = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name, e.date_of_joining, dep.name AS department,
              'RESIGNATION' AS kind, NULL::text AS subtype, r.resignation_date AS raised_on, r.last_working_date,
              r.status, r.reason, r.notice_period_days
         FROM resignations r JOIN employees e ON e.id = r.employee_id
         LEFT JOIN departments dep ON dep.id = e.department_id
        WHERE ${SCOPE}
        UNION ALL
       SELECT e.employee_code, e.first_name, e.last_name, e.date_of_joining, dep.name,
              'TERMINATION', t.type, (t.initiated_at AT TIME ZONE 'Asia/Kolkata')::date, t.last_working_date,
              t.status, t.reason, t.notice_period_days
         FROM terminations t JOIN employees e ON e.id = t.employee_id
         LEFT JOIN departments dep ON dep.id = e.department_id
        WHERE ${SCOPE}
        ORDER BY 8 DESC NULLS LAST`, p)).rows;

    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    // H136: a raised date in the future, before the joining date, or after the
    // last working day is a data problem worth seeing, not hiding.
    const exitCheck = (r) => {
      const raised = isoDate(r.raised_on); const lwd = isoDate(r.last_working_date); const doj = isoDate(r.date_of_joining);
      const out = [];
      if (raised && raised > today) out.push('Raised date is in the future');
      if (raised && doj && raised < doj) out.push('Raised before the joining date');
      if (lwd && doj && lwd < doj) out.push('Last working date before the joining date');
      if (raised && lwd && lwd < raised) out.push('Last working date before the raised date');
      return out.join('; ');
    };
    sheet(wb, 'Exits', [
      { header: 'Employee Code', key: 'code', width: 16 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Department', key: 'dep', width: 22 },
      { header: 'Kind', key: 'kind', width: 26 },
      { header: 'Raised On', key: 'raised', width: 14, date: true },
      { header: 'Last Working Date', key: 'lwd', width: 18, date: true },
      { header: 'Notice Days', key: 'notice', width: 13 },
      { header: 'Status', key: 'status', width: 13 },
      { header: 'Data Check', key: 'check', width: 40 },
      { header: 'Reason', key: 'reason', width: 44 },
    ], exits.map((r) => ({
      code: r.employee_code || '', name: nameOf(r), dep: r.department || '',
      kind: r.kind === 'TERMINATION' && r.subtype && r.subtype !== 'TERMINATION' ? `Termination (${label(r.subtype)})` : label(r.kind),
      raised: xDate(r.raised_on), lwd: xDate(r.last_working_date),
      notice: r.notice_period_days == null ? '' : Number(r.notice_period_days),
      status: label(r.status), check: exitCheck(r), reason: r.reason || '',
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
      company: r.company || '(none)', dep: r.department || '(no department)', status: label(r.status),
      hc: r.headcount, cost: Number(r.monthly_cost || 0),
    })));

    await audit(req.user.id, 'HRMIS_EXPORT', 'employees', null,
      { people: people.length, scope: onlyActive ? 'ACTIVE' : 'ALL' });

    const stamp = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="hrmis-${stamp}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
}

// GET /admin/reports/hrmis/summary — what the screen shows before you download.
export async function summary(req, res, next) {
  try {
    await ensureBalancesQuietly(req.orgId);
    const p = [req.orgId || null, req.companyScope || null];
    const r = (await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE e.onboarding_status='ACTIVE')::int AS active,
              COUNT(*) FILTER (WHERE e.onboarding_status <> 'ACTIVE')::int AS non_active,
              COUNT(*) FILTER (WHERE ${activeEmployeeSql('e')})::int AS employees
         FROM employees e WHERE ${SCOPE}`, p)).rows[0];
    const gaps = (await query(
      `SELECT
         COUNT(*) FILTER (WHERE ss.employee_id IS NULL)::int AS no_structure,
         COUNT(*) FILTER (WHERE b.employee_id IS NULL)::int AS no_bank,
         COUNT(*) FILTER (WHERE COALESCE(NULLIF(s.uan,''), sp.uan) IS NULL)::int AS no_uan,
         COUNT(*) FILTER (WHERE e.reporting_manager_id IS NULL)::int AS no_manager,
         COUNT(*) FILTER (WHERE e.department_id IS NULL)::int AS no_department,
         COUNT(*) FILTER (WHERE e.designation_id IS NULL)::int AS no_designation,
         COUNT(*) FILTER (WHERE e.date_of_joining IS NULL)::int AS no_doj,
         COUNT(*) FILTER (WHERE b.ifsc IS NOT NULL AND b.ifsc <> '' AND upper(b.ifsc) !~ '^[A-Z]{4}0[A-Z0-9]{6}$')::int AS invalid_ifsc,
         COUNT(*) FILTER (WHERE
           (COALESCE(NULLIF(s.uan,''), sp.uan) IS NOT NULL AND COALESCE(NULLIF(s.uan,''), sp.uan) !~ '^[0-9]{12}$')
           OR (COALESCE(NULLIF(s.esi_number,''), sp.esic_number) IS NOT NULL AND COALESCE(NULLIF(s.esi_number,''), sp.esic_number) !~ '^[0-9]{17}$')
           OR (COALESCE(NULLIF(s.pf_number,''), sp.pf_number) IS NOT NULL AND upper(COALESCE(NULLIF(s.pf_number,''), sp.pf_number)) !~ '^[A-Z]{5}[0-9]{17}$'))::int AS invalid_statutory,
         COUNT(*) FILTER (WHERE ua.status = 'DISABLED')::int AS login_disabled
       FROM employees e
       LEFT JOIN salary_structures ss ON ss.employee_id = e.id
       LEFT JOIN employee_bank b ON b.employee_id = e.id
       LEFT JOIN employee_statutory s ON s.employee_id = e.id
       LEFT JOIN statutory_profiles sp ON sp.employee_id = e.id
       LEFT JOIN user_accounts ua ON ua.employee_id = e.id
      WHERE ${SCOPE} AND ${activeEmployeeSql('e')}`, p)).rows[0];
    res.json({ ...r, gaps });
  } catch (e) { next(e); }
}
