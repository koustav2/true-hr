import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

const VALID = ['PENDING', 'ONGOING', 'CLOSED'];

async function isMyReport(managerId, employeeId) {
  return (await query(
    `SELECT 1 FROM employees
      WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
}

function shape(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    assignedTo: r.assigned_to,
    assignedToName: `${r.a_first || ''} ${r.a_last || ''}`.trim() || null,
    assignedToCode: r.a_code || null,
    assignedByName: `${r.b_first || ''} ${r.b_last || ''}`.trim() || null,
    dueDate: r.due_date,
    aroundTime: r.around_time,
    status: r.status,
    remark: r.remark,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const COLS = `t.id, t.title, t.description, t.assigned_to, t.due_date, t.around_time, t.status, t.remark,
  t.created_at, t.updated_at,
  a.first_name AS a_first, a.last_name AS a_last, a.employee_code AS a_code,
  b.first_name AS b_first, b.last_name AS b_last`;

// ── Employee ──────────────────────────────────────────────────────────────────

// GET /tasks?status=&from=&to=  — my assigned tasks
export async function mine(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const args = [empId];
    let where = 't.assigned_to=$1';
    const status = (req.query.status || '').toUpperCase();
    if (VALID.includes(status)) { args.push(status); where += ` AND t.status=$${args.length}`; }
    if (req.query.from) { args.push(req.query.from); where += ` AND t.created_at >= $${args.length}::date`; }
    if (req.query.to) { args.push(req.query.to); where += ` AND t.created_at < ($${args.length}::date + 1)`; }
    const rows = (await query(
      `SELECT ${COLS} FROM tasks t
         JOIN employees a ON a.id=t.assigned_to
         LEFT JOIN employees b ON b.id=t.assigned_by
        WHERE ${where} ORDER BY t.created_at DESC`, args)).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /tasks/summary — counts for me
export async function summary(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json({ total: 0, pending: 0, ongoing: 0, closed: 0 });
    const r = (await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status='PENDING')::int AS pending,
         COUNT(*) FILTER (WHERE status='ONGOING')::int AS ongoing,
         COUNT(*) FILTER (WHERE status='CLOSED')::int AS closed
       FROM tasks WHERE assigned_to=$1`, [empId])).rows[0];
    res.json(r);
  } catch (e) { next(e); }
}

// POST /tasks/:id/status { status, remark } — employee updates own task
export async function updateStatus(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const id = parseInt(req.params.id, 10);
    const status = String(req.body.status || '').toUpperCase();
    if (!VALID.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const t = (await query(`SELECT assigned_to FROM tasks WHERE id=$1`, [id])).rows[0];
    if (!t || t.assigned_to !== empId) return res.status(404).json({ error: 'Task not found' });
    await query(`UPDATE tasks SET status=$1, remark=COALESCE($2, remark), updated_at=now() WHERE id=$3`,
      [status, req.body.remark || null, id]);
    await audit(req.user.id, 'TASK_STATUS', 'task', id, { status });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── Manager ───────────────────────────────────────────────────────────────────

// POST /tasks { assignedTo, title, description, dueDate, aroundTime }
export async function create(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.status(403).json({ error: 'No employee linked to this account' });
    const { assignedTo, title, description, dueDate, aroundTime } = req.body || {};
    if (!assignedTo || !title) return res.status(400).json({ error: 'assignedTo and title are required' });
    if (Number(assignedTo) !== managerId && !(await isMyReport(managerId, Number(assignedTo)))) {
      return res.status(403).json({ error: 'You can only assign tasks to your team members' });
    }
    const row = (await query(
      `INSERT INTO tasks (title, description, assigned_to, assigned_by, due_date, around_time)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [title, description || null, assignedTo, managerId, dueDate || null, aroundTime || null])).rows[0];
    await audit(req.user.id, 'TASK_CREATE', 'task', row.id, { assignedTo });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// GET /tasks/team?memberId=&status=&from=&to=  — tasks I assigned (Team Pending Task)
export async function team(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.json([]);
    const args = [managerId];
    let where = 't.assigned_by=$1';
    if (req.query.memberId) { args.push(req.query.memberId); where += ` AND t.assigned_to=$${args.length}`; }
    const status = (req.query.status || '').toUpperCase();
    if (VALID.includes(status)) { args.push(status); where += ` AND t.status=$${args.length}`; }
    if (req.query.from) { args.push(req.query.from); where += ` AND t.created_at >= $${args.length}::date`; }
    if (req.query.to) { args.push(req.query.to); where += ` AND t.created_at < ($${args.length}::date + 1)`; }
    const rows = (await query(
      `SELECT ${COLS} FROM tasks t
         JOIN employees a ON a.id=t.assigned_to
         LEFT JOIN employees b ON b.id=t.assigned_by
        WHERE ${where} ORDER BY t.created_at DESC`, args)).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /tasks/team/summary?from=&to=  — per-employee counts (Team Task)
export async function teamSummary(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.json([]);
    const args = [managerId];
    let extra = '';
    if (req.query.from) { args.push(req.query.from); extra += ` AND t.created_at >= $${args.length}::date`; }
    if (req.query.to) { args.push(req.query.to); extra += ` AND t.created_at < ($${args.length}::date + 1)`; }
    const rows = (await query(
      `SELECT a.id AS employee_id, a.employee_code, a.first_name, a.last_name,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE t.status='CLOSED')::int AS closed,
              COUNT(*) FILTER (WHERE t.status='PENDING')::int AS pending,
              COUNT(*) FILTER (WHERE t.status='ONGOING')::int AS ongoing
         FROM tasks t JOIN employees a ON a.id=t.assigned_to
        WHERE t.assigned_by=$1${extra}
        GROUP BY a.id, a.employee_code, a.first_name, a.last_name
        ORDER BY a.first_name`, args)).rows;
    res.json(rows.map((r) => ({
      employeeId: r.employee_id, employeeCode: r.employee_code,
      name: `${r.first_name} ${r.last_name}`.trim(),
      total: r.total, closed: r.closed, pending: r.pending, ongoing: r.ongoing,
    })));
  } catch (e) { next(e); }
}
