// NFA master-data CRUD + the cascade meta endpoint that powers all cascading
// dropdowns client-side (no per-selection server round-trips — unlike GreenHR).
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

// Whitelisted masters: :type URL segment → table definition.
const MASTERS = {
  'business-operations': { table: 'business_operations', cols: ['name'] },
  'group-companies':     { table: 'group_companies',     cols: ['name'] },
  'cost-zones':          { table: 'cost_zones',          cols: ['name'] },
  'projects':            { table: 'projects',            cols: ['name', 'business_operation_id', 'group_company_id'] },
  'locations':           { table: 'office_locations',    cols: ['name', 'kind'] },
  'clients-vendors':     { table: 'clients_vendors',     cols: ['name', 'type'] },
  'expense-categories':  { table: 'expense_categories',  cols: ['name', 'business_operation_id'] },
  'expense-headers':     { table: 'expense_headers',     cols: ['name', 'category_id'] },
  'expense-subheaders':  { table: 'expense_subheaders',  cols: ['name', 'header_id'] },
};

function def(req, res) {
  const d = MASTERS[req.params.type];
  if (!d) res.status(404).json({ error: 'Unknown master type' });
  return d;
}
const camel = (s) => s.replace(/_(\w)/g, (_, c) => c.toUpperCase());
const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const shape = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v]));

// GET /admin/masters/:type?q=&all=1  (all=1 includes inactive)
export async function list(req, res, next) {
  try {
    const d = def(req, res); if (!d) return;
    const params = [];
    let where = req.query.all ? 'TRUE' : 'active';
    if (req.query.q) { params.push(`%${req.query.q}%`); where += ` AND name ILIKE $${params.length}`; }
    const rows = (await query(`SELECT * FROM ${d.table} WHERE ${where} ORDER BY name`, params)).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /admin/masters/:type
export async function create(req, res, next) {
  try {
    const d = def(req, res); if (!d) return;
    const body = req.body || {};
    const cols = [], vals = [], params = [];
    for (const c of d.cols) {
      const v = body[camel(c)] ?? body[c];
      if (v !== undefined && v !== '') { cols.push(c); params.push(v); vals.push(`$${params.length}`); }
    }
    if (!cols.includes('name')) return res.status(400).json({ error: 'name is required' });
    const row = (await query(
      `INSERT INTO ${d.table} (${cols.join(',')}) VALUES (${vals.join(',')}) RETURNING *`, params)).rows[0];
    await audit(req.user.sub, 'MASTER_CREATED', d.table, row.id, { name: row.name });
    res.status(201).json(shape(row));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An entry with this name already exists' });
    next(e);
  }
}

// PUT /admin/masters/:type/:id — update whitelisted cols and/or `active`.
export async function update(req, res, next) {
  try {
    const d = def(req, res); if (!d) return;
    const body = req.body || {};
    const sets = [], params = [];
    for (const c of [...d.cols, 'active']) {
      const v = body[camel(c)] ?? body[c];
      if (v !== undefined) { params.push(v === '' ? null : v); sets.push(`${c}=$${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(Number(req.params.id));
    const row = (await query(
      `UPDATE ${d.table} SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params)).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.sub, 'MASTER_UPDATED', d.table, row.id, { name: row.name });
    res.json(shape(row));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An entry with this name already exists' });
    next(e);
  }
}

// DELETE /admin/masters/:type/:id — hard delete; falls back to a clear 409 when referenced.
export async function remove(req, res, next) {
  try {
    const d = def(req, res); if (!d) return;
    const r = await query(`DELETE FROM ${d.table} WHERE id=$1`, [Number(req.params.id)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.sub, 'MASTER_DELETED', d.table, Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23503') return res.status(409).json({ error: 'In use — deactivate it instead of deleting' });
    next(e);
  }
}

// POST /admin/masters/expense-hierarchy/import
// Body: { rows: [{ category, header, subheader }] } — idempotent bulk upsert
// matching the client's "Expanse-Header-NFA" Excel structure.
export async function importExpenseHierarchy(req, res, next) {
  try {
    const rows = (req.body || {}).rows;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows[] required' });
    let created = { categories: 0, headers: 0, subheaders: 0 }, skipped = 0;
    for (const r of rows) {
      const category = String(r.category || '').trim();
      const header = String(r.header || '').trim();
      const subheader = String(r.subheader || '').trim();
      if (!category) { skipped++; continue; }
      const cat = (await query(
        `INSERT INTO expense_categories (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET active=TRUE RETURNING id, (xmax = 0) AS inserted`, [category])).rows[0];
      if (cat.inserted) created.categories++;
      if (!header) continue;
      const hdr = (await query(
        `INSERT INTO expense_headers (category_id, name) VALUES ($1,$2)
         ON CONFLICT (category_id, name) DO UPDATE SET active=TRUE RETURNING id, (xmax = 0) AS inserted`,
        [cat.id, header])).rows[0];
      if (hdr.inserted) created.headers++;
      if (!subheader) continue;
      const sub = (await query(
        `INSERT INTO expense_subheaders (header_id, name) VALUES ($1,$2)
         ON CONFLICT (header_id, name) DO UPDATE SET active=TRUE RETURNING (xmax = 0) AS inserted`,
        [hdr.id, subheader])).rows[0];
      if (sub.inserted) created.subheaders++;
    }
    await audit(req.user.sub, 'EXPENSE_HIERARCHY_IMPORTED', 'expense_categories', null, { rows: rows.length, created });
    res.json({ ok: true, created, skipped });
  } catch (e) { next(e); }
}

// GET /meta/nfa-masters — one payload with every active master; the client
// does all cascading locally (operation → projects/categories → headers → subheaders).
export async function nfaMasters(req, res, next) {
  try {
    const [ops, companies, zones, projects, locations, cv, cats, headers, subs] = await Promise.all([
      query(`SELECT id, name FROM business_operations WHERE active ORDER BY name`),
      query(`SELECT id, name FROM group_companies WHERE active ORDER BY name`),
      query(`SELECT id, name FROM cost_zones WHERE active ORDER BY name`),
      query(`SELECT id, name, business_operation_id, group_company_id FROM projects WHERE active ORDER BY name`),
      query(`SELECT id, name, kind FROM office_locations WHERE active ORDER BY name`),
      query(`SELECT id, name, type FROM clients_vendors WHERE active ORDER BY name`),
      query(`SELECT id, name, business_operation_id FROM expense_categories WHERE active ORDER BY name`),
      query(`SELECT id, name, category_id FROM expense_headers WHERE active ORDER BY name`),
      query(`SELECT id, name, header_id FROM expense_subheaders WHERE active ORDER BY name`),
    ]);
    res.json({
      businessOperations: ops.rows,
      groupCompanies: companies.rows,
      costZones: zones.rows,
      projects: projects.rows.map((p) => ({ id: p.id, name: p.name, businessOperationId: p.business_operation_id, groupCompanyId: p.group_company_id })),
      locations: locations.rows,
      clientsVendors: cv.rows,
      expenseCategories: cats.rows.map((c) => ({ id: c.id, name: c.name, businessOperationId: c.business_operation_id })),
      expenseHeaders: headers.rows.map((h) => ({ id: h.id, name: h.name, categoryId: h.category_id })),
      expenseSubheaders: subs.rows.map((s) => ({ id: s.id, name: s.name, headerId: s.header_id })),
    });
  } catch (e) { next(e); }
}
