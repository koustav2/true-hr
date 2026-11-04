// /api/v2 routes for the "org" area. Guard every route exactly as the v1 table does.
// One block per sub-area so the work on each stays independent.
import { Router } from 'express';
import { catchAsync } from '../../utils/asyncRoutes.js';
import {
  authenticate, requireStaff, requireModule, requirePlatformAdmin, requireOrg,
} from '../../middleware/auth.js';

const r = catchAsync(Router());
// Silence "unused" for guards a block may not need yet.
void authenticate; void requireStaff; void requireModule; void requirePlatformAdmin; void requireOrg;

// ---- [organisations & master tickets] ----
// Organisation detail / delete / add-first-admin, and Master-ticket assign and
// log-on-behalf. Platform owner only, like the v1 organisation routes.
import * as orgCtl from '../../controllers/organisationController.js';
import * as masterTicketCtl from '../../controllers/platformTicketController.js';

r.get('/admin/organisations/:id(\\d+)', authenticate, requirePlatformAdmin, orgCtl.getOne);
r.delete('/admin/organisations/:id(\\d+)', authenticate, requirePlatformAdmin, orgCtl.remove);
r.post('/admin/organisations/:id(\\d+)/admins', authenticate, requirePlatformAdmin, orgCtl.addAdmin);
r.post('/admin/platform-tickets', authenticate, requirePlatformAdmin, masterTicketCtl.adminCreate);
r.get('/admin/platform-tickets/assignees', authenticate, requirePlatformAdmin, masterTicketCtl.assignees);
r.post('/admin/platform-tickets/:id(\\d+)/assign', authenticate, requirePlatformAdmin, masterTicketCtl.assign);

// ---- [companies, hierarchy, org masters] ----
import * as levelsCtl from '../../controllers/levelController.js';
// H12/H127: which department a designation belongs to (null = any).
r.put('/admin/designations/:id/department', authenticate, requireOrg, requireModule('STRUCTURE', 'manage'), levelsCtl.setDesignationDepartment);

// ---- [branding] ----

// ---- [policies] ----
// Per-organisation policy/format list, acknowledgements, filled-form uploads.
// (import declarations are hoisted, so this one can live with its block)
import * as policy from '../../controllers/policyController.js';

r.post('/policies/:id/ack', authenticate, policy.acknowledge);
r.post('/policies/slots/:slotId/submissions', authenticate, policy.submitForm);
r.get('/me/policy-submissions', authenticate, policy.mySubmissions);
r.get('/me/policy-submissions/:id/file', authenticate, policy.mySubmissionFile);
r.post('/admin/policy-slots', authenticate, requireModule('POLICIES', 'manage'), policy.createSlot);
r.patch('/admin/policy-slots/:id', authenticate, requireModule('POLICIES', 'manage'), policy.updateSlot);
r.delete('/admin/policy-slots/:id', authenticate, requireModule('POLICIES', 'manage'), policy.removeSlot);
r.get('/admin/policies/:id/acks', authenticate, requireModule('POLICIES'), policy.acks);
r.get('/admin/policy-submissions', authenticate, requireModule('POLICIES'), policy.adminSubmissions);
r.get('/admin/policy-submissions/:id/file', authenticate, requireModule('POLICIES'), policy.adminSubmissionFile);
r.post('/admin/policy-submissions/:id/review', authenticate, requireModule('POLICIES', 'manage'), policy.reviewSubmission);

// ---- [support desk] ----
// Per-org issue types, ticket thread, assignment, employee cancel/reopen.
// Numeric :id patterns keep /support/catalog and /admin/support/types on their own handlers.
import * as support from '../../controllers/supportController.js';

r.get('/admin/support/types', authenticate, requireModule('SUPPORT'), support.listTypes);
r.post('/admin/support/types', authenticate, requireModule('SUPPORT', 'manage'), support.createType);
r.put('/admin/support/types/:id(\\d+)', authenticate, requireModule('SUPPORT', 'manage'), support.updateType);
r.delete('/admin/support/types/:id(\\d+)', authenticate, requireModule('SUPPORT', 'manage'), support.removeType);
r.get('/admin/support/staff', authenticate, requireModule('SUPPORT'), support.staff);
r.get('/admin/support/:id(\\d+)', authenticate, requireModule('SUPPORT'), support.adminDetail);
r.post('/admin/support/:id(\\d+)/comments', authenticate, requireModule('SUPPORT', 'manage'), support.adminComment);
r.post('/admin/support/:id(\\d+)/assign', authenticate, requireModule('SUPPORT', 'manage'), support.assign);
r.get('/support/:id(\\d+)', authenticate, support.myDetail);
r.post('/support/:id(\\d+)/comments', authenticate, support.myComment);
r.post('/support/:id(\\d+)/cancel', authenticate, support.myCancel);
r.post('/support/:id(\\d+)/reopen', authenticate, support.myReopen);

// ---- [scheduler, wishes, assets] ----
import * as opsWishes from '../../controllers/wishesController.js';
import * as opsAssets from '../../controllers/assetController.js';

r.get('/admin/wishes/settings', authenticate, requireModule('EMPLOYEES'), opsWishes.getSettings);
r.put('/admin/wishes/settings', authenticate, requireModule('EMPLOYEES', 'manage'), opsWishes.putSettings);
r.post('/admin/wishes/send', authenticate, requireModule('EMPLOYEES', 'manage'), opsWishes.send);
r.get('/admin/assets/options', authenticate, requireModule('ASSETS'), opsAssets.options);
r.get('/admin/assets/employees', authenticate, requireModule('ASSETS'), opsAssets.assignableEmployees);
r.delete('/admin/assets/:id', authenticate, requireModule('ASSETS', 'manage'), opsAssets.deleteAsset);
r.get('/admin/asset-requests', authenticate, requireModule('ASSETS'), opsAssets.adminRequests);
r.post('/admin/asset-requests/:id/action', authenticate, requireModule('ASSETS', 'manage'), opsAssets.actionRequest);
r.get('/me/asset-requests', authenticate, opsAssets.myRequests);
r.post('/me/asset-requests', authenticate, opsAssets.createRequest);
r.post('/me/asset-requests/:id/cancel', authenticate, opsAssets.cancelRequest);

export default r;
