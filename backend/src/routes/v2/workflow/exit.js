// /api/v2 workflow routes — exits (resignations & terminations). Composed by ../workflow.js.
// Guards mirror the v1 table in routes/index.js.
import { Router } from 'express';
import { catchAsync } from '../../../utils/asyncRoutes.js';
import { authenticate, requireModule, requireOrg } from '../../../middleware/auth.js';
import * as resignation from '../../../controllers/resignationController.js';
import * as termination from '../../../controllers/terminationController.js';

const r = catchAsync(Router());

// Terminate picker: active employees only (C26, H88, H89).
r.get('/admin/terminations/eligible', authenticate, requireOrg, requireModule('TERMINATION'), termination.eligible);

// Optional resignation letter attached on the v2 form (E51).
r.get('/resignation/:id/letter', authenticate, resignation.letter);

export default r;
