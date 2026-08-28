// ============================================================================
// Module registry — the catalogue of permissionable areas of TRUE HR.
//
// Access used to be frozen in code (requireStaff / requireAdmin / ...). It is
// now data: a Super Admin ticks modules per role from the portal and the change
// takes effect on the next request, with no deploy.
//
// `group` drives the sidebar grouping in the web portal so a new module shows up
// in the right place automatically.
// ============================================================================

export const MODULE_GROUPS = {
  WORKSPACE: 'Workspace',
  PEOPLE: 'People',
  PAYROLL: 'Payroll',
  FINANCE: 'NFA & Finance',
  PERFORMANCE: 'Performance',
  ADMIN: 'Administration',
};

// Order here is the order shown in the permissions matrix and the sidebar.
export const MODULES = [
  { key: 'DASHBOARD',     label: 'Dashboard',            group: MODULE_GROUPS.WORKSPACE,   path: '/admin' },
  { key: 'EMPLOYEES',     label: 'Employees',            group: MODULE_GROUPS.PEOPLE,      path: '/admin/employees' },
  { key: 'ONBOARDING',    label: 'Onboarding & Review',  group: MODULE_GROUPS.PEOPLE,      path: '/admin/review' },
  { key: 'ATTENDANCE',    label: 'Attendance',           group: MODULE_GROUPS.PEOPLE },
  { key: 'LEAVE',         label: 'Leave Configuration',  group: MODULE_GROUPS.PEOPLE,      path: '/admin/leave-config' },
  { key: 'STRUCTURE',     label: 'Departments & Roles',  group: MODULE_GROUPS.PEOPLE,
    note: 'Departments and designations inside a company' },
  { key: 'RESIGNATION',   label: 'Resignations',         group: MODULE_GROUPS.PEOPLE,      path: '/admin/resignations' },
  { key: 'LETTERS',       label: 'Letters',              group: MODULE_GROUPS.PEOPLE,      path: '/admin/letters',
    note: 'Confirmation, transfer, experience, relieving and more' },
  { key: 'TERMINATION',   label: 'Terminations',         group: MODULE_GROUPS.PEOPLE,      path: '/admin/terminations',
    sensitive: true, note: 'Ending an employee’s service' },
  { key: 'PAYROLL',       label: 'Payroll & Payslips',   group: MODULE_GROUPS.PAYROLL,     path: '/admin/payroll',
    sensitive: true, note: 'Salary structures, runs and bank sheets' },
  { key: 'STATUTORY',     label: 'Statutory (PF/ESIC/Gratuity)', group: MODULE_GROUPS.PAYROLL, path: '/admin/statutory',
    sensitive: true, note: 'PF/ESIC/gratuity records, nominees, registers & Form 16' },
  { key: 'INVDECL',       label: 'Investment Declarations', group: MODULE_GROUPS.PAYROLL,     path: '/admin/tax-declarations',
    note: 'Employee income-tax declarations — verify and lock' },
  { key: 'FNF',           label: 'Full & Final Settlement', group: MODULE_GROUPS.PAYROLL,     path: '/admin/fnf',
    sensitive: true, note: 'Exit pay computation' },
  { key: 'NFA',           label: 'NFA',                  group: MODULE_GROUPS.FINANCE,     path: '/admin/nfa' },
  { key: 'SETTLEMENTS',   label: 'Settlements',          group: MODULE_GROUPS.FINANCE },
  { key: 'NFA_REPORTS',   label: 'NFA Reports',          group: MODULE_GROUPS.FINANCE,     path: '/admin/nfa-reports' },
  { key: 'VENDORS',       label: 'Vendors & Agreements', group: MODULE_GROUPS.FINANCE,     path: '/admin/vendors' },
  { key: 'MASTERS',       label: 'Masters',              group: MODULE_GROUPS.FINANCE,     path: '/admin/masters' },
  { key: 'PMS',           label: 'Performance (PMS)',    group: MODULE_GROUPS.PERFORMANCE, path: '/admin/pms' },
  { key: 'APPROVERS',     label: 'Approver Matrix',      group: MODULE_GROUPS.PERFORMANCE, path: '/admin/approvers' },
  { key: 'POLICIES',      label: 'Policies',             group: MODULE_GROUPS.ADMIN,       path: '/admin/policies' },
  { key: 'SUPPORT',       label: 'Support Desk',         group: MODULE_GROUPS.ADMIN,       path: '/admin/support' },
  { key: 'BANNERS',       label: 'App Banners',          group: MODULE_GROUPS.ADMIN,       path: '/admin/banners' },
  { key: 'ASSETS',        label: 'Asset Management',     group: MODULE_GROUPS.ADMIN,       path: '/admin/assets',
    note: 'IT & non-IT asset register and assignment' },
  { key: 'COMPANIES',     label: 'Companies',            group: MODULE_GROUPS.ADMIN,       path: '/admin/companies',
    sensitive: true, note: 'Legal entities inside this organisation' },
  { key: 'USERS',         label: 'Users & Accounts',     group: MODULE_GROUPS.ADMIN,       path: '/admin/users',
    sensitive: true, note: 'Creating logins and assigning roles' },
  { key: 'ROLES',         label: 'Roles & Permissions',  group: MODULE_GROUPS.ADMIN,       path: '/admin/roles',
    sensitive: true, note: 'Who can open what — grant with care' },
  { key: 'AUDIT',         label: 'Audit Log',            group: MODULE_GROUPS.ADMIN,       path: '/admin/audit' },
  { key: 'ORGANISATIONS', label: 'Organisations',        group: MODULE_GROUPS.ADMIN,       path: '/admin/organisations',
    platformOnly: true, note: 'Creating and switching organisations' },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
const MODULE_SET = new Set(MODULE_KEYS);
export const isModule = (k) => MODULE_SET.has(k);
export const moduleLabel = (k) => MODULES.find((m) => m.key === k)?.label || k;

// Modules a platform owner manages; never granted to an org-scoped role.
export const PLATFORM_ONLY = MODULES.filter((m) => m.platformOnly).map((m) => m.key);

// ── Seeded system roles ─────────────────────────────────────────────────────
// Every new organisation starts with these four. They mirror exactly what the
// old hardcoded guards allowed, so behaviour is unchanged on day one — but each
// is now editable from the portal (except Super Admin, which always has all).
//
//   'all'  → every non-platform module at manage level
//   [...]  → manage on the listed modules
//   view:  → view-only on the listed modules
const ALL_ORG_MODULES = MODULE_KEYS.filter((k) => !PLATFORM_ONLY.includes(k));

export const SYSTEM_ROLES = [
  {
    key: 'SUPER_ADMIN',
    label: 'Super Admin',
    description: 'Full control of this organisation, including roles and permissions.',
    baseRole: 'SUPER_ADMIN',
    rank: 0,
    manage: 'all',
  },
  {
    key: 'HR_ADMIN',
    label: 'HR Admin',
    description: 'People, payroll and everything in the employee lifecycle.',
    baseRole: 'HR_ADMIN',
    rank: 10,
    manage: [
      'DASHBOARD', 'EMPLOYEES', 'ONBOARDING', 'ATTENDANCE', 'LEAVE', 'RESIGNATION',
      'TERMINATION', 'PAYROLL', 'POLICIES', 'SUPPORT', 'BANNERS', 'USERS',
      'MASTERS', 'APPROVERS', 'NFA', 'SETTLEMENTS', 'NFA_REPORTS', 'VENDORS', 'PMS',
      'STRUCTURE', 'STATUTORY', 'INVDECL', 'FNF', 'LETTERS', 'ASSETS',
    ],
    // HR needs to see the company list to hire into one, but creating legal
    // entities is a Super Admin decision.
    view: ['COMPANIES'],
  },
  {
    key: 'IT_ADMIN',
    label: 'IT Admin',
    description: 'User accounts, roles and the audit trail. No payroll or PII.',
    baseRole: 'IT_ADMIN',
    rank: 20,
    manage: ['USERS', 'ROLES', 'AUDIT'],
    view: ['DASHBOARD'],
  },
  {
    key: 'EMPLOYEE',
    label: 'Employee',
    description: 'Self-service only — no admin console access.',
    baseRole: 'EMPLOYEE',
    rank: 100,
    manage: [],
  },
];

// Optional starter roles a Super Admin can create in one click from the portal.
// These are the leadership roles that could not exist under the old fixed enum.
export const ROLE_PRESETS = [
  {
    key: 'CEO', label: 'Chief Executive Officer', baseRole: 'HR_ADMIN', rank: 5,
    description: 'Full visibility across the organisation, without day-to-day administration.',
    manage: ['DASHBOARD'],
    view: ['EMPLOYEES', 'PAYROLL', 'RESIGNATION', 'TERMINATION', 'NFA', 'NFA_REPORTS', 'PMS', 'AUDIT'],
  },
  {
    key: 'PRESIDENT', label: 'President', baseRole: 'HR_ADMIN', rank: 6,
    description: 'Organisation-wide visibility with approval authority.',
    manage: ['DASHBOARD', 'NFA'],
    view: ['EMPLOYEES', 'PAYROLL', 'RESIGNATION', 'NFA_REPORTS', 'PMS'],
  },
  {
    key: 'CTO', label: 'Chief Technology Officer', baseRole: 'HR_ADMIN', rank: 6,
    description: 'Technology leadership — people and performance, no payroll.',
    manage: ['DASHBOARD', 'PMS'],
    view: ['EMPLOYEES', 'ATTENDANCE', 'NFA', 'NFA_REPORTS'],
  },
  {
    key: 'CFO', label: 'Chief Financial Officer', baseRole: 'HR_ADMIN', rank: 6,
    description: 'Finance leadership — payroll, expenses and reporting.',
    manage: ['DASHBOARD', 'PAYROLL', 'NFA', 'SETTLEMENTS', 'NFA_REPORTS', 'VENDORS'],
    view: ['EMPLOYEES', 'PMS'],
  },
  {
    key: 'PAYROLL_OFFICER', label: 'Payroll Officer', baseRole: 'HR_ADMIN', rank: 30,
    description: 'Runs payroll and nothing else.',
    manage: ['PAYROLL'],
    view: ['DASHBOARD', 'EMPLOYEES', 'ATTENDANCE'],
  },
  {
    key: 'RECRUITER', label: 'Recruiter', baseRole: 'HR_ADMIN', rank: 30,
    description: 'Hiring and onboarding only — no payroll or exits.',
    manage: ['EMPLOYEES', 'ONBOARDING'],
    view: ['DASHBOARD'],
  },
];

// Expand a role definition ({manage, view}) into matrix rows.
export function expandRoleModules(def) {
  const rows = new Map();
  const manage = def.manage === 'all' ? ALL_ORG_MODULES : (def.manage || []);
  for (const k of def.view || []) if (isModule(k)) rows.set(k, { canView: true, canManage: false });
  for (const k of manage) if (isModule(k)) rows.set(k, { canView: true, canManage: true });
  return [...rows.entries()].map(([moduleKey, v]) => ({ moduleKey, ...v }));
}
