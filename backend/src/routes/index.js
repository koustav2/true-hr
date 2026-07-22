import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import * as emp from '../controllers/employeeController.js';
import * as ob from '../controllers/onboardingController.js';
import * as meta from '../controllers/metaController.js';
import * as users from '../controllers/userController.js';
import * as attendance from '../controllers/attendanceController.js';
import * as missPunch from '../controllers/missPunchController.js';
import * as onDuty from '../controllers/onDutyController.js';
import * as leave from '../controllers/leaveController.js';
import * as compOff from '../controllers/compOffController.js';
import * as leaveAdmin from '../controllers/leaveAdminController.js';
import * as support from '../controllers/supportController.js';
import * as policy from '../controllers/policyController.js';
import * as banner from '../controllers/bannerController.js';
import * as tour from '../controllers/tourController.js';
import * as payroll from '../controllers/payrollController.js';
import * as dashboard from '../controllers/dashboardController.js';
import * as resignation from '../controllers/resignationController.js';
import * as task from '../controllers/taskController.js';
import * as approval from '../controllers/approvalController.js';
import * as masters from '../controllers/mastersController.js';
import * as nfa from '../controllers/nfaController.js';
import * as settlement from '../controllers/settlementController.js';
import * as nfaReport from '../controllers/nfaReportController.js';
import * as pms from '../controllers/pmsController.js';
import * as vendor from '../controllers/vendorController.js';
import { authenticate, requireStaff, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';

const r = Router();

// --- Auth ---
r.post('/auth/login', auth.login);
r.post('/auth/forgot-password', auth.forgotPassword);
r.post('/auth/reset-password', auth.resetPassword);
r.post('/auth/change-password', authenticate, auth.changePassword);
r.get('/me/photo', authenticate, auth.myPhoto);
r.post('/auth/web-sso-token', authenticate, auth.webSsoToken);
r.post('/auth/web-sso', auth.webSsoExchange);
r.get('/me', authenticate, auth.me);
r.get('/me/profile', authenticate, auth.meProfile);
r.get('/me/team', authenticate, auth.myTeam);
r.get('/me/directory', authenticate, auth.directory);

// --- Employee: attendance ---
r.post('/attendance/punch', authenticate, attendance.punch);
r.get('/attendance/today', authenticate, attendance.today);
r.get('/attendance/daily', authenticate, attendance.daily);
r.get('/attendance/regularized', authenticate, attendance.regularized);
r.get('/attendance/monthly', authenticate, attendance.monthly);
r.get('/attendance/team', authenticate, attendance.team);
r.post('/attendance/team/hold', authenticate, attendance.holdTeam);
r.post('/attendance/team/release', authenticate, attendance.releaseTeam);
r.get('/attendance/:id/photo', authenticate, attendance.photo);

// --- Employee: miss-punch ---
r.post('/misspunch', authenticate, missPunch.apply);
r.get('/misspunch', authenticate, missPunch.listOwn);
r.get('/misspunch/team', authenticate, missPunch.team);
r.post('/misspunch/:id/review', authenticate, missPunch.review);

// --- Employee: on-duty (OD) ---
r.get('/onduty/eligibility', authenticate, onDuty.eligibility);
r.post('/onduty', authenticate, onDuty.apply);
r.get('/onduty', authenticate, onDuty.listOwn);
r.get('/onduty/team', authenticate, onDuty.team);
r.post('/onduty/:id/review', authenticate, onDuty.review);

// --- Employee: leave management ---
r.get('/leave/types', authenticate, leave.types);
r.get('/leave/holidays', authenticate, leave.holidays);
r.get('/leave/balances', authenticate, leave.balances);
r.post('/leave', authenticate, leave.apply);
r.get('/leave', authenticate, leave.listOwn);
r.get('/leave/team', authenticate, leave.team);
r.post('/leave/:id/review', authenticate, leave.review);
r.post('/leave/:id/cancel', authenticate, leave.cancel);
r.get('/leave/:id/certificate', authenticate, leave.certificate);

// --- Comp-Off ---
r.get('/compoff/credits', authenticate, compOff.credits);
r.get('/compoff', authenticate, compOff.listOwn);
r.get('/compoff/team', authenticate, compOff.team);
r.post('/compoff', authenticate, compOff.apply);
r.post('/compoff/:id/review', authenticate, compOff.review);

// --- Support Desk (HR / IT / Admin) ---
// --- Policies (employee read) ---
r.get('/policies', authenticate, policy.list);
r.get('/banners', authenticate, banner.list);
r.get('/banners/:id/image', authenticate, banner.image);
r.get('/policies/:id/file', authenticate, policy.file);

// --- Tour Management (live GPS tracking + geo-tags) ---
r.post('/tours/start', authenticate, tour.start);
r.get('/tours', authenticate, tour.list);
r.get('/tours/:id', authenticate, tour.detail);
r.post('/tours/:id/points', authenticate, tour.addPoints);
r.post('/tours/:id/end', authenticate, tour.end);
r.post('/geotags', authenticate, tour.createGeotag);
r.get('/geotags', authenticate, tour.listGeotags);
r.get('/geotags/:id/photo', authenticate, tour.geotagPhoto);

// --- Task Management ---
r.get('/tasks/summary', authenticate, task.summary);
r.get('/tasks/team/summary', authenticate, task.teamSummary);
r.get('/tasks/team', authenticate, task.team);
r.get('/tasks', authenticate, task.mine);
r.post('/tasks', authenticate, task.create);
r.post('/tasks/:id/status', authenticate, task.updateStatus);

// --- NFA masters ---
r.get('/meta/nfa-masters', authenticate, masters.nfaMasters);
r.get('/admin/masters/:type', authenticate, requireStaff, masters.list);
r.post('/admin/masters/expense-hierarchy/import', authenticate, requireStaff, masters.importExpenseHierarchy);
r.post('/admin/masters/:type', authenticate, requireStaff, masters.create);
r.put('/admin/masters/:type/:id', authenticate, requireStaff, masters.update);
r.delete('/admin/masters/:type/:id', authenticate, requireStaff, masters.remove);

// --- Approver matrix (who approves per role/context) ---
r.get('/admin/approver-matrix', authenticate, requireStaff, approval.matrixList);
r.post('/admin/approver-matrix', authenticate, requireStaff, approval.matrixSave);
r.delete('/admin/approver-matrix/:id', authenticate, requireStaff, approval.matrixRemove);

// --- Approval-chain engine (generic: NFA / settlement / resignation / PMS) ---
r.get('/approvals/pending', authenticate, approval.pending);
r.get('/approvals/preview', authenticate, approval.preview);
r.get('/approvals/:id', authenticate, approval.detail);
r.post('/approvals/:id/act', authenticate, approval.actOn);
r.post('/approvals/:id/resubmit', authenticate, approval.resubmit);

// --- NFA (Note For Approval) ---
r.get('/nfa/pending', authenticate, nfa.pendingApprovals);
r.get('/nfa/ledger', authenticate, nfa.ledger);
r.get('/nfa', authenticate, nfa.listMine);
r.post('/nfa', authenticate, nfa.create);
r.get('/nfa/:id', authenticate, nfa.detail);
r.post('/nfa/:id/act', authenticate, nfa.actOn);
r.post('/nfa/:id/resubmit', authenticate, nfa.resubmit);
r.put('/nfa/:id', authenticate, nfa.update);
r.post('/nfa/:id/release-payment', authenticate, nfa.releasePayment);
r.get('/admin/nfa', authenticate, requireStaff, nfa.adminList);

// --- NFA settlements ---
r.post('/nfa/:id/settlement', authenticate, settlement.submit);
r.get('/nfa/:id/settlement', authenticate, settlement.forNfa);
r.get('/settlements/pending', authenticate, settlement.pendingApprovals);
r.post('/settlements/:id/act', authenticate, settlement.actOn);
r.post('/settlements/:id/resubmit', authenticate, settlement.resubmit);
r.get('/admin/settlements', authenticate, requireStaff, settlement.adminList);

// --- NFA reports & analytics ---
r.get('/admin/nfa-dashboard', authenticate, requireStaff, nfaReport.dashboard);
r.get('/admin/reports/project-expense', authenticate, requireStaff, nfaReport.projectExpense);
r.get('/admin/reports/client-billing', authenticate, requireStaff, nfaReport.clientBilling);
r.get('/admin/reports/pending-settlements', authenticate, requireStaff, nfaReport.pendingSettlements);
r.get('/admin/nfa-export', authenticate, requireStaff, nfaReport.nfaExport);

// --- PMS / KPI ---
r.get('/pms/grades', authenticate, pms.grades);
r.get('/pms/pending', authenticate, pms.pendingRatings);
r.post('/pms/:id/rate', authenticate, pms.rate);
r.get('/kpi/team-pending', authenticate, pms.teamPending);
r.get('/kpi', authenticate, pms.listMine);
r.post('/kpi', authenticate, pms.createKpi);
r.get('/kpi/:id', authenticate, pms.detail);
r.put('/kpi/:id', authenticate, pms.updateKpi);
r.post('/kpi/:id/review', authenticate, pms.reviewKpi);
r.post('/kpi/:id/pms', authenticate, pms.submitPms);

// --- Vendor registration & agreements ---
r.get('/vendors', authenticate, vendor.listVendors);
r.post('/vendors', authenticate, vendor.createVendor);
r.post('/admin/vendors/:id/review', authenticate, requireStaff, vendor.reviewVendor);
r.get('/agreements', authenticate, vendor.listAgreements);
r.post('/agreements', authenticate, vendor.createAgreement);
r.get('/vendors/:id/document', authenticate, vendor.vendorDocument);
r.get('/agreements/:id/document', authenticate, vendor.agreementDocument);
r.get('/settlements/:id/documents', authenticate, settlement.listDocs);
r.get('/settlements/:id/documents/:docId', authenticate, settlement.getDoc);
r.post('/admin/agreements/:id/review', authenticate, requireStaff, vendor.reviewAgreement);

// --- Resignation ---
r.get('/resignation/context', authenticate, resignation.context);
r.get('/resignation/team', authenticate, resignation.team);
r.get('/resignation', authenticate, resignation.listOwn);
r.post('/resignation', authenticate, resignation.apply);
r.post('/resignation/:id/withdraw', authenticate, resignation.withdraw);
r.post('/resignation/:id/review', authenticate, resignation.review);
r.get('/resignation/:id/chain', authenticate, resignation.chain);
r.post('/resignation/:id/act', authenticate, resignation.actOn);

// --- Salary Slip (employee) ---
r.get('/payslips', authenticate, payroll.list);
r.get('/payslips/:id', authenticate, payroll.detail);
r.get('/payslips/:id/pdf', authenticate, payroll.pdf);

r.get('/support/catalog', authenticate, support.catalog);
r.get('/support', authenticate, support.list);
r.post('/support', authenticate, support.create);
r.get('/support/:id/attachment', authenticate, support.attachment);

// --- Public onboarding (token-gated) ---
r.get('/onboarding/accept', ob.getAccept);
r.post('/onboarding/accept', ob.postAccept);
r.post('/onboarding/reject', ob.postReject);
r.get('/onboarding/form', ob.getForm);
r.get('/onboarding/offer-letter', ob.getOfferLetterByToken);
r.post('/onboarding/document', ob.postDocument);
r.post('/onboarding/details', ob.postDetails);
r.post('/onboarding/esign', ob.postEsign);

// --- Meta (staff) ---
r.get('/meta/company', authenticate, requireStaff, meta.getCompany);
r.get('/meta/departments', authenticate, requireStaff, meta.getDepartments);
r.get('/meta/designations', authenticate, requireStaff, meta.getDesignations);
r.get('/meta/managers', authenticate, requireStaff, meta.getManagers);

// --- Staff: employees + onboarding review ---
r.get('/employees', authenticate, requireStaff, emp.listEmployees);
r.post('/employees', authenticate, requireStaff, emp.createEmployee);
r.get('/employees/:id', authenticate, requireStaff, emp.getEmployee);
r.get('/employees/:id/offer-letter', authenticate, requireStaff, emp.downloadOfferLetter);
r.get('/employees/:id/documents/:docId', authenticate, requireStaff, emp.downloadDocument);
r.get('/employees/:id/sheet', authenticate, requireStaff, emp.generateSheet);
r.get('/onboarding/queue', authenticate, requireStaff, emp.reviewQueue);
r.post('/onboarding/:id/approve', authenticate, requireStaff, emp.approveOnboarding);
r.post('/onboarding/:id/send-back', authenticate, requireStaff, emp.sendBack);

// --- System administration (IT admin + super admin) ---
r.get('/admin/users', authenticate, requireAdmin, users.listUsers);
r.post('/admin/users', authenticate, requireAdmin, users.createUser);
r.post('/admin/users/:id/status', authenticate, requireAdmin, users.setUserStatus);
r.post('/admin/employees/:id/reset-password', authenticate, requireStaff, users.resetEmployeePassword);
r.patch('/admin/employees/:id', authenticate, requireStaff, emp.updateEmployee);
r.post('/admin/employees/:id/generate-offer', authenticate, requireStaff, emp.generateOfferLetter);
r.post('/admin/employees/:id/documents', authenticate, requireStaff, emp.uploadEmployeeDocument);
r.patch('/admin/employees/:id/bank-statutory', authenticate, requireStaff, emp.updateBankStatutory);
r.get('/admin/audit', authenticate, requireAdmin, users.getAudit);

// --- Leave configuration (HR) ---
r.get('/admin/holidays', authenticate, requireStaff, leaveAdmin.listHolidays);
r.post('/admin/holidays', authenticate, requireStaff, leaveAdmin.createHoliday);
r.delete('/admin/holidays/:id', authenticate, requireStaff, leaveAdmin.deleteHoliday);
r.get('/admin/entitlements', authenticate, requireStaff, leaveAdmin.listEntitlements);
r.put('/admin/entitlements', authenticate, requireStaff, leaveAdmin.upsertEntitlement);
r.get('/admin/leave-types', authenticate, requireStaff, leaveAdmin.listLeaveTypes);
r.put('/admin/leave-types/:code', authenticate, requireStaff, leaveAdmin.updateLeaveType);

// --- Support Desk portal (HR/IT/Admin agents) ---
r.get('/admin/support', authenticate, requireStaff, support.adminList);
r.post('/admin/support/:id/resolve', authenticate, requireStaff, support.resolve);
r.get('/admin/support/:id/attachment', authenticate, requireStaff, support.adminAttachment);

// --- Dashboard stats (HR) ---
r.get('/admin/stats', authenticate, requireStaff, dashboard.stats);

// --- Resignations (HR) ---
r.get('/admin/resignations', authenticate, requireStaff, resignation.adminList);
r.post('/admin/resignations/:id/review', authenticate, requireStaff, resignation.adminReview);

// --- Payroll (HR) ---
r.get('/admin/salary-template', authenticate, requireStaff, payroll.getTemplate);
r.put('/admin/salary-template', authenticate, requireStaff, payroll.setTemplate);
r.get('/admin/salary-structure/:employeeId', authenticate, requireStaff, payroll.getStructure);
r.put('/admin/salary-structure/:employeeId', authenticate, requireStaff, payroll.setStructure);
r.get('/admin/payslips', authenticate, requireStaff, payroll.adminList);
r.post('/admin/payslips/generate', authenticate, requireStaff, payroll.generate);
r.get('/admin/payslips/:id', authenticate, requireStaff, payroll.adminDetail);
r.get('/admin/payslips/:id/pdf', authenticate, requireStaff, payroll.adminPdf);
r.post('/admin/payslips/:id/publish', authenticate, requireStaff, payroll.publish);
r.post('/admin/payslips/:id/unpublish', authenticate, requireStaff, payroll.unpublish);
r.delete('/admin/payslips/:id', authenticate, requireStaff, payroll.remove);

// --- Policies (HR manage) ---
r.get('/admin/policies', authenticate, requireStaff, policy.adminList);
r.post('/admin/policies', authenticate, requireStaff, policy.create);
r.delete('/admin/policies/:id', authenticate, requireStaff, policy.remove);

// --- App dashboard banners (HR manage) ---
r.get('/admin/banners', authenticate, requireStaff, banner.adminList);
r.post('/admin/banners', authenticate, requireStaff, banner.create);
r.delete('/admin/banners/:id', authenticate, requireStaff, banner.remove);

export default r;
