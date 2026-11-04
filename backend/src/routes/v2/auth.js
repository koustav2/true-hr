// /api/v2 routes for the "auth" area. Guard every route exactly as the v1 table does.
import { Router } from 'express';
import { catchAsync } from '../../utils/asyncRoutes.js';
import { authenticate, requireModule, requireOrg, requirePlatformAdmin } from '../../middleware/auth.js';
import { auditTrail } from '../../utils/audit.js';
import * as auth from '../../controllers/authController.js';
import * as users from '../../controllers/userController.js';
import * as wishes from '../../controllers/wishesController.js';
import * as notifSched from '../../controllers/notificationScheduleController.js';

const r = catchAsync(Router());

// C43: every successful admin write on v2 lands in the audit log, even when
// the handler that served it does not call audit() itself.
r.use(auditTrail);

// D3: first password from a one-time link (public; the token is the credential).
r.get('/auth/set-password', auth.setPasswordInfo);
r.post('/auth/set-password', auth.setPasswordWithToken);

// C39: give a staff login a person's name.
r.post('/admin/users/:id/name', authenticate, requireOrg, requireModule('USERS', 'manage'), users.setUserName);

// H47: email delivery diagnostics — platform owner only.
r.get('/admin/email-health', authenticate, requirePlatformAdmin, auth.emailHealth);
r.post('/admin/email-health/test', authenticate, requirePlatformAdmin, auth.emailHealthTest);

// M7: Wishes and the Notification Scheduler are modules of their own on v2,
// so a plan or role can switch them off. (v1 keeps its EMPLOYEES / BANNERS
// guards; the migration granted the new modules to every role that had those.)
r.get('/admin/wishes', authenticate, requireModule('WISHES'), wishes.upcoming);
r.get('/admin/notification-schedules', authenticate, requireModule('SCHEDULER'), notifSched.list);
r.post('/admin/notification-schedules', authenticate, requireModule('SCHEDULER', 'manage'), notifSched.create);
r.post('/admin/notification-schedules/:id/toggle', authenticate, requireModule('SCHEDULER', 'manage'), notifSched.toggle);
r.post('/admin/notification-schedules/:id/run', authenticate, requireModule('SCHEDULER', 'manage'), notifSched.runNow);
r.delete('/admin/notification-schedules/:id', authenticate, requireModule('SCHEDULER', 'manage'), notifSched.remove);

export default r;
