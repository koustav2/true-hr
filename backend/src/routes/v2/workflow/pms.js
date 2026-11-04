// /api/v2 workflow routes — PMS / KPI and tasks. Composed by ../workflow.js.
// Guards mirror the v1 table (routes/index.js) for the same module.
import { Router } from 'express';
import { catchAsync } from '../../../utils/asyncRoutes.js';
import { authenticate, requireModule, requireOrg } from '../../../middleware/auth.js';
import * as pms from '../../../controllers/pmsController.js';
import * as task from '../../../controllers/taskController.js';

const r = catchAsync(Router());

// PMS / KPI — employee
r.get('/kpi/allowed-months', authenticate, pms.kpiAllowedMonths);
r.delete('/kpi/:id', authenticate, pms.withdrawKpi);

// PMS / KPI — HR (module PMS)
r.put('/admin/pms/grades', authenticate, requireOrg, requireModule('PMS', 'manage'), pms.saveGrades);
r.delete('/admin/pms/grades', authenticate, requireOrg, requireModule('PMS', 'manage'), pms.resetGrades);
r.get('/admin/pms/overview', authenticate, requireOrg, requireModule('PMS'), pms.overview);
r.get('/admin/pms/cycles', authenticate, requireOrg, requireModule('PMS'), pms.listCycles);
r.post('/admin/pms/cycles', authenticate, requireOrg, requireModule('PMS', 'manage'), pms.startCycle);

// Tasks
r.get('/tasks/team-members', authenticate, task.teamMembers);

export default r;
