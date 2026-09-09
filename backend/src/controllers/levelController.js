// ============================================================================
// Organisation hierarchy levels.
//
// GreenHR parity: "Organization Hierarchy" — choose a company, say how many
// levels it has, name each one, save. A level is the rung (L1 Board,
// L2 Leadership, L3 Management…), owned per company because two companies
// inside one organisation rarely have the same shape.
//
// Designations carry the level, so an employee inherits one from the
// designation they already hold. Nothing extra to set per person, and no way
// for a person's level to drift out of step with their title.
// ============================================================================
import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';

const MAX_LEVELS = 20;

async function scopedCompany(req, raw) {
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) return null;
  return (await query(
    `SELECT id, organisation_id, name FROM companies
      WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
    [id, req.orgId || null])).rows[0] || null;
}

const shape = (r) => ({
  id: Number(r.id),
  levelNo: r.level_no,
  name: r.name,
  description: r.description,
  designations: Number(r.designation_count || 0),
  employees: Number(r.employee_count || 0),
});

/** The ladder plus the designations hanging off it, for one company. */
async function payload(co) {
  const { rows } = await query(
      `SELECT l.*,
              (SELECT COUNT(*) FROM designations d WHERE d.level_id = l.id) AS designation_count,
              (SELECT COUNT(*) FROM employees e
                 JOIN designations d ON d.id = e.designation_id
                WHERE d.level_id = l.id AND e.onboarding_status = 'ACTIVE') AS employee_count
         FROM org_levels l WHERE l.company_id=$1 ORDER BY l.level_no`, [co.id]);
  const designations = (await query(
    `SELECT id, title, grade, level_id FROM designations WHERE company_id=$1 ORDER BY title`, [co.id])).rows
    .map((d) => ({ id: Number(d.id), title: d.title, grade: d.grade, levelId: d.level_id != null ? Number(d.level_id) : null }));
  return { companyId: co.id, company: co.name, maxLevels: MAX_LEVELS, levels: rows.map(shape), designations };
}

// GET /admin/companies/:companyId/levels
export async function list(req, res, next) {
  try {
    const co = await scopedCompany(req, req.params.companyId);
    if (!co) return res.status(404).json({ error: 'Company not found in your organisation.' });
    res.json(await payload(co));
  } catch (e) { next(e); }
}

// PUT /admin/companies/:companyId/levels { levels: [{ id?, levelNo, name, description }] }
//
// The whole ladder is saved at once. A level that disappears has its
// designations unhooked rather than blocked (ON DELETE SET NULL) — refusing to
// let HR restructure because titles are attached would be worse than a few
// designations needing to be reassigned, and the response says how many.
export async function replace(req, res, next) {
  try {
    const co = await scopedCompany(req, req.params.companyId);
    if (!co) return res.status(404).json({ error: 'Company not found in your organisation.' });

    const raw = Array.isArray(req.body?.levels) ? req.body.levels : [];
    if (raw.length > MAX_LEVELS) return res.status(400).json({ error: `At most ${MAX_LEVELS} levels.` });

    // Renumber from 1 in the order given, so a deleted middle level does not
    // leave a hole and "level 3" always means the third rung.
    const levels = raw.map((l, i) => ({
      id: l.id ? Number(l.id) : null,
      levelNo: i + 1,
      name: String(l.name || '').trim(),
      description: l.description ? String(l.description).trim() : null,
    }));
    const blank = levels.find((l) => !l.name);
    if (blank) return res.status(400).json({ error: `Level ${blank.levelNo} needs a name.` });
    const names = levels.map((l) => l.name.toLowerCase());
    const dupe = names.find((n, i) => names.indexOf(n) !== i);
    if (dupe) return res.status(400).json({ error: `Two levels are both called "${dupe}".` });

    let unhooked = 0;
    await tx(async (c) => {
      const keep = levels.filter((l) => l.id).map((l) => l.id);
      const gone = (await c.query(
        `SELECT id FROM org_levels
          WHERE company_id=$1 AND ($2::bigint[] IS NULL OR NOT (id = ANY($2::bigint[])))`,
        [co.id, keep.length ? keep : null])).rows.map((r) => Number(r.id));
      if (gone.length) {
        unhooked = (await c.query(
          `SELECT COUNT(*)::int AS n FROM designations WHERE level_id = ANY($1::bigint[])`, [gone])).rows[0].n;
        await c.query(`DELETE FROM org_levels WHERE id = ANY($1::bigint[])`, [gone]);
      }
      // Park the survivors above the range first: level_no is unique per
      // company, so renumbering in place would collide the moment two levels
      // swap places.
      if (keep.length) {
        await c.query(`UPDATE org_levels SET level_no = level_no + 1000 WHERE id = ANY($1::bigint[])`, [keep]);
      }
      for (const l of levels) {
        if (l.id) {
          await c.query(
            `UPDATE org_levels SET level_no=$3, name=$4, description=$5 WHERE id=$1 AND company_id=$2`,
            [l.id, co.id, l.levelNo, l.name, l.description]);
        } else {
          await c.query(
            `INSERT INTO org_levels (organisation_id, company_id, level_no, name, description)
             VALUES ($1,$2,$3,$4,$5)`,
            [co.organisation_id, co.id, l.levelNo, l.name, l.description]);
        }
      }
    });
    await audit(req.user.id, 'ORG_LEVELS_SAVE', 'company', co.id, { levels: levels.length, unhooked });
    // Re-read so the client gets real ids and counts rather than its own input back.
    res.json({ ...(await payload(co)), unhooked });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Two levels ended up on the same rung — try again.' });
    next(e);
  }
}

// PUT /admin/designations/:id/level { levelId }
export async function setDesignationLevel(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const d = (await query(
      `SELECT d.id, d.company_id FROM designations d JOIN companies c ON c.id=d.company_id
        WHERE d.id=$1 AND ($2::bigint IS NULL OR c.organisation_id=$2)`,
      [id, req.orgId || null])).rows[0];
    if (!d) return res.status(404).json({ error: 'Designation not found in your organisation.' });

    const levelId = req.body?.levelId === null || req.body?.levelId === '' ? null : parseInt(req.body.levelId, 10);
    if (levelId != null) {
      const ok = (await query(
        `SELECT 1 FROM org_levels WHERE id=$1 AND company_id=$2`, [levelId, d.company_id])).rowCount;
      if (!ok) return res.status(400).json({ error: 'That level belongs to a different company.' });
    }
    await query(`UPDATE designations SET level_id=$2 WHERE id=$1`, [id, levelId]);
    await audit(req.user.id, 'DESIGNATION_LEVEL_SET', 'designation', id, { levelId });
    res.json({ id, levelId });
  } catch (e) { next(e); }
}

// GET /admin/levels — every level in the organisation, for pickers and reports.
export async function all(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT l.id, l.level_no, l.name, l.company_id, c.name AS company
         FROM org_levels l JOIN companies c ON c.id = l.company_id
        WHERE ($1::bigint IS NULL OR c.organisation_id=$1)
          AND ($2::bigint IS NULL OR l.company_id=$2)
        ORDER BY c.name, l.level_no`,
      [req.orgId || null, req.companyScope || null]);
    res.json(rows.map((r) => ({
      id: Number(r.id), levelNo: r.level_no, name: r.name,
      companyId: Number(r.company_id), company: r.company,
    })));
  } catch (e) { next(e); }
}
