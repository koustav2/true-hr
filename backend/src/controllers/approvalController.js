// Approval-chain engine API (generic across NFA / settlement / resignation / PMS).
import * as engine from '../services/approvalEngine.js';

const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];

// GET /approvals/pending — everything waiting on the logged-in employee.
export async function pending(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    res.json(await engine.pendingFor(empId));
  } catch (e) { next(e); }
}

// GET /approvals/:id — chain + trail.
export async function detail(req, res, next) {
  try {
    const inst = await engine.getInstance(Number(req.params.id));
    if (!inst) return res.status(404).json({ error: 'Not found' });
    res.json(inst);
  } catch (e) { next(e); }
}

// POST /approvals/:id/act { action: APPROVED|REJECTED|QUERY_HOLD, remarks }
export async function actOn(req, res, next) {
  try {
    const { action, remarks } = req.body || {};
    const result = await engine.act(Number(req.params.id), req.user.employeeId, action, remarks, {
      isStaff: STAFF.includes(req.user.role),
      actorUserId: req.user.sub,
    });
    res.json(result);
  } catch (e) { next(e); }
}

// POST /approvals/:id/resubmit { remarks } — raiser answers a query.
export async function resubmit(req, res, next) {
  try {
    const result = await engine.resubmit(Number(req.params.id), req.user.employeeId, (req.body || {}).remarks, req.user.sub);
    res.json(result);
  } catch (e) { next(e); }
}

// GET /approvals/preview?flow=NFA&projectId=&expenseCategoryId=&zoneId= — read-only
// chain shown on create forms before submission.
export async function preview(req, res, next) {
  try {
    const { flow, projectId, expenseCategoryId, zoneId } = req.query;
    if (!flow) return res.status(400).json({ error: 'flow is required' });
    const chain = await engine.previewChain(String(flow), req.user.employeeId, {
      projectId: projectId ? Number(projectId) : null,
      expenseCategoryId: expenseCategoryId ? Number(expenseCategoryId) : null,
      zoneId: zoneId ? Number(zoneId) : null,
    });
    res.json(chain);
  } catch (e) { next(e); }
}
