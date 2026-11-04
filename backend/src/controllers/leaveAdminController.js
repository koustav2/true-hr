import { query, pool } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import * as leaveTypes from '../services/leaveTypes.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, canonicalState, INDIAN_STATES, todayIST } from '../utils/validate.js';
import { AppError } from '../middleware/error.js';
import { SATURDAY_RULES, loadLeaveSettings } from '../services/attendancePayroll.js';

// ---------------- Holidays (per organisation; national / state / location) ----------------
//
// C17/C44/E6: holidays used to be one global table, so every tenant saw and
// could delete every other tenant's holidays. They now belong to an
// organisation (both API versions — it was a data leak). A row with no
// organisation is a platform-wide holiday that only direct SQL can create; it
// is listed read-only.

const fmt = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');
const scopeLabel = (state, location) => [state || 'National (all states)', location ? `${location} office` : null]
  .filter(Boolean).join(' · ');

function shapeHoliday(r, orgId) {
  return {
    id: Number(r.id), date: r.date, name: r.name, state: r.state || null,
    // added in v2 (old clients ignore unknown keys)
    occasion: r.name, location: r.location || null, kind: r.kind || 'PUBLIC',
    platform: r.organisation_id == null,
    editable: r.organisation_id != null && Number(r.organisation_id) === Number(orgId),
  };
}

// GET /admin/holidays?state=&year=&kind=
export async function listHolidays(req, res, next) {
  try {
    const p = [req.orgId || null];
    let where = '(organisation_id = $1 OR organisation_id IS NULL)';
    if (req.query.state) { p.push(req.query.state); where += ` AND (state IS NULL OR state='' OR lower(state)=lower($${p.length}))`; }
    if (/^\d{4}$/.test(String(req.query.year || ''))) { p.push(Number(req.query.year)); where += ` AND EXTRACT(YEAR FROM holiday_date)=$${p.length}`; }
    if (['PUBLIC', 'RESTRICTED'].includes(String(req.query.kind || '').toUpperCase())) {
      p.push(String(req.query.kind).toUpperCase()); where += ` AND COALESCE(kind,'PUBLIC')=$${p.length}`;
    }
    const rows = (await query(
      `SELECT id, to_char(holiday_date,'YYYY-MM-DD') AS date, name, state, location, kind, organisation_id
         FROM holidays WHERE ${where}
        ORDER BY holiday_date DESC`, p)).rows;
    res.json(rows.map((r) => shapeHoliday(r, req.orgId)));
  } catch (e) { next(e); }
}

// GET /admin/holidays/meta (v2) — choices for the holiday form.
export async function holidayMeta(req, res, next) {
  try {
    const locations = (await query(
      `SELECT DISTINCT name FROM (
         SELECT name FROM office_locations WHERE organisation_id=$1 AND active
         UNION SELECT trim(location) FROM employees WHERE organisation_id=$1 AND COALESCE(trim(location),'')<>''
       ) x ORDER BY name`, [req.orgId || null])).rows.map((r) => r.name);
    res.json({ states: INDIAN_STATES, locations, kinds: ['PUBLIC', 'RESTRICTED'] });
  } catch (e) { next(e); }
}

/** Validate a holiday body (v2) and return the clean row; throws 400 with every field error. */
async function cleanHoliday(req, b, exceptId = null) {
  const v = validator();
  const date = String(b.date || '').trim();
  const name = String(b.occasion ?? b.name ?? '').trim();
  const y = Number(todayIST().slice(0, 4));
  v.date('date', date, 'Date', { required: true, min: `${y - 1}-01-01`, max: `${y + 2}-12-31`,
    minMsg: `Date must be in ${y - 1} or later`, maxMsg: `Date must be no later than 31-12-${y + 2}` });
  v.text('name', name, 'Occasion', { required: true, min: 2, max: 100 });
  let state = null;
  if (b.state && String(b.state).trim()) {
    state = canonicalState(b.state);
    if (!state) v.add('state', 'Choose a state from the list');
  }
  const location = b.location && String(b.location).trim() ? String(b.location).trim() : null;
  if (location) v.text('location', location, 'Office location', { max: 80 });
  const kind = String(b.kind || 'PUBLIC').toUpperCase();
  if (!['PUBLIC', 'RESTRICTED'].includes(kind)) v.add('kind', 'Type must be Holiday or Restricted holiday');
  v.throwIfAny();
  const dupe = (await query(
    `SELECT name FROM holidays
      WHERE organisation_id=$1 AND holiday_date=$2
        AND lower(COALESCE(state,''))=lower($3) AND lower(COALESCE(location,''))=lower($4)
        AND ($5::bigint IS NULL OR id <> $5) LIMIT 1`,
    [req.orgId, date, state || '', location || '', exceptId])).rows[0];
  if (dupe) {
    throw new AppError(`"${dupe.name}" is already a holiday on ${fmt(date)} for ${scopeLabel(state, location)}`, 409,
      { date: `"${dupe.name}" is already on ${fmt(date)} for ${scopeLabel(state, location)}` });
  }
  return { date, name, state, location, kind };
}

// POST /admin/holidays { date, name|occasion, state, location, kind }
export async function createHoliday(req, res, next) {
  try {
    if (!req.orgId) return res.status(409).json({ error: 'No organisation selected. Pick one before continuing.' });
    let row;
    if (isV2(req)) {
      row = await cleanHoliday(req, req.body || {});
    } else {
      const { date, name, state } = req.body;
      if (!date || !name) return res.status(400).json({ error: 'date and name are required' });
      const st = state && String(state).trim() ? (canonicalState(state) || String(state).trim()) : null;
      row = { date, name, state: st, location: null, kind: 'PUBLIC' };
    }
    const ins = (await query(
      `INSERT INTO holidays (holiday_date, name, state, location, kind, organisation_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [row.date, row.name, row.state, row.location, row.kind, req.orgId])).rows[0];
    await audit(req.user.id, 'HOLIDAY_CREATE', 'holiday', ins.id, row);
    res.status(201).json({ ok: true, id: Number(ins.id) });
  } catch (e) { next(e); }
}

// PUT /admin/holidays/:id (v2, H63)
export async function updateHoliday(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const own = Number.isFinite(id) && (await query(
      `SELECT id FROM holidays WHERE id=$1 AND organisation_id=$2`, [id, req.orgId || null])).rowCount;
    if (!own) return res.status(404).json({ error: 'Holiday not found' });
    const row = await cleanHoliday(req, req.body || {}, id);
    await query(
      `UPDATE holidays SET holiday_date=$2, name=$3, state=$4, location=$5, kind=$6, updated_at=now() WHERE id=$1`,
      [id, row.date, row.name, row.state, row.location, row.kind]);
    await audit(req.user.id, 'HOLIDAY_UPDATE', 'holiday', id, row);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/holidays/:id — only this organisation's own (404 otherwise).
export async function deleteHoliday(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const r = Number.isFinite(id) ? await query(
      `DELETE FROM holidays WHERE id=$1 AND organisation_id=$2 RETURNING id`, [id, req.orgId || null]) : { rowCount: 0 };
    if (!r.rowCount) return res.status(404).json({ error: 'Holiday not found' });
    await audit(req.user.id, 'HOLIDAY_DELETE', 'holiday', id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ---------------- State-wise quota overrides (decision D5) ----------------
//
// The single source of a leave quota is the Leave Types annual quota. An
// organisation may override it for employees of one state. Overrides are the
// organisation's own (the old leave_entitlements table was global: one tenant
// editing Odisha changed every tenant's balances) and keyed by the canonical
// state name. The global table is kept only as a statutory reference.

async function statutoryRef() {
  const map = new Map();
  for (const r of (await query(`SELECT state, el, cl, sl FROM leave_entitlements ORDER BY state`)).rows) {
    const st = canonicalState(r.state);
    if (st && !map.has(st)) map.set(st, { EL: Number(r.el), CL: Number(r.cl), SL: Number(r.sl) });
  }
  return map;
}

async function orgOverrides(orgId) {
  const map = new Map();
  for (const r of (await query(
    `SELECT state, leave_type_code, annual_quota FROM leave_state_quotas WHERE organisation_id=$1`, [orgId || null])).rows) {
    if (!map.has(r.state)) map.set(r.state, {});
    map.get(r.state)[r.leave_type_code] = Number(r.annual_quota);
  }
  return map;
}

async function setOverride(orgId, state, code, value) {
  if (value === null || value === undefined || value === '') {
    await query(`DELETE FROM leave_state_quotas WHERE organisation_id=$1 AND lower(state)=lower($2) AND leave_type_code=$3`,
      [orgId, state, code]);
  } else {
    await query(
      `INSERT INTO leave_state_quotas (organisation_id, state, leave_type_code, annual_quota)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (organisation_id, lower(state), leave_type_code)
       DO UPDATE SET annual_quota=EXCLUDED.annual_quota, state=EXCLUDED.state, updated_at=now()`,
      [orgId, state, code, Number(value)]);
  }
}

// GET /admin/entitlements (v1 shape, now this organisation's own figures).
// Each state with an override; a code with no override shows the leave-type quota.
export async function listEntitlements(req, res, next) {
  try {
    const types = await leaveTypes.forOrg(req.orgId);
    const q = (c) => Number(types.find((t) => t.code === c)?.annualQuota || 0);
    const ov = await orgOverrides(req.orgId);
    const rows = [...ov.keys()].sort().map((state) => {
      const o = ov.get(state);
      return {
        state, el: o.EL ?? q('EL'), cl: o.CL ?? q('CL'), sl: o.SL ?? q('SL'),
        elAccum: 0, clAccum: 0, slAccum: 0,
      };
    });
    res.json(rows);
  } catch (e) { next(e); }
}

// PUT /admin/entitlements  { state, el, cl, sl }  (v1 upsert → this organisation's overrides)
export async function upsertEntitlement(req, res, next) {
  try {
    const { state, el, cl, sl } = req.body || {};
    if (!state || !String(state).trim()) return res.status(400).json({ error: 'state is required' });
    if (!req.orgId) return res.status(409).json({ error: 'No organisation selected. Pick one before continuing.' });
    const st = canonicalState(state) || String(state).trim();
    for (const [code, val] of [['EL', el], ['CL', cl], ['SL', sl]]) {
      if (val !== undefined && val !== null && val !== '' && Number.isFinite(Number(val)) && Number(val) >= 0) {
        await setOverride(req.orgId, st, code, Number(val));
      }
    }
    await audit(req.user.id, 'ENTITLEMENT_UPSERT', 'leave_entitlement', null, { state: st });
    await leaveTypes.ensureOrgBalances(req.orgId);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /admin/leave-states (v2) — every Indian state with this organisation's
// overrides, the statutory reference and the leave types they apply to.
export async function listStateQuotas(req, res, next) {
  try {
    const types = (await leaveTypes.forOrg(req.orgId, { activeOnly: true })).filter((t) => t.requiresBalance);
    const ov = await orgOverrides(req.orgId);
    const ref = await statutoryRef();
    res.json({
      precedence: 'An employee gets the State-wise quota for their state when one is set here, otherwise the Leave Types annual quota. Joiners in the current year get it prorated from their date of joining.',
      types: types.map((t) => ({ code: t.code, name: t.name, annualQuota: t.annualQuota })),
      states: INDIAN_STATES.map((state) => ({
        state, overrides: ov.get(state) || {}, statutory: ref.get(state) || null,
      })),
    });
  } catch (e) { next(e); }
}

// PUT /admin/leave-states (v2) { state, quotas: { EL: 15, CL: null, ... } }
export async function saveStateQuotas(req, res, next) {
  try {
    if (!req.orgId) return res.status(409).json({ error: 'No organisation selected. Pick one before continuing.' });
    const b = req.body || {};
    const v = validator();
    const state = canonicalState(b.state);
    if (!state) v.add('state', 'Choose a state from the list');
    const types = await leaveTypes.forOrg(req.orgId, { activeOnly: true });
    const quotas = b.quotas && typeof b.quotas === 'object' ? b.quotas : {};
    for (const [code, val] of Object.entries(quotas)) {
      const t = types.find((x) => x.code === code);
      if (!t) { v.add(code, `${code} is not one of your leave types`); continue; }
      if (val !== null && val !== '') v.number(code, val, `${t.name} quota`, { min: 0, max: 366 });
    }
    v.throwIfAny();
    for (const [code, val] of Object.entries(quotas)) {
      await setOverride(req.orgId, state, code, val === '' ? null : val);
    }
    await audit(req.user.id, 'STATE_QUOTA_SAVE', 'leave_state_quota', null, { state, quotas });
    await leaveTypes.ensureOrgBalances(req.orgId);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ---------------- Leave & attendance policy (v2) ----------------

// GET /admin/leave-settings
export async function getSettings(req, res, next) {
  try {
    const s = await loadLeaveSettings(req.orgId);
    const wo = (await query(`SELECT week_off_days FROM org_payroll_settings WHERE organisation_id=$1`, [req.orgId || null])).rows[0];
    res.json({ ...s, weekOffDays: String(wo?.week_off_days ?? '0').split(',').filter((x) => x !== '').map(Number), saturdayRules: SATURDAY_RULES });
  } catch (e) { next(e); }
}

// PUT /admin/leave-settings { saturdayRule, sandwichRule, maxBackdateDays, missPunchDays }
export async function saveSettings(req, res, next) {
  try {
    if (!req.orgId) return res.status(409).json({ error: 'No organisation selected. Pick one before continuing.' });
    const b = req.body || {};
    const v = validator();
    if (!SATURDAY_RULES.includes(b.saturdayRule)) v.add('saturdayRule', 'Choose a Saturday rule');
    v.number('maxBackdateDays', b.maxBackdateDays, 'Back-dated leave limit', { required: true, min: 0, max: 365, integer: true });
    v.number('missPunchDays', b.missPunchDays, 'Miss-punch window', { required: true, min: 1, max: 365, integer: true });
    v.throwIfAny();
    await query(
      `INSERT INTO org_leave_settings (organisation_id, saturday_rule, sandwich_rule, max_backdate_days, miss_punch_days, updated_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (organisation_id) DO UPDATE SET saturday_rule=EXCLUDED.saturday_rule,
         sandwich_rule=EXCLUDED.sandwich_rule, max_backdate_days=EXCLUDED.max_backdate_days,
         miss_punch_days=EXCLUDED.miss_punch_days, updated_at=now()`,
      [req.orgId, b.saturdayRule, b.sandwichRule !== false, Number(b.maxBackdateDays), Number(b.missPunchDays)]);
    await audit(req.user.id, 'LEAVE_SETTINGS_SAVE', 'organisation', req.orgId, b);
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
              lt.eligibility, lt.certificate_after_days,
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

/**
 * v2 field checks for one leave type (C19/H60): readable name not already used
 * by another type of this organisation (case-insensitive), a sane quota,
 * eligibility and certificate threshold. Returns the field-error map.
 */
async function leaveTypeErrors(orgId, b, { exceptCode = null, partial = false, v = validator(), prefix = '' } = {}) {
  const k = (f) => `${prefix}${f}`;
  if (!partial || b.name !== undefined) {
    v.text(k('name'), b.name, 'Name', { required: true, min: 2, max: 60 });
    if (b.name && String(b.name).trim()) {
      const clash = (await query(
        `SELECT code FROM leave_types WHERE organisation_id=$1 AND lower(trim(name))=lower(trim($2))
           AND ($3::text IS NULL OR code <> $3) LIMIT 1`, [orgId, b.name, exceptCode])).rows[0];
      if (clash) v.add(k('name'), `The name "${String(b.name).trim()}" is already used by ${clash.code}`);
    }
  }
  if (!partial || b.annualQuota !== undefined) {
    v.number(k('annualQuota'), b.annualQuota ?? 0, 'Annual quota', { min: 0, max: 366, decimals: 1 });
  }
  if (b.eligibility !== undefined && !leaveTypes.ELIGIBILITY.includes(String(b.eligibility).toUpperCase())) {
    v.add(k('eligibility'), 'Eligibility must be Everyone, Female only or Male only');
  }
  if (b.certificateAfterDays !== undefined && b.certificateAfterDays !== null && b.certificateAfterDays !== '') {
    v.number(k('certificateAfterDays'), b.certificateAfterDays, 'Certificate needed after', { min: 0, max: 366, decimals: 1 });
  }
  return v;
}
const eligOf = (b) => (b.eligibility ? String(b.eligibility).toUpperCase() : 'ALL');
const certOf = (b) => (b.certificateAfterDays === undefined || b.certificateAfterDays === null || b.certificateAfterDays === ''
  ? null : Number(b.certificateAfterDays));

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
    if (isV2(req)) (await leaveTypeErrors(req.orgId, b)).throwIfAny();

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
          allow_half_day, single_date, allow_certificate, active, eligibility, certificate_after_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11) RETURNING id`,
      [req.orgId, code, name, quota,
       b.requiresBalance !== false, nextOrder,
       b.allowHalfDay === true, b.singleDate === true, b.allowCertificate === true,
       eligOf(b), certOf(b)])).rows[0];
    await leaveTypes.ensureOrgBalances(req.orgId);

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
    if (isV2(req)) (await leaveTypeErrors(req.orgId, b, { exceptCode: code, partial: true })).throwIfAny();
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
         active = COALESCE($10, active),
         eligibility = COALESCE($11, eligibility),
         certificate_after_days = CASE WHEN $12::boolean THEN $13::numeric ELSE certificate_after_days END
       WHERE organisation_id=$1 AND code=$2 RETURNING id`,
      [req.orgId || null, code,
       b.name != null ? String(b.name).trim() : null,
       b.annualQuota ?? null, b.requiresBalance ?? null,
       b.allowHalfDay ?? null, b.singleDate ?? null, b.allowCertificate ?? null,
       b.sortOrder ?? null, b.active ?? null,
       b.eligibility ? String(b.eligibility).toUpperCase() : null,
       b.certificateAfterDays !== undefined, certOf(b)])).rows[0];
    if (!r) return res.status(404).json({ error: 'Leave type not found in your organisation.' });
    // Quota / eligibility drive every system-allocated balance (D5).
    await leaveTypes.ensureOrgBalances(req.orgId);
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
    const seenNames = new Set();
    const v2 = isV2(req);
    const fv = validator();
    for (const [i, raw] of list.entries()) {
      const at = `Row ${i + 1}`;
      const code = String(raw?.code || '').trim().toUpperCase();
      const name = String(raw?.name || '').trim();
      if (!code && !name) continue; // a blank row the user left behind
      if (!leaveTypes.CODE_RE.test(code)) return res.status(400).json({ error: `${at}: "${code}" is not a valid code — 1–10 characters, starting with a letter, using A–Z, 0–9 and _.` });
      if (!name) return res.status(400).json({ error: `${at}: name is required.` });
      if (seen.has(code)) return res.status(400).json({ error: `${at}: ${code} appears twice in this list.` });
      if (existing.has(code)) return res.status(409).json({ error: `${at}: you already have a leave type with the code ${code}.` });
      if (v2) {
        await leaveTypeErrors(req.orgId, raw || {}, { v: fv, prefix: `${i}.` });
        if (seenNames.has(name.toLowerCase())) fv.add(`${i}.name`, `${at}: the name "${name}" appears twice in this list`);
        seenNames.add(name.toLowerCase());
      }
      const quota = Number(raw?.annualQuota ?? 0);
      if (!Number.isFinite(quota) || quota < 0) return res.status(400).json({ error: `${at}: annual quota must be zero or more.` });
      seen.add(code);
      clean.push({
        code, name, quota,
        requiresBalance: raw?.requiresBalance !== false,
        allowHalfDay: raw?.allowHalfDay === true,
        singleDate: raw?.singleDate === true,
        allowCertificate: raw?.allowCertificate === true,
        eligibility: eligOf(raw || {}),
        certificateAfterDays: certOf(raw || {}),
      });
    }
    if (!clean.length) return res.status(400).json({ error: 'Nothing to add.' });
    if (v2) {
      // Prefix each message with its row so the summary reads on its own.
      for (const key of Object.keys(fv.fields)) {
        const row = Number(key.split('.')[0]) + 1;
        if (!fv.fields[key].startsWith('Row ')) fv.fields[key] = `Row ${row}: ${fv.fields[key]}`;
      }
      fv.throwIfAny();
    }

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
            allow_half_day, single_date, allow_certificate, active, eligibility, certificate_after_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11) RETURNING id`,
        [req.orgId, t.code, t.name, t.quota, t.requiresBalance, order,
         t.allowHalfDay, t.singleDate, t.allowCertificate, t.eligibility, t.certificateAfterDays])).rows[0];
      made.push({ id: Number(row.id), code: t.code });
    }
    await client.query('COMMIT');
    await audit(req.user.id, 'LEAVE_TYPE_CREATE_BULK', 'leave_type', null, { codes: made.map((m) => m.code) });
    await leaveTypes.ensureOrgBalances(req.orgId);
    res.status(201).json({ ok: true, added: made.length, types: made });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* the connection is already gone */ }
    next(e);
  } finally { client.release(); }
}
