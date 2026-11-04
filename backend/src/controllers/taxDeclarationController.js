// Income-tax investment declaration — employee submits, HR verifies. Uses incomeTax.js.
//
// v2 (QA C25, E34-E37, C47): section limits, no negatives or duplicate sections,
// at least one real investment, blocked until a salary structure exists; a
// submitted declaration is locked until HR sends it back; a proof per item;
// HR's verify saves an approved amount for every item; the projection covers
// only the months of the FY the employee is actually paid for.
import { query } from '../db/pool.js';
import { scopedByEmployee } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { estimateTax, SECTION_CAPS, projectedAnnualGross, monthsInFy, fyStartYearOf } from '../services/incomeTax.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, toNumber } from '../utils/validate.js';
import { isoDate } from '../utils/joining.js';
import { AppError } from '../middleware/error.js';
import { checkUpload, sendAttachment, DOC_KINDS } from '../utils/uploads.js';

const SECTION_LABELS = {
  '80C': '80C — LIC, PPF, ELSS, tuition fees, home-loan principal',
  '80CCD1B': '80CCD(1B) — additional NPS',
  '80D': '80D — medical insurance',
  '80E': '80E — education-loan interest',
  '80EE': '80EE — first home-loan interest',
  '80EEA': '80EEA — affordable home-loan interest',
  '80G': '80G — donations',
  '80TTA': '80TTA — savings-account interest',
  SEC24: 'Section 24 — home-loan interest (self-occupied)',
  HRA: 'HRA — rent paid',
};
const MAX_UNCAPPED = 10000000; // ₹1 crore for sections with no statutory cap

export async function sections(_req, res) {
  res.json({ sections: Object.entries(SECTION_CAPS).map(([code, cap]) => ({ code, cap: cap === Infinity ? null : cap, label: SECTION_LABELS[code] || code })) });
}

// Gross salary for the FY: monthly CTC × the months the employee is paid in it.
// Someone joining on 02-11-2026 is paid for under five months of FY 2026-27,
// not twelve (C47 / E37).
async function grossAnnualFor(employeeId, fy) {
  const s = (await query(
    `SELECT ss.monthly_ctc, e.date_of_joining FROM employees e
       LEFT JOIN salary_structures ss ON ss.employee_id = e.id WHERE e.id=$1`, [employeeId])).rows[0];
  const startYear = fyStartYearOf(fy || defaultFy());
  return {
    grossAnnual: projectedAnnualGross({ monthlyCtc: Number(s?.monthly_ctc) || 0, doj: isoDate(s?.date_of_joining), fyStartYear: startYear }),
    months: monthsInFy({ doj: isoDate(s?.date_of_joining), fyStartYear: startYear }),
    monthlyCtc: Number(s?.monthly_ctc) || 0,
    hasStructure: s?.monthly_ctc != null && Number(s.monthly_ctc) > 0,
  };
}

// Every column the v1 shape had, plus whether a proof is on file. The file
// itself is never inlined — it is fetched on its own route.
const ITEM_COLS = 'id, declaration_id, section, description, declared_amount, approved_amount, proof_doc_id, admin_remark, proof_name, proof_uploaded_at';
const itemView = (i) => ({ ...i, proof: i.proof_name ? { name: i.proof_name, uploadedAt: i.proof_uploaded_at } : null });

async function loadDeclaration(employeeId, fy) {
  const d = (await query(
    `SELECT * FROM investment_declarations WHERE employee_id=$1 AND financial_year=$2`, [employeeId, fy])).rows[0];
  if (!d) return null;
  const items = (await query(
    `SELECT ${ITEM_COLS} FROM investment_declaration_items WHERE declaration_id=$1 ORDER BY id`, [d.id])).rows;
  return { ...d, items: items.map(itemView) };
}

// ESS — GET /me/tax-declaration?fy=2024-25
export async function getMine(req, res) {
  const fy = req.query.fy || defaultFy();
  const employeeId = req.user.employeeId;
  const decl = await loadDeclaration(employeeId, fy);
  const g = await grossAnnualFor(employeeId, fy);
  const items = decl?.items?.map((i) => ({ section: i.section, amount: Number(i.declared_amount) })) || [];
  const estimate = estimateTax({ grossAnnual: g.grossAnnual, items });
  res.json({
    declaration: decl, grossAnnual: g.grossAnnual, estimate, fy,
    projection: { months: Math.round(g.months * 100) / 100, monthlyCtc: g.monthlyCtc }, hasStructure: g.hasStructure,
    locked: decl ? ['submitted', 'verified'].includes(decl.status) : false,
  });
}

// v2 rules for the rows of a declaration (E34, E35).
function validateItems(items) {
  const v = validator();
  if (!Array.isArray(items) || !items.length) {
    v.add('items', 'Add at least one investment with an amount');
    return { v, rows: [] };
  }
  const seen = new Set();
  const rows = [];
  items.forEach((it, i) => {
    const section = String(it.section || '').toUpperCase().trim();
    const key = `items.${i}`;
    if (!Object.prototype.hasOwnProperty.call(SECTION_CAPS, section)) { v.add(`${key}.section`, `Row ${i + 1}: choose a section`); return; }
    if (seen.has(section)) v.add(`${key}.section`, `Row ${i + 1}: ${section} is already declared — put the total in one row`);
    seen.add(section);
    const cap = SECTION_CAPS[section] === Infinity ? MAX_UNCAPPED : SECTION_CAPS[section];
    v.number(`${key}.amount`, it.amount, `Row ${i + 1} (${section}) amount`, { required: true, min: 1, max: cap, decimals: 2 });
    v.text(`${key}.description`, it.description, `Row ${i + 1} description`, { max: 200 });
    rows.push({ id: it.id ? Number(it.id) : null, section, description: it.description ? String(it.description).trim() : null, amount: toNumber(it.amount) });
  });
  return { v, rows };
}

// ESS — POST /me/tax-declaration  { fy, regime, items:[{section,description,amount}] }
export async function saveMine(req, res) {
  const { fy = defaultFy(), regime = 'new', items = [] } = req.body || {};
  const employeeId = req.user.employeeId;
  if (!employeeId) return res.status(400).json({ error: 'No employee profile on this account.' });
  let decl = (await query(`SELECT * FROM investment_declarations WHERE employee_id=$1 AND financial_year=$2`, [employeeId, fy])).rows[0];
  if (decl && decl.status === 'verified') return res.status(409).json({ error: 'This declaration is already verified and locked.' });

  if (isV2(req)) {
    // E36: once submitted it is HR's to review — saving a draft no longer pulls it back.
    if (decl && decl.status === 'submitted') {
      return res.status(409).json({ error: 'This declaration has been submitted to HR and is locked. HR can send it back if it needs changes.' });
    }
    const g = await grossAnnualFor(employeeId, fy);
    if (!g.hasStructure) {
      return res.status(409).json({ error: 'Your salary structure has not been set up yet, so tax cannot be worked out. HR will set it up — you can declare after that.' });
    }
    const { v, rows } = validateItems(items);
    v.oneOf('regime', regime, ['old', 'new'], 'Tax regime');
    v.throwIfAny();
    if (!decl) {
      decl = (await query(
        `INSERT INTO investment_declarations (employee_id, financial_year, regime) VALUES ($1,$2,$3) RETURNING *`,
        [employeeId, fy, regime])).rows[0];
    } else {
      await query(`UPDATE investment_declarations SET regime=$2 WHERE id=$1`, [decl.id, regime]);
    }
    // Update in place by section so an uploaded proof survives a re-save.
    const existing = (await query(`SELECT id, section FROM investment_declaration_items WHERE declaration_id=$1`, [decl.id])).rows;
    const bySection = new Map(existing.map((x) => [x.section, x.id]));
    const keep = [];
    for (const r of rows) {
      const id = bySection.get(r.section);
      if (id) {
        await query(`UPDATE investment_declaration_items SET description=$2, declared_amount=$3 WHERE id=$1`, [id, r.description, r.amount]);
        keep.push(id);
      } else {
        const ins = (await query(
          `INSERT INTO investment_declaration_items (declaration_id, section, description, declared_amount)
           VALUES ($1,$2,$3,$4) RETURNING id`, [decl.id, r.section, r.description, r.amount])).rows[0];
        keep.push(ins.id);
      }
    }
    await query(`DELETE FROM investment_declaration_items WHERE declaration_id=$1 AND NOT (id = ANY($2::bigint[]))`, [decl.id, keep]);
    await audit(req.user.id, 'TAX_DECL_SAVE', 'investment_declaration', decl.id, { fy });
    return res.json({ ok: true, declarationId: decl.id, declaration: await loadDeclaration(employeeId, fy) });
  }

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
  if (isV2(req)) {
    const d = (await query(`SELECT id, status FROM investment_declarations WHERE employee_id=$1 AND financial_year=$2`, [employeeId, fy])).rows[0];
    if (!d) return res.status(409).json({ error: 'Save your declaration first.' });
    const n = (await query(`SELECT COUNT(*)::int AS n FROM investment_declaration_items WHERE declaration_id=$1 AND declared_amount > 0`, [d.id])).rows[0].n;
    if (!n) throw new AppError('Add at least one investment with an amount before submitting.', 400, { items: 'Add at least one investment with an amount' });
    if (!(await grossAnnualFor(employeeId, fy)).hasStructure) {
      return res.status(409).json({ error: 'Your salary structure has not been set up yet, so this cannot be submitted.' });
    }
  }
  const row = (await query(
    `UPDATE investment_declarations SET status='submitted', submitted_at=now()
      WHERE employee_id=$1 AND financial_year=$2 AND status IN ('draft','rejected') RETURNING *`, [employeeId, fy])).rows[0];
  if (!row) return res.status(409).json({ error: 'Nothing to submit for this year.' });
  await audit(req.user.id, 'TAX_DECL_SUBMIT', 'investment_declaration', row.id, { fy });
  res.json({ ok: true });
}

// ESS — POST /api/v2/me/tax-declaration/items/:itemId/proof { file, mime, name }
export async function uploadProof(req, res) {
  const item = (await query(
    `SELECT i.id, d.status FROM investment_declaration_items i
       JOIN investment_declarations d ON d.id = i.declaration_id
      WHERE i.id=$1 AND d.employee_id=$2`, [parseInt(req.params.itemId, 10) || 0, req.user.employeeId || 0])).rows[0];
  if (!item) return res.status(404).json({ error: 'Investment not found.' });
  if (['submitted', 'verified'].includes(item.status)) return res.status(409).json({ error: 'This declaration is locked — proofs cannot be changed now.' });
  const f = checkUpload({ data: req.body?.file, mime: req.body?.mime, name: req.body?.name, label: 'proof', maxMb: 5, kinds: DOC_KINDS, required: true });
  await query(`UPDATE investment_declaration_items SET proof_name=$2, proof_mime=$3, proof_data=$4, proof_uploaded_at=now() WHERE id=$1`,
    [item.id, f.name, f.mime, f.data]);
  await audit(req.user.id, 'TAX_DECL_PROOF', 'investment_declaration_item', item.id, { bytes: f.bytes });
  res.json({ ok: true, proof: { name: f.name } });
}

// GET /api/v2/me/tax-declaration/items/:itemId/proof
export async function myProof(req, res) {
  const p = (await query(
    `SELECT i.proof_name, i.proof_mime, i.proof_data FROM investment_declaration_items i
       JOIN investment_declarations d ON d.id = i.declaration_id
      WHERE i.id=$1 AND d.employee_id=$2`, [parseInt(req.params.itemId, 10) || 0, req.user.employeeId || 0])).rows[0];
  if (!p?.proof_data) return res.status(404).json({ error: 'No proof uploaded.' });
  sendAttachment(res, { data: p.proof_data, mime: p.proof_mime, name: p.proof_name, fallbackName: 'proof' });
}

// GET /api/v2/admin/tax-declarations/:id/items/:itemId/proof
export async function adminProof(req, res) {
  const d = await scopedByEmployee(req, 'investment_declarations', req.params.id, { cols: 't.id' });
  if (!d) return res.status(404).json({ error: 'Not found.' });
  const p = (await query(
    `SELECT proof_name, proof_mime, proof_data FROM investment_declaration_items WHERE id=$1 AND declaration_id=$2`,
    [parseInt(req.params.itemId, 10) || 0, d.id])).rows[0];
  if (!p?.proof_data) return res.status(404).json({ error: 'No proof uploaded.' });
  sendAttachment(res, { data: p.proof_data, mime: p.proof_mime, name: p.proof_name, fallbackName: 'proof' });
}

// Admin — GET /admin/tax-declarations?status=&fy=
export async function adminList(req, res) {
  // investment_declarations carries no organisation_id; the join to employees was
  // already here but had no org predicate, so the queue listed every tenant's
  // declarations.
  const rows = (await query(
    `SELECT d.id, d.financial_year, d.regime, d.status, d.submitted_at, d.verified_at,
            e.first_name, e.last_name, e.employee_code,
            (SELECT COALESCE(SUM(i.declared_amount),0) FROM investment_declaration_items i WHERE i.declaration_id=d.id) AS declared_total,
            (SELECT SUM(i.approved_amount) FROM investment_declaration_items i WHERE i.declaration_id=d.id) AS approved_total
       FROM investment_declarations d JOIN employees e ON e.id=d.employee_id
      WHERE ($1::text IS NULL OR d.status=$1) AND ($2::text IS NULL OR d.financial_year=$2)
        AND ($3::bigint IS NULL OR e.organisation_id=$3)
        AND ($4::bigint IS NULL OR e.company_id=$4)
      ORDER BY d.submitted_at DESC NULLS LAST, d.id DESC`,
    [req.query.status || null, req.query.fy || null, req.orgId || null, req.companyScope || null])).rows;
  res.json({ declarations: rows });
}

export async function adminGet(req, res) {
  const id = parseInt(req.params.id, 10);
  // Unscoped, any declaration id exposed another tenant's investment proofs and
  // their annual gross salary.
  const d = await scopedByEmployee(req, 'investment_declarations', id);
  if (!d) return res.status(404).json({ error: 'Not found.' });
  const items = (await query(
    `SELECT ${ITEM_COLS} FROM investment_declaration_items WHERE declaration_id=$1 ORDER BY id`, [id])).rows.map(itemView);
  const g = await grossAnnualFor(d.employee_id, d.financial_year);
  const estimate = estimateTax({ grossAnnual: g.grossAnnual, items: items.map((i) => ({ section: i.section, amount: Number(i.declared_amount) })) });
  res.json({ declaration: d, items, grossAnnual: g.grossAnnual, estimate, projection: { months: Math.round(g.months * 100) / 100, monthlyCtc: g.monthlyCtc } });
}

// Admin — POST /admin/tax-declarations/:id/verify  { approvals:[{itemId,approvedAmount,remark}], remarks }
export async function verify(req, res) {
  const id = parseInt(req.params.id, 10);
  const { approvals = [], remarks, reject } = req.body || {};
  // The declaration (and therefore its items) must be the caller's own: unscoped,
  // this approved/rejected another tenant's declaration and rewrote the approved
  // amounts that drive their TDS.
  const mine = await scopedByEmployee(req, 'investment_declarations', id, { cols: 't.id, t.status' });
  if (!mine) return res.status(404).json({ error: 'Not found.' });

  if (isV2(req)) {
    if (mine.status !== 'submitted') {
      return res.status(409).json({ error: `Only a submitted declaration can be ${reject ? 'sent back' : 'verified'} — this one is ${mine.status}.` });
    }
    const items = (await query(`SELECT id, section, declared_amount FROM investment_declaration_items WHERE declaration_id=$1`, [id])).rows;
    const given = new Map((approvals || []).map((a) => [String(a.itemId), a]));
    const v = validator();
    if (reject) v.text('remarks', remarks, 'Remarks', { required: true, min: 5, max: 1000 });
    const writes = [];
    for (const it of items) {
      const a = given.get(String(it.id));
      const cap = SECTION_CAPS[it.section] === Infinity ? Number(it.declared_amount) : Math.min(Number(it.declared_amount), SECTION_CAPS[it.section] ?? Infinity);
      // C25: every item gets an approved amount on verify; blank = declared, within the section cap.
      const raw = a && a.approvedAmount !== undefined && a.approvedAmount !== null && a.approvedAmount !== '' ? a.approvedAmount : cap;
      v.number(`approvals.${it.id}`, raw, `${it.section} approved amount`, { min: 0, max: cap, decimals: 2 });
      writes.push([it.id, toNumber(raw), a?.remark ? String(a.remark).slice(0, 300) : null]);
    }
    v.throwIfAny();
    if (!reject) for (const [itemId, amt, remark] of writes) {
      await query(`UPDATE investment_declaration_items SET approved_amount=$2, admin_remark=$3 WHERE id=$1 AND declaration_id=$4`, [itemId, amt, remark, id]);
    }
  } else {
    for (const a of approvals) {
      await query(`UPDATE investment_declaration_items SET approved_amount=$2, admin_remark=$3 WHERE id=$1 AND declaration_id=$4`,
        [a.itemId, Number(a.approvedAmount) || 0, a.remark || null, id]);
    }
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
  // Indian FY runs Apr–Mar, in India time.
  const now = new Date(Date.now() + 330 * 60000);
  const y = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
