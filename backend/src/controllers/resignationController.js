import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import * as engine from '../services/approvalEngine.js';
import { invalidateAccountStatus } from '../middleware/auth.js';
import { notifyEmployee, notifyManagersOf, employeeName } from '../services/notify.js';
import { scopedByEmployee } from '../utils/scope.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST } from '../utils/validate.js';
import { checkUpload, sendAttachment, DOC_KINDS } from '../utils/uploads.js';
import { isoDate } from '../utils/joining.js';
import { outstandingAdvance } from '../services/exitWorker.js';

// v2 resignation policy (E51, H84, H87). The employee may back-date the
// resignation by a few days (a letter handed in over a weekend), never more,
// and never to before they joined. The last working day must not precede the
// resignation date; a last day earlier than the notice period allows is
// accepted but the shortfall is recorded for recovery in the Full & Final.
const BACKDATE_DAYS = Number(process.env.RESIGNATION_BACKDATE_DAYS || 3);
const MAX_FORWARD_DAYS = 30;     // resignation date at most this far ahead
const MAX_LWD_DAYS = 180;        // last working day at most this long after it
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const dmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '');

const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];

async function isMyReport(managerId, employeeId) {
  return (await query(
    `SELECT 1 FROM employees
      WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
}

function shape(r) {
  return {
    id: r.id,
    employeeCode: r.employee_code,
    name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    designation: r.designation,
    department: r.department,
    location: r.location,
    resignationDate: r.resignation_date,
    lastWorkingDate: r.last_working_date,
    noticePeriodDays: r.notice_period_days,
    reason: r.reason,
    status: r.status,
    reviewNote: r.review_note,
    appliedAt: r.applied_at,
    reviewedAt: r.reviewed_at,
    noticeShortfallDays: r.notice_shortfall_days ?? 0,
    hasLetter: !!r.has_letter,
    exitedAt: r.exited_at || null,
  };
}

const REQ_COLS = `r.id, r.resignation_date, r.last_working_date, r.notice_period_days, r.reason,
  r.status, r.review_note, r.applied_at, r.reviewed_at, r.notice_shortfall_days, r.exited_at,
  (r.letter IS NOT NULL) AS has_letter, r.employee_id,
  e.employee_code, e.first_name, e.last_name, e.location,
  d.title AS designation, dep.name AS department`;

// GreenHR-style stage labels for the resignation chain.
const STAGE_LABELS = {
  REPORTING_MANAGER: 'Reporting Manager', FUNCTIONAL_HEAD: 'Functional Manager',
  BUSINESS_HEAD: 'Business Head', OFFICE_ADMIN: 'Office Admin',
  FINANCE: 'Finance', HR: 'Human Resource',
};
const stageLabel = (k) => STAGE_LABELS[k] || String(k).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/**
 * Who would approve a resignation raised now, resolved exactly as the engine
 * will (approvalEngine.previewChain): the employee's own organisation only,
 * never another tenant's approver matrix (C50/E52 — the old preview read
 * approver_matrix with no organisation filter and showed TRUE HR's approvers
 * to another company's employee).
 */
async function previewApprovers(empId, { noSelf = false } = {}) {
  // noSelf (v2): an employee can never approve their own resignation.
  const chain = await engine.previewChain('RESIGNATION', empId, {}, { noSelf });
  return chain.map((s) => ({
    stage: stageLabel(s.roleKey), roleKey: s.roleKey, seq: s.seq, status: null,
    employeeCode: s.approver?.employeeCode || null,
    name: s.approver?.name || null,
    email: s.approver?.email || null,
    // Not assigned: an optional stage is skipped; a required one blocks (v2).
    assignment: s.approver ? 'ASSIGNED' : (s.willBypass ? 'SKIPPED' : 'MISSING'),
  }));
}

// GET /resignation/context — details for the form + approver chain + current resignation
export async function context(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const e = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name, e.location, e.notice_period_days,
              e.date_of_joining, e.official_email,
              e.reporting_manager_id, e.function_manager_id, e.operational_manager_id,
              d.title AS designation, dep.name AS department, c.name AS company,
              br.name AS branch,
              NULLIF(trim(coalesce(rm.first_name,'') || ' ' || coalesce(rm.last_name,'')), '') AS rm_name,
              rm.employee_code AS rm_code
         FROM employees e
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
         LEFT JOIN companies c ON c.id=e.company_id
         LEFT JOIN org_masters br ON br.id=e.branch_id
         LEFT JOIN employees rm ON rm.id=e.reporting_manager_id
                               AND rm.organisation_id IS NOT DISTINCT FROM e.organisation_id
        WHERE e.id=$1`, [empId])).rows[0];
    if (!e) return res.status(404).json({ error: 'Employee not found' });

    const current = (await query(
      `SELECT ${REQ_COLS}, r.approval_instance_id FROM resignations r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
        WHERE r.employee_id=$1 AND r.status<>'WITHDRAWN'
        ORDER BY r.applied_at DESC LIMIT 1`, [empId])).rows[0];

    let approvers = [];
    if (current?.approval_instance_id) {
      // Running / finished chain — real per-stage status.
      const inst = await engine.getInstance(current.approval_instance_id);
      approvers = (inst?.chain || []).map((s) => ({
        stage: stageLabel(s.roleKey), roleKey: s.roleKey, seq: s.seq, status: s.status,
        employeeCode: s.approver?.employeeCode || null,
        name: s.approver?.name || null, email: s.approver?.email || null,
      }));
    } else {
      approvers = await previewApprovers(empId, { noSelf: isV2(req) });
    }
    const missing = approvers.filter((a) => a.assignment === 'MISSING').map((a) => a.stage);
    const doj = isoDate(e.date_of_joining);
    const today = todayIST();
    const np = e.notice_period_days ?? 30;

    res.json({
      employee: {
        employeeCode: e.employee_code,
        name: `${e.first_name} ${e.last_name}`.trim(),
        designation: e.designation,
        // "Vertical" is the company (legal entity) the employee works for;
        // falls back to the department where no company name is set.
        vertical: e.company || e.department,
        department: e.department,
        location: e.branch || e.location,
        dateOfJoining: doj,
        reportingManager: e.rm_name ? `${e.rm_code ? `${e.rm_code} - ` : ''}${e.rm_name}` : null,
        officialEmail: e.official_email,
        noticePeriodDays: np,
      },
      approvers,
      // What the v2 form needs to validate before submitting (E50, E51).
      canSubmit: !missing.length,
      missingStages: missing,
      policy: {
        today,
        minResignationDate: [addDays(today, -BACKDATE_DAYS), doj].filter(Boolean).sort().pop(),
        maxResignationDate: addDays(today, MAX_FORWARD_DAYS),
        suggestedLastWorkingDate: addDays(today, np),
        noticePeriodDays: np,
      },
      current: current ? shape(current) : null,
    });
  } catch (e) { next(e); }
}

// v2 validation of a resignation (E51, H84, H87, E50). Returns the values to
// store; throws 400 with every field error at once.
async function validateV2(empId, b) {
  const emp = (await query(
    `SELECT date_of_joining, notice_period_days, onboarding_status FROM employees WHERE id=$1`, [empId])).rows[0];
  const today = todayIST();
  const doj = isoDate(emp?.date_of_joining);
  const np = emp?.notice_period_days ?? 30;
  const resignationDate = String(b.resignationDate || '').trim() || today;
  const lwd = String(b.lastWorkingDate || '').trim();
  const v = validator();
  const minRes = addDays(today, -BACKDATE_DAYS);
  v.date('resignationDate', resignationDate, 'Resignation date', {
    required: true, min: minRes, max: addDays(today, MAX_FORWARD_DAYS),
    minMsg: BACKDATE_DAYS
      ? `Resignation date cannot be more than ${BACKDATE_DAYS} days in the past`
      : 'Resignation date cannot be in the past',
    maxMsg: `Resignation date cannot be more than ${MAX_FORWARD_DAYS} days ahead`,
  });
  if (!v.has('resignationDate') && doj && resignationDate < doj) {
    v.add('resignationDate', `Resignation date cannot be before your date of joining (${dmy(doj)})`);
  }
  v.date('lastWorkingDate', lwd, 'Last working date', {
    required: true,
    min: v.has('resignationDate') ? undefined : resignationDate,
    max: v.has('resignationDate') ? undefined : addDays(resignationDate, MAX_LWD_DAYS),
    minMsg: 'Last working date cannot be before the resignation date',
    maxMsg: `Last working date cannot be more than ${MAX_LWD_DAYS} days after the resignation date`,
  });
  v.text('reason', b.reason, 'Reason', { required: true, min: 5, max: 1000 });
  let letter = null;
  try {
    letter = checkUpload({ data: b.letter, mime: b.letterMime, name: b.letterName, label: 'resignation letter', maxMb: 5, kinds: DOC_KINDS });
  } catch (err) { v.add('letter', err.publicMessage || err.message); }
  v.throwIfAny();
  const served = daysBetween(resignationDate, lwd);
  return { resignationDate, lwd, np, letter, shortfall: Math.max(0, np - served) };
}

// POST /resignation { resignationDate, lastWorkingDate, reason, letter?, letterMime?, letterName? }
export async function apply(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const v2 = isV2(req);
    const { resignationDate, lastWorkingDate, reason } = req.body || {};
    let vals;
    if (v2) {
      vals = await validateV2(empId, req.body || {});
    } else {
      if (!resignationDate || !lastWorkingDate) return res.status(400).json({ error: 'Resignation date and last working date are required' });
      if (new Date(lastWorkingDate) < new Date(resignationDate)) return res.status(400).json({ error: 'Last working date cannot be before the resignation date' });
    }

    const active = (await query(
      `SELECT 1 FROM resignations WHERE employee_id=$1 AND status IN ('PENDING','APPROVED') LIMIT 1`, [empId])).rowCount > 0;
    if (active) return res.status(409).json({ error: 'You already have a resignation in progress' });

    if (v2) {
      // E50: every required level of the chain must have a person before the
      // employee can resign, otherwise the request would sit at an empty stage.
      // Optional stages without an approver are skipped, as the Approvers page says.
      const preview = await previewApprovers(empId, { noSelf: true });
      const missing = preview.filter((a) => a.assignment === 'MISSING').map((a) => a.stage);
      if (missing.length) {
        return res.status(409).json({
          error: `Your resignation cannot be submitted yet: no ${missing.join(', ')} approver is set up for you. Please ask HR to assign one.`,
          missingStages: missing,
        });
      }
    }

    const np = v2 ? vals.np
      : (await query(`SELECT notice_period_days FROM employees WHERE id=$1`, [empId])).rows[0]?.notice_period_days || 30;
    const row = (await query(
      `INSERT INTO resignations (employee_id, resignation_date, last_working_date, reason, notice_period_days,
                                 notice_shortfall_days, letter, letter_mime, letter_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      v2
        ? [empId, vals.resignationDate, vals.lwd, String(reason).trim(), np, vals.shortfall,
          vals.letter?.data || null, vals.letter?.mime || null, vals.letter?.name || null]
        : [empId, resignationDate, lastWorkingDate, reason || null, np, 0, null, null, null])).rows[0];
    // Phase 6: run the 6-stage RESIGNATION flow (RM → Functional Head → IT Infra
    // → Office Admin → Finance → HR); unstaffed named stages auto-bypass.
    try {
      const inst = await engine.createInstance('RESIGNATION', 'resignation', row.id, empId, {}, req.user.id, { noSelf: v2 });
      await query(`UPDATE resignations SET approval_instance_id=$2 WHERE id=$1`, [row.id, inst.id]);
    } catch (err) {
      console.warn('[resignation] approval chain not created:', err.message);
    }
    await audit(req.user.id, 'RESIGNATION_APPLY', 'resignation', row.id, v2 ? { shortfallDays: vals.shortfall } : {});
    const lwdShown = v2 ? vals.lwd : lastWorkingDate;
    if (!v2) {
      // v1 (Android) policy: applying a resignation blocks the account from the
      // whole system immediately. Only HR/admin can re-enable it (Users & roles),
      // and a rejection/withdrawal re-enables it automatically.
      await query(`UPDATE user_accounts SET status='DISABLED' WHERE employee_id=$1`, [empId]);
      invalidateAccountStatus(req.user.id);
      await audit(req.user.id, 'ACCOUNT_BLOCKED_ON_RESIGNATION', 'user_account', req.user.id, { resignationId: row.id });
    }
    // v2 (decision D2): access continues through the notice period; the exit
    // worker disables the login after the approved last working day.
    notifyManagersOf(empId, {
      type: 'RESIGNATION_APPLIED', route: 'team_resignation',
      title: 'Resignation submitted',
      body: `${await employeeName(empId)} has submitted their resignation (last working day ${lwdShown}).`,
    });
    if (v2) {
      return res.status(201).json({
        ok: true, id: row.id, accountBlocked: false,
        noticeShortfallDays: vals.shortfall, lastWorkingDate: vals.lwd,
      });
    }
    res.status(201).json({ ok: true, id: row.id, accountBlocked: true });
  } catch (e) { next(e); }
}

// GET /resignation/:id/letter — the uploaded letter (employee, chain approver, HR).
export async function letter(req, res, next) {
  try {
    const r = await scopedByEmployee(req, 'resignations', req.params.id,
      { cols: 't.employee_id, t.letter, t.letter_mime, t.letter_name, t.approval_instance_id' });
    if (!r || !r.letter) return res.status(404).json({ error: 'No letter attached' });
    const me = req.user.employeeId;
    let allowed = STAFF.includes(req.user.role) || Number(r.employee_id) === Number(me);
    if (!allowed && r.approval_instance_id && me) {
      allowed = (await query(
        `SELECT 1 FROM approval_instance_stages WHERE instance_id=$1 AND approver_employee_id=$2`,
        [r.approval_instance_id, me])).rowCount > 0;
    }
    if (!allowed) return res.status(404).json({ error: 'No letter attached' });
    sendAttachment(res, { data: r.letter, mime: r.letter_mime, name: r.letter_name, fallbackName: 'resignation-letter' });
  } catch (e) { next(e); }
}

// Re-activate the account when a resignation dies (rejected / withdrawn).
async function reenableAccount(employeeId, actorUserId, reason) {
  // Only undo a resignation block: never re-open an account a live
  // termination closed. (A v2 resignation never blocked it in the first place,
  // so this is then a no-op.)
  const acc = (await query(
    `UPDATE user_accounts SET status='ACTIVE'
      WHERE employee_id=$1 AND status='DISABLED'
        AND NOT EXISTS (SELECT 1 FROM terminations t WHERE t.employee_id=$1 AND t.status='ACTIVE')
      RETURNING id`, [employeeId])).rows[0];
  if (!acc) return;
  if (acc) invalidateAccountStatus(acc.id);
  await audit(actorUserId, 'ACCOUNT_REENABLED', 'user_account', acc?.id || null, { employeeId, reason });
}

// GET /resignation/:id/chain — the 6-stage approval trail.
export async function chain(req, res, next) {
  try {
    // resignations carry no organisation_id — the tenant comes from the
    // employee. `STAFF.includes(req.user.role)` below only asked "an HR admin
    // somewhere", so any tenant's HR admin could read any tenant's resignation
    // chain (names, emails, dates, remarks).
    const r = await scopedByEmployee(req, 'resignations', req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    if (!r.approval_instance_id) return res.json(null); // legacy row
    const inst = await engine.getInstance(r.approval_instance_id);
    const me = req.user.employeeId;
    const inChain = inst.chain.some((s) => s.approver?.id === me);
    if (Number(r.employee_id) !== Number(me) && !inChain && !STAFF.includes(req.user.role))
      return res.status(403).json({ error: 'Forbidden' });
    res.json(inst);
  } catch (e) { next(e); }
}

// POST /resignation/:id/act { action, remarks } — current-stage approver (or HR override).
// When the chain completes, the resignation is APPROVED; a rejection anywhere rejects it.
export async function actOn(req, res, next) {
  try {
    const id = Number(req.params.id);
    // Scoped through employees: unscoped, the isStaff override let any tenant's
    // HR admin approve or reject another tenant's resignation — and a rejection
    // re-enables that person's account.
    const r = await scopedByEmployee(req, 'resignations', id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    if (!r.approval_instance_id) return res.status(409).json({ error: 'Legacy resignation — use the review endpoint' });
    if (r.status !== 'PENDING') return res.status(409).json({ error: `Resignation is ${r.status}` });
    const { action, remarks } = req.body || {};
    const inst = await engine.act(r.approval_instance_id, req.user.employeeId, action, remarks, {
      isStaff: STAFF.includes(req.user.role), actorUserId: req.user.id, orgId: req.orgId,
    });
    if (inst.status === 'APPROVED') {
      await query(`UPDATE resignations SET status='APPROVED', reviewed_at=now(), review_note=$2 WHERE id=$1`, [id, remarks || null]);
      notifyEmployee(r.employee_id, {
        type: 'RESIGNATION_APPROVED', route: 'resignation',
        title: 'Resignation approved',
        body: 'Your resignation has been approved by all authorities in the approval chain.',
      });
    } else if (inst.status === 'REJECTED') {
      await query(`UPDATE resignations SET status='REJECTED', reviewed_at=now(), review_note=$2 WHERE id=$1`, [id, remarks || inst.statusLabel]);
      await reenableAccount(r.employee_id, req.user.id, 'resignation rejected');
      notifyEmployee(r.employee_id, {
        type: 'RESIGNATION_REJECTED', route: 'resignation',
        title: 'Resignation rejected',
        body: `Your resignation was rejected${remarks ? ` — "${remarks}"` : ''}. Your account has been re-activated.`,
      });
    }
    await audit(req.user.id, `RESIGNATION_${action}`, 'resignation', id, { stage: inst.currentStageSeq });
    res.json({ status: inst.status === 'PENDING' ? 'PENDING' : inst.status, approval: inst });
  } catch (e) { next(e); }
}

// GET /resignation — own history
export async function listOwn(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const rows = (await query(
      `SELECT ${REQ_COLS} FROM resignations r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
        WHERE r.employee_id=$1 ORDER BY r.applied_at DESC`, [empId])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /resignation/:id/withdraw — employee withdraws own request before the
// final approval. The approval chain is cancelled too, so it leaves every
// approver's inbox (both versions — a withdrawn request must not stay actionable).
export async function withdraw(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const row = (await query(
      `SELECT employee_id, status, approval_instance_id FROM resignations WHERE id=$1`, [req.params.id])).rows[0];
    if (!row || Number(row.employee_id) !== Number(empId)) return res.status(404).json({ error: 'Resignation not found' });
    if (row.status !== 'PENDING') {
      return res.status(409).json({ error: row.status === 'APPROVED'
        ? 'Your resignation has already been approved, so it can no longer be withdrawn. Please contact HR.'
        : 'Only a pending resignation can be withdrawn' });
    }
    const upd = await query(
      `UPDATE resignations SET status='WITHDRAWN', reviewed_at=now() WHERE id=$1 AND status='PENDING'`, [req.params.id]);
    if (!upd.rowCount) return res.status(409).json({ error: 'Only a pending resignation can be withdrawn' });
    if (row.approval_instance_id) {
      await engine.cancel(row.approval_instance_id, {
        actorEmployeeId: empId, actorUserId: req.user.id, remarks: 'Resignation withdrawn by the employee',
      }).catch((err) => console.warn('[resignation] chain not cancelled:', err.message));
    }
    await audit(req.user.id, 'RESIGNATION_WITHDRAW', 'resignation', req.params.id, {});
    await reenableAccount(empId, req.user.id, 'resignation withdrawn');
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /resignation/team?status=
export async function team(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${REQ_COLS} FROM resignations r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
        WHERE (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
          AND r.status=$2 ORDER BY r.applied_at DESC`, [empId, status])).rows;

    // Chain approvers beyond the managers (Business Head / Admin / Finance / HR
    // via the matrix) must also see requests whose CURRENT stage waits on them —
    // otherwise the chain stalls after the managers approve (client bug report).
    if (status === 'PENDING') {
      const chainRows = (await query(
        `SELECT ${REQ_COLS} FROM resignations r
           JOIN approval_instances i ON i.id=r.approval_instance_id AND i.status='PENDING'
           JOIN approval_instance_stages st ON st.instance_id=i.id
                AND st.seq=i.current_stage_seq AND st.status='PENDING' AND st.approver_employee_id=$1
           JOIN employees e ON e.id=r.employee_id
           LEFT JOIN designations d ON d.id=e.designation_id
           LEFT JOIN departments dep ON dep.id=e.department_id
          WHERE r.status='PENDING' ORDER BY r.applied_at DESC`, [empId])).rows;
      const seen = new Set(rows.map((x) => x.id));
      for (const cr of chainRows) if (!seen.has(cr.id)) rows.push(cr);
    }
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /resignation/:id/review { decision, note }
export async function review(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.status(403).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const decision = String(req.body.decision || '').toUpperCase();
    const note = req.body.note || null;
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });

    const r = (await query(`SELECT employee_id, status FROM resignations WHERE id=$1`, [id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Resignation not found' });
    if (!(await isMyReport(managerId, r.employee_id))) return res.status(403).json({ error: 'This request is not from your team' });
    if (r.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been reviewed' });

    await query(`UPDATE resignations SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now() WHERE id=$4`,
      [decision, managerId, note, id]);
    await audit(req.user.id, `RESIGNATION_${decision}`, 'resignation', id, { note });
    if (decision === 'REJECTED') await reenableAccount(r.employee_id, req.user.id, 'resignation rejected');
    notifyEmployee(r.employee_id, {
      type: `RESIGNATION_${decision}`, route: 'resignation',
      title: `Resignation ${decision.toLowerCase()}`,
      body: `Your resignation was ${decision.toLowerCase()} by ${await employeeName(managerId)}${note ? ` — "${note}"` : '.'}`,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── HR admin ──
// GET /admin/resignations?status=
export async function adminList(req, res, next) {
  try {
    const status = (req.query.status || '').toUpperCase();
    const params = [req.orgId || null];
    let where = '($1::bigint IS NULL OR e.organisation_id=$1)';
    if (status) { params.push(status); where += ` AND r.status=$${params.length}`; }
    const rows = (await query(
      `SELECT ${REQ_COLS} FROM resignations r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
        WHERE ${where} ORDER BY r.applied_at DESC`, params)).rows;
    // H109: an open NFA advance is shown against the exit so HR recovers it in
    // the Full & Final instead of letting it lapse. Added fields only.
    const out = [];
    for (const r of rows) {
      const x = shape(r);
      if (['PENDING', 'APPROVED'].includes(r.status)) {
        const adv = await outstandingAdvance(r.employee_id);
        x.openAdvance = adv.amount; x.openAdvanceNfas = adv.codes;
      }
      out.push(x);
    }
    res.json(out);
  } catch (e) { next(e); }
}

// HR decided outside the chain: close the chain the same way, so the request
// leaves every approver's inbox and the trail says who decided (data fix,
// both versions — before, the resignation said APPROVED while its chain still
// sat PENDING with an approver).
async function closeChainByHr(resignationId, decision, note, actorUserId) {
  const r = (await query(`SELECT approval_instance_id FROM resignations WHERE id=$1`, [resignationId])).rows[0];
  const instId = r?.approval_instance_id;
  if (!instId) return;
  const inst = (await query(
    `UPDATE approval_instances SET status=$2, completed_at=now(),
            rejected_by_role = CASE WHEN $2='REJECTED' THEN 'HR' ELSE rejected_by_role END,
            rejected_by_name = CASE WHEN $2='REJECTED' THEN 'HR' ELSE rejected_by_name END
      WHERE id=$1 AND status IN ('PENDING','QUERY') RETURNING current_stage_seq`, [instId, decision])).rows[0];
  if (!inst) return;
  const who = (await query(`SELECT email FROM user_accounts WHERE id=$1`, [actorUserId])).rows[0]?.email || 'HR';
  const remark = `${decision === 'APPROVED' ? 'Approved' : 'Rejected'} by HR (${who})${note ? `: ${note}` : ''}`;
  await query(
    `UPDATE approval_instance_stages SET status=$2, remarks=$3, acted_at=now()
      WHERE instance_id=$1 AND status IN ('PENDING','WAITING','QUERY')`,
    [instId, decision === 'APPROVED' ? 'BYPASSED' : 'REJECTED', remark]);
  await query(
    `INSERT INTO approval_actions (instance_id, stage_seq, actor_employee_id, action, remarks)
     VALUES ($1,$2,NULL,$3,$4)`, [instId, inst.current_stage_seq, decision, remark]);
}

// POST /admin/resignations/:id/review { decision, note }  (HR can act on any)
export async function adminReview(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const decision = String(req.body.decision || '').toUpperCase();
    const note = req.body.note || null;
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
    // HR may act on any resignation — but only in their own organisation.
    // Unscoped, any tenant's HR admin could approve or reject another tenant's
    // resignation and, on a rejection, re-enable that person's account.
    const r = await scopedByEmployee(req, 'resignations', id, { cols: 't.employee_id, t.status' });
    if (!r) return res.status(404).json({ error: 'Resignation not found' });
    if (r.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been reviewed' });
    if (isV2(req) && decision === 'REJECTED') {
      // v2: the employee sees why (reason is mandatory on a rejection).
      const v = validator(); v.text('note', note, 'Reason for rejection', { required: true, min: 5, max: 1000 }); v.throwIfAny();
    }
    await query(`UPDATE resignations SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now() WHERE id=$4`,
      [decision, req.user.employeeId || null, note, id]);
    await closeChainByHr(id, decision, note, req.user.id);
    await audit(req.user.id, `RESIGNATION_${decision}`, 'resignation', id, { note, byHr: true });
    if (decision === 'REJECTED') await reenableAccount(r.employee_id, req.user.id, 'resignation rejected');
    notifyEmployee(r.employee_id, {
      type: `RESIGNATION_${decision}`, route: 'resignation',
      title: `Resignation ${decision.toLowerCase()}`,
      body: `Your resignation was ${decision.toLowerCase()} by HR${note ? ` — "${note}"` : '.'}`,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
