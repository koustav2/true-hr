// Bulk Excel tools — GreenHR-style bulk salary upload.
// Download a template pre-filled with current CTC, edit the "New Monthly CTC"
// column, re-upload → salary_structures updated by employee code. Additive.
import ExcelJS from 'exceljs';
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

// GET /admin/bulk/salary/template — xlsx of active employees + current CTC.
export async function salaryTemplate(req, res) {
  const rows = (await query(
    `SELECT e.employee_code, e.first_name, e.last_name, COALESCE(ss.monthly_ctc,0) AS ctc
       FROM employees e LEFT JOIN salary_structures ss ON ss.employee_id=e.id
      WHERE e.onboarding_status='ACTIVE' AND ($1::bigint IS NULL OR e.organisation_id=$1)
      ORDER BY e.employee_code`, [req.orgId || null])).rows;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Bulk Salary');
  ws.columns = [
    { header: 'Employee Code', key: 'code', width: 18 },
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Current Monthly CTC', key: 'cur', width: 20 },
    { header: 'New Monthly CTC', key: 'neu', width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow({ code: r.employee_code, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), cur: Number(r.ctc), neu: '' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="bulk-salary-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}

// POST /admin/bulk/salary { file: base64 } — apply new CTC by employee code.
export async function salaryUpload(req, res) {
  const b64 = req.body?.file;
  if (!b64) return res.status(400).json({ error: 'No file uploaded.' });
  let ws;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(b64, 'base64'));
    ws = wb.worksheets[0];
  } catch { return res.status(400).json({ error: 'Could not read that spreadsheet.' }); }
  if (!ws) return res.status(400).json({ error: 'The workbook has no sheets.' });

  // Map header names → column numbers (tolerant of column order).
  const header = {};
  ws.getRow(1).eachCell((c, col) => { header[String(c.value || '').trim().toLowerCase()] = col; });
  const codeCol = header['employee code'] || 1;
  const newCol = header['new monthly ctc'] || 4;

  const results = [];
  let updated = 0;
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const code = String(row.getCell(codeCol).value ?? '').trim();
    if (!code) continue;
    const raw = row.getCell(newCol).value;
    const ctc = Number(typeof raw === 'object' && raw?.result != null ? raw.result : raw);
    if (!Number.isFinite(ctc) || ctc <= 0) { results.push({ code, status: 'skipped (no valid new CTC)' }); continue; }
    const emp = (await query(`SELECT id FROM employees WHERE employee_code=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [code, req.orgId || null])).rows[0];
    if (!emp) { results.push({ code, status: 'not found' }); continue; }
    await query(
      `INSERT INTO salary_structures (employee_id, monthly_ctc) VALUES ($1,$2)
       ON CONFLICT (employee_id) DO UPDATE SET monthly_ctc=EXCLUDED.monthly_ctc`, [emp.id, Math.round(ctc)]);
    results.push({ code, status: `updated → ₹${Math.round(ctc)}` });
    updated++;
  }
  await audit(req.user.id, 'BULK_SALARY_UPLOAD', 'salary_structures', null, { updated, rows: results.length });
  res.json({ updated, total: results.length, results });
}
