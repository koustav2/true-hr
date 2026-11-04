// /api/v2 routes for the "leave" area. Guard every route exactly as the v1 table does.
import { Router } from 'express';
import { catchAsync } from '../../utils/asyncRoutes.js';
import { authenticate, requireModule, requireOrg, hasModule } from '../../middleware/auth.js';
import * as leaveAdmin from '../../controllers/leaveAdminController.js';
import * as attendance from '../../controllers/attendanceController.js';
import * as missPunch from '../../controllers/missPunchController.js';

const r = catchAsync(Router());

// HR attendance & approvals (C41/E9): the ATTENDANCE module, or LEAVE for an
// organisation whose roles only grant Leave configuration.
const attendanceGuard = (level = 'view') => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'Missing token' });
  if (hasModule(req.auth, 'ATTENDANCE', level) || hasModule(req.auth, 'LEAVE', level)) return next();
  return res.status(403).json({
    error: 'You do not have access to attendance. Ask a Super Admin to grant it.', module: 'ATTENDANCE', required: level,
  });
};

// --- Holidays (C17, H61-H63, E5, E11) ---
r.get('/admin/holidays/meta', authenticate, requireOrg, requireModule('LEAVE'), leaveAdmin.holidayMeta);
r.put('/admin/holidays/:id', authenticate, requireOrg, requireModule('LEAVE', 'manage'), leaveAdmin.updateHoliday);

// --- State-wise quota overrides (D5, C18, H58, H59, C45) ---
r.get('/admin/leave-states', authenticate, requireOrg, requireModule('LEAVE'), leaveAdmin.listStateQuotas);
r.put('/admin/leave-states', authenticate, requireOrg, requireModule('LEAVE', 'manage'), leaveAdmin.saveStateQuotas);

// --- Leave & attendance policy (E4, E10, E11, E7) ---
r.get('/admin/leave-settings', authenticate, requireOrg, requireModule('LEAVE'), leaveAdmin.getSettings);
r.put('/admin/leave-settings', authenticate, requireOrg, requireModule('LEAVE', 'manage'), leaveAdmin.saveSettings);
r.post('/admin/leave-balances/allocate', authenticate, requireOrg, requireModule('LEAVE', 'manage'), attendance.adminAllocate);

// --- Admin > Attendance (C41, E9) ---
r.get('/admin/attendance/employees', authenticate, requireOrg, attendanceGuard(), attendance.adminEmployees);
r.get('/admin/attendance/daily', authenticate, requireOrg, attendanceGuard(), attendance.adminDaily);
r.get('/admin/attendance/monthly', authenticate, requireOrg, attendanceGuard(), attendance.adminMonthly);
r.get('/admin/attendance/summary', authenticate, requireOrg, attendanceGuard(), attendance.adminSummary);
r.get('/admin/attendance/requests', authenticate, requireOrg, attendanceGuard(), attendance.adminRequests);
r.post('/admin/attendance/requests/:kind/:id/review', authenticate, requireOrg, attendanceGuard('manage'), attendance.adminReview);
r.get('/admin/attendance/leave/:id/certificate', authenticate, requireOrg, attendanceGuard(), attendance.adminCertificate);

// --- Employee: miss-punch cancel (E7) ---
r.post('/misspunch/:id/cancel', authenticate, missPunch.cancel);

export default r;
