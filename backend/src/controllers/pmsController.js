// PMS / KPI module (Phase 5). Monthly KPI → RM approval → PMS self-assessment →
// 4-level rating chain on the generic engine (flow 'PMS_RATING') → final grade.
import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import * as engine from '../services/approvalEngine.js';
import { scopedByEmployee } from '../utils/scope.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST } from '../utils/validate.js';
import { AppError } from '../middleware/error.js';
import { activeEmployeeSql } from '../utils/people.js';
import { notifyEmployee } from '../services/notify.js';
import {
  resolveScore, validateBands, normaliseBands, achievementPct, ratingFromBands, DEFAULT_BANDS,
  labelBands, gradeForPct, validateLadder, rangeLabel,
} from '../services/kpiBands.js';

const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];
const isStaff = (u) => STAFF.includes(u.role);
const num = (v) => (v == null || v === '' ? null : Number(v));

async function isManagerOf(managerId, employeeId) {
  return (await query(
    `SELECT 1 FROM employees WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

async function orgOfEmployee(employeeId) {
  if (!employeeId) return null;
  return (await query(`SELECT organisation_id FROM employees WHERE id=$1`, [employeeId])).rows[0]?.organisation_id ?? null;
}

/**
 * The grade ladder in force for an organisation: its own (configured on the
 * PMS page) or the published global one. Each row carries `upperPct` (the next
 * grade's floor, exclusive) and a readable `rangeLabel`, so a grade covers
 * [minPct, upperPct) and the ladder has no gaps (H119).
 */
export async function ladderFor(orgId) {
  let rows = [];
  let custom = false;
  if (orgId) {
    rows = (await query(
      `SELECT grade, code, label, min_pct FROM pms_org_grades WHERE organisation_id=$1 ORDER BY min_pct`, [orgId])).rows
      .map((g) => ({ grade: g.grade, code: g.code, label: g.label, minPct: Number(g.min_pct), legacyMax: undefined }));
    custom = rows.length > 0;
  }
  if (!custom) {
    rows = (await query(`SELECT grade, code, label, min_pct, max_pct FROM pms_grades ORDER BY min_pct`)).rows
      .map((g) => ({ grade: g.grade, code: g.code, label: g.label, minPct: Number(g.min_pct), legacyMax: g.max_pct }));
  }
  const out = rows.map((g, i) => {
    const upper = rows[i + 1]?.minPct ?? null;
    // maxPct keeps its v1 meaning (an inclusive whole-number ceiling) for the
    // apps that print it; the lookup itself never reads it.
    const maxPct = g.legacyMax !== undefined ? (g.legacyMax == null ? null : Number(g.legacyMax))
      : (upper == null ? null : (Number.isInteger(upper) && Number.isInteger(g.minPct) ? upper - 1 : upper));
    return { grade: g.grade, code: g.code, label: g.label, minPct: g.minPct, maxPct, upperPct: upper, rangeLabel: rangeLabel(g.minPct, upper) };
  });
  return { custom, grades: out.sort((a, b) => b.minPct - a.minPct) };
}

// Months an employee may raise a KPI for (v2, E30): the current month, the
// previous month until the 10th, and any month HR has opened as a cycle.
async function allowedMonths(orgId) {
  const today = todayIST();
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), d = Number(today.slice(8, 10));
  const out = [{ year: y, month: m, reason: 'Current month' }];
  if (d <= 10) out.push(m === 1 ? { year: y - 1, month: 12, reason: 'Previous month (open until the 10th)' }
    : { year: y, month: m - 1, reason: 'Previous month (open until the 10th)' });
  if (orgId) {
    const cycles = (await query(
      `SELECT year, month, closes_on FROM pms_cycles
        WHERE organisation_id=$1 AND (closes_on IS NULL OR closes_on >= $2::date)
        ORDER BY year DESC, month DESC`, [orgId, today])).rows;
    for (const c of cycles) {
      if (!out.some((o) => o.year === c.year && o.month === c.month)) {
        out.push({ year: c.year, month: c.month, reason: 'Opened by HR' });
      }
    }
  }
  return out;
}

// Does this employee have a reporting manager who can approve their KPI?
async function hasActiveManager(employeeId) {
  return (await query(
    `SELECT 1 FROM employees e JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.id=$1 AND m.organisation_id IS NOT DISTINCT FROM e.organisation_id
        AND ${activeEmployeeSql('m')}`, [employeeId])).rowCount > 0;
}

// v2 field-level KRA validation (all messages at once).
function validateKrasV2(kras) {
  const v = validator();
  if (!Array.isArray(kras) || !kras.length) { v.add('kras', 'Add at least one KRA'); return v; }
  if (kras.length > 20) v.add('kras', 'A KPI can have at most 20 KRAs');
  kras.forEach((k, i) => {
    v.text(`kras.${i}.description`, k?.description, `KRA ${i + 1} description`, { required: true, min: 3, max: 500 });
    v.number(`kras.${i}.weightage`, k?.weightage, `KRA ${i + 1} weightage`, { required: true, min: 1, max: 100, decimals: 2 });
    if (k?.target != null && String(k.target).length > 100) v.add(`kras.${i}.target`, `KRA ${i + 1} target must be at most 100 characters`);
    const bad = validateBands(k?.measurementBands, `KRA ${i + 1}`);
    if (bad) v.add(`kras.${i}.measurementBands`, bad);
  });
  if (!v.has('kras') && kras.every((k, i) => !v.has(`kras.${i}.weightage`))) {
    const sum = Math.round(kras.reduce((a, k) => a + Number(String(k.weightage).replace(/,/g, '')), 0) * 100) / 100;
    if (sum !== 100) v.add('kras', `KRA weightages must add up to 100% (now ${sum}%)`);
  }
  return v;
}

async function kpiDetail(id) {
  const k = (await query(
    `SELECT k.*, e.employee_code, e.first_name, e.last_name
       FROM kpis k JOIN employees e ON e.id=k.employee_id WHERE k.id=$1`, [id])).rows[0];
  if (!k) return null;
  const kras = (await query(`SELECT * FROM kpi_kras WHERE kpi_id=$1 ORDER BY seq`, [id])).rows;
  const sub = (await query(`SELECT * FROM pms_submissions WHERE kpi_id=$1`, [id])).rows[0];
  let submission = null;
  if (sub) {
    const scores = (await query(`SELECT * FROM pms_kra_scores WHERE submission_id=$1`, [sub.id])).rows;
    const levels = (await query(
      `SELECT r.*, e.first_name, e.last_name FROM pms_level_ratings r
       LEFT JOIN employees e ON e.id=r.rated_by WHERE r.submission_id=$1 ORDER BY r.rated_at`, [sub.id])).rows;
    submission = {
      id: sub.id, status: sub.status, selfRating: sub.self_rating, submittedAt: sub.submitted_at,
      finalGrade: sub.final_grade, finalPliPct: sub.final_pli_pct,
      approval: sub.approval_instance_id ? await engine.getInstance(sub.approval_instance_id) : null,
      scores: scores.map((s) => ({
        kraId: s.kra_id, mtdTarget: s.mtd_target, mtdAchieved: s.mtd_achieved,
        selfRating: s.self_rating, selfRemarks: s.self_remarks,
        mgrRating: s.mgr_rating, mgrRemarks: s.mgr_remarks,
        // So a reviewer can see 3 came from "96% of target" and not from a dropdown.
        achievementPct: s.achievement_pct == null ? null : Number(s.achievement_pct),
        ratingSource: s.rating_source || null,
      })),
      levelRatings: levels.map((l) => ({
        roleKey: l.role_key, pliRating: l.pli_rating, pliPct: l.pli_pct, remarks: l.remarks,
        ratedBy: l.first_name ? `${l.first_name} ${l.last_name}`.trim() : null, ratedAt: l.rated_at,
      })),
    };
  }
  return {
    id: k.id,
    employee: { id: k.employee_id, employeeCode: k.employee_code, name: `${k.first_name} ${k.last_name}`.trim() },
    year: k.year, month: k.month, status: k.status,
    submittedAt: k.submitted_at, approvedAt: k.approved_at,
    routedToHr: !!k.routed_to_hr,
    kras: kras.map((x) => ({
      id: x.id, seq: x.seq, description: x.description, weightage: Number(x.weightage), target: x.target ?? null,
      measurementBands: x.measurement_bands,
      // Readable ranges ("90% to below 105%", "120% and above") — E31.
      bandLabels: labelBands(x.measurement_bands).map((b) => ({ label: b.label, rating: b.rating })),
    })),
    pms: submission,
  };
}

function validateKras(kras) {
  if (!Array.isArray(kras) || !kras.length) return 'At least one KRA is required';
  const sum = kras.reduce((a, k) => a + Number(k.weightage || 0), 0);
  if (Math.round(sum * 100) / 100 !== 100) return `KRA weightages must sum to 100 (got ${sum})`;
  if (kras.some((k) => !k.description || !String(k.description).trim())) return 'Every KRA needs a description';
  // The bands decide the rating, so a gap or an overlap in them mis-rates
  // someone quietly. Refuse the shape rather than store it.
  for (const [i, k] of kras.entries()) {
    const bad = validateBands(k.measurementBands, `KRA ${i + 1}`);
    if (bad) return bad;
  }
  return null;
}

// POST /kpi { year, month, copyPrevious?, kras:[{description, weightage, measurementBands?}] }
export async function createKpi(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee linked to this account' });
    const b = req.body || {};
    const year = Number(b.year), month = Number(b.month);
    if (!year || !(month >= 1 && month <= 12)) {
      if (isV2(req)) throw Object.assign(new AppError('Select the month for this KPI', 400), { fields: { month: 'Select the month for this KPI' } });
      return res.status(400).json({ error: 'year and month (1–12) required' });
    }
    let routedToHr = false;
    if (isV2(req)) {
      // E30: only the current month (or one HR has opened) — no future months.
      const allowed = await allowedMonths(await orgOfEmployee(empId));
      if (!allowed.some((a) => a.year === year && a.month === month)) {
        const msg = `KPIs can only be submitted for ${allowed.map((a) => `${MONTH_NAMES[a.month - 1]} ${a.year}`).join(' or ')}`;
        throw Object.assign(new AppError(msg, 400), { fields: { month: msg } });
      }
      if (!b.copyPrevious) validateKrasV2(b.kras).throwIfAny();
      // E29: nobody to approve it — route to HR instead of leaving it stuck.
      routedToHr = !(await hasActiveManager(empId));
    }

    let kras = b.kras;
    if (b.copyPrevious) {
      const prev = (await query(
        `SELECT id FROM kpis WHERE employee_id=$1 AND (year, month) < ($2, $3) ORDER BY year DESC, month DESC LIMIT 1`,
        [empId, year, month])).rows[0];
      if (!prev) return res.status(404).json({ error: 'No previous KPI to copy' });
      kras = (await query(`SELECT description, weightage, measurement_bands, target FROM kpi_kras WHERE kpi_id=$1 ORDER BY seq`, [prev.id])).rows
        .map((x) => ({ description: x.description, weightage: Number(x.weightage), measurementBands: x.measurement_bands, target: x.target }));
    }
    const err = validateKras(kras);
    if (err) return res.status(400).json({ error: err });

    const kpi = await tx(async (c) => {
      const k = (await c.query(
        `INSERT INTO kpis (employee_id, year, month, routed_to_hr) VALUES ($1,$2,$3,$4) RETURNING *`,
        [empId, year, month, routedToHr])).rows[0];
      for (const [i, x] of kras.entries()) {
        await c.query(
          `INSERT INTO kpi_kras (kpi_id, seq, description, weightage, measurement_bands, target) VALUES ($1,$2,$3,$4,$5,$6)`,
          [k.id, i + 1, String(x.description).trim(), Number(String(x.weightage).replace(/,/g, '')),
           JSON.stringify(normaliseBands(x.measurementBands)), x.target != null && String(x.target).trim() ? String(x.target).trim() : null]);
      }
      return k;
    });
    await audit(req.user.id, 'KPI_CREATED', 'kpi', kpi.id, { year, month, routedToHr });
    const out = await kpiDetail(kpi.id);
    if (routedToHr) out.notice = 'You have no reporting manager assigned, so this KPI has been sent to HR for approval.';
    res.status(201).json(out);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'KPI already exists for this month' });
    next(e);
  }
}

// PUT /kpi/:id — owner edits while RM_PENDING or DISCUSS (Discuss → back to RM_PENDING).
export async function updateKpi(req, res, next) {
  try {
    const id = Number(req.params.id);
    const k = (await query(`SELECT * FROM kpis WHERE id=$1`, [id])).rows[0];
    if (!k) return res.status(404).json({ error: 'Not found' });
    if (Number(k.employee_id) !== Number(req.user.employeeId)) return res.status(403).json({ error: 'Not your KPI' });
    if (!['RM_PENDING', 'DISCUSS'].includes(k.status)) return res.status(409).json({ error: `KPI is ${k.status}` });
    const kras = (req.body || {}).kras;
    if (isV2(req)) validateKrasV2(kras).throwIfAny();
    const err = validateKras(kras);
    if (err) return res.status(400).json({ error: err });
    await tx(async (c) => {
      await c.query(`DELETE FROM kpi_kras WHERE kpi_id=$1`, [id]);
      for (const [i, x] of kras.entries()) {
        await c.query(
          `INSERT INTO kpi_kras (kpi_id, seq, description, weightage, measurement_bands, target) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, i + 1, String(x.description).trim(), Number(String(x.weightage).replace(/,/g, '')),
           JSON.stringify(normaliseBands(x.measurementBands)), x.target != null && String(x.target).trim() ? String(x.target).trim() : null]);
      }
      await c.query(`UPDATE kpis SET status='RM_PENDING', submitted_at=now() WHERE id=$1`, [id]);
    });
    res.json(await kpiDetail(id));
  } catch (e) { next(e); }
}

// GET /kpi?year= — my KPI/PMS list (mirrors GreenHR "My Performance").
export async function listMine(req, res, next) {
  try {
    const params = [req.user.employeeId];
    let where = 'k.employee_id=$1';
    if (req.query.year) { params.push(Number(req.query.year)); where += ` AND k.year=$${params.length}`; }
    const rows = (await query(
      `SELECT k.id, k.year, k.month, k.status AS kpi_status, k.submitted_at, k.approved_at, k.routed_to_hr,
              s.status AS pms_status, s.self_rating, s.final_grade, s.final_pli_pct
         FROM kpis k LEFT JOIN pms_submissions s ON s.kpi_id = k.id
        WHERE ${where} ORDER BY k.year DESC, k.month DESC`, params)).rows;
    res.json(rows.map((r) => ({
      id: r.id, year: r.year, month: r.month,
      kpiStatus: r.kpi_status, pmsStatus: r.pms_status || 'NOT_SUBMITTED',
      selfRating: r.self_rating, finalGrade: r.final_grade, finalPliPct: r.final_pli_pct,
      submittedAt: r.submitted_at, approvedAt: r.approved_at, routedToHr: !!r.routed_to_hr,
    })));
  } catch (e) { next(e); }
}

// GET /kpi/team-pending — KPIs awaiting my approval as a manager.
export async function teamPending(req, res, next) {
  try {
    const rows = (await query(
      `SELECT k.id, k.year, k.month, k.status, k.submitted_at,
              e.id AS emp_id, e.employee_code, e.first_name, e.last_name, d.title AS designation
         FROM kpis k
         JOIN employees e ON e.id = k.employee_id
         LEFT JOIN designations d ON d.id = e.designation_id
        WHERE k.status IN ('RM_PENDING','DISCUSS')
          AND (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
        ORDER BY k.submitted_at`, [req.user.employeeId])).rows;
    // v2 (C36/E29): HR also sees KPIs that have no reporting manager to approve
    // them, in its own organisation, so they never sit at "RM pending" forever.
    if (isV2(req) && isStaff(req.user)) {
      const extra = (await query(
        `SELECT k.id, k.year, k.month, k.status, k.submitted_at,
                e.id AS emp_id, e.employee_code, e.first_name, e.last_name, d.title AS designation, true AS no_manager
           FROM kpis k
           JOIN employees e ON e.id = k.employee_id
           LEFT JOIN designations d ON d.id = e.designation_id
          WHERE k.status = 'RM_PENDING'
            AND ($1::bigint IS NULL OR e.organisation_id = $1)
            AND ($2::bigint IS NULL OR e.company_id = $2)
            AND (k.routed_to_hr OR NOT EXISTS (
                  SELECT 1 FROM employees m WHERE m.id = e.reporting_manager_id AND ${activeEmployeeSql('m')}))
          ORDER BY k.submitted_at`, [req.orgId || null, req.companyScope || null])).rows;
      const seen = new Set(rows.map((r) => String(r.id)));
      for (const x of extra) if (!seen.has(String(x.id))) rows.push(x);
    }
    res.json(rows.map((r) => ({
      id: r.id, year: r.year, month: r.month, status: r.status, submittedAt: r.submitted_at,
      employee: { id: r.emp_id, employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`.trim(), designation: r.designation },
      ...(r.no_manager ? { routedToHr: true } : {}),
    })));
  } catch (e) { next(e); }
}

// GET /kpi/:id — owner, their manager, or staff.
export async function detail(req, res, next) {
  try {
    // kpis carry no organisation_id — the tenant comes from the employee. The
    // isStaff gate below only asked "an HR admin somewhere", so any tenant's HR
    // admin could read any tenant's KRAs, scores, remarks and final grade.
    if (!(await scopedByEmployee(req, 'kpis', req.params.id, { cols: 't.id' })))
      return res.status(404).json({ error: 'Not found' });
    const d = await kpiDetail(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Not found' });
    const me = req.user.employeeId;
    if (d.employee.id !== me && !isStaff(req.user) && !(await isManagerOf(me, d.employee.id)))
      return res.status(403).json({ error: 'Forbidden' });
    res.json(d);
  } catch (e) { next(e); }
}

// POST /kpi/:id/review { action: 'APPROVE' | 'DISCUSS' } — reporting manager.
export async function reviewKpi(req, res, next) {
  try {
    const id = Number(req.params.id);
    // Scoped through employees: isStaff bypasses isManagerOf below, so without
    // this any tenant's HR admin could approve (LOCK) or send back another
    // tenant's KPI.
    const k = await scopedByEmployee(req, 'kpis', id);
    if (!k) return res.status(404).json({ error: 'Not found' });
    if (k.status !== 'RM_PENDING') return res.status(409).json({ error: `KPI is ${k.status}` });
    const me = req.user.employeeId;
    if (!isStaff(req.user) && !(await isManagerOf(me, k.employee_id))) return res.status(403).json({ error: 'Not a manager of this employee' });
    const action = (req.body || {}).action;
    if (!['APPROVE', 'DISCUSS'].includes(action)) return res.status(400).json({ error: 'action must be APPROVE or DISCUSS' });
    await query(
      `UPDATE kpis SET status=$2, approved_by=$3, approved_at = CASE WHEN $2='LOCKED' THEN now() ELSE approved_at END WHERE id=$1`,
      [id, action === 'APPROVE' ? 'LOCKED' : 'DISCUSS', me]);
    await audit(req.user.id, `KPI_${action}`, 'kpi', id, {});
    res.json(await kpiDetail(id));
  } catch (e) { next(e); }
}

// POST /kpi/:id/pms { scores:[{kraId, mtdTarget, mtdAchieved, selfRating, selfRemarks}] }
export async function submitPms(req, res, next) {
  try {
    const id = Number(req.params.id);
    const k = (await query(`SELECT * FROM kpis WHERE id=$1`, [id])).rows[0];
    if (!k) return res.status(404).json({ error: 'Not found' });
    if (Number(k.employee_id) !== Number(req.user.employeeId)) return res.status(403).json({ error: 'Not your KPI' });
    if (k.status !== 'LOCKED') return res.status(409).json({ error: 'KPI must be approved (LOCKED) before PMS submission' });

    const scores = (req.body || {}).scores;
    const kras = (await query(
      `SELECT id, seq, weightage, measurement_bands FROM kpi_kras WHERE kpi_id=$1`, [id])).rows;
    if (!Array.isArray(scores) || scores.length !== kras.length)
      return res.status(400).json({ error: `scores for all ${kras.length} KRAs required` });

    const byKra = Object.fromEntries(kras.map((x) => [String(x.id), x]));

    // The rating comes from the KRA's measurement bands wherever MTD Target and
    // MTD Achieved are both numeric — that is what the bands are for, and it is
    // how GreenHR scores a KRA. A rating typed in the form is only used where
    // there is nothing to divide (a KRA like "Launch 3 campaigns"), which is why
    // each row also records the achievement % and where its rating came from.
    const resolved = [];
    for (const s of scores) {
      const kra = byKra[String(s.kraId)];
      if (!kra) return res.status(400).json({ error: `Unknown kraId ${s.kraId}` });
      const r = resolveScore({
        bands: kra.measurement_bands,
        mtdTarget: s.mtdTarget,
        mtdAchieved: s.mtdAchieved,
        enteredRating: s.selfRating,
      });
      if (r.rating == null) {
        return res.status(400).json({
          error: `KRA ${kra.seq}: give a numeric MTD target and achievement so the band can score it, or enter a rating yourself.`,
        });
      }
      resolved.push({ ...s, ...r, weightage: Number(kra.weightage) });
    }

    // Weighted overall, using the resolved ratings rather than what was typed.
    let selfRating = resolved.reduce((a, r) => a + r.rating * r.weightage / 100, 0);
    selfRating = Math.round(selfRating * 100) / 100;

    const sub = await tx(async (c) => {
      const s = (await c.query(
        `INSERT INTO pms_submissions (kpi_id, self_rating) VALUES ($1,$2) RETURNING *`, [id, selfRating])).rows[0];
      for (const x of resolved) {
        await c.query(
          `INSERT INTO pms_kra_scores
             (submission_id, kra_id, mtd_target, mtd_achieved, self_rating, self_remarks,
              achievement_pct, rating_source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [s.id, x.kraId, x.mtdTarget || null, x.mtdAchieved || null, x.rating, x.selfRemarks || null,
           x.pct, x.source]);
      }
      return s;
    });
    const inst = await engine.createInstance('PMS_RATING', 'pms', sub.id, k.employee_id, {}, req.user.id);
    await query(`UPDATE pms_submissions SET approval_instance_id=$2 WHERE id=$1`, [sub.id, inst.id]);
    await audit(req.user.id, 'PMS_SUBMITTED', 'pms', sub.id, { kpiId: id, selfRating });
    res.status(201).json(await kpiDetail(id));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'PMS already submitted for this month' });
    next(e);
  }
}

// GET /pms/pending — submissions waiting on me in the rating chain.
export async function pendingRatings(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const staffV2 = isV2(req) && isStaff(req.user);
    if (!empId && !staffV2) return res.json([]);
    const items = empId ? (await engine.pendingFor(empId)).filter((x) => x.subjectType === 'pms') : [];
    // v2 (C36): a stage nobody holds (e.g. no reporting manager) waits on HR,
    // so HR's rating queue shows it instead of it being invisible to everyone.
    if (staffV2) {
      const orphan = (await query(
        `SELECT i.id AS instance_id, i.subject_id, st.seq, st.role_key
           FROM approval_instances i
           JOIN approval_flows f ON f.id = i.flow_id AND f.code = 'PMS_RATING'
           JOIN approval_instance_stages st ON st.instance_id = i.id AND st.seq = i.current_stage_seq
           JOIN employees e ON e.id = i.raised_by_employee_id
          WHERE i.status = 'PENDING' AND st.status = 'PENDING' AND st.approver_employee_id IS NULL
            AND ($1::bigint IS NULL OR e.organisation_id = $1)
            AND ($2::bigint IS NULL OR e.company_id = $2)`, [req.orgId || null, req.companyScope || null])).rows;
      for (const o of orphan) {
        if (!items.some((x) => String(x.subjectId) === String(o.subject_id))) {
          items.push({ instanceId: o.instance_id, subjectType: 'pms', subjectId: o.subject_id, stageSeq: o.seq, roleKey: o.role_key, unassigned: true });
        }
      }
    }
    if (!items.length) return res.json([]);
    const ids = items.map((x) => x.subjectId);
    const rows = (await query(
      `SELECT s.id, s.kpi_id, s.self_rating, k.year, k.month, e.employee_code, e.first_name, e.last_name
         FROM pms_submissions s JOIN kpis k ON k.id=s.kpi_id JOIN employees e ON e.id=k.employee_id
        WHERE s.id = ANY($1::bigint[])`, [ids])).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    res.json(items.map((x) => {
      const r = byId[x.subjectId];
      return {
        submissionId: x.subjectId, kpiId: r?.kpi_id, stage: { seq: x.stageSeq, roleKey: x.roleKey },
        year: r?.year, month: r?.month, selfRating: r?.self_rating,
        employee: r ? { employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`.trim() } : null,
        ...(x.unassigned ? { unassigned: true } : {}),
      };
    }));
  } catch (e) { next(e); }
}

// POST /pms/:id/rate { pliRating, pliPct, remarks, kraScores?:[{kraId, mgrRating, mgrRemarks}] }
// Current-stage rater: records the level rating, then advances the chain.
// When the chain completes, the last level's PLI % maps to the final grade.
export async function rate(req, res, next) {
  try {
    const id = Number(req.params.id);
    // pms_submissions has neither organisation_id nor employee_id: it reaches
    // the tenant through kpis → employees. Unscoped, the isStaff override let
    // any tenant's HR admin rate and stamp final_grade on another tenant's
    // submission.
    const s = (await query(
      `SELECT s.* FROM pms_submissions s
         JOIN kpis k ON k.id = s.kpi_id
         JOIN employees e ON e.id = k.employee_id
        WHERE s.id=$1
          AND ($2::bigint IS NULL OR e.organisation_id = $2)
          AND ($3::bigint IS NULL OR e.company_id = $3)`,
      [id, req.orgId || null, req.companyScope || null])).rows[0];
    if (!s) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    if (num(b.pliPct) == null || num(b.pliRating) == null)
      return res.status(400).json({ error: 'pliRating and pliPct are required' });
    // Never validated before: a PLI rating of 9 or a negative % would land in
    // the ledger and then map to no grade at all.
    const pliRating = num(b.pliRating), pliPct = num(b.pliPct);
    if (pliRating < 1 || pliRating > 5) return res.status(400).json({ error: 'PLI rating runs 1 to 5.' });
    if (pliPct < 0 || pliPct > 500) return res.status(400).json({ error: 'PLI % looks wrong — it should be between 0 and 500.' });
    for (const x of (Array.isArray(b.kraScores) ? b.kraScores : [])) {
      const r = num(x.mgrRating);
      if (r != null && (r < 1 || r > 5)) return res.status(400).json({ error: 'A manager rating runs 1 to 5.' });
    }

    const before = await engine.getInstance(s.approval_instance_id);
    const stage = before.chain.find((x) => x.seq === before.currentStageSeq);
    const inst = await engine.act(s.approval_instance_id, req.user.employeeId, 'APPROVED', b.remarks, {
      isStaff: isStaff(req.user), actorUserId: req.user.id, orgId: req.orgId,
    });

    await query(
      `INSERT INTO pms_level_ratings (submission_id, role_key, pli_rating, pli_pct, remarks, rated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (submission_id, role_key) DO UPDATE SET pli_rating=$3, pli_pct=$4, remarks=$5, rated_by=$6, rated_at=now()`,
      [id, stage.roleKey, num(b.pliRating), num(b.pliPct), b.remarks || null, req.user.employeeId]);

    if (Array.isArray(b.kraScores)) {
      for (const x of b.kraScores) {
        await query(
          `UPDATE pms_kra_scores SET mgr_rating=$3, mgr_remarks=$4 WHERE submission_id=$1 AND kra_id=$2`,
          [id, x.kraId, num(x.mgrRating), x.mgrRemarks || null]);
      }
    }

    if (inst.status === 'APPROVED') {
      // Floor-based on the employee's organisation's ladder: 104.5% is AT, not
      // "no grade" as the old inclusive whole-number ranges made it (H119).
      const empOrg = (await query(
        `SELECT e.organisation_id FROM pms_submissions s JOIN kpis k ON k.id=s.kpi_id
           JOIN employees e ON e.id=k.employee_id WHERE s.id=$1`, [id])).rows[0]?.organisation_id ?? null;
      const grade = gradeForPct((await ladderFor(empOrg)).grades, num(b.pliPct));
      await query(
        `UPDATE pms_submissions SET status='FUNCTIONAL_APPROVED', final_grade=$2, final_pli_pct=$3 WHERE id=$1`,
        [id, grade?.code || null, num(b.pliPct)]);
    }
    await audit(req.user.id, 'PMS_RATED', 'pms', id, { roleKey: stage.roleKey, pliPct: num(b.pliPct) });
    const kpiId = (await query(`SELECT kpi_id FROM pms_submissions WHERE id=$1`, [id])).rows[0].kpi_id;
    res.json(await kpiDetail(kpiId));
  } catch (e) { next(e); }
}

// GET /pms/grades — the published ladder.
// v1 keeps its array shape (plus the additive upperPct / rangeLabel); the
// caller's organisation's own ladder is served when it has one.
export async function grades(req, res, next) {
  try {
    const org = req.orgId || await orgOfEmployee(req.user?.employeeId);
    const { custom, grades: rows } = await ladderFor(org);
    if (isV2(req)) return res.json({ custom, grades: rows });
    res.json(rows.map((g) => ({ ...g })));
  } catch (e) { next(e); }
}

// ── v2 admin: grade ladder, overview, cycles ─────────────────────────────────

// PUT /admin/pms/grades { grades:[{grade, code, label, minPct}] } — C36/H120.
export async function saveGrades(req, res, next) {
  try {
    if (!req.orgId) return res.status(400).json({ error: 'Open an organisation first' });
    const rows = (req.body || {}).grades;
    const bad = validateLadder(rows);
    if (bad) {
      const keys = Object.keys(bad);
      throw Object.assign(new AppError(keys.length === 1 ? bad[keys[0]] : `Please fix ${keys.length} fields: ${keys.map((k) => bad[k]).join('; ')}`, 400), { fields: bad });
    }
    await tx(async (c) => {
      await c.query(`DELETE FROM pms_org_grades WHERE organisation_id=$1`, [req.orgId]);
      for (const g of rows) {
        await c.query(
          `INSERT INTO pms_org_grades (organisation_id, grade, code, label, min_pct) VALUES ($1,$2,$3,$4,$5)`,
          [req.orgId, Number(g.grade), String(g.code).trim().toUpperCase(), String(g.label).trim(), Number(g.minPct)]);
      }
    });
    await audit(req.user.id, 'PMS_GRADES_SAVED', 'pms_org_grades', null, { grades: rows.length });
    res.json(await ladderFor(req.orgId));
  } catch (e) { next(e); }
}

// DELETE /admin/pms/grades — back to the published default ladder.
export async function resetGrades(req, res, next) {
  try {
    if (!req.orgId) return res.status(400).json({ error: 'Open an organisation first' });
    await query(`DELETE FROM pms_org_grades WHERE organisation_id=$1`, [req.orgId]);
    await audit(req.user.id, 'PMS_GRADES_RESET', 'pms_org_grades', null, {});
    res.json(await ladderFor(req.orgId));
  } catch (e) { next(e); }
}

// GET /admin/pms/overview?year=&month=&status= — every active employee's KPI /
// PMS state for one month (H120). status: NOT_SUBMITTED | RM_PENDING | DISCUSS
// | LOCKED | PMS_PENDING | RATED.
export async function overview(req, res, next) {
  try {
    const today = todayIST();
    const year = Number(req.query.year) || Number(today.slice(0, 4));
    const month = Number(req.query.month) || Number(today.slice(5, 7));
    if (!(month >= 1 && month <= 12)) return res.status(400).json({ error: 'Month must be 1-12', fields: { month: 'Month must be 1-12' } });
    const rows = (await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, d.title AS designation, dep.name AS department,
              m.first_name AS rm_first, m.last_name AS rm_last,
              k.id AS kpi_id, k.status AS kpi_status, k.submitted_at, k.routed_to_hr,
              s.status AS pms_status, s.self_rating, s.final_grade, s.final_pli_pct
         FROM employees e
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN departments dep ON dep.id = e.department_id
         LEFT JOIN employees m ON m.id = e.reporting_manager_id
         LEFT JOIN kpis k ON k.employee_id = e.id AND k.year = $3 AND k.month = $4
         LEFT JOIN pms_submissions s ON s.kpi_id = k.id
        WHERE ${activeEmployeeSql('e')}
          AND ($1::bigint IS NULL OR e.organisation_id = $1)
          AND ($2::bigint IS NULL OR e.company_id = $2)
        ORDER BY e.first_name, e.last_name`,
      [req.orgId || null, req.companyScope || null, year, month])).rows;
    const stateOf = (r) => (!r.kpi_id ? 'NOT_SUBMITTED'
      : r.pms_status === 'FUNCTIONAL_APPROVED' ? 'RATED'
        : r.pms_status ? 'PMS_PENDING' : r.kpi_status);
    let out = rows.map((r) => ({
      employee: { id: r.id, employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name || ''}`.trim(), designation: r.designation, department: r.department },
      reportingManager: r.rm_first ? `${r.rm_first} ${r.rm_last || ''}`.trim() : null,
      kpiId: r.kpi_id, kpiStatus: r.kpi_status, state: stateOf(r), routedToHr: !!r.routed_to_hr,
      submittedAt: r.submitted_at, selfRating: r.self_rating, finalGrade: r.final_grade, finalPliPct: r.final_pli_pct,
    }));
    const counts = out.reduce((a, r) => { a[r.state] = (a[r.state] || 0) + 1; return a; }, {});
    const status = String(req.query.status || '').toUpperCase();
    if (status) out = out.filter((r) => r.state === status);
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) out = out.filter((r) => r.employee.name.toLowerCase().includes(q) || String(r.employee.employeeCode || '').toLowerCase().includes(q));
    const cycle = req.orgId ? (await query(
      `SELECT closes_on, opened_at FROM pms_cycles WHERE organisation_id=$1 AND year=$2 AND month=$3`, [req.orgId, year, month])).rows[0] : null;
    res.json({ year, month, counts, total: rows.length, cycle: cycle ? { closesOn: cycle.closes_on, openedAt: cycle.opened_at } : null, rows: out });
  } catch (e) { next(e); }
}

// GET /admin/pms/cycles
export async function listCycles(req, res, next) {
  try {
    const rows = (await query(
      `SELECT c.id, c.year, c.month, c.closes_on, c.opened_at FROM pms_cycles c
        WHERE ($1::bigint IS NULL OR c.organisation_id=$1) ORDER BY c.year DESC, c.month DESC LIMIT 24`, [req.orgId || null])).rows;
    res.json(rows.map((c) => ({ id: c.id, year: c.year, month: c.month, closesOn: c.closes_on, openedAt: c.opened_at })));
  } catch (e) { next(e); }
}

// POST /admin/pms/cycles { year, month, closesOn? } — HR opens a month for KPI
// submission and every active employee is notified (H120, minimal "start cycle").
export async function startCycle(req, res, next) {
  try {
    if (!req.orgId) return res.status(400).json({ error: 'Open an organisation first' });
    const b = req.body || {};
    const today = todayIST();
    const v = validator();
    v.number('year', b.year, 'Year', { required: true, integer: true, min: 2020, max: Number(today.slice(0, 4)) + 1 });
    v.number('month', b.month, 'Month', { required: true, integer: true, min: 1, max: 12 });
    v.date('closesOn', b.closesOn, 'Closing date', { min: today, minMsg: 'Closing date cannot be in the past' });
    v.throwIfAny();
    const year = Number(b.year), month = Number(b.month);
    const cur = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7));
    const asked = year * 12 + month;
    if (asked > cur) throw Object.assign(new AppError('A KPI cycle cannot be opened for a future month', 400), { fields: { month: 'A KPI cycle cannot be opened for a future month' } });
    if (asked < cur - 12) throw Object.assign(new AppError('A KPI cycle can only be opened for the last 12 months', 400), { fields: { month: 'A KPI cycle can only be opened for the last 12 months' } });
    const ins = await query(
      `INSERT INTO pms_cycles (organisation_id, year, month, closes_on, opened_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organisation_id, year, month) DO NOTHING RETURNING id`,
      [req.orgId, year, month, b.closesOn || null, req.user.id]);
    if (!ins.rowCount) throw Object.assign(new AppError(`The ${MONTH_NAMES[month - 1]} ${year} cycle is already open`, 409), { fields: { month: 'This cycle is already open' } });
    const emps = (await query(
      `SELECT e.id FROM employees e WHERE e.organisation_id=$1 AND ${activeEmployeeSql('e')}`, [req.orgId])).rows;
    for (const e of emps) {
      notifyEmployee(e.id, {
        type: 'PMS_CYCLE_OPEN', route: 'performance', title: 'KPI cycle open',
        body: `Submit your KPI for ${MONTH_NAMES[month - 1]} ${year}${b.closesOn ? ` by ${b.closesOn}` : ''}.`,
      });
    }
    await audit(req.user.id, 'PMS_CYCLE_STARTED', 'pms_cycles', ins.rows[0].id, { year, month });
    res.status(201).json({ ok: true, id: ins.rows[0].id, notified: emps.length });
  } catch (e) { next(e); }
}

// ── v2 employee: allowed months, withdraw ────────────────────────────────────

// GET /kpi/allowed-months
export async function kpiAllowedMonths(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json({ months: [], hasManager: false });
    const months = await allowedMonths(await orgOfEmployee(empId));
    res.json({ months, hasManager: await hasActiveManager(empId) });
  } catch (e) { next(e); }
}

// DELETE /kpi/:id — the employee withdraws a KPI still awaiting approval (E30).
export async function withdrawKpi(req, res, next) {
  try {
    const id = Number(req.params.id);
    const k = (await query(`SELECT * FROM kpis WHERE id=$1`, [id])).rows[0];
    if (!k || Number(k.employee_id) !== Number(req.user.employeeId)) return res.status(404).json({ error: 'KPI not found' });
    if (!['RM_PENDING', 'DISCUSS'].includes(k.status)) return res.status(409).json({ error: 'Only a KPI awaiting approval can be withdrawn' });
    await query(`DELETE FROM kpis WHERE id=$1`, [id]);
    await audit(req.user.id, 'KPI_WITHDRAWN', 'kpi', id, { year: k.year, month: k.month });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
