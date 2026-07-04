// PMS / KPI module (Phase 5). Monthly KPI → RM approval → PMS self-assessment →
// 4-level rating chain on the generic engine (flow 'PMS_RATING') → final grade.
import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import * as engine from '../services/approvalEngine.js';

const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];
const isStaff = (u) => STAFF.includes(u.role);
const num = (v) => (v == null || v === '' ? null : Number(v));

async function isManagerOf(managerId, employeeId) {
  return (await query(
    `SELECT 1 FROM employees WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
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
        selfRating: s.self_rating, selfRemarks: s.self_remarks, mgrRating: s.mgr_rating, mgrRemarks: s.mgr_remarks,
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
    kras: kras.map((x) => ({ id: x.id, seq: x.seq, description: x.description, weightage: Number(x.weightage), measurementBands: x.measurement_bands })),
    pms: submission,
  };
}

function validateKras(kras) {
  if (!Array.isArray(kras) || !kras.length) return 'At least one KRA is required';
  const sum = kras.reduce((a, k) => a + Number(k.weightage || 0), 0);
  if (Math.round(sum * 100) / 100 !== 100) return `KRA weightages must sum to 100 (got ${sum})`;
  if (kras.some((k) => !k.description || !String(k.description).trim())) return 'Every KRA needs a description';
  return null;
}

// POST /kpi { year, month, copyPrevious?, kras:[{description, weightage, measurementBands?}] }
export async function createKpi(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee linked to this account' });
    const b = req.body || {};
    const year = Number(b.year), month = Number(b.month);
    if (!year || !(month >= 1 && month <= 12)) return res.status(400).json({ error: 'year and month (1–12) required' });

    let kras = b.kras;
    if (b.copyPrevious) {
      const prev = (await query(
        `SELECT id FROM kpis WHERE employee_id=$1 AND (year, month) < ($2, $3) ORDER BY year DESC, month DESC LIMIT 1`,
        [empId, year, month])).rows[0];
      if (!prev) return res.status(404).json({ error: 'No previous KPI to copy' });
      kras = (await query(`SELECT description, weightage, measurement_bands FROM kpi_kras WHERE kpi_id=$1 ORDER BY seq`, [prev.id])).rows
        .map((x) => ({ description: x.description, weightage: Number(x.weightage), measurementBands: x.measurement_bands }));
    }
    const err = validateKras(kras);
    if (err) return res.status(400).json({ error: err });

    const kpi = await tx(async (c) => {
      const k = (await c.query(
        `INSERT INTO kpis (employee_id, year, month) VALUES ($1,$2,$3) RETURNING *`, [empId, year, month])).rows[0];
      for (const [i, x] of kras.entries()) {
        await c.query(
          `INSERT INTO kpi_kras (kpi_id, seq, description, weightage, measurement_bands) VALUES ($1,$2,$3,$4,$5)`,
          [k.id, i + 1, String(x.description).trim(), Number(x.weightage), JSON.stringify(x.measurementBands || [
            { min: 90, max: 104, rating: 3 }, { min: 105, max: 119, rating: 4 }, { min: 120, max: null, rating: 5 }])]);
      }
      return k;
    });
    await audit(req.user.sub, 'KPI_CREATED', 'kpi', kpi.id, { year, month });
    res.status(201).json(await kpiDetail(kpi.id));
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
    const err = validateKras(kras);
    if (err) return res.status(400).json({ error: err });
    await tx(async (c) => {
      await c.query(`DELETE FROM kpi_kras WHERE kpi_id=$1`, [id]);
      for (const [i, x] of kras.entries()) {
        await c.query(
          `INSERT INTO kpi_kras (kpi_id, seq, description, weightage, measurement_bands) VALUES ($1,$2,$3,$4,$5)`,
          [id, i + 1, String(x.description).trim(), Number(x.weightage), JSON.stringify(x.measurementBands || [
            { min: 90, max: 104, rating: 3 }, { min: 105, max: 119, rating: 4 }, { min: 120, max: null, rating: 5 }])]);
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
      `SELECT k.id, k.year, k.month, k.status AS kpi_status, k.submitted_at, k.approved_at,
              s.status AS pms_status, s.self_rating, s.final_grade, s.final_pli_pct
         FROM kpis k LEFT JOIN pms_submissions s ON s.kpi_id = k.id
        WHERE ${where} ORDER BY k.year DESC, k.month DESC`, params)).rows;
    res.json(rows.map((r) => ({
      id: r.id, year: r.year, month: r.month,
      kpiStatus: r.kpi_status, pmsStatus: r.pms_status || 'NOT_SUBMITTED',
      selfRating: r.self_rating, finalGrade: r.final_grade, finalPliPct: r.final_pli_pct,
      submittedAt: r.submitted_at, approvedAt: r.approved_at,
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
    res.json(rows.map((r) => ({
      id: r.id, year: r.year, month: r.month, status: r.status, submittedAt: r.submitted_at,
      employee: { id: r.emp_id, employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`.trim(), designation: r.designation },
    })));
  } catch (e) { next(e); }
}

// GET /kpi/:id — owner, their manager, or staff.
export async function detail(req, res, next) {
  try {
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
    const k = (await query(`SELECT * FROM kpis WHERE id=$1`, [id])).rows[0];
    if (!k) return res.status(404).json({ error: 'Not found' });
    if (k.status !== 'RM_PENDING') return res.status(409).json({ error: `KPI is ${k.status}` });
    const me = req.user.employeeId;
    if (!isStaff(req.user) && !(await isManagerOf(me, k.employee_id))) return res.status(403).json({ error: 'Not a manager of this employee' });
    const action = (req.body || {}).action;
    if (!['APPROVE', 'DISCUSS'].includes(action)) return res.status(400).json({ error: 'action must be APPROVE or DISCUSS' });
    await query(
      `UPDATE kpis SET status=$2, approved_by=$3, approved_at = CASE WHEN $2='LOCKED' THEN now() ELSE approved_at END WHERE id=$1`,
      [id, action === 'APPROVE' ? 'LOCKED' : 'DISCUSS', me]);
    await audit(req.user.sub, `KPI_${action}`, 'kpi', id, {});
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
    const kras = (await query(`SELECT id, weightage FROM kpi_kras WHERE kpi_id=$1`, [id])).rows;
    if (!Array.isArray(scores) || scores.length !== kras.length)
      return res.status(400).json({ error: `scores for all ${kras.length} KRAs required` });

    // Weighted self rating.
    const wByKra = Object.fromEntries(kras.map((x) => [x.id, Number(x.weightage)]));
    let selfRating = 0;
    for (const s of scores) {
      if (!wByKra[s.kraId]) return res.status(400).json({ error: `Unknown kraId ${s.kraId}` });
      if (num(s.selfRating) == null) return res.status(400).json({ error: 'selfRating required per KRA' });
      selfRating += Number(s.selfRating) * wByKra[s.kraId] / 100;
    }
    selfRating = Math.round(selfRating * 100) / 100;

    const sub = await tx(async (c) => {
      const s = (await c.query(
        `INSERT INTO pms_submissions (kpi_id, self_rating) VALUES ($1,$2) RETURNING *`, [id, selfRating])).rows[0];
      for (const x of scores) {
        await c.query(
          `INSERT INTO pms_kra_scores (submission_id, kra_id, mtd_target, mtd_achieved, self_rating, self_remarks)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [s.id, x.kraId, x.mtdTarget || null, x.mtdAchieved || null, num(x.selfRating), x.selfRemarks || null]);
      }
      return s;
    });
    const inst = await engine.createInstance('PMS_RATING', 'pms', sub.id, k.employee_id, {}, req.user.sub);
    await query(`UPDATE pms_submissions SET approval_instance_id=$2 WHERE id=$1`, [sub.id, inst.id]);
    await audit(req.user.sub, 'PMS_SUBMITTED', 'pms', sub.id, { kpiId: id, selfRating });
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
    if (!empId) return res.json([]);
    const items = (await engine.pendingFor(empId)).filter((x) => x.subjectType === 'pms');
    if (!items.length) return res.json([]);
    const ids = items.map((x) => x.subjectId);
    const rows = (await query(
      `SELECT s.id, s.self_rating, k.year, k.month, e.employee_code, e.first_name, e.last_name
         FROM pms_submissions s JOIN kpis k ON k.id=s.kpi_id JOIN employees e ON e.id=k.employee_id
        WHERE s.id = ANY($1::bigint[])`, [ids])).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    res.json(items.map((x) => {
      const r = byId[x.subjectId];
      return {
        submissionId: x.subjectId, stage: { seq: x.stageSeq, roleKey: x.roleKey },
        year: r?.year, month: r?.month, selfRating: r?.self_rating,
        employee: r ? { employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`.trim() } : null,
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
    const s = (await query(`SELECT * FROM pms_submissions WHERE id=$1`, [id])).rows[0];
    if (!s) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    if (num(b.pliPct) == null || num(b.pliRating) == null)
      return res.status(400).json({ error: 'pliRating and pliPct are required' });

    const before = await engine.getInstance(s.approval_instance_id);
    const stage = before.chain.find((x) => x.seq === before.currentStageSeq);
    const inst = await engine.act(s.approval_instance_id, req.user.employeeId, 'APPROVED', b.remarks, {
      isStaff: isStaff(req.user), actorUserId: req.user.sub,
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
      const grade = (await query(
        `SELECT code FROM pms_grades WHERE $1 >= min_pct AND (max_pct IS NULL OR $1 <= max_pct)`, [num(b.pliPct)])).rows[0];
      await query(
        `UPDATE pms_submissions SET status='FUNCTIONAL_APPROVED', final_grade=$2, final_pli_pct=$3 WHERE id=$1`,
        [id, grade?.code || null, num(b.pliPct)]);
    }
    await audit(req.user.sub, 'PMS_RATED', 'pms', id, { roleKey: stage.roleKey, pliPct: num(b.pliPct) });
    const kpiId = (await query(`SELECT kpi_id FROM pms_submissions WHERE id=$1`, [id])).rows[0].kpi_id;
    res.json(await kpiDetail(kpiId));
  } catch (e) { next(e); }
}

// GET /pms/grades — the published ladder.
export async function grades(req, res, next) {
  try {
    const rows = (await query(`SELECT * FROM pms_grades ORDER BY grade DESC`)).rows;
    res.json(rows.map((g) => ({ grade: g.grade, code: g.code, label: g.label, minPct: g.min_pct, maxPct: g.max_pct })));
  } catch (e) { next(e); }
}
