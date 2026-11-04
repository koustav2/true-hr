// Statutory records (PF / ESIC / Gratuity identifiers + nominations) and
// statutory reports (PF register, ESIC register, Form-16 estimate).
import { query } from '../db/pool.js';
import { ownsEmployee, scopedByEmployee, scopedEmployee } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { decrypt } from '../utils/crypto.js';
import { estimateTax, computeRegimeTax } from '../services/incomeTax.js';
import { buildForm16Pdf } from '../services/docPdf.js';
import { brandForEmployee } from '../services/docProfile.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST } from '../utils/validate.js';
import { activeEmployeeSql } from '../utils/people.js';
import { isoDate } from '../utils/joining.js';
import { AppError } from '../middleware/error.js';
import { fyStartYearOf, projectedAnnualGross, fyOf } from '../services/incomeTax.js';

// C24: one source for UAN / PF / ESIC. employee_statutory (what the employee's
// Bank & statutory card writes) wins; statutory_profiles fills any gap. The
// Statutory page writes both, so the two screens can no longer disagree.
const IDS_SQL = `
  COALESCE(NULLIF(es.uan,''), sp.uan)               AS uan,
  COALESCE(NULLIF(es.pf_number,''), sp.pf_number)    AS pf_number,
  COALESCE(NULLIF(es.esi_number,''), sp.esic_number) AS esic_number`;

const NOMINEE_RELATIONS = ['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'];

export async function getProfile(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  // statutory_profiles / statutory_nominees carry no organisation_id, so the
  // tenant is reached through the employee. Unscoped, any id returned another
  // tenant's UAN, PF/ESIC numbers and nominee names, DOBs and addresses.
  if (!(await ownsEmployee(req, employeeId))) return res.status(404).json({ error: 'Employee not found.' });
  const p = (await query(
    `SELECT sp.employee_id, sp.pension_number, sp.esic_dispensary, sp.pf_join_date, sp.pf_applicable, sp.esic_applicable,
            sp.updated_at, ${IDS_SQL}
       FROM employees e
       LEFT JOIN statutory_profiles sp ON sp.employee_id = e.id
       LEFT JOIN employee_statutory es ON es.employee_id = e.id
      WHERE e.id=$1 AND (sp.employee_id IS NOT NULL OR es.employee_id IS NOT NULL)`, [employeeId])).rows[0] || null;
  if (p) p.pf_join_date = isoDate(p.pf_join_date);
  const nominees = (await query(`SELECT * FROM statutory_nominees WHERE employee_id=$1 ORDER BY scheme, id`, [employeeId])).rows;
  res.json({ profile: p, nominees });
}

export async function upsertProfile(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  // Unscoped, this wrote (or created) statutory identifiers on another tenant's
  // employee, which then feed their PF/ESIC registers and payslips.
  if (!(await ownsEmployee(req, employeeId))) return res.status(404).json({ error: 'Employee not found.' });
  const b = { ...(req.body || {}) };
  // The page sends the column names it read (uan, pf_number, esic_number …);
  // accept both spellings.
  b.pfNumber ??= b.pf_number; b.esicNumber ??= b.esic_number; b.pensionNumber ??= b.pension_number;
  b.esicDispensary ??= b.esic_dispensary; b.pfJoinDate ??= b.pf_join_date;
  b.pfApplicable ??= b.pf_applicable; b.esicApplicable ??= b.esic_applicable;
  for (const k of ['uan', 'pfNumber', 'esicNumber']) if (typeof b[k] === 'string') b[k] = b[k].replace(/\s+/g, '').toUpperCase() || null;
  if (isV2(req)) {
    const e = (await query(`SELECT date_of_joining, ${activeEmployeeSql('e')} AS ok FROM employees e WHERE e.id=$1`, [employeeId])).rows[0];
    if (!e?.ok) throw new AppError('Statutory records are kept for active employees only.', 409, { employeeId: 'Not an active employee' });
    const v = validator();
    v.pattern('uan', b.uan, 'uan', 'UAN');
    v.pattern('pfNumber', b.pfNumber, 'pf', 'PF number');
    v.pattern('esicNumber', b.esicNumber, 'esic', 'ESIC number');
    v.text('pensionNumber', b.pensionNumber, 'Pension number', { max: 30 });
    v.text('esicDispensary', b.esicDispensary, 'ESIC dispensary', { max: 120 });
    v.date('pfJoinDate', b.pfJoinDate, 'PF join date', { max: todayIST(), min: isoDate(e.date_of_joining) || undefined,
      minMsg: 'PF join date cannot be before the joining date' });
    v.throwIfAny();
  }
  const row = (await query(
    `INSERT INTO statutory_profiles (employee_id, uan, pf_number, pension_number, esic_number, esic_dispensary,
        pf_join_date, pf_applicable, esic_applicable, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,true),COALESCE($9,false),now())
     ON CONFLICT (employee_id) DO UPDATE SET uan=EXCLUDED.uan, pf_number=EXCLUDED.pf_number,
        pension_number=EXCLUDED.pension_number, esic_number=EXCLUDED.esic_number, esic_dispensary=EXCLUDED.esic_dispensary,
        pf_join_date=EXCLUDED.pf_join_date, pf_applicable=EXCLUDED.pf_applicable, esic_applicable=EXCLUDED.esic_applicable,
        updated_at=now() RETURNING *`,
    [employeeId, b.uan || null, b.pfNumber || null, b.pensionNumber || null, b.esicNumber || null, b.esicDispensary || null,
     b.pfJoinDate || null, b.pfApplicable, b.esicApplicable])).rows[0];
  // Keep the employee's Bank & statutory card in step (C24) — one set of identifiers.
  await query(
    `INSERT INTO employee_statutory (employee_id, uan, pf_number, esi_number) VALUES ($1,$2,$3,$4)
     ON CONFLICT (employee_id) DO UPDATE SET uan=EXCLUDED.uan, pf_number=EXCLUDED.pf_number, esi_number=EXCLUDED.esi_number`,
    [employeeId, b.uan || null, b.pfNumber || null, b.esicNumber || null]);
  await audit(req.user.id, 'STATUTORY_PROFILE_SAVE', 'statutory_profile', employeeId, {});
  res.json({ profile: row });
}

export async function addNominee(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = req.body || {};
  // Unscoped, a nominee could be attached to another tenant's employee.
  if (!(await ownsEmployee(req, employeeId))) return res.status(404).json({ error: 'Employee not found.' });
  if (!b.scheme || !b.name) return res.status(400).json({ error: 'scheme and name are required.' });
  if (isV2(req)) {
    const v = validator();
    const scheme = String(b.scheme).toUpperCase();
    v.oneOf('scheme', scheme, ['PF', 'GRATUITY', 'ESIC', 'PENSION'], 'Scheme');
    v.name('name', b.name, 'Nominee name', { required: true });
    v.check('relation', b.relation, (x) => NOMINEE_RELATIONS.some((r) => r.toLowerCase() === x.toLowerCase()),
      `Relation must be one of: ${NOMINEE_RELATIONS.join(', ')}`, { required: true, label: 'Relation' });
    v.number('sharePct', b.sharePct, 'Share %', { required: true, min: 0.01, max: 100, decimals: 2 });
    v.date('dateOfBirth', b.dateOfBirth, 'Date of birth', { max: todayIST(), maxMsg: 'Date of birth must be in the past' });
    v.text('address', b.address, 'Address', { max: 300 });
    if (b.guardian) v.name('guardian', b.guardian, 'Guardian');
    if (!v.has('sharePct') && !v.has('scheme')) {
      const used = Number((await query(
        `SELECT COALESCE(SUM(share_pct),0) AS s FROM statutory_nominees WHERE employee_id=$1 AND scheme=$2`,
        [employeeId, scheme])).rows[0].s);
      const total = used + Number(b.sharePct);
      if (total > 100.001) v.add('sharePct', `${scheme} nominees would total ${total}% — shares must add up to 100% (${100 - used}% is left)`);
    }
    v.throwIfAny();
    b.relation = NOMINEE_RELATIONS.find((r) => r.toLowerCase() === String(b.relation).toLowerCase());
  }
  const row = (await query(
    `INSERT INTO statutory_nominees (employee_id, scheme, name, relation, date_of_birth, share_pct, address, guardian)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [employeeId, String(b.scheme).toUpperCase(), b.name, b.relation || null, b.dateOfBirth || null,
     Number(b.sharePct) || 0, b.address || null, b.guardian || null])).rows[0];
  await audit(req.user.id, 'STATUTORY_NOMINEE_ADD', 'statutory_nominee', row.id, { employeeId, scheme: b.scheme });
  res.status(201).json({ nominee: row });
}

export async function deleteNominee(req, res) {
  const id = parseInt(req.params.id, 10);
  // The nominee id came straight off the URL: unscoped, this deleted another
  // tenant's PF/gratuity nomination.
  const mine = await scopedByEmployee(req, 'statutory_nominees', id, { cols: 't.id' });
  if (!mine) return res.status(404).json({ error: 'Nominee not found.' });
  await query(`DELETE FROM statutory_nominees WHERE id=$1`, [mine.id]);
  await audit(req.user.id, 'STATUTORY_NOMINEE_DELETE', 'statutory_nominee', id, {});
  res.json({ ok: true });
}

// GET /admin/reports/pf-register?companyId= — PF contribution register (12% capped at 15k wage).
export async function pfRegister(req, res) {
  const rows = (await query(
    `SELECT e.employee_code, e.first_name, e.last_name, ${IDS_SQL},
            ss.monthly_ctc, ss.basic_pct
       FROM employees e
       JOIN salary_structures ss ON ss.employee_id=e.id
       LEFT JOIN statutory_profiles sp ON sp.employee_id=e.id
       LEFT JOIN employee_statutory es ON es.employee_id=e.id
      WHERE e.onboarding_status='ACTIVE' AND (sp.pf_applicable IS DISTINCT FROM false)
        AND ($1::bigint IS NULL OR e.organisation_id=$1)
        AND ($2::bigint IS NULL OR e.company_id=$2)
      ORDER BY e.employee_code`, [req.orgId || null, req.companyScope || null])).rows;
  // Statutory ceilings current as of FY 2025-26 (EPF ₹15,000, EPS 8.33%). Hikes to
  // ₹21k/25k are proposed but not yet notified — override via the rate masters when they land.
  const PF_WAGE_CAP = 15000, RATE = 0.12;
  const register = rows.map((r) => {
    const basic = Math.round((Number(r.monthly_ctc) || 0) * (Number(r.basic_pct) || 50) / 100);
    const pfWage = Math.min(basic, PF_WAGE_CAP);
    const employee = Math.round(pfWage * RATE);
    const pension = Math.round(Math.min(pfWage, 15000) * 0.0833);
    const employerPf = employee - pension;
    return { code: r.employee_code, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      uan: r.uan || '', pfNumber: r.pf_number || '', basic, pfWage,
      employeeShare: employee, employerPension: pension, employerPf, total: employee + employee };
  });
  if (req.query.format === 'csv') return sendCsv(res, 'pf-register.csv',
    ['code', 'name', 'uan', 'pfNumber', 'basic', 'pfWage', 'employeeShare', 'employerPension', 'employerPf', 'total'], register);
  res.json({ register });
}

// GET /admin/reports/esic-register — ESIC (0.75% employee + 3.25% employer, gross ≤ 21000).
export async function esicRegister(req, res) {
  const rows = (await query(
    `SELECT e.employee_code, e.first_name, e.last_name, ${IDS_SQL}, ss.monthly_ctc
       FROM employees e JOIN salary_structures ss ON ss.employee_id=e.id
       LEFT JOIN statutory_profiles sp ON sp.employee_id=e.id
       LEFT JOIN employee_statutory es ON es.employee_id=e.id
      WHERE e.onboarding_status='ACTIVE' AND ($1::bigint IS NULL OR e.organisation_id=$1)
        AND ($2::bigint IS NULL OR e.company_id=$2)
      ORDER BY e.employee_code`, [req.orgId || null, req.companyScope || null])).rows;
  const CAP = 21000; // ESIC wage limit current as of FY 2025-26 (hike to ₹25k/30k proposed, not notified).
  const register = rows.map((r) => {
    const gross = Number(r.monthly_ctc) || 0;
    const applicable = gross <= CAP;
    return { code: r.employee_code, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      esicNumber: r.esic_number || '', gross, applicable: applicable ? 'Yes' : 'No',
      employeeShare: applicable ? Math.ceil(gross * 0.0075) : 0,
      employerShare: applicable ? Math.ceil(gross * 0.0325) : 0 };
  });
  if (req.query.format === 'csv') return sendCsv(res, 'esic-register.csv',
    ['code', 'name', 'esicNumber', 'gross', 'applicable', 'employeeShare', 'employerShare'], register);
  res.json({ register });
}

// Form-16 Part-B estimate for one employee and FY, shared by HR and ESS.
async function sendForm16(res, employeeId, fyParam) {
  const e = (await query(`SELECT * FROM employees WHERE id=$1`, [employeeId])).rows[0];
  const now = new Date();
  const fy = fyParam || fyOf(now.getFullYear(), now.getMonth() + 1).label;
  const ss = (await query(`SELECT monthly_ctc FROM salary_structures WHERE employee_id=$1`, [employeeId])).rows[0];
  // Mid-year joiners: only the months of the FY they are paid for (C47).
  const grossAnnual = projectedAnnualGross({ monthlyCtc: Number(ss?.monthly_ctc) || 0,
    doj: isoDate(e.date_of_joining), fyStartYear: fyStartYearOf(fy) || now.getFullYear() });
  const decl = (await query(
    `SELECT id, regime FROM investment_declarations WHERE employee_id=$1 AND financial_year=$2 ORDER BY id DESC LIMIT 1`,
    [employeeId, fy])).rows[0];
  let items = [];
  if (decl) items = (await query(
    `SELECT section, COALESCE(approved_amount, declared_amount) AS amount FROM investment_declaration_items WHERE declaration_id=$1`,
    [decl.id])).rows.map((i) => ({ section: i.section, amount: Number(i.amount) }));
  const est = estimateTax({ grossAnnual, items });
  const regime = decl?.regime || est.recommended;
  const chosen = regime === 'old' ? est.old : est.new;
  // PAN lives encrypted in employee_statutory.pan_enc — the employees table has
  // no PAN column, which is why the Form 16 printed it blank.
  let pan = '';
  try {
    const st = (await query(`SELECT pan_enc FROM employee_statutory WHERE employee_id=$1`, [employeeId])).rows[0];
    pan = st?.pan_enc ? decrypt(st.pan_enc) : '';
  } catch { pan = ''; }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="form16-${e.employee_code || employeeId}-${fy}.pdf"`);
  buildForm16Pdf({ financialYear: fy, regime, grossAnnual, deductions: est.deductions,
    taxable: chosen.taxable, taxBeforeCess: chosen.taxBeforeCess, cess: chosen.cess,
    totalTax: chosen.totalTax, monthlyTds: chosen.monthlyTds,
    meta: { name: `${e.first_name || ''} ${e.last_name || ''}`.trim(), pan } },
    res, await brandForEmployee(employeeId));
}

// GET /admin/reports/form16/:employeeId?fy= — Form-16 Part-B estimate PDF.
export async function form16(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  // Unscoped, this rendered a Form-16 PDF for any employee id in the database —
  // decrypted PAN, gross annual salary, declarations and tax — to any caller
  // holding the reports permission in any tenant.
  const e = await scopedEmployee(req, employeeId, isV2(req) ? `e.id, ${activeEmployeeSql('e')} AS ok, e.employee_code` : 'e.id');
  if (!e) return res.status(404).json({ error: 'Employee not found.' });
  if (isV2(req) && !e.employee_code) return res.status(409).json({ error: 'Form 16 is for employees who have joined — this person is still a candidate.' });
  return sendForm16(res, employeeId, req.query.fy || null);
}

// GET /api/v2/me/form16?fy= — my own (E33).
export async function myForm16(req, res) {
  if (!req.user.employeeId) return res.status(404).json({ error: 'No employee profile on this account.' });
  const fy = req.query.fy && /^\d{4}-\d{2}$/.test(String(req.query.fy)) ? String(req.query.fy) : null;
  return sendForm16(res, req.user.employeeId, fy);
}

// GET /api/v2/admin/statutory/employees — the picker: joined, active employees
// only, with their employee ID (H81).
export async function employeesV2(req, res) {
  const rows = (await query(
    `SELECT e.id, e.first_name, e.last_name, e.employee_code FROM employees e
      WHERE ${activeEmployeeSql('e')} AND ($1::bigint IS NULL OR e.organisation_id=$1) AND ($2::bigint IS NULL OR e.company_id=$2)
      ORDER BY e.first_name, e.last_name`, [req.orgId || null, req.companyScope || null])).rows;
  res.json(rows.map((r) => ({ id: Number(r.id), name: `${r.first_name} ${r.last_name}`.trim(), code: r.employee_code })));
}

function sendCsv(res, filename, cols, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
