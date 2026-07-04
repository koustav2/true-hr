// Role hierarchy: SUPER_ADMIN → HR_ADMIN → IT_ADMIN
export const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  HR_ADMIN: 'HR Admin',
  IT_ADMIN: 'IT Admin',
  EMPLOYEE: 'Employee',
};

// Capability checks
export const can = {
  // HR data: employees, onboarding, review queue
  hr: (role) => role === 'HR_ADMIN' || role === 'SUPER_ADMIN',
  // System administration: user accounts, audit log
  admin: (role) => role === 'IT_ADMIN' || role === 'SUPER_ADMIN',
  // Only super admins can create/elevate to super admin
  superadmin: (role) => role === 'SUPER_ADMIN',
};

import { FEATURES } from './flags.js';

// Landing page per role after login.
export function homeFor(role) {
  if (role === 'EMPLOYEE' && FEATURES.nfaSuite) return '/ess';
  return can.hr(role) ? '/admin' : '/admin/users';
}
