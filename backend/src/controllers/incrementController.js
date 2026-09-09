// ============================================================================
// Increment management — the salary-revision ledger.
//
// GreenHR parity: "Increment Management". salary_structures holds only the
// current compensation, so without this table a revision overwrites history.
// Three steps on purpose: PROPOSE (recorded, payroll untouched) → APPROVE
// (signed off) → APPLY (written onto the structure). That lets HR prepare an
// April increment in February without changing February's payslip.
// ============================================================================
import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { buildLetter } from '../services/letters.js';

const TYPES = ['INCREMENT', 'PROMOTION', 'CORRECTION'];
const money = (v) => (v == null ? null : Number(v));
const inr = (n) => `INR ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const shape = (r) => {
  const oldM = money(r.old_monthly_ctc), newM = money(r.new_monthly_ctc);
  return {
    id: Number(r.id),
    revisionType: r.revision_type,
    effectiveFrom: r.effective_from,
    oldMonthlyCtc: oldM, newMonthlyCtc: newM,
    oldAnnualCtc: oldM == null ? null : oldM * 12,
    newAnnualCtc: newM == null ? null : newM * 12,
    hikePct: oldM ? Number((((newM - oldM) / oldM) * 100).toFixed(2)) : null,
    hikeAmount: oldM == null ? null : newM - oldM,
    oldGrade: r.old_grade, newGrade: r.new_grade,
    oldDesignation: r.old_designation, newDesignation: r.new_designation,
    reason: r.reason,
    status: r.status,
    letterId: r.letter_id != null ? Number(r.letter_id) : null,
    createdAt: r.created_at, approvedAt: r.approved_at, appliedAt: r.applied_at,
    cancelNote: r.cancel_note,
    employee: r.first_name ? {
      id: Number(r.employee_id), name: `${r.first_name} ${r.last_name}`.trim(),
      code: r.employee_code, designation: r.current_designation, department: r.department, company: r.company,
    } : undefined,
  };
};

const SELECT = `
  SELECT i.*, e.first_name, e.last_name, e.employee_code,
         cd.title AS current_designation, dep.name AS department, co.name AS company,
         od.title AS old_designation, nd.title AS new_designation
    FROM salary_increments i
    JOIN employees e ON e.id = i.employee_id
    LEFT JOIN designations cd ON cd.id = e.designation_id
    LEFT JOIN departments dep ON dep.id = e.department_id
    LEFT JOIN companies co ON co.id = e.company_id
    LEFT JOIN designations od ON od.id = i.old_designation_id
    LEFT JOIN designations nd ON nd.id = i.new_designation_id`;

// GET /admin/increments?status=&employeeId=
export async function list(req, res, next) {
  try {
    const status = String(req.query.status || 'ALL').toUpperCase();
    const empId = req.query.employeeId ? parseInt(req.query.employeeId, 10) : null;
    const { rows } = await query(
      `${SELECT}
        WHERE ($1 = 'ALL' OR i.status = $1)
          AND ($2::bigint IS NULL OR i.employee_id = $2)
          AND ($3::bigint IS NULL OR e.organisation_id = $3)
          AND ($4::bigint IS NULL OR e.company_id = $4)
        ORDER BY i.effective_from DESC, i.id DESC LIMIT 500`,
      [status, empId, req.orgId || null, req.companyScope || null]);
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /me/increments — my own revision history (APPLIED only; an employee has
// no business seeing a proposal that has not been signed off).
export async function mine(req, res, next) {
  try {
    const empId = req.auth?.employeeId || req.user?.employeeId;
    if (!empId) return res.json([]);
    const { rows } = await query(
      `${SELECT} WHERE i.employee_id=$1 AND i.status='APPLIED' ORDER BY i.effective_from DESC`, [empId]);
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

async function fetchScoped(id, req) {
  return (await query(
    `${SELECT} WHERE i.id=$1 AND ($2::bigint IS NULL OR e.organisation_id=$2)`,
    [id, req.orgId || null])).rows[0];
}

// POST /admin/increments
// { employeeId, effectiveFrom, revisionType, newMonthlyCtc | hikePct, newGrade, newDesignationId, reason }
export async function propose(req, res, next) {
  try {
    const b = req.body || {};
    const empId = parseInt(b.employeeId, 10);
    if (!Number.isFinite(empId)) return res.status(400).json({ error: 'employeeId is required.' });
    const effectiveFrom = String(b.effectiveFrom || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return res.status(400).json({ error: 'effectiveFrom must be a date (YYYY-MM-DD).' });
    const revisionType = TYPES.includes(String(b.revisionType || '').toUpperCase())
      ? String(b.revisionType).toUpperCase() : 'INCREMENT';

    const e = (await query(
      `SELECT e.id, e.designation_id, e.organisation_id, ss.monthly_ctc, ss.grade
         FROM employees e LEFT JOIN salary_structures ss ON ss.employee_id = e.id
        WHERE e.id=$1 AND ($2::bigint IS NULL OR e.organisation_id=$2)
          AND ($3::bigint IS NULL OR e.company_id=$3)`,
      [empId, req.orgId || null, req.companyScope || null])).rows[0];
    if (!e) return res.status(404).json({ error: 'Employee not found in your scope.' });

    const oldM = money(e.monthly_ctc);
    let newM = b.newMonthlyCtc != null && b.newMonthlyCtc !== '' ? Number(b.newMonthlyCtc) : null;
    if (newM == null && b.hikePct != null && b.hikePct !== '') {
      if (!oldM) return res.status(400).json({ error: 'This employee has no salary structure yet, so a percentage hike has nothing to apply to. Enter the new monthly CTC instead.' });
      newM = Math.round(oldM * (1 + Number(b.hikePct) / 100));
    }
    if (!Number.isFinite(newM) || newM <= 0) return res.status(400).json({ error: 'Give either the new monthly CTC or a hike percentage.' });
    if (revisionType !== 'CORRECTION' && oldM != null && newM < oldM) {
      return res.status(400).json({ error: 'That is a reduction, not an increment. Record it as a Correction if it is intentional.' });
    }

    const clash = await query(
      `SELECT 1 FROM salary_increments
        WHERE employee_id=$1 AND effective_from=$2 AND status IN ('PROPOSED','APPROVED')`,
      [empId, effectiveFrom]);
    if (clash.rowCount) return res.status(409).json({ error: 'There is already an open revision for this employee on that date.' });

    const row = (await query(
      `INSERT INTO salary_increments
         (employee_id, organisation_id, revision_type, effective_from, old_monthly_ctc, new_monthly_ctc,
          old_grade, new_grade, old_designation_id, new_designation_id, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [empId, e.organisation_id || req.orgId || null, revisionType, effectiveFrom, oldM, newM,
       e.grade || null, b.newGrade || null, e.designation_id || null,
       b.newDesignationId ? parseInt(b.newDesignationId, 10) : null, b.reason || null, req.user.id])).rows[0];

    await audit(req.user.id, 'INCREMENT_PROPOSED', 'salary_increment', row.id, { employeeId: empId, newMonthlyCtc: newM, effectiveFrom });
    res.status(201).json(shape(await fetchScoped(row.id, req)));
  } catch (e) { next(e); }
}

// POST /admin/increments/:id/approve
export async function approve(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await fetchScoped(id, req);
    if (!r) return res.status(404).json({ error: 'Revision not found.' });
    if (r.status !== 'PROPOSED') return res.status(409).json({ error: `This revision is already ${r.status.toLowerCase()}.` });
    await query(`UPDATE salary_increments SET status='APPROVED', approved_by=$2, approved_at=now() WHERE id=$1`, [id, req.user.id]);
    await audit(req.user.id, 'INCREMENT_APPROVED', 'salary_increment', id, {});
    res.json(shape(await fetchScoped(id, req)));
  } catch (e) { next(e); }
}

// POST /admin/increments/:id/apply { issueLetter }
// Writes the revision onto the live salary structure. This is the only step
// that payroll can see, and it is idempotent by status guard.
export async function apply(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await fetchScoped(id, req);
    if (!r) return res.status(404).json({ error: 'Revision not found.' });
    if (r.status === 'APPLIED') return res.status(409).json({ error: 'Already applied.' });
    if (r.status !== 'APPROVED') return res.status(409).json({ error: 'Approve the revision before applying it.' });

    let letterId = null;
    await tx(async (c) => {
      // salary_structures is one row per employee (UNIQUE employee_id), so this
      // upsert keeps the current-compensation contract intact.
      await c.query(
        `INSERT INTO salary_structures (employee_id, grade, monthly_ctc)
         VALUES ($1, $2, $3)
         ON CONFLICT (employee_id) DO UPDATE
           SET monthly_ctc = EXCLUDED.monthly_ctc,
               grade = COALESCE(EXCLUDED.grade, salary_structures.grade),
               updated_at = now()`,
        [r.employee_id, r.new_grade || r.old_grade || null, r.new_monthly_ctc]);

      // Annual CTC on the employee record is what the offer/annexure reads.
      await c.query(`UPDATE employees SET ctc = $2 WHERE id = $1`,
        [r.employee_id, Number(r.new_monthly_ctc) * 12]);

      if (r.new_designation_id) {
        await c.query(`UPDATE employees SET designation_id=$2 WHERE id=$1`, [r.employee_id, r.new_designation_id]);
      }

      if (req.body?.issueLetter) {
        const code = r.revision_type === 'PROMOTION' ? 'PROMOTION' : 'INCREMENT';
        const built = buildLetter({ typeCode: code }, {
          employeeName: `${r.first_name} ${r.last_name}`.trim(),
          employeeCode: r.employee_code || '',
          designation: r.new_designation || r.current_designation || '',
          newDesignation: r.new_designation || r.current_designation || '',
          effectiveDate: String(r.effective_from).slice(0, 10),
          revisedCtc: inr(Number(r.new_monthly_ctc) * 12),
          companyName: r.company || process.env.COMPANY_NAME || 'True HR Pvt Ltd',
        });
        const refNo = `TH/INC/${new Date().getFullYear()}/${Date.now().toString().slice(-6)}`;
        const lt = (await c.query(
          `INSERT INTO issued_letters (employee_id, type_code, ref_no, title, body_rendered, meta, issued_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [r.employee_id, code, refNo, built.title, built.text,
           { incrementId: id, missing: built.missing }, req.user.id])).rows[0];
        letterId = lt.id;
      }

      await c.query(
        `UPDATE salary_increments SET status='APPLIED', applied_at=now(), letter_id=COALESCE($2, letter_id) WHERE id=$1`,
        [id, letterId]);
    });

    await audit(req.user.id, 'INCREMENT_APPLIED', 'salary_increment', id,
      { employeeId: Number(r.employee_id), newMonthlyCtc: money(r.new_monthly_ctc), letterId });
    res.json(shape(await fetchScoped(id, req)));
  } catch (e) { next(e); }
}

// POST /admin/increments/:id/cancel { note }
export async function cancel(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await fetchScoped(id, req);
    if (!r) return res.status(404).json({ error: 'Revision not found.' });
    if (r.status === 'APPLIED') return res.status(409).json({ error: 'An applied revision cannot be cancelled — record a Correction instead.' });
    if (r.status === 'CANCELLED') return res.status(409).json({ error: 'Already cancelled.' });
    await query(`UPDATE salary_increments SET status='CANCELLED', cancel_note=$2 WHERE id=$1`,
      [id, String(req.body?.note || '').trim() || null]);
    await audit(req.user.id, 'INCREMENT_CANCELLED', 'salary_increment', id, {});
    res.json(shape(await fetchScoped(id, req)));
  } catch (e) { next(e); }
}

// GET /admin/increments/summary — tiles for the page header.
export async function summary(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT i.status, COUNT(*)::int AS n,
              COALESCE(SUM(i.new_monthly_ctc - COALESCE(i.old_monthly_ctc,0)),0) AS delta
         FROM salary_increments i JOIN employees e ON e.id=i.employee_id
        WHERE ($1::bigint IS NULL OR e.organisation_id=$1)
          AND ($2::bigint IS NULL OR e.company_id=$2)
        GROUP BY i.status`,
      [req.orgId || null, req.companyScope || null]);
    const by = Object.fromEntries(rows.map((r) => [r.status, r]));
    const due = (await query(
      `SELECT COUNT(*)::int AS n FROM salary_increments i JOIN employees e ON e.id=i.employee_id
        WHERE i.status='APPROVED' AND i.effective_from <= CURRENT_DATE
          AND ($1::bigint IS NULL OR e.organisation_id=$1)
          AND ($2::bigint IS NULL OR e.company_id=$2)`,
      [req.orgId || null, req.companyScope || null])).rows[0].n;
    res.json({
      proposed: by.PROPOSED?.n || 0,
      approved: by.APPROVED?.n || 0,
      applied: by.APPLIED?.n || 0,
      dueToApply: due,
      // Monthly payroll impact of everything already applied.
      appliedMonthlyDelta: Number(by.APPLIED?.delta || 0),
    });
  } catch (e) { next(e); }
}
