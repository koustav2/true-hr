import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

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

// ---------------- Leave types ----------------

// GET /admin/leave-types
export async function listLeaveTypes(req, res, next) {
  try {
    const rows = (await query(
      `SELECT code, name, annual_quota, requires_balance, allow_half_day, single_date, allow_certificate, sort_order
       FROM leave_types ORDER BY sort_order`)).rows;
    res.json(rows.map((r) => ({
      code: r.code, name: r.name, annualQuota: Number(r.annual_quota), requiresBalance: r.requires_balance,
      allowHalfDay: r.allow_half_day, singleDate: r.single_date, allowCertificate: r.allow_certificate,
    })));
  } catch (e) { next(e); }
}

// PUT /admin/leave-types/:code  { name, annualQuota, requiresBalance, allowHalfDay, singleDate, allowCertificate }
export async function updateLeaveType(req, res, next) {
  try {
    const { code } = req.params;
    const b = req.body;
    const r = (await query(
      `UPDATE leave_types SET
         name = COALESCE($2, name),
         annual_quota = COALESCE($3, annual_quota),
         requires_balance = COALESCE($4, requires_balance),
         allow_half_day = COALESCE($5, allow_half_day),
         single_date = COALESCE($6, single_date),
         allow_certificate = COALESCE($7, allow_certificate)
       WHERE code=$1 RETURNING code`,
      [code, b.name ?? null, b.annualQuota ?? null, b.requiresBalance ?? null,
       b.allowHalfDay ?? null, b.singleDate ?? null, b.allowCertificate ?? null])).rows[0];
    if (!r) return res.status(404).json({ error: 'Leave type not found' });
    await audit(req.user.id, 'LEAVE_TYPE_UPDATE', 'leave_type', null, { code });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
