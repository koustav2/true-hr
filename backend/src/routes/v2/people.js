// /api/v2 routes for the "people" area. Guard every route exactly as the v1 table does.
// Shared handlers (employees, onboarding, change requests, org chart) live in
// ../index.js and switch on isV2(req); only v2-only endpoints are declared here.
import { Router } from 'express';
import { catchAsync } from '../../utils/asyncRoutes.js';
import { authenticate, requireModule, requireOrg } from '../../middleware/auth.js';
import * as emp from '../../controllers/employeeController.js';
import * as chg from '../../controllers/changeRequestController.js';
import * as self from '../../controllers/peopleSelfController.js';

const r = catchAsync(Router());

// H16: preview the offer letter before it is sent / regenerated.
r.get('/admin/employees/offer-preview', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.previewOfferDraft);
r.get('/admin/employees/:id/offer-preview', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.previewOfferForEmployee);

// H50: per-document verify / reject with a remark.
r.post('/admin/employees/:id/documents/:docId/verify', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.verifyDocument);

// H38: candidate status actions (declined / did not join / on hold / resume) with a reason.
r.post('/admin/employees/:id/candidate-action', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.candidateAction);

// E53: my full profile (masked) and my documents for HR verification.
r.get('/me/full-profile', authenticate, self.myFullProfile);
r.get('/me/documents', authenticate, self.myDocuments);
r.post('/me/documents', authenticate, self.uploadMyDocument);
r.get('/me/documents/:docId', authenticate, self.downloadMyDocument);

// E54-E56: the address book — official contacts, current employees, server-side search.
r.get('/me/directory', authenticate, self.directory);

// E57: edit / withdraw my pending change request.
r.patch('/me/change-requests/:id', authenticate, chg.editMine);
r.post('/me/change-requests/:id/withdraw', authenticate, chg.withdrawMine);

export default r;
