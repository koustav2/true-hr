// ============================================================================
// Organisation hierarchy: levels, and the titles placed on them.
//
// Say how many rungs the organisation has, name each one, save. A level is the
// rung (L1 Board, L2 Leadership, L3 Management…) and it belongs to the whole
// organisation, not to a legal entity inside it — every client wants one ladder
// for the group, and the same "HR Manager" title however the person is paid.
//
// Grade and level are different things and both are kept:
//   grade  — the code typed on the title itself (M1, M2, L2), pay-band shaped
//   level  — the rung on this ladder, which is about reporting depth
// Designations carry the level, so an employee inherits one from the title they
// already hold. Nothing extra to set per person, and no way for somebody's
// level to drift out of step with their title.
// ============================================================================
import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { isV2 } from '../utils/apiVersion.js';
import { activeEmployeeSql } from '../utils/people.js';
import { AppError } from '../middleware/error.js';

// Honorifics mean somebody typed a person where a rung belongs ("Mr Gudu").
const HONORIFIC = /^(mr|mrs|ms|miss|dr|shri|smt|sri|kumari|mx|prof)\b\.?/i;
// Standard labels the screen can offer instead of free text.
export const STANDARD_LEVEL_NAMES = ['Board', 'Leadership', 'Senior Management', 'Management',
  'Senior Staff', 'Staff', 'Associate', 'Trainee'];

/** v2 (H56): every level-name problem at once, keyed levels.<index>. */
function levelNameErrors(levels) {
  const fields = {};
  const seen = new Map();
  levels.forEach((l, i) => {
    const key = `levels.${i}`;
    const n = l.name;
    if (!n) { fields[key] = `Level ${l.levelNo} needs a name`; return; }
    if (n.length > 60) fields[key] = `Level ${l.levelNo}: name must be at most 60 characters`;
    else if (/[<>]/.test(n) || !/[A-Za-z]/.test(n) || !/^[A-Za-z0-9][A-Za-z0-9 &.,'()\/+-]*$/.test(n)) {
      fields[key] = `Level ${l.levelNo}: "${n}" is not a valid level name — use letters and digits, like "L1 Board" or "Management"`;
    } else if (HONORIFIC.test(n)) {
      fields[key] = `Level ${l.levelNo}: "${n}" looks like a person's name. A level names a rung (e.g. "L1 Board", "Management"), not a person`;
    }
    const k = n.toLowerCase();
    if (!fields[key] && seen.has(k)) fields[key] = `Level ${l.levelNo}: "${n}" is already used by level ${seen.get(k)}`;
    if (!seen.has(k)) seen.set(k, l.levelNo);
  });
  return fields;
}

const MAX_LEVELS = 20;

const shape = (r) => ({
  id: Number(r.id),
  levelNo: r.level_no,
  name: r.name,
  description: r.description,
  designations: Number(r.designation_count || 0),
  employees: Number(r.employee_count || 0),
});

/** The ladder plus everything hanging off it, for one organisation. */
async function payload(orgId, orgName) {
  const levels = (await query(
    `SELECT l.*,
            (SELECT COUNT(*) FROM designations d WHERE d.level_id = l.id) AS designation_count,
            (SELECT COUNT(*) FROM employees e
               JOIN designations d ON d.id = e.designation_id
              WHERE d.level_id = l.id AND ${activeEmployeeSql('e')}) AS employee_count
       FROM org_levels l WHERE l.organisation_id = $1 ORDER BY l.level_no`, [orgId])).rows;

  // `employees` counts employees by the one rule every screen uses (D7, H55).
  // `holders` counts every record pointing at the row — candidates and leavers
  // included — which is what decides whether it can be deleted, so the screen
  // can grey those out instead of failing after the click.
  const designations = (await query(
    `SELECT g.id, g.title, g.grade, g.level_id, g.department_id,
            (SELECT count(*)::int FROM employees e WHERE e.designation_id = g.id AND ${activeEmployeeSql('e')}) AS employees,
            (SELECT count(*)::int FROM employees e WHERE e.designation_id = g.id) AS holders
       FROM designations g WHERE g.organisation_id = $1 ORDER BY g.title`, [orgId])).rows
    .map((d) => ({
      id: Number(d.id), title: d.title, grade: d.grade,
      levelId: d.level_id != null ? Number(d.level_id) : null,
      departmentId: d.department_id != null ? Number(d.department_id) : null,
      employees: Number(d.employees || 0),
      holders: Number(d.holders || 0),
    }));
  const departments = (await query(
    `SELECT d.id, d.name,
            (SELECT count(*)::int FROM employees e WHERE e.department_id = d.id AND ${activeEmployeeSql('e')}) AS employees,
            (SELECT count(*)::int FROM employees e WHERE e.department_id = d.id) AS holders
       FROM departments d WHERE d.organisation_id = $1 ORDER BY d.name`, [orgId])).rows
    .map((d) => ({ id: Number(d.id), name: d.name, employees: Number(d.employees || 0), holders: Number(d.holders || 0) }));
  const totalEmployees = Number((await query(
    `SELECT count(*)::int AS n FROM employees e WHERE e.organisation_id = $1 AND ${activeEmployeeSql('e')}`,
    [orgId])).rows[0].n);

  return {
    organisationId: Number(orgId),
    organisation: orgName || null,
    maxLevels: MAX_LEVELS,
    standardLevelNames: STANDARD_LEVEL_NAMES,
    // Same denominator as the org chart's "placed on a level" (D7).
    totalEmployees,
    levels: levels.map(shape),
    designations,
    departments,
  };
}

async function orgName(orgId) {
  return (await query(`SELECT name FROM organisations WHERE id = $1`, [orgId])).rows[0]?.name || null;
}

// GET /admin/hierarchy — the whole picture for the current organisation.
export async function overview(req, res, next) {
  try {
    res.json(await payload(req.orgId, await orgName(req.orgId)));
  } catch (e) { next(e); }
}

// PUT /admin/hierarchy { levels: [{ id?, levelNo, name, description }] }
//
// The whole ladder is saved at once. A level that disappears has its titles
// unhooked rather than blocked (ON DELETE SET NULL) — refusing to let HR
// restructure because titles are attached would be worse than a few titles
// needing to be re-placed, and the response says how many.
export async function replace(req, res, next) {
  try {
    const orgId = req.orgId;
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
    if (isV2(req)) {
      const fields = levelNameErrors(levels);
      const keys = Object.keys(fields);
      if (keys.length) throw new AppError(keys.length === 1 ? fields[keys[0]] : `Please fix ${keys.length} level names: ${keys.map((k) => fields[k]).join('; ')}`, 400, fields);
    }
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
          WHERE organisation_id = $1 AND ($2::bigint[] IS NULL OR NOT (id = ANY($2::bigint[])))`,
        [orgId, keep.length ? keep : null])).rows.map((r) => Number(r.id));
      if (gone.length) {
        unhooked = (await c.query(
          `SELECT COUNT(*)::int AS n FROM designations WHERE level_id = ANY($1::bigint[])`, [gone])).rows[0].n;
        await c.query(`DELETE FROM org_levels WHERE id = ANY($1::bigint[])`, [gone]);
      }
      // Park the survivors above the range first: level_no is unique per
      // organisation, so renumbering in place would collide the moment two
      // levels swap places.
      if (keep.length) {
        await c.query(`UPDATE org_levels SET level_no = level_no + 1000 WHERE id = ANY($1::bigint[])`, [keep]);
      }
      for (const l of levels) {
        if (l.id) {
          await c.query(
            `UPDATE org_levels SET level_no=$3, name=$4, description=$5
              WHERE id=$1 AND organisation_id=$2`,
            [l.id, orgId, l.levelNo, l.name, l.description]);
        } else {
          await c.query(
            `INSERT INTO org_levels (organisation_id, level_no, name, description)
             VALUES ($1,$2,$3,$4)`,
            [orgId, l.levelNo, l.name, l.description]);
        }
      }
    });
    await audit(req.user.id, 'ORG_LEVELS_SAVE', 'organisation', orgId, { levels: levels.length, unhooked });
    // Re-read so the client gets real ids and counts rather than its own input back.
    res.json({ ...(await payload(orgId, await orgName(orgId))), unhooked });
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
      `SELECT id FROM designations WHERE id=$1 AND organisation_id=$2`, [id, req.orgId])).rows[0];
    if (!d) return res.status(404).json({ error: 'Designation not found in your organisation.' });

    const levelId = req.body?.levelId === null || req.body?.levelId === '' ? null : parseInt(req.body.levelId, 10);
    if (levelId != null) {
      const ok = (await query(
        `SELECT 1 FROM org_levels WHERE id=$1 AND organisation_id=$2`, [levelId, req.orgId])).rowCount;
      if (!ok) return res.status(400).json({ error: 'That level belongs to a different organisation.' });
    }
    await query(`UPDATE designations SET level_id=$2 WHERE id=$1`, [id, levelId]);
    await audit(req.user.id, 'DESIGNATION_LEVEL_SET', 'designation', id, { levelId });
    res.json({ id, levelId });
  } catch (e) { next(e); }
}

// PUT /admin/designations/:id/department { departmentId }   (v2 route)
// Which department a designation belongs to (H12/H127). null = any department.
// The people and bulk-upload validations read designations.department_id.
export async function setDesignationDepartment(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const d = Number.isFinite(id) ? (await query(
      `SELECT id FROM designations WHERE id=$1 AND organisation_id=$2`, [id, req.orgId])).rows[0] : null;
    if (!d) return res.status(404).json({ error: 'Designation not found in your organisation.' });
    const raw = req.body?.departmentId;
    const departmentId = raw === null || raw === '' || raw === undefined ? null : parseInt(raw, 10);
    if (departmentId != null) {
      const ok = Number.isFinite(departmentId) && (await query(
        `SELECT 1 FROM departments WHERE id=$1 AND organisation_id=$2`, [departmentId, req.orgId])).rowCount;
      if (!ok) throw new AppError('Choose a department from your organisation', 400, { departmentId: 'Choose a department from your organisation' });
    }
    await query(`UPDATE designations SET department_id=$2 WHERE id=$1 AND organisation_id=$3`, [id, departmentId, req.orgId]);
    await audit(req.user.id, 'DESIGNATION_DEPARTMENT_SET', 'designation', id, { departmentId });
    res.json({ id, departmentId });
  } catch (e) { next(e); }
}

// PUT /admin/designations/levels { placements: [{ designationId, levelId }] }
//
// Placing titles one dropdown at a time is how a screen ends up reading
// "not placed" for everything, so the whole column saves in one call — which is
// also what makes "place every title by its grade" a single click on the client.
export async function setDesignationLevelsBulk(req, res, next) {
  try {
    const raw = Array.isArray(req.body?.placements) ? req.body.placements : [];
    if (!raw.length) return res.status(400).json({ error: 'Nothing to place.' });
    if (raw.length > 500) return res.status(400).json({ error: 'Too many at once.' });

    const wanted = raw.map((p) => ({
      designationId: parseInt(p.designationId, 10),
      levelId: p.levelId === null || p.levelId === '' || p.levelId === undefined
        ? null : parseInt(p.levelId, 10),
    })).filter((p) => Number.isFinite(p.designationId));

    // Validate everything against this organisation before writing anything —
    // a half-applied column is worse than a refusal.
    const mine = new Set((await query(
      `SELECT id FROM designations WHERE organisation_id=$1`, [req.orgId])).rows.map((r) => String(r.id)));
    const rungs = new Set((await query(
      `SELECT id FROM org_levels WHERE organisation_id=$1`, [req.orgId])).rows.map((r) => String(r.id)));

    const strayTitle = wanted.find((p) => !mine.has(String(p.designationId)));
    if (strayTitle) return res.status(404).json({ error: 'One of those titles is not in your organisation.' });
    const strayLevel = wanted.find((p) => p.levelId != null && !rungs.has(String(p.levelId)));
    if (strayLevel) return res.status(400).json({ error: 'One of those levels is not in your organisation.' });

    await tx(async (c) => {
      for (const p of wanted) {
        await c.query(`UPDATE designations SET level_id=$2 WHERE id=$1 AND organisation_id=$3`,
          [p.designationId, p.levelId, req.orgId]);
      }
    });
    await audit(req.user.id, 'DESIGNATION_LEVELS_BULK', 'organisation', req.orgId, { placed: wanted.length });
    res.json({ ...(await payload(req.orgId, await orgName(req.orgId))), placed: wanted.length });
  } catch (e) { next(e); }
}

// GET /admin/levels — every level in the organisation, for pickers and reports.
export async function all(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, level_no, name FROM org_levels
        WHERE organisation_id = $1 ORDER BY level_no`, [req.orgId]);
    res.json(rows.map((r) => ({ id: Number(r.id), levelNo: r.level_no, name: r.name })));
  } catch (e) { next(e); }
}

// ── Compatibility shims ─────────────────────────────────────────────────────
// The ladder used to be addressed per company. Anything still calling those
// paths now reads and writes the organisation's single ladder; the company id
// in the URL is ignored on purpose rather than 404-ing an old bookmark.
export async function list(req, res, next) {
  try {
    res.json(await payload(req.orgId, await orgName(req.orgId)));
  } catch (e) { next(e); }
}
export { replace as replaceForCompany };
