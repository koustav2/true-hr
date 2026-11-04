import { AsyncLocalStorage } from 'async_hooks';
import { query } from '../db/pool.js';

// ============================================================================
// Audit trail.
//
// audit(actor, action, entity, entityId, metadata?, opts?) — signature kept
// backward compatible; every existing caller works unchanged.
//
// Each row now carries the organisation it belongs to (C43). The organisation
// is, in order of preference:
//   1. opts.orgId, when a caller passes it explicitly;
//   2. the organisation of the HTTP request being served (req.orgId), which is
//      the right answer for a Master working inside a tenant;
//   3. the actor's own organisation (the Master's active one);
//   4. for actor-less rows about an employee/onboarding, that employee's org.
//
// auditTrail() is mounted for every /api/v2 request (routes/v2/auth.js). It
// writes a generic "who changed what" row for any successful admin write that
// the handler did not already audit itself, so a create/update/delete is never
// silently missing from the log — whichever controller handled it.
// ============================================================================

const als = new AsyncLocalStorage();

export async function audit(actorUserId, action, entity, entityId, metadata = {}, opts = {}) {
  const store = als.getStore();
  if (store) store.audited = true;
  const reqOrg = store?.req?.orgId ?? null;
  const orgId = opts?.orgId ?? reqOrg ?? null;
  const id = Number.isFinite(Number(entityId)) && entityId !== null && entityId !== '' ? Number(entityId) : null;
  try {
    await query(
      `INSERT INTO audit_log (actor_user_id, action, entity, entity_id, metadata, organisation_id)
       VALUES ($1,$2,$3,$4,$5, COALESCE(
         $6::bigint,
         (SELECT CASE WHEN ua.is_platform_admin THEN COALESCE(ua.active_organisation_id, ua.organisation_id)
                      ELSE COALESCE(ua.organisation_id, e.organisation_id) END
            FROM user_accounts ua LEFT JOIN employees e ON e.id = ua.employee_id
           WHERE ua.id = $1),
         CASE WHEN $3 IN ('employee','employees') THEN (SELECT organisation_id FROM employees WHERE id = $4)
              WHEN $3 = 'onboarding' THEN (SELECT e.organisation_id FROM onboarding o JOIN employees e ON e.id = o.employee_id WHERE o.id = $4)
         END))`,
      [actorUserId || null, action, entity, id, metadata || {}, orgId]
    );
  } catch (e) {
    // The organisation column may not exist yet on a DB that has not run the
    // v2 migration — fall back to the original insert rather than lose the row.
    try {
      await query(
        `INSERT INTO audit_log (actor_user_id, action, entity, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)`,
        [actorUserId || null, action, entity, id, metadata || {}]);
    } catch (e2) { console.warn('[audit] failed', e2.message); }
  }
}

// ── Generic HTTP audit trail (v2) ───────────────────────────────────────────

const SENSITIVE = /pass|otp|token|secret|aadhaar|aadhar|\bpan\b|^pan|pan_|panNumber|account|ifsc|uan|esic|signature|image|photo|file|data|base64|document|pdf|html|logo|letterhead/i;
const VERBS = new Set(['approve', 'reject', 'publish', 'unpublish', 'publish-all', 'generate', 'generate-all',
  'regenerate', 'send-back', 'verify', 'lock', 'unlock', 'toggle', 'run', 'status', 'role', 'org-role',
  'reset-password', 'apply', 'revoke', 'finalise', 'finalize', 'cancel', 'close', 'reopen', 'assign', 'return',
  'import', 'upload', 'restore', 'withdraw', 'act', 'review', 'resend', 'switch', 'subscription', 'name']);

/** Summarise a request body for the log without leaking PII or blobs. */
export function summariseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Array.isArray(body) ? { items: body.length } : {};
  }
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(body)) {
    if (n >= 30) { out['…'] = 'more fields'; break; }
    n += 1;
    if (SENSITIVE.test(k)) { out[k] = '[hidden]'; continue; }
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (typeof v === 'string') { out[k] = v.length > 200 ? '[long text]' : v; continue; }
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
    if (Array.isArray(v)) { out[k] = `[${v.length} item${v.length === 1 ? '' : 's'}]`; continue; }
    if (typeof v === 'object') { out[k] = '{…}'; continue; }
  }
  return out;
}

/** '/admin/leave-types/12' → { entity: 'leave_type', id: 12, verb: null } */
export function describePath(path) {
  const segs = String(path || '').split('?')[0].split('/').filter(Boolean);
  if (segs[0] === 'admin') segs.shift();
  let id = null; let entity = null; let verb = null;
  for (let i = 0; i < segs.length; i += 1) {
    const s = segs[i];
    if (/^\d+$/.test(s)) { if (id === null) id = Number(s); continue; }
    if (i === segs.length - 1 && i > 0 && VERBS.has(s)) { verb = s; continue; }
    if (id === null) entity = s;
  }
  if (!entity) entity = segs[0] || 'request';
  const singular = entity.replace(/-/g, '_')
    .replace(/ies$/, 'y')
    .replace(/(ss)$/, '$1')
    .replace(/([^s])s$/, '$1');
  return { entity: singular, id, verb };
}

function actionFor(method, verb) {
  if (verb) return verb.replace(/-/g, '_').toUpperCase();
  if (method === 'POST') return 'CREATE';
  if (method === 'DELETE') return 'DELETE';
  return 'UPDATE';
}

export function auditTrail(req, res, next) {
  const method = req.method;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
  const path = req.path;
  if (path.startsWith('/auth/') || path.startsWith('/public/')) return next();
  const store = { req, audited: false };
  res.on('finish', () => {
    if (store.audited || res.statusCode >= 300 || !req.user?.id) return;
    // Administrative writes only; an employee's own requests (leave, NFA…)
    // and HR's personal actions (marking notifications read) are not admin
    // changes and would only bury the real entries.
    if (!path.startsWith('/admin/')) return;
    const { entity, id, verb } = describePath(path);
    // Fire and forget: the response has already gone.
    audit(req.user.id, actionFor(method, verb), entity, id,
      { via: 'web', method, path, changes: summariseBody(req.body) },
      { orgId: req.orgId ?? null }).catch(() => {});
  });
  als.run(store, () => next());
}

// ── Readable names for audit rows ───────────────────────────────────────────
// entity → SQL that returns (id, name) for a list of ids. Unknown entities and
// any query that fails (column renamed, table absent) just keep the raw id.
const EMP_NAME = `(e.first_name || ' ' || e.last_name || COALESCE(' (' || e.employee_code || ')', ''))`;
const viaEmployee = (table) =>
  `SELECT t.id, ${EMP_NAME} AS name FROM ${table} t JOIN employees e ON e.id = t.employee_id WHERE t.id = ANY($1::bigint[])`;
const ENTITY_NAME_SQL = {
  employee: `SELECT e.id, ${EMP_NAME} AS name FROM employees e WHERE e.id = ANY($1::bigint[])`,
  user_account: `SELECT ua.id, COALESCE(NULLIF(trim(e.first_name || ' ' || e.last_name), ''), ua.display_name, ua.email) AS name
                   FROM user_accounts ua LEFT JOIN employees e ON e.id = ua.employee_id WHERE ua.id = ANY($1::bigint[])`,
  user: `SELECT ua.id, COALESCE(ua.display_name, ua.email) AS name FROM user_accounts ua WHERE ua.id = ANY($1::bigint[])`,
  org_role: `SELECT id, label AS name FROM org_roles WHERE id = ANY($1::bigint[])`,
  role: `SELECT id, label AS name FROM org_roles WHERE id = ANY($1::bigint[])`,
  department: `SELECT id, name FROM departments WHERE id = ANY($1::bigint[])`,
  designation: `SELECT id, title AS name FROM designations WHERE id = ANY($1::bigint[])`,
  company: `SELECT id, name FROM companies WHERE id = ANY($1::bigint[])`,
  organisation: `SELECT id, name || COALESCE(' · ' || code, '') AS name FROM organisations WHERE id = ANY($1::bigint[])`,
  leave_type: `SELECT id, name FROM leave_types WHERE id = ANY($1::bigint[])`,
  holiday: `SELECT id, name FROM holidays WHERE id = ANY($1::bigint[])`,
  cost_zone: `SELECT id, name FROM cost_zones WHERE id = ANY($1::bigint[])`,
  org_master: `SELECT id, name FROM org_masters WHERE id = ANY($1::bigint[])`,
  policy: `SELECT id, COALESCE(title, filename) AS name FROM policies WHERE id = ANY($1::bigint[])`,
  app_banner: `SELECT id, filename AS name FROM app_banners WHERE id = ANY($1::bigint[])`,
  banner: `SELECT id, filename AS name FROM app_banners WHERE id = ANY($1::bigint[])`,
  letter_template: `SELECT id, title AS name FROM letter_templates WHERE id = ANY($1::bigint[])`,
  salary_component: `SELECT id, label AS name FROM salary_components WHERE id = ANY($1::bigint[])`,
  scheduled_notification: `SELECT id, title AS name FROM scheduled_notifications WHERE id = ANY($1::bigint[])`,
  notification_schedule: `SELECT id, title AS name FROM scheduled_notifications WHERE id = ANY($1::bigint[])`,
  platform_ticket: `SELECT id, subject AS name FROM platform_tickets WHERE id = ANY($1::bigint[])`,
  task: `SELECT id, title AS name FROM tasks WHERE id = ANY($1::bigint[])`,
  nfa: `SELECT t.id, t.nfa_code || ' · ' || ${EMP_NAME} AS name FROM nfas t JOIN employees e ON e.id = t.employee_id WHERE t.id = ANY($1::bigint[])`,
  payslip: `SELECT t.id, ${EMP_NAME} || ' · ' || lpad(t.month::text, 2, '0') || '/' || t.year AS name
              FROM payslips t JOIN employees e ON e.id = t.employee_id WHERE t.id = ANY($1::bigint[])`,
  kpi: `SELECT t.id, ${EMP_NAME} || ' · ' || lpad(t.month::text, 2, '0') || '/' || t.year AS name
          FROM kpis t JOIN employees e ON e.id = t.employee_id WHERE t.id = ANY($1::bigint[])`,
  onboarding: viaEmployee('onboarding'),
  salary_increment: viaEmployee('salary_increments'),
  increment: viaEmployee('salary_increments'),
  issued_letter: viaEmployee('issued_letters'),
  fnf_settlement: viaEmployee('fnf_settlements'),
  fnf: viaEmployee('fnf_settlements'),
  termination: viaEmployee('terminations'),
  resignation: viaEmployee('resignations'),
  leave_request: viaEmployee('leave_requests'),
  support_ticket: viaEmployee('support_tickets'),
  employee_change_request: viaEmployee('employee_change_requests'),
  change_request: viaEmployee('employee_change_requests'),
  investment_declaration: viaEmployee('investment_declarations'),
  tax_declaration: viaEmployee('investment_declarations'),
  comp_off_request: viaEmployee('comp_off_requests'),
  miss_punch: viaEmployee('miss_punch'),
  on_duty: viaEmployee('on_duty'),
};

/** Adds `entity_name` to each audit row where the entity can be resolved. */
export async function attachEntityNames(rows) {
  const byEntity = new Map();
  for (const r of rows) {
    if (!r.entity || r.entity_id == null) continue;
    const key = String(r.entity);
    if (!ENTITY_NAME_SQL[key]) continue;
    if (!byEntity.has(key)) byEntity.set(key, new Set());
    byEntity.get(key).add(Number(r.entity_id));
  }
  const names = new Map();
  await Promise.all([...byEntity.entries()].map(async ([entity, ids]) => {
    try {
      const res = await query(ENTITY_NAME_SQL[entity], [[...ids]]);
      for (const x of res.rows) names.set(`${entity}:${x.id}`, x.name);
    } catch { /* unknown shape — leave the raw id */ }
  }));
  for (const r of rows) r.entity_name = names.get(`${r.entity}:${r.entity_id}`) || null;
  return rows;
}
