// Statutory records (PF / ESIC / Gratuity identifiers + nominations) and
// statutory reports (PF register, ESIC register, Form-16 estimate).
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { decrypt } from '../utils/crypto.js';
import { estimateTax, computeRegimeTax } from '../services/incomeTax.js';
import { buildForm16Pdf } from '../services/docPdf.js';

export async function getProfile(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  const p = (await query(`SELECT * FROM statutory_profiles WHERE employee_id=$1`, [employeeId])).rows[0] || null;
  const nominees = (await query(`SELECT * FROM statutory_nominees WHERE employee_id=$1 ORDER BY scheme, id`, [employeeId])).rows;
  res.json({ profile: p, nominees });
}

export async function upsertProfile(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = req.body || {};
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
  await audit(req.user.id, 'STATUTORY_PROFILE_SAVE', 'statutory_profile', employeeId, {});
  res.json({ profile: row });
}

export async function addNominee(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = req.body || {};
  if (!b.scheme || !b.name) return res.status(400).json({ error: 'scheme and name are required.' });
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
  await query(`DELETE FROM statutory_nominees WHERE id=$1`, [id]);
  await audit(req.user.id, 'STATUTORY_NOMINEE_DELETE', 'statutory_nominee', id, {});
  res.json({ ok: true });
}

// GET /admin/reports/pf-register?companyId= — PF contribution register (12% capped at 15k wage).
export async function pfRegister(req, res) {
  const rows = (await query(
    `SELECT e.employee_code, e.first_name, e.last_name, sp.uan, sp.pf_number,
            ss.monthly_ctc, ss.basic_pct
       FROM employees e
       JOIN salary_structures ss ON ss.employee_id=e.id
       LEFT JOIN statutory_profiles sp ON sp.employee_id=e.id
      WHERE e.onboarding_status='ACTIVE' AND (sp.pf_applicable IS DISTINCT FROM false)
        AND ($1::bigint IS NULL OR e.organisation_id=$1)
      ORDER BY e.employee_code`, [req.orgId || null])).rows;
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
    `SELECT e.employee_code, e.first_name, e.last_name, sp.esic_number, ss.monthly_ctc
       FROM employees e JOIN salary_structures ss ON ss.employee_id=e.id
       LEFT JOIN statutory_profiles sp ON sp.employee_id=e.id
      WHERE e.onboarding_status='ACTIVE' AND ($1::bigint IS NULL OR e.organisation_id=$1)
      ORDER BY e.employee_code`, [req.orgId || null])).rows;
  const CAP = 21000;
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

// GET /admin/reports/form16/:employeeId?fy= — Form-16 Part-B estimate PDF.
export async function form16(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  const fy = req.query.fy || null;
  const e = (await query(`SELECT * FROM employees WHERE id=$1`, [employeeId])).rows[0];
  if (!e) return res.status(404).json({ error: 'Employee not found.' });
  const ss = (await query(`SELECT monthly_ctc FROM salary_structures WHERE employee_id=$1`, [employeeId])).rows[0];
  const grossAnnual = Math.round((Number(ss?.monthly_ctc) || 0) * 12);
  const decl = (await query(
    `SELECT id, regime FROM investment_declarations WHERE employee_id=$1 ${fy ? 'AND financial_year=$2' : ''} ORDER BY id DESC LIMIT 1`,
    fy ? [employeeId, fy] : [employeeId])).rows[0];
  let items = [];
  if (decl) items = (await query(
    `SELECT section, COALESCE(approved_amount, declared_amount) AS amount FROM investment_declaration_items WHERE declaration_id=$1`,
    [decl.id])).rows.map((i) => ({ section: i.section, amount: Number(i.amount) }));
  const est = estimateTax({ grossAnnual, items });
  const regime = decl?.regime || est.recommended;
  const chosen = regime === 'old' ? est.old : est.new;
  let pan = '';
  try { pan = e.pan_encrypted ? decrypt(e.pan_encrypted) : (e.pan || ''); } catch { pan = ''; }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="form16-${e.employee_code || employeeId}.pdf"`);
  buildForm16Pdf({ financialYear: fy || '', regime, grossAnnual, deductions: est.deductions,
    taxable: chosen.taxable, taxBeforeCess: chosen.taxBeforeCess, cess: chosen.cess,
    totalTax: chosen.totalTax, monthlyTds: chosen.monthlyTds,
    meta: { name: `${e.first_name || ''} ${e.last_name || ''}`.trim(), pan } }, res);
}

function sendCsv(res, filename, cols, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
