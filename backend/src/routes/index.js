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
import { authenticate, requireStaff, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';

const r = Router();

// --- Auth ---
r.post('/auth/login', auth.login);
r.post('/auth/change-password', authenticate, auth.changePassword);
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

export default r;
