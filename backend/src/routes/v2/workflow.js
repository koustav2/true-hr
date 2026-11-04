// /api/v2 routes for the "workflow" area. Guard every route exactly as the v1 table does.
// Split per sub-area (NFA & approvals, vendors, PMS & tasks, exits) so each
// part stays readable; all are mounted here in order.
import { Router } from 'express';
import { catchAsync } from '../../utils/asyncRoutes.js';
import nfa from './workflow/nfa.js';
import vendor from './workflow/vendor.js';
import pms from './workflow/pms.js';
import exit from './workflow/exit.js';

const r = catchAsync(Router());
for (const sub of [nfa, vendor, pms, exit]) r.use(sub);

export default r;
