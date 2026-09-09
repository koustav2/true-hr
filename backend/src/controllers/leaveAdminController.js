import { query, pool } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import * as leaveTypes from '../services/leaveTypes.js';

// ---------------- Holidays (state-based) ----------------

// GET /admin/holidays?state=
export async function listHolidays(req, res, next) {
  try {
    const state = req.query.state;
    const rows = (await query(
      `SELECT id, to_char(holiday_date,'YYYY-MM-DD') AS date, name, state FROM holidays
       ${state ? 'WHERE state IS NULL OR state=\'\' OR lower(state)=lower($1)' : ''}
       ORDER BY holiday_date DESC`, state ? [state] : [])).rows;
    res.json(rows);
  } catch (e) { next(e); }
}

// POST /admin/holidays { date, name, state }
export async function createHoliday(req, res, next) {
  try {
    const { date, name, state } = req.body;
    if (!date || !name) return res.status(400).json({ error: 'date and name are required' });
    const row = (await query(
      `INSERT INTO holidays (holiday_date, name, state) VALUES ($1,$2,$3) RETURNING id`,
      [date, name, (state && state.trim()) ? state.trim() : null])).rows[0];
    await audit(req.user.id, 'HOLIDAY_CREATE', 'holiday', row.id, { date, name, state: state || null });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// DELETE /admin/holidays/:id
export async function deleteHoliday(req, res, next) {
  try {
    await query(`DELETE FROM holidays WHERE id=$1`, [req.params.id]);
    await audit(req.user.id, 'HOLIDAY_DELETE', 'holiday', req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ---------------- State entitlements (EL/CL/SL) ----------------

// GET /admin/entitlements
export async function listEntitlements(req, res, next) {
  try {
    const rows = (await query(
      `SELECT state, el, cl, sl, el_accum, cl_accum, sl_accum FROM leave_entitlements ORDER BY state`)).rows;
    res.json(rows.map((r) => ({
      state: r.state, el: Number(r.el), cl: Number(r.cl), sl: Number(r.sl),
      elAccum: Number(r.el_accum), clAccum: Number(r.cl_accum), slAccum: Number(r.sl_accum),
    })));
  } catch (e) { next(e); }
}

// PUT /admin/entitlements  { state, el, cl, sl, elAccum, clAccum, slAccum }  (upsert)
export async function upsertEntitlement(req, res, next) {
  try {
    const { state, el = 0, cl = 0, sl = 0, elAccum = 0, clAccum = 0, slAccum = 0 } = req.body;
    if (!state || !state.trim()) return res.status(400).json({ error: 'state is required' });
    await query(
      `INSERT INTO leave_entitlements (state, el, cl, sl, el_accum, cl_accum, sl_accum)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (state) DO UPDATE SET el=EXCLUDED.el, cl=EXCLUDED.cl, sl=EXCLUDED.sl,
         el_accum=EXCLUDED.el_accum, cl_accum=EXCLUDED.cl_accum, sl_accum=EXCLUDED.sl_accum`,
      [state.trim(), el, cl, sl, elAccum, clAccum, slAccum]);
    await audit(req.user.id, 'ENTITLEMENT_UPSERT', 'leave_entitlement', null, { state });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ---------------- Leave types (per organisation) ----------------
//
// Each organisation owns its own set, so one tenant renaming "CL" or adding a
// "Bereavement Leave" does not touch anybody else. The rows with a NULL
// organisation_id are the templates a new organisation is seeded from and are
// never editable from here.

/** Count what would break if a leave type went away. */
async function typeUsage(id) {
  const r = (await query(
    `SELECT (SELECT count(*) FROM leave_balances WHERE leave_type_id=$1) AS balances,
            (SELECT count(*) FROM leave_requests WHERE leave_type_id=$1) AS requests`, [id])).rows[0];
  return { balances: Number(r.balances), requests: Number(r.requests) };
}

// GET /admin/leave-types
export async function listLeaveTypes(req, res, next) {
  try {
    const rows = (await query(
      `SELECT lt.id, lt.code, lt.name, lt.annual_quota, lt.requires_balance, lt.allow_half_day,
              lt.single_date, lt.allow_certificate, lt.sort_order, lt.active,
              (SELECT count(*) FROM leave_balances b WHERE b.leave_type_id = lt.id)
              + (SELECT count(*) FROM leave_requests r WHERE r.leave_type_id = lt.id) AS in_use
         FROM leave_types lt
        WHERE lt.organisation_id = $1
        ORDER BY lt.sort_order, lt.code`, [req.orgId || null])).rows;
    // An organisation seeded before this screen existed still has none of its
    // own; show it the templates rather than an empty table.
    const out = rows.length ? rows.map(leaveTypes.shape) : await leaveTypes.forOrg(req.orgId);
    res.json(out.map((t) => ({ ...t, protectedReason: leaveTypes.protectedReason(t.code) })));
  } catch (e) { next(e); }
}

// POST /admin/leave-types  { code, name, annualQuota, requiresBalance, allowHalfDay, singleDate, allowCertificate, sortOrder }
export async function createLeaveType(req, res, next) {
  try {
    if (!req.orgId) return res.status(400).json({ error: 'Pick an organisation first.' });
    const b = req.body || {};
    const code = String(b.code || '').trim().toUpperCase();
    const name = String(b.name || '').trim();
    if (!leaveTypes.CODE_RE.test(code)) {
      return res.status(400).json({ error: 'Code must be 1–10 characters, start with a letter, and use only A–Z, 0–9 and _ (e.g. BL, PAT_L).' });
    }
    if (!name) return res.status(400).json({ error: 'Name is required.' });

    const quota = Number(b.annualQuota ?? 0);
    if (!Number.isFinite(quota) || quota < 0) return res.status(400).json({ error: 'Annual quota must be zero or more.' });

    const dupe = (await query(
      `SELECT active FROM leave_types WHERE organisation_id=$1 AND code=$2`, [req.orgId, code])).rows[0];
    if (dupe) {
      return res.status(409).json({
        error: dupe.active
          ? `You already have a leave type with the code ${code}.`
          : `${code} exists but is retired — reactivate it instead of creating a second one.`,
      });
    }

    // Default to the end of the list so a new type does not jump the order.
    const nextOrder = Number(b.sortOrder) > 0 ? Number(b.sortOrder) : Number((await query(
      `SELECT COALESCE(max(sort_order),0) + 10 AS n FROM leave_types WHERE organisation_id=$1`,
      [req.orgId])).rows[0].n);

    const row = (await query(
      `INSERT INTO leave_types
         (organisation_id, code, name, annual_quota, requires_balance, sort_order,
          allow_half_day, single_date, allow_certificate, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
      [req.orgId, code, name, quota,
       b.requiresBalance !== false, nextOrder,
       b.allowHalfDay === true, b.singleDate === true, b.allowCertificate === true])).rows[0];

    await audit(req.user.id, 'LEAVE_TYPE_CREATE', 'leave_type', row.id, { code, name, quota });
    res.status(201).json({ ok: true, id: Number(row.id), code });
  } catch (e) { next(e); }
}

// PUT /admin/leave-types/:code
export async function updateLeaveType(req, res, next) {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const b = req.body || {};
    if (b.active === false) {
      const why = leaveTypes.protectedReason(code);
      if (why) return res.status(409).json({ error: why });
    }
    if (b.name != null && !String(b.name).trim()) return res.status(400).json({ error: 'Name cannot be blank.' });
    if (b.annualQuota != null && (!Number.isFinite(Number(b.annualQuota)) || Number(b.annualQuota) < 0)) {
      return res.status(400).json({ error: 'Annual quota must be zero or more.' });
    }
    const r = (await query(
      `UPDATE leave_types SET
         name = COALESCE($3, name),
         annual_quota = COALESCE($4, annual_quota),
         requires_balance = COALESCE($5, requires_balance),
         allow_half_day = COALESCE($6, allow_half_day),
         single_date = COALESCE($7, single_date),
         allow_certificate = COALESCE($8, allow_certificate),
         sort_order = COALESCE($9, sort_order),
         active = COALESCE($10, active)
       WHERE organisation_id=$1 AND code=$2 RETURNING id`,
      [req.orgId || null, code,
       b.name != null ? String(b.name).trim() : null,
       b.annualQuota ?? null, b.requiresBalance ?? null,
       b.allowHalfDay ?? null, b.singleDate ?? null, b.allowCertificate ?? null,
       b.sortOrder ?? null, b.active ?? null])).rows[0];
    if (!r) return res.status(404).json({ error: 'Leave type not found in your organisation.' });
    await audit(req.user.id, 'LEAVE_TYPE_UPDATE', 'leave_type', r.id, { code, ...b });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/leave-types/:code
//
// A type that has ever been allocated or applied for is retired, not deleted —
// removing it would orphan balances and rewrite leave history. Unused ones go
// for real, so a typo can be undone.
export async function deleteLeaveType(req, res, next) {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const why = leaveTypes.protectedReason(code);
    if (why) return res.status(409).json({ error: why });
    const lt = (await query(
      `SELECT id, name FROM leave_types WHERE organisation_id=$1 AND code=$2`,
      [req.orgId || null, code])).rows[0];
    if (!lt) return res.status(404).json({ error: 'Leave type not found in your organisation.' });

    const use = await typeUsage(lt.id);
    if (use.balances || use.requests) {
      await query(`UPDATE leave_types SET active=false WHERE id=$1`, [lt.id]);
      await audit(req.user.id, 'LEAVE_TYPE_RETIRE', 'leave_type', lt.id, { code, ...use });
      const bits = [];
      if (use.balances) bits.push(`${use.balances} balance${use.balances === 1 ? '' : 's'}`);
      if (use.requests) bits.push(`${use.requests} leave request${use.requests === 1 ? '' : 's'}`);
      return res.json({
        ok: true, retired: true,
        message: `${lt.name} is in use by ${bits.join(' and ')}, so it has been retired instead of deleted. Nobody can apply for it any more and past records are intact.`,
      });
    }
    await query(`DELETE FROM leave_types WHERE id=$1`, [lt.id]);
    await audit(req.user.id, 'LEAVE_TYPE_DELETE', 'leave_type', lt.id, { code });
    res.json({ ok: true, retired: false, message: `${lt.name} deleted.` });
  } catch (e) { next(e); }
}

// POST /admin/leave-types/bulk  { types: [ {code,name,...}, ... ] }
//
// The add-many path: every row is validated, then all of them are inserted in
// one transaction so a bad row cannot leave half a list behind.
export async function createLeaveTypesBulk(req, res, next) {
  const client = await pool.connect();
  try {
    if (!req.orgId) return res.status(400).json({ error: 'Pick an organisation first.' });
    const list = Array.isArray(req.body?.types) ? req.body.types : [];
    if (!list.length) return res.status(400).json({ error: 'Nothing to add.' });
    if (list.length > 50) return res.status(400).json({ error: 'Add at most 50 leave types at a time.' });

    const existing = new Set((await query(
      `SELECT code FROM leave_types WHERE organisation_id=$1`, [req.orgId])).rows.map((r) => r.code));

    const clean = [];
    const seen = new Set();
    for (const [i, raw] of list.entries()) {
      const at = `Row ${i + 1}`;
      const code = String(raw?.code || '').trim().toUpperCase();
      const name = String(raw?.name || '').trim();
      if (!code && !name) continue; // a blank row the user left behind
      if (!leaveTypes.CODE_RE.test(code)) return res.status(400).json({ error: `${at}: "${code}" is not a valid code — 1–10 characters, starting with a letter, using A–Z, 0–9 and _.` });
      if (!name) return res.status(400).json({ error: `${at}: name is required.` });
      if (seen.has(code)) return res.status(400).json({ error: `${at}: ${code} appears twice in this list.` });
      if (existing.has(code)) return res.status(409).json({ error: `${at}: you already have a leave type with the code ${code}.` });
      const quota = Number(raw?.annualQuota ?? 0);
      if (!Number.isFinite(quota) || quota < 0) return res.status(400).json({ error: `${at}: annual quota must be zero or more.` });
      seen.add(code);
      clean.push({
        code, name, quota,
        requiresBalance: raw?.requiresBalance !== false,
        allowHalfDay: raw?.allowHalfDay === true,
        singleDate: raw?.singleDate === true,
        allowCertificate: raw?.allowCertificate === true,
      });
    }
    if (!clean.length) return res.status(400).json({ error: 'Nothing to add.' });

    await client.query('BEGIN');
    let order = Number((await client.query(
      `SELECT COALESCE(max(sort_order),0) AS n FROM leave_types WHERE organisation_id=$1`,
      [req.orgId])).rows[0].n);
    const made = [];
    for (const t of clean) {
      order += 10;
      const row = (await client.query(
        `INSERT INTO leave_types
           (organisation_id, code, name, annual_quota, requires_balance, sort_order,
            allow_half_day, single_date, allow_certificate, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
        [req.orgId, t.code, t.name, t.quota, t.requiresBalance, order,
         t.allowHalfDay, t.singleDate, t.allowCertificate])).rows[0];
      made.push({ id: Number(row.id), code: t.code });
    }
    await client.query('COMMIT');
    await audit(req.user.id, 'LEAVE_TYPE_CREATE_BULK', 'leave_type', null, { codes: made.map((m) => m.code) });
    res.status(201).json({ ok: true, added: made.length, types: made });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* the connection is already gone */ }
    next(e);
  } finally { client.release(); }
}
