// /api/v2 — routes that exist only for v2 clients (the web portal). Anything
// not matched here falls through to the shared route table in ../index.js,
// where handlers branch on req.apiVersion (utils/apiVersion.js).
//
// One file per area so parallel work never edits the same file.
import { Router } from 'express';
import { catchAsync } from '../../utils/asyncRoutes.js';
import auth from './auth.js';
import people from './people.js';
import leave from './leave.js';
import payroll from './payroll.js';
import org from './org.js';
import workflow from './workflow.js';

const r = catchAsync(Router());
for (const area of [auth, people, leave, payroll, org, workflow]) r.use(area);
export default r;
