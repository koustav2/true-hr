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
import * as notif from '../controllers/notificationController.js';
import * as org from '../controllers/organisationController.js';
import * as roles from '../controllers/roleController.js';
import * as termination from '../controllers/terminationController.js';
import * as company from '../controllers/companyController.js';
// --- GreenHR-parity gap-closure controllers (additive) ---
import * as assets from '../controllers/assetController.js';
import * as statRates from '../controllers/statutoryRatesController.js';
import * as fnf from '../controllers/fnfController.js';
import * as letters from '../controllers/letterController.js';
import * as taxDecl from '../controllers/taxDeclarationController.js';
import * as statutory from '../controllers/statutoryController.js';
import * as wishes from '../controllers/wishesController.js';
import * as notifSched from '../controllers/notificationScheduleController.js';
import * as bulk from '../controllers/bulkController.js';
import {
  authenticate, requireStaff, requireAdmin, requireSuperAdmin, requireAnyAdmin,
  requireModule, requirePlatformAdmin, requireOrg,
} from '../middleware/auth.js';

const r = Router();

// --- Auth ---
r.post('/auth/login', auth.login);
r.post('/auth/login/verify-otp', auth.loginVerifyOtp); // shares the /api/auth/login rate limit (prefix match)
r.post('/auth/forgot-password', auth.forgotPassword);
r.post('/auth/reset-password', auth.resetPassword);
r.post('/auth/change-password', authenticate, auth.changePassword);
r.get('/me/photo', authenticate, auth.myPhoto);
r.get('/employees/:id/photo', authenticate, auth.employeePhoto);
r.post('/auth/web-sso-token', authenticate, auth.webSsoToken);
r.post('/auth/web-sso', auth.webSsoExchange);
r.get('/me', authenticate, auth.me);
r.get('/me/profile', authenticate, auth.meProfile);
r.get('/me/team', authenticate, auth.myTeam);
r.get('/me/directory', authenticate, auth.directory);

// --- Push notifications: device registration + in-app notification centre ---
r.post('/me/device-token', authenticate, notif.registerDevice);
r.delete('/me/device-token', authenticate, notif.unregisterDevice);
r.get('/notifications', authenticate, notif.list);
r.get('/notifications/unread-count', authenticate, notif.unreadCount);
r.post('/notifications/read-all', authenticate, notif.markAllRead);

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
r.get('/admin/masters/:type', authenticate, requireModule('MASTERS'), masters.list);
r.post('/admin/masters/expense-hierarchy/import', authenticate, requireModule('MASTERS', 'manage'), masters.importExpenseHierarchy);
r.post('/admin/masters/:type', authenticate, requireModule('MASTERS', 'manage'), masters.create);
r.put('/admin/masters/:type/:id', authenticate, requireModule('MASTERS', 'manage'), masters.update);
r.delete('/admin/masters/:type/:id', authenticate, requireModule('MASTERS', 'manage'), masters.remove);

// --- Approver matrix (who approves per role/context) ---
r.get('/admin/approver-matrix', authenticate, requireModule('APPROVERS'), approval.matrixList);
r.post('/admin/approver-matrix', authenticate, requireModule('APPROVERS', 'manage'), approval.matrixSave);
r.delete('/admin/approver-matrix/:id', authenticate, requireModule('APPROVERS', 'manage'), approval.matrixRemove);

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
r.get('/admin/nfa', authenticate, requireModule('NFA'), nfa.adminList);

// --- NFA settlements ---
r.post('/nfa/:id/settlement', authenticate, settlement.submit);
r.get('/nfa/:id/settlement', authenticate, settlement.forNfa);
r.get('/settlements/pending', authenticate, settlement.pendingApprovals);
r.post('/settlements/:id/act', authenticate, settlement.actOn);
r.post('/settlements/:id/resubmit', authenticate, settlement.resubmit);
r.get('/admin/settlements', authenticate, requireModule('SETTLEMENTS'), settlement.adminList);

// --- NFA reports & analytics ---
r.get('/admin/nfa-dashboard', authenticate, requireModule('NFA_REPORTS'), nfaReport.dashboard);
r.get('/admin/reports/project-expense', authenticate, requireModule('NFA_REPORTS'), nfaReport.projectExpense);
r.get('/admin/reports/client-billing', authenticate, requireModule('NFA_REPORTS'), nfaReport.clientBilling);
r.get('/admin/reports/pending-settlements', authenticate, requireModule('NFA_REPORTS'), nfaReport.pendingSettlements);
r.get('/admin/reports/company-expense', authenticate, requireModule('NFA_REPORTS'), nfaReport.companyExpense);
r.get('/admin/nfa-export', authenticate, requireModule('NFA_REPORTS'), nfaReport.nfaExport);

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
r.post('/admin/vendors/:id/review', authenticate, requireModule('VENDORS', 'manage'), vendor.reviewVendor);
r.get('/agreements', authenticate, vendor.listAgreements);
r.post('/agreements', authenticate, vendor.createAgreement);
r.get('/vendors/:id/document', authenticate, vendor.vendorDocument);
r.get('/agreements/:id/document', authenticate, vendor.agreementDocument);
r.get('/settlements/:id/documents', authenticate, settlement.listDocs);
r.get('/settlements/:id/documents/:docId', authenticate, settlement.getDoc);
r.post('/admin/agreements/:id/review', authenticate, requireModule('VENDORS', 'manage'), vendor.reviewAgreement);

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
r.get('/meta/companies', authenticate, requireStaff, meta.getCompanies);
r.get('/meta/departments', authenticate, requireStaff, meta.getDepartments);
r.get('/meta/designations', authenticate, requireStaff, meta.getDesignations);
r.get('/meta/managers', authenticate, requireStaff, meta.getManagers);

// --- Staff: employees + onboarding review ---
r.get('/employees', authenticate, requireOrg, requireModule('EMPLOYEES'), emp.listEmployees);
r.post('/employees', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.createEmployee);
r.get('/employees/:id', authenticate, requireOrg, requireModule('EMPLOYEES'), emp.getEmployee);
r.get('/employees/:id/offer-letter', authenticate, requireOrg, requireModule('EMPLOYEES'), emp.downloadOfferLetter);
r.get('/employees/:id/documents/:docId', authenticate, requireOrg, requireModule('EMPLOYEES'), emp.downloadDocument);
r.get('/employees/:id/sheet', authenticate, requireOrg, requireModule('EMPLOYEES'), emp.generateSheet);
r.get('/onboarding/queue', authenticate, requireOrg, requireModule('ONBOARDING'), emp.reviewQueue);
r.post('/onboarding/:id/approve', authenticate, requireModule('ONBOARDING', 'manage'), emp.approveOnboarding);
r.post('/onboarding/:id/send-back', authenticate, requireModule('ONBOARDING', 'manage'), emp.sendBack);

// --- System administration (IT admin + super admin) ---
r.get('/admin/users', authenticate, requireOrg, requireModule('USERS'), users.listUsers);
r.post('/admin/users', authenticate, requireOrg, requireModule('USERS', 'manage'), users.createUser);
r.post('/admin/users/:id/status', authenticate, requireOrg, requireModule('USERS', 'manage'), users.setUserStatus);
r.post('/admin/users/:id/role', authenticate, requireOrg, requireModule('USERS', 'manage'), users.setUserRole);
r.post('/admin/users/:id/org-role', authenticate, requireOrg, requireModule('USERS', 'manage'), users.setUserOrgRole);
r.post('/admin/employees/:id/reset-password', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), users.resetEmployeePassword);
r.patch('/admin/employees/:id', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.updateEmployee);
r.post('/admin/employees/:id/active', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.setEmployeeActive);
r.post('/admin/employees/:id/generate-offer', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.generateOfferLetter);
r.post('/admin/employees/:id/documents', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.uploadEmployeeDocument);
r.patch('/admin/employees/:id/bank-statutory', authenticate, requireOrg, requireModule('EMPLOYEES', 'manage'), emp.updateBankStatutory);
r.get('/admin/audit', authenticate, requireOrg, requireModule('AUDIT'), users.getAudit);

// --- Leave configuration (HR) ---
r.get('/admin/holidays', authenticate, requireModule('LEAVE'), leaveAdmin.listHolidays);
r.post('/admin/holidays', authenticate, requireModule('LEAVE', 'manage'), leaveAdmin.createHoliday);
r.delete('/admin/holidays/:id', authenticate, requireModule('LEAVE', 'manage'), leaveAdmin.deleteHoliday);
r.get('/admin/entitlements', authenticate, requireModule('LEAVE'), leaveAdmin.listEntitlements);
r.put('/admin/entitlements', authenticate, requireModule('LEAVE', 'manage'), leaveAdmin.upsertEntitlement);
r.get('/admin/leave-types', authenticate, requireModule('LEAVE'), leaveAdmin.listLeaveTypes);
r.put('/admin/leave-types/:code', authenticate, requireModule('LEAVE', 'manage'), leaveAdmin.updateLeaveType);

// --- Support Desk portal (HR/IT/Admin agents) ---
r.get('/admin/support', authenticate, requireModule('SUPPORT'), support.adminList);
r.post('/admin/support/:id/resolve', authenticate, requireModule('SUPPORT', 'manage'), support.resolve);
r.get('/admin/support/:id/attachment', authenticate, requireModule('SUPPORT'), support.adminAttachment);

// --- Dashboard stats (HR) ---
r.get('/admin/stats', authenticate, requireModule('DASHBOARD'), dashboard.stats);

// --- Resignations (HR) ---
r.get('/admin/resignations', authenticate, requireOrg, requireModule('RESIGNATION'), resignation.adminList);
r.post('/admin/resignations/:id/review', authenticate, requireOrg, requireModule('RESIGNATION', 'manage'), resignation.adminReview);

// --- Payroll (HR) ---
r.get('/admin/salary-template', authenticate, requireOrg, requireModule('PAYROLL'), payroll.getTemplate);
r.put('/admin/salary-template', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), payroll.setTemplate);
r.get('/admin/salary-structure/:employeeId', authenticate, requireOrg, requireModule('PAYROLL'), payroll.getStructure);
r.put('/admin/salary-structure/:employeeId', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), payroll.setStructure);
r.get('/admin/payslips', authenticate, requireOrg, requireModule('PAYROLL'), payroll.adminList);
r.post('/admin/payslips/generate', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), payroll.generate);
r.post('/admin/payslips/generate-all', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), payroll.generateAll);
r.post('/admin/payslips/publish-all', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), payroll.publishAll);
r.get('/admin/payslips/export', authenticate, requireOrg, requireModule('PAYROLL'), payroll.exportBankSheet); // must precede /:id
r.get('/admin/payslips/:id', authenticate, requireOrg, requireModule('PAYROLL'), payroll.adminDetail);
r.get('/admin/payslips/:id/pdf', authenticate, requireOrg, requireModule('PAYROLL'), payroll.adminPdf);
r.post('/admin/payslips/:id/publish', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), payroll.publish);
r.post('/admin/payslips/:id/unpublish', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), payroll.unpublish);
r.delete('/admin/payslips/:id', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), payroll.remove);

// --- Policies (HR manage) ---
r.get('/admin/policies', authenticate, requireModule('POLICIES'), policy.adminList);
r.post('/admin/policies', authenticate, requireModule('POLICIES', 'manage'), policy.create);
r.delete('/admin/policies/:id', authenticate, requireModule('POLICIES', 'manage'), policy.remove);

// --- App dashboard banners (HR manage) ---
r.get('/admin/banners', authenticate, requireModule('BANNERS'), banner.adminList);
r.post('/admin/banners', authenticate, requireModule('BANNERS', 'manage'), banner.create);
r.delete('/admin/banners/:id', authenticate, requireModule('BANNERS', 'manage'), banner.remove);

// --- Who am I allowed to be? (drives the portal sidebar) ---
r.get('/me/permissions', authenticate, roles.myPermissions);
r.get('/me/organisations', authenticate, org.mine);

// --- Organisations (platform owner: create tenants & switch between them) ---
r.get('/admin/organisations', authenticate, requirePlatformAdmin, org.list);
r.post('/admin/organisations', authenticate, requirePlatformAdmin, org.create);
r.post('/admin/organisations/switch', authenticate, requirePlatformAdmin, org.switchOrg);
r.patch('/admin/organisations/:id', authenticate, requirePlatformAdmin, org.update);
r.post('/admin/organisations/:id/status', authenticate, requirePlatformAdmin, org.setStatus);

// --- Payroll policy for the current organisation (attendance rules) ---
r.get('/admin/payroll-settings', authenticate, requireOrg, requireModule('PAYROLL'), org.getPayrollSettings);
r.put('/admin/payroll-settings', authenticate, requireOrg, requireModule('PAYROLL', 'manage'), org.setPayrollSettings);

// --- Roles & module permissions (replaces the old hardcoded guards) ---
r.get('/admin/modules', authenticate, requireOrg, requireModule('ROLES'), roles.modules);
r.get('/admin/role-presets', authenticate, requireOrg, requireModule('ROLES'), roles.presets);
// Assignable roles for the Users screen — gated on USERS, because putting
// someone into an existing role is account management, not role design.
r.get('/admin/assignable-roles', authenticate, requireOrg, requireModule('USERS'), roles.assignable);
r.get('/admin/roles', authenticate, requireOrg, requireModule('ROLES'), roles.list);
r.post('/admin/roles', authenticate, requireOrg, requireModule('ROLES', 'manage'), roles.create);
r.get('/admin/roles/:id', authenticate, requireOrg, requireModule('ROLES'), roles.detail);
r.put('/admin/roles/:id', authenticate, requireOrg, requireModule('ROLES', 'manage'), roles.update);
r.delete('/admin/roles/:id', authenticate, requireOrg, requireModule('ROLES', 'manage'), roles.remove);

// --- Companies (legal entities inside the current organisation) ---
r.get('/admin/companies', authenticate, requireOrg, requireModule('COMPANIES'), company.list);
r.post('/admin/companies', authenticate, requireOrg, requireModule('COMPANIES', 'manage'), company.create);
r.patch('/admin/companies/:id', authenticate, requireOrg, requireModule('COMPANIES', 'manage'), company.update);
r.post('/admin/companies/:id/status', authenticate, requireOrg, requireModule('COMPANIES', 'manage'), company.setStatus);
r.get('/admin/companies/:id/structure', authenticate, requireOrg, requireModule('COMPANIES'), company.listStructure);
r.post('/admin/companies/:id/departments', authenticate, requireOrg, requireModule('STRUCTURE', 'manage'), company.addDepartment);
r.delete('/admin/companies/:id/departments/:depId', authenticate, requireOrg, requireModule('STRUCTURE', 'manage'), company.removeDepartment);
r.post('/admin/companies/:id/designations', authenticate, requireOrg, requireModule('STRUCTURE', 'manage'), company.addDesignation);
r.delete('/admin/companies/:id/designations/:desId', authenticate, requireOrg, requireModule('STRUCTURE', 'manage'), company.removeDesignation);

// --- Termination (employer-initiated exit; separate from resignation) ---
r.get('/admin/termination-types', authenticate, requireModule('TERMINATION'), termination.types);
r.get('/admin/terminations', authenticate, requireOrg, requireModule('TERMINATION'), termination.list);
r.get('/admin/employees/:id/termination', authenticate, requireOrg, requireModule('TERMINATION'), termination.forEmployee);
r.post('/admin/employees/:id/terminate', authenticate, requireOrg, requireModule('TERMINATION', 'manage'), termination.terminate);
r.post('/admin/terminations/:id/revoke', authenticate, requireOrg, requireModule('TERMINATION', 'manage'), termination.revoke);

// =====================================================================
// GreenHR-parity gap closure (additive; NFA suite untouched)
// =====================================================================

// --- Asset management (IT / non-IT register + assignment) ---
r.get('/admin/assets', authenticate, requireModule('ASSETS'), assets.listAssets);
r.post('/admin/assets', authenticate, requireModule('ASSETS', 'manage'), assets.createAsset);
r.patch('/admin/assets/:id', authenticate, requireModule('ASSETS', 'manage'), assets.updateAsset);
r.post('/admin/assets/:id/assign', authenticate, requireModule('ASSETS', 'manage'), assets.assignAsset);
r.post('/admin/assets/:id/return', authenticate, requireModule('ASSETS', 'manage'), assets.returnAsset);
r.get('/admin/employees/:employeeId/assets', authenticate, requireModule('ASSETS'), assets.employeeAssets);
r.get('/me/assets', authenticate, assets.myAssets);
r.post('/me/assets/:id/acknowledge', authenticate, assets.acknowledgeAsset);

// --- Statutory-rate masters + payroll compliance (PT / minimum wage) ---
r.get('/admin/statutory/categories', authenticate, requireModule('STATUTORY'), statRates.categories);
r.get('/admin/statutory/pt-slabs', authenticate, requireModule('STATUTORY'), statRates.listPtSlabs);
r.post('/admin/statutory/pt-slabs', authenticate, requireModule('STATUTORY', 'manage'), statRates.savePtSlabs);
r.get('/admin/statutory/min-wages', authenticate, requireModule('STATUTORY'), statRates.listMinWages);
r.post('/admin/statutory/min-wages', authenticate, requireModule('STATUTORY', 'manage'), statRates.saveMinWage);
r.get('/admin/statutory/compliance-check', authenticate, requireModule('STATUTORY'), statRates.checkCompliance);

// --- Statutory records (PF/ESIC/Gratuity profiles + nominees) + reports ---
r.get('/admin/employees/:employeeId/statutory', authenticate, requireModule('STATUTORY'), statutory.getProfile);
r.put('/admin/employees/:employeeId/statutory', authenticate, requireModule('STATUTORY', 'manage'), statutory.upsertProfile);
r.post('/admin/employees/:employeeId/statutory/nominees', authenticate, requireModule('STATUTORY', 'manage'), statutory.addNominee);
r.delete('/admin/statutory/nominees/:id', authenticate, requireModule('STATUTORY', 'manage'), statutory.deleteNominee);
r.get('/admin/reports/pf-register', authenticate, requireModule('STATUTORY'), statutory.pfRegister);
r.get('/admin/reports/esic-register', authenticate, requireModule('STATUTORY'), statutory.esicRegister);
r.get('/admin/reports/form16/:employeeId', authenticate, requireModule('STATUTORY'), statutory.form16);

// --- Income-tax investment declaration (ESS submit -> HR verify) ---
r.get('/me/tax-declaration/sections', authenticate, taxDecl.sections);
r.get('/me/tax-declaration', authenticate, taxDecl.getMine);
r.post('/me/tax-declaration', authenticate, taxDecl.saveMine);
r.post('/me/tax-declaration/submit', authenticate, taxDecl.submitMine);
r.get('/admin/tax-declarations', authenticate, requireModule('INVDECL'), taxDecl.adminList);
r.get('/admin/tax-declarations/:id', authenticate, requireModule('INVDECL'), taxDecl.adminGet);
r.post('/admin/tax-declarations/:id/verify', authenticate, requireModule('INVDECL', 'manage'), taxDecl.verify);

// --- Letters engine (templates + issue + PDF) ---
r.get('/admin/letters/types', authenticate, requireModule('LETTERS'), letters.types);
r.post('/admin/letters/templates', authenticate, requireModule('LETTERS', 'manage'), letters.saveTemplate);
r.post('/admin/letters/issue', authenticate, requireModule('LETTERS', 'manage'), letters.issue);
r.get('/admin/letters/issued', authenticate, requireModule('LETTERS'), letters.listIssued);
r.get('/admin/letters/:id/pdf', authenticate, requireModule('LETTERS'), letters.pdf);
r.get('/me/letters', authenticate, letters.myLetters);
r.get('/me/letters/:id/pdf', authenticate, letters.myPdf);

// --- Wishes reminders (birthdays & anniversaries) ---
r.get('/admin/wishes', authenticate, requireModule('EMPLOYEES'), wishes.upcoming);

// --- Recurring notification scheduler (comms) ---
r.get('/admin/notification-schedules', authenticate, requireModule('BANNERS'), notifSched.list);
r.post('/admin/notification-schedules', authenticate, requireModule('BANNERS', 'manage'), notifSched.create);
r.post('/admin/notification-schedules/:id/toggle', authenticate, requireModule('BANNERS', 'manage'), notifSched.toggle);
r.post('/admin/notification-schedules/:id/run', authenticate, requireModule('BANNERS', 'manage'), notifSched.runNow);
r.delete('/admin/notification-schedules/:id', authenticate, requireModule('BANNERS', 'manage'), notifSched.remove);

// --- Bulk Excel tools ---
r.get('/admin/bulk/salary/template', authenticate, requireModule('PAYROLL'), bulk.salaryTemplate);
r.post('/admin/bulk/salary', authenticate, requireModule('PAYROLL', 'manage'), bulk.salaryUpload);

// --- Full & Final settlement (exit pay; ties to resignation, not NFA) ---
r.post('/admin/fnf/preview/:employeeId', authenticate, requireModule('FNF', 'manage'), fnf.preview);
r.post('/admin/fnf/:employeeId', authenticate, requireModule('FNF', 'manage'), fnf.save);
r.post('/admin/fnf/:id/finalise', authenticate, requireModule('FNF', 'manage'), fnf.finalise);
r.post('/admin/fnf/:id/paid', authenticate, requireModule('FNF', 'manage'), fnf.markPaid);
r.get('/admin/fnf', authenticate, requireModule('FNF'), fnf.list);
r.get('/admin/fnf/:id/pdf', authenticate, requireModule('FNF'), fnf.pdf);

export default r;
