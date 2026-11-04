// /api/v2 workflow routes — NFA & approvals sub-area. Composed by ../workflow.js.
// Same guards as the v1 table for the neighbouring routes.
import { Router } from 'express';
import { catchAsync } from '../../../utils/asyncRoutes.js';
import { authenticate, requireModule } from '../../../middleware/auth.js';
import * as nfa from '../../../controllers/nfaController.js';
import * as approval from '../../../controllers/approvalController.js';

const r = catchAsync(Router());

// E23: the requester withdraws a pending / queried NFA.
r.post('/nfa/:id/withdraw', authenticate, nfa.withdraw);
// E26/C32: bills, invoices, quotations and query replies attached to an NFA.
r.get('/nfa/:id/documents', authenticate, nfa.listDocs);
r.get('/nfa/:id/documents/:docId', authenticate, nfa.getDoc);
// H113: the Approvers page picks only current employees.
r.get('/admin/approver-matrix/candidates', authenticate, requireModule('APPROVERS'), approval.matrixCandidates);

export default r;
