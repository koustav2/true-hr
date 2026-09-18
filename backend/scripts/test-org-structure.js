// Structure is organisation-wide: levels, departments and designations.
//
// The move from company scope to organisation scope is the kind of change that
// looks fine until a second tenant appears, so most of this suite is about what
// one organisation must NOT see or touch in another.
import { query, pool } from '../src/db/pool.js';
import * as levels from '../src/controllers/levelController.js';
import * as company from '../src/controllers/companyController.js';
import * as meta from '../src/controllers/metaController.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};
function call(fn, { params = {}, q = {}, body = {}, user, auth, orgId }) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user, auth, orgId };
    const res = {
      _s: 200,
      status(s) { this._s = s; return this; },
      json(d) { resolve({ status: this._s, data: d }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.publicMessage || e.message } }));
  });
}

const RUN = `S${String(Date.now()).slice(-6)}`;

async function main() {
  // Two organisations, and two legal entities inside the first — the case that
  // used to give each entity its own duplicate lists.
  const orgA = (await query(
    `INSERT INTO organisations (name, code) VALUES ($1,$2) RETURNING id`,
    [`Alpha ${RUN}`, `A${RUN}`])).rows[0].id;
  const orgB = (await query(
    `INSERT INTO organisations (name, code) VALUES ($1,$2) RETURNING id`,
    [`Beta ${RUN}`, `B${RUN}`])).rows[0].id;
  const coA1 = (await query(
    `INSERT INTO companies (organisation_id, name, code_prefix) VALUES ($1,'A One',$2) RETURNING id`,
    [orgA, `A1${RUN}`.slice(0, 8)])).rows[0].id;
  const coA2 = (await query(
    `INSERT INTO companies (organisation_id, name, code_prefix) VALUES ($1,'A Two',$2) RETURNING id`,
    [orgA, `A2${RUN}`.slice(0, 8)])).rows[0].id;
  const coB = (await query(
    `INSERT INTO companies (organisation_id, name, code_prefix) VALUES ($1,'B One',$2) RETURNING id`,
    [orgB, `B1${RUN}`.slice(0, 8)])).rows[0].id;

  const asA = { user: { id: 1 }, auth: {}, orgId: orgA };
  const asB = { user: { id: 1 }, auth: {}, orgId: orgB };

  // ---- structure is added once for the organisation ----------------------
  let r = await call(company.addDepartmentsBulk, { ...asA, body: { names: 'Finance\nEngineering\nSales' } });
  check('departments added org-wide → 201', r.status === 201 && r.data.added.length === 3, JSON.stringify(r.data));

  r = await call(company.addDepartmentsBulk, { ...asA, body: { names: 'finance\nOperations' } });
  check('same name is skipped, not duplicated',
    r.data.added.length === 1 && r.data.skipped.length === 1, JSON.stringify(r.data));

  r = await call(company.addDesignationsBulk, { ...asA, body: { titles: 'HR Manager\nSoftware Engineer' } });
  check('designations added org-wide → 201', r.status === 201 && r.data.added.length === 2);

  // The per-company alias must write into the SAME org-wide list, not a second
  // copy for that entity — that is the whole point of the change.
  r = await call(company.addDepartmentsBulk, { ...asA, params: { id: coA2 }, body: { names: 'Finance\nLegal' } });
  check('adding via a company alias hits the same list',
    r.data.added.length === 1 && r.data.skipped.length === 1, JSON.stringify(r.data));

  const deptsA = (await query(`SELECT name FROM departments WHERE organisation_id=$1 ORDER BY name`, [orgA]))
    .rows.map((x) => x.name);
  check('one list for the whole group',
    deptsA.join(',') === 'Engineering,Finance,Legal,Operations,Sales', deptsA.join(','));
  check('no department is pinned to a company',
    (await query(`SELECT count(*)::int AS n FROM departments WHERE organisation_id=$1 AND company_id IS NOT NULL`,
      [orgA])).rows[0].n === 0);

  // ---- the other organisation sees none of it ----------------------------
  r = await call(meta.getDepartments, asB);
  check('other organisation sees none of those departments',
    !r.data.some((d) => deptsA.includes(d.name)), JSON.stringify(r.data.slice(0, 4)));

  r = await call(company.addDepartmentsBulk, { ...asB, body: { names: 'Finance' } });
  check('the same name is free in another organisation → 201',
    r.status === 201 && r.data.added.length === 1, JSON.stringify(r.data));

  // A company id from another tenant must still be refused, even though the
  // company no longer decides what gets written.
  r = await call(company.addDepartmentsBulk, { ...asB, params: { id: coA1 }, body: { names: 'Smuggled' } });
  check("another tenant's company id → 404", r.status === 404, JSON.stringify(r.data));

  // ---- the ladder --------------------------------------------------------
  r = await call(levels.overview, asA);
  check('overview reports the organisation, not a company',
    r.data.organisationId === Number(orgA) && r.data.organisation.startsWith('Alpha'), JSON.stringify(r.data).slice(0, 120));
  check('overview carries the org-wide lists',
    r.data.departments.length === 5 && r.data.designations.length === 2);
  check('every title starts unplaced', r.data.designations.every((d) => d.levelId === null));

  r = await call(levels.replace, {
    ...asA,
    body: { levels: [{ name: 'Board' }, { name: 'Leadership' }, { name: 'Management' }] },
  });
  check('ladder saved → 3 rungs', r.status === 200 && r.data.levels.length === 3, JSON.stringify(r.data).slice(0, 140));
  check('rungs numbered from 1', r.data.levels.map((l) => l.levelNo).join(',') === '1,2,3');
  const rungs = r.data.levels;

  // Both organisations may hold a level 1 — the old unique was per company and
  // would have collided the moment two entities both had one.
  r = await call(levels.replace, { ...asB, body: { levels: [{ name: 'Board' }] } });
  check('another organisation can also have a level 1', r.status === 200 && r.data.levels[0].levelNo === 1);

  // ---- placing titles ----------------------------------------------------
  const hrTitle = (await query(
    `SELECT id FROM designations WHERE organisation_id=$1 AND title='HR Manager'`, [orgA])).rows[0].id;

  r = await call(levels.setDesignationLevel, { ...asA, params: { id: hrTitle }, body: { levelId: rungs[1].id } });
  check('title placed on a rung → 200', r.status === 200 && Number(r.data.levelId) === Number(rungs[1].id));

  r = await call(levels.setDesignationLevel, { ...asB, params: { id: hrTitle }, body: { levelId: null } });
  check("another organisation cannot place this org's title → 404", r.status === 404);

  const strayRung = (await query(`SELECT id FROM org_levels WHERE organisation_id=$1`, [orgB])).rows[0].id;
  r = await call(levels.setDesignationLevel, { ...asA, params: { id: hrTitle }, body: { levelId: strayRung } });
  check("a rung from another organisation is refused → 400", r.status === 400, JSON.stringify(r.data));

  // ---- placing the whole column at once ----------------------------------
  const allTitles = (await query(
    `SELECT id FROM designations WHERE organisation_id=$1 ORDER BY title`, [orgA])).rows.map((x) => Number(x.id));
  r = await call(levels.setDesignationLevelsBulk, {
    ...asA,
    body: { placements: allTitles.map((id, i) => ({ designationId: id, levelId: rungs[i % 3].id })) },
  });
  check('whole column placed in one call → 200', r.status === 200 && r.data.placed === allTitles.length, JSON.stringify(r.data).slice(0, 120));
  check('nothing left unplaced', r.data.designations.every((d) => d.levelId !== null));

  r = await call(levels.setDesignationLevelsBulk, {
    ...asB, body: { placements: [{ designationId: hrTitle, levelId: strayRung }] },
  });
  check("bulk refuses another organisation's title → 404", r.status === 404);

  r = await call(levels.setDesignationLevelsBulk, {
    ...asA, body: { placements: [{ designationId: allTitles[0], levelId: strayRung }] },
  });
  check('bulk refuses a foreign rung → 400', r.status === 400);
  const stillPlaced = (await query(
    `SELECT count(*)::int AS n FROM designations WHERE organisation_id=$1 AND level_id IS NOT NULL`, [orgA])).rows[0].n;
  check('a refused bulk placed nothing at all', stillPlaced === allTitles.length, `n=${stillPlaced}`);

  // ---- removing a rung unhooks rather than blocks ------------------------
  // Drop rung 2, which the bulk placement above actually put a title on — the
  // empty rung would pass this check without proving anything.
  const occupied = (await query(
    `SELECT level_id, count(*)::int AS n FROM designations
      WHERE organisation_id=$1 AND level_id IS NOT NULL GROUP BY level_id ORDER BY n DESC LIMIT 1`,
    [orgA])).rows[0];
  check('a rung really does hold a title before we drop it', occupied?.n >= 1, JSON.stringify(occupied));
  r = await call(levels.replace, {
    ...asA,
    body: { levels: rungs.filter((l) => String(l.id) !== String(occupied.level_id)).map((l) => ({ id: l.id, name: l.name })) },
  });
  check('dropping a rung reports what it unhooked',
    r.status === 200 && r.data.unhooked === occupied.n, `unhooked=${r.data.unhooked} want ${occupied.n}`);
  check('the rest of the ladder survives', r.data.levels.length === 2);
  check('the unhooked title is now unplaced, not deleted',
    r.data.designations.length === 2 && r.data.designations.some((d) => d.levelId === null));

  // ---- occupied rows are still protected ---------------------------------
  const finance = (await query(
    `SELECT id FROM departments WHERE organisation_id=$1 AND name='Finance'`, [orgA])).rows[0].id;
  await query(
    `INSERT INTO employees (organisation_id, company_id, first_name, last_name,
                            personal_email, official_email, employee_code, department_id, onboarding_status)
     VALUES ($1,$2,'Occ','U',$3,$3,$4,$5,'ACTIVE')`,
    [orgA, coA1, `occ.${RUN}@t.test`, `OC${RUN}`.slice(0, 12), finance]);

  r = await call(company.removeDepartmentsBulk, { ...asA, body: { ids: [finance] } });
  check('a department somebody is in is refused by name',
    r.data.deleted === 0 && r.data.blocked[0]?.name === 'Finance', JSON.stringify(r.data));

  const legal = (await query(
    `SELECT id FROM departments WHERE organisation_id=$1 AND name='Legal'`, [orgA])).rows[0].id;
  r = await call(company.removeDepartmentsBulk, { ...asA, body: { ids: [legal, finance] } });
  check('the free one still goes through', r.data.deleted === 1 && r.data.blocked.length === 1);

  r = await call(company.removeDepartmentsBulk, { ...asB, body: { ids: [finance] } });
  check("another organisation cannot delete this org's department", r.data.deleted === 0 && !r.data.blocked.length);

  // ---- the hire form sees the same list whichever entity pays ------------
  r = await call(meta.getDepartments, { ...asA, q: { companyId: String(coA2) } });
  const names = r.data.map((d) => d.name).sort().join(',');
  check('companyId no longer narrows the hire form',
    names === 'Engineering,Finance,Operations,Sales', names);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
