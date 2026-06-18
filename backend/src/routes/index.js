import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import * as emp from '../controllers/employeeController.js';
import * as ob from '../controllers/onboardingController.js';
import * as meta from '../controllers/metaController.js';
import * as users from '../controllers/userController.js';
import * as attendance from '../controllers/attendanceController.js';
import * as missPunch from '../controllers/missPunchController.js';
import * as onDuty from '../controllers/onDutyController.js';
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
r.post('/onduty', authenticate, onDuty.apply);
r.get('/onduty', authenticate, onDuty.listOwn);
r.get('/onduty/team', authenticate, onDuty.team);
r.post('/onduty/:id/review', authenticate, onDuty.review);

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

export default r;
