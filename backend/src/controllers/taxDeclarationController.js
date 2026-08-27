// Income-tax investment declaration — employee submits, HR verifies. Uses incomeTax.js.
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { estimateTax, aggregateDeductions, computeRegimeTax, SECTION_CAPS } from '../services/incomeTax.js';

export async function sections(_req, res) {
  res.json({ sections: Object.entries(SECTION_CAPS).map(([code, cap]) => ({ code, cap: cap === Infinity ? null : cap })) });
}

async function grossAnnualFor(employeeId) {
  const s = (await query(`SELECT monthly_ctc FROM salary_structures WHERE employee_id=$1`, [employeeId])).rows[0];
  return Math.round((Number(s?.monthly_ctc) || 0) * 12);
}

async function loadDeclaration(employeeId, fy) {
  const d = (await query(
    `SELECT * FROM investment_declarations WHERE employee_id=$1 AND financial_year=$2`, [employeeId, fy])).rows[0];
  if (!d) return null;
  const items = (await query(`SELECT * FROM investment_declaration_items WHERE declaration_id=$1 ORDER BY id`, [d.id])).rows;
  return { ...d, items };
}

// ESS — GET /me/tax-declaration?fy=2024-25
export async function getMine(req, res) {
  const fy = req.query.fy || defaultFy();
  const employeeId = req.user.employeeId;
  const decl = await loadDeclaration(employeeId, fy);
  const grossAnnual = await grossAnnualFor(employeeId);
  const items = decl?.items?.map((i) => ({ section: i.section, amount: Number(i.declared_amount) })) || [];
  const estimate = estimateTax({ grossAnnual, items });
  res.json({ declaration: decl, grossAnnual, estimate, fy });
}

// ESS — POST /me/tax-declaration  { fy, regime, items:[{section,description,amount}] }
export async function saveMine(req, res) {
  const { fy = defaultFy(), regime = 'new', items = [] } = req.body || {};
  const employeeId = req.user.employeeId;
  if (!employeeId) return res.status(400).json({ error: 'No employee profile on this account.' });
  let decl = (await query(`SELECT * FROM investment_declarations WHERE employee_id=$1 AND financial_year=$2`, [employeeId, fy])).rows[0];
  if (decl && decl.status === 'verified') return res.status(409).json({ error: 'This declaration is already verified and locked.' });
  if (!decl) {
    decl = (await query(
      `INSERT INTO investment_declarations (employee_id, financial_year, regime) VALUES ($1,$2,$3) RETURNING *`,
      [employeeId, fy, regime === 'old' ? 'old' : 'new'])).rows[0];
  } else {
    await query(`UPDATE investment_declarations SET regime=$2, status='draft' WHERE id=$1`, [decl.id, regime === 'old' ? 'old' : 'new']);
  }
  await query(`DELETE FROM investment_declaration_items WHERE declaration_id=$1`, [decl.id]);
  for (const it of items) {
    if (!it.section) continue;
    await query(
      `INSERT INTO investment_declaration_items (declaration_id, section, description, declared_amount)
       VALUES ($1,$2,$3,$4)`, [decl.id, String(it.section).toUpperCase(), it.description || null, Number(it.amount) || 0]);
  }
  await audit(req.user.id, 'TAX_DECL_SAVE', 'investment_declaration', decl.id, { fy });
  res.json({ ok: true, declarationId: decl.id });
}

// ESS — POST /me/tax-declaration/submit
export async function submitMine(req, res) {
  const fy = req.body?.fy || defaultFy();
  const employeeId = req.user.employeeId;
  const row = (await query(
    `UPDATE investment_declarations SET status='submitted', submitted_at=now()
      WHERE employee_id=$1 AND financial_year=$2 AND status IN ('draft','rejected') RETURNING *`, [employeeId, fy])).rows[0];
  if (!row) return res.status(409).json({ error: 'Nothing to submit for this year.' });
  await audit(req.user.id, 'TAX_DECL_SUBMIT', 'investment_declaration', row.id, { fy });
  res.json({ ok: true });
}

// Admin — GET /admin/tax-declarations?status=&fy=
export async function adminList(req, res) {
  const rows = (await query(
    `SELECT d.id, d.financial_year, d.regime, d.status, d.submitted_at,
            e.first_name, e.last_name, e.employee_code
       FROM investment_declarations d JOIN employees e ON e.id=d.employee_id
      WHERE ($1::text IS NULL OR d.status=$1) AND ($2::text IS NULL OR d.financial_year=$2)
      ORDER BY d.submitted_at DESC NULLS LAST, d.id DESC`, [req.query.status || null, req.query.fy || null])).rows;
  res.json({ declarations: rows });
}

export async function adminGet(req, res) {
  const id = parseInt(req.params.id, 10);
  const d = (await query(`SELECT * FROM investment_declarations WHERE id=$1`, [id])).rows[0];
  if (!d) return res.status(404).json({ error: 'Not found.' });
  const items = (await query(`SELECT * FROM investment_declaration_items WHERE declaration_id=$1 ORDER BY id`, [id])).rows;
  const grossAnnual = await grossAnnualFor(d.employee_id);
  const estimate = estimateTax({ grossAnnual, items: items.map((i) => ({ section: i.section, amount: Number(i.declared_amount) })) });
  res.json({ declaration: d, items, grossAnnual, estimate });
}

// Admin — POST /admin/tax-declarations/:id/verify  { approvals:[{itemId,approvedAmount,remark}], remarks }
export async function verify(req, res) {
  const id = parseInt(req.params.id, 10);
  const { approvals = [], remarks, reject } = req.body || {};
  for (const a of approvals) {
    await query(`UPDATE investment_declaration_items SET approved_amount=$2, admin_remark=$3 WHERE id=$1 AND declaration_id=$4`,
      [a.itemId, Number(a.approvedAmount) || 0, a.remark || null, id]);
  }
  const status = reject ? 'rejected' : 'verified';
  const row = (await query(
    `UPDATE investment_declarations SET status=$2, verified_by=$3, verified_at=now(), remarks=$4 WHERE id=$1 RETURNING *`,
    [id, status, req.user.id, remarks || null])).rows[0];
  if (!row) return res.status(404).json({ error: 'Not found.' });
  await audit(req.user.id, `TAX_DECL_${status.toUpperCase()}`, 'investment_declaration', id, {});
  res.json({ declaration: row });
}

function defaultFy() {
  // Indian FY runs Apr–Mar. We avoid Date.now-based ambiguity by deriving from the server clock at request time.
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
