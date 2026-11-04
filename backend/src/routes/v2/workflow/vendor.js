// /api/v2 workflow routes — vendors & agreements. Composed by ../workflow.js.
// Guards mirror the v1 table (routes/index.js): employee routes need only a
// login; admin routes need the VENDORS module.
import { Router } from 'express';
import { catchAsync } from '../../../utils/asyncRoutes.js';
import { authenticate, requireModule } from '../../../middleware/auth.js';
import * as vendor from '../../../controllers/vendorController.js';

const r = catchAsync(Router());

r.get('/meta/vendor-options', authenticate, vendor.vendorOptions);

// Employee: edit / withdraw own pending registration or agreement.
r.put('/vendors/:id', authenticate, vendor.updateOwnVendor);
r.post('/vendors/:id/withdraw', authenticate, vendor.withdrawVendor);
r.post('/agreements/:id/withdraw', authenticate, vendor.withdrawAgreement);

// Admin: add / edit / deactivate vendors, approval trail, upload agreements.
r.post('/admin/vendors', authenticate, requireModule('VENDORS', 'manage'), vendor.adminCreateVendor);
r.put('/admin/vendors/:id', authenticate, requireModule('VENDORS', 'manage'), vendor.adminUpdateVendor);
r.post('/admin/vendors/:id/deactivate', authenticate, requireModule('VENDORS', 'manage'), vendor.setVendorActive);
r.post('/admin/vendors/:id/reactivate', authenticate, requireModule('VENDORS', 'manage'), vendor.setVendorActive);
r.get('/admin/vendors/:id/trail', authenticate, requireModule('VENDORS'), vendor.vendorTrail);
r.post('/admin/agreements', authenticate, requireModule('VENDORS', 'manage'), vendor.adminCreateAgreement);

export default r;
