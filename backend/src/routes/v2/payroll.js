// /api/v2 routes for the "payroll" area. Guard every route exactly as the v1 table does.
// Routes declared here are matched before the shared table (routes/index.js);
// anything not here falls through to it with req.apiVersion === 2, where the
// shared handlers switch on isV2(req).
import { Router } from 'express';
import { catchAsync } from '../../utils/asyncRoutes.js';
import { authenticate, requireModule, requireOrg } from '../../middleware/auth.js';
import * as payroll from '../../controllers/payrollController.js';
import * as incr from '../../controllers/incrementController.js';
import * as statutory from '../../controllers/statutoryController.js';
import * as taxDecl from '../../controllers/taxDeclarationController.js';
import * as fnf from '../../controllers/fnfController.js';
import * as letters from '../../controllers/letterController.js';

const r = catchAsync(Router());

// ── Payroll: structure follows the payslip components (D6), one compute path (H78)
r.get('/admin/salary-structure/:employeeId', authenticate, requireOrg, requireModule('PAYROLL'), payroll.getStructureV2);
r.put('/admin/salary-structure/:employeeId', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), payroll.setStructureV2);
r.post('/admin/payroll/preview', authenticate, requireOrg, requireModule('PAYROLL'), payroll.previewV2);
// Same preview for the Payslip components screen, which HR reaches with PAYCOMP.
r.post('/admin/payslip-components/preview', authenticate, requireOrg, requireModule('PAYCOMP'), payroll.previewV2);

// ── ESS: my CTC breakup and Form 16 (E33)
r.get('/me/salary-structure', authenticate, payroll.mySalaryV2);
r.get('/me/form16', authenticate, statutory.myForm16);

// ── Increments: validation in the form, maker-checker, current pay (C22, H74-H77)
r.get('/admin/increments/current/:employeeId', authenticate, requireOrg, requireModule('INCREMENT'), incr.current);
r.post('/admin/increments', authenticate, requireOrg, requireModule('INCREMENT', 'manage'), incr.proposeV2);

// ── Statutory: active employees only, with their ID (H81)
r.get('/admin/statutory/employees', authenticate, requireModule('STATUTORY'), statutory.employeesV2);

// ── Investment declarations: proofs (C25, E36)
r.post('/me/tax-declaration/items/:itemId/proof', authenticate, taxDecl.uploadProof);
r.get('/me/tax-declaration/items/:itemId/proof', authenticate, taxDecl.myProof);
r.get('/admin/tax-declarations/:id/items/:itemId/proof', authenticate, requireModule('INVDECL'), taxDecl.adminProof);

// ── Full & Final: approved exits only, pre-fill, edit/delete drafts (C27, H90-H95)
// Literal paths before /admin/fnf/:id.
r.get('/admin/fnf/eligible', authenticate, requireModule('FNF'), fnf.eligible);
r.get('/admin/fnf/prefill/:employeeId', authenticate, requireModule('FNF'), fnf.prefillV2);
r.get('/admin/fnf/:id(\\d+)', authenticate, requireModule('FNF'), fnf.detail);
r.delete('/admin/fnf/:id(\\d+)', authenticate, requireModule('FNF', 'manage'), fnf.removeDraft);

// ── Letters: typed, eligible, revocable; employee requests (C28, H96-H99, E38)
r.get('/admin/letters/prefill', authenticate, requireModule('LETTERS'), letters.prefill);
r.get('/admin/letters/employees', authenticate, requireModule('LETTERS'), letters.eligibleEmployees);
r.post('/admin/letters/:id/revoke', authenticate, requireModule('LETTERS', 'manage'), letters.revoke);
r.get('/admin/letter-requests', authenticate, requireModule('LETTERS'), letters.adminRequests);
r.post('/admin/letter-requests/:id/decide', authenticate, requireModule('LETTERS', 'manage'), letters.decideRequest);
r.get('/me/letter-requests', authenticate, letters.myRequests);
r.post('/me/letter-requests', authenticate, letters.createRequest);
r.post('/me/letter-requests/:id/cancel', authenticate, letters.cancelRequest);

export default r;
