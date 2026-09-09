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

// These are the sidebar sections, in order, and the permissions matrix reads
// the same way — one vocabulary, so "where do I grant Terminations?" has the
// same answer on both screens. Grouped by the job being done rather than by the
// table the data sits in: an HR user thinks "someone is leaving", not
// "resignations".
export const MODULE_GROUPS = {
  WORKSPACE: 'Workspace',
  PEOPLE: 'People',
  PAY: 'Pay & Compliance',
  SEPARATION: 'Separation',
  COMMS: 'Documents & Comms',
  FINANCE: 'NFA & Finance',
  PERFORMANCE: 'Performance',
  DATA: 'Data & Reports',
  ADMIN: 'Administration',
};

// Order here is the order shown in the permissions matrix and the sidebar.
export const MODULES = [
  // ── WORKSPACE ─────────────────────────────────────────────────
  { key: 'DASHBOARD',     label: 'Dashboard',            group: MODULE_GROUPS.WORKSPACE,   path: '/admin' },
  { key: 'SUPPORT',       label: 'Support Desk',         group: MODULE_GROUPS.WORKSPACE,       path: '/admin/support' },
  // ── PEOPLE ────────────────────────────────────────────────────
  { key: 'EMPLOYEES',     label: 'Employees',            group: MODULE_GROUPS.PEOPLE,      path: '/admin/employees' },
  { key: 'ONBOARDING',    label: 'Onboarding & Review',  group: MODULE_GROUPS.PEOPLE,      path: '/admin/review' },
  { key: 'ATTENDANCE',    label: 'Attendance',           group: MODULE_GROUPS.PEOPLE },
  { key: 'LEAVE',         label: 'Leave Configuration',  group: MODULE_GROUPS.PEOPLE,      path: '/admin/leave-config' },
  { key: 'STRUCTURE',     label: 'Departments & Roles',  group: MODULE_GROUPS.PEOPLE,
    path: '/admin/hierarchy',
    note: 'Departments, designations and the organisation level ladder' },
  { key: 'CHANGEREQ',     label: 'Change Requests',      group: MODULE_GROUPS.PEOPLE,      path: '/admin/change-requests',
    note: 'Employee-submitted profile, address and bank changes awaiting approval' },
  { key: 'ORGCHART',      label: 'Organisation Chart',   group: MODULE_GROUPS.PEOPLE,      path: '/admin/org-chart',
    note: 'Reporting hierarchy by manager level' },
  // ── PAY ───────────────────────────────────────────────────────
  { key: 'PAYROLL',       label: 'Payroll & Payslips',   group: MODULE_GROUPS.PAY,     path: '/admin/payroll',
    sensitive: true, note: 'Salary structures, runs and bank sheets' },
  { key: 'INCREMENT',     label: 'Increment Management', group: MODULE_GROUPS.PAY,     path: '/admin/increments',
    sensitive: true, note: 'Salary revisions: propose, approve, apply and letter' },
  { key: 'PAYCOMP',       label: 'Payslip Components',   group: MODULE_GROUPS.PAY,     path: '/admin/salary-components',
    sensitive: true, note: 'What each company\u2019s payslip is made of \u2014 earnings and deductions' },
  { key: 'STATUTORY',     label: 'Statutory (PF/ESIC/Gratuity)', group: MODULE_GROUPS.PAY, path: '/admin/statutory',
    sensitive: true, note: 'PF/ESIC/gratuity records, nominees, registers & Form 16' },
  { key: 'INVDECL',       label: 'Investment Declarations', group: MODULE_GROUPS.PAY,     path: '/admin/tax-declarations',
    note: 'Employee income-tax declarations — verify and lock' },
  // ── SEPARATION ────────────────────────────────────────────────
  { key: 'RESIGNATION',   label: 'Resignations',         group: MODULE_GROUPS.SEPARATION,      path: '/admin/resignations' },
  { key: 'TERMINATION',   label: 'Terminations',         group: MODULE_GROUPS.SEPARATION,      path: '/admin/terminations',
    sensitive: true, note: 'Ending an employee’s service' },
  { key: 'FNF',           label: 'Full & Final Settlement', group: MODULE_GROUPS.SEPARATION,     path: '/admin/fnf',
    sensitive: true, note: 'Exit pay computation' },
  // ── COMMS ─────────────────────────────────────────────────────
  { key: 'LETTERS',       label: 'Letters',              group: MODULE_GROUPS.COMMS,      path: '/admin/letters',
    note: 'Confirmation, transfer, experience, relieving and more' },
  { key: 'POLICIES',      label: 'Policies',             group: MODULE_GROUPS.COMMS,       path: '/admin/policies' },
  { key: 'DOCBRAND',      label: 'Document Branding',    group: MODULE_GROUPS.COMMS,       path: '/admin/branding',
    sensitive: true,
    note: 'Letterhead, logo, signatory and PDF templates per organisation or company' },
  { key: 'BANNERS',       label: 'App Banners',          group: MODULE_GROUPS.COMMS,       path: '/admin/banners' },
  // ── FINANCE ───────────────────────────────────────────────────
  { key: 'NFA',           label: 'NFA',                  group: MODULE_GROUPS.FINANCE,     path: '/admin/nfa' },
  { key: 'SETTLEMENTS',   label: 'Settlements',          group: MODULE_GROUPS.FINANCE },
  { key: 'NFA_REPORTS',   label: 'NFA Reports',          group: MODULE_GROUPS.FINANCE,     path: '/admin/nfa-reports' },
  { key: 'VENDORS',       label: 'Vendors & Agreements', group: MODULE_GROUPS.FINANCE,     path: '/admin/vendors' },
  { key: 'MASTERS',       label: 'Masters',              group: MODULE_GROUPS.FINANCE,     path: '/admin/masters' },
  { key: 'APPROVERS',     label: 'Approver Matrix',      group: MODULE_GROUPS.FINANCE, path: '/admin/approvers' },
  // ── PERFORMANCE ───────────────────────────────────────────────
  { key: 'PMS',           label: 'Performance (PMS)',    group: MODULE_GROUPS.PERFORMANCE, path: '/admin/pms' },
  // ── DATA ──────────────────────────────────────────────────────
  { key: 'BULK',          label: 'Bulk Utilities',       group: MODULE_GROUPS.DATA,      path: '/admin/bulk',
    sensitive: true, note: 'Excel round-trip updates for pay, managers, transfers and leave balances' },
  { key: 'HRMIS',         label: 'HRMIS Reports',        group: MODULE_GROUPS.DATA,      path: '/admin/hrmis',
    sensitive: true, note: 'One workbook of people, pay, statutory, leave, assets and exits' },
  // ── ADMIN ─────────────────────────────────────────────────────
  { key: 'COMPANIES',     label: 'Companies',            group: MODULE_GROUPS.ADMIN,       path: '/admin/companies',
    sensitive: true, note: 'Legal entities inside this organisation' },
  { key: 'USERS',         label: 'Users & Accounts',     group: MODULE_GROUPS.ADMIN,       path: '/admin/users',
    sensitive: true, note: 'Creating logins and assigning roles' },
  { key: 'ROLES',         label: 'Roles & Permissions',  group: MODULE_GROUPS.ADMIN,       path: '/admin/roles',
    sensitive: true, note: 'Who can open what — grant with care' },
  { key: 'ASSETS',        label: 'Asset Management',     group: MODULE_GROUPS.ADMIN,       path: '/admin/assets',
    note: 'IT & non-IT asset register and assignment' },
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
      'TERMINATION', 'PAYROLL', 'INCREMENT', 'PAYCOMP', 'POLICIES', 'SUPPORT', 'BANNERS', 'CHANGEREQ', 'ORGCHART',
      'BULK', 'HRMIS', 'DOCBRAND',
      'MASTERS', 'APPROVERS', 'NFA', 'SETTLEMENTS', 'NFA_REPORTS', 'VENDORS', 'PMS',
      'STRUCTURE', 'STATUTORY', 'INVDECL', 'FNF', 'LETTERS', 'ASSETS',
    ],
    // Companies & organisations are a Super Admin / platform-owner concern only —
    // HR hires into a company via the /meta/companies lookup, not the admin screen.
    // Creating logins is not HR's job either: only a Super Admin (and IT Admin,
    // whose whole remit is accounts) may mint HR/IT accounts. A Super Admin can
    // still grant USERS to HR explicitly from Roles & Permissions.
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

// ── Subscription plans (Master-controlled, per organisation) ────────────────
// The Master sells an organisation a plan; the plan seeds `organisation_modules`.
// From then on the Master may hand-pick modules (which flips the plan to CUSTOM).
// A role can never grant a module the organisation is not entitled to.

export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED'];

// While a subscription is EXPIRED the tenant keeps only this, so its people can
// still sign in and see why they are locked out rather than hitting dead pages.
export const GRACE_MODULES = ['DASHBOARD'];

const STARTER = [
  'DASHBOARD', 'EMPLOYEES', 'ONBOARDING', 'ATTENDANCE', 'LEAVE', 'STRUCTURE',
  'POLICIES', 'SUPPORT', 'USERS', 'ROLES', 'AUDIT', 'CHANGEREQ', 'ORGCHART', 'DOCBRAND',
];
const GROWTH = [
  ...STARTER, 'COMPANIES', 'PAYROLL', 'INCREMENT', 'PAYCOMP', 'STATUTORY', 'INVDECL', 'FNF', 'LETTERS',
  'BULK', 'HRMIS',
  'RESIGNATION', 'TERMINATION', 'ASSETS', 'BANNERS',
];

export const PLANS = [
  { key: 'STARTER', label: 'Starter', description: 'Core people records, onboarding and leave.', modules: STARTER },
  { key: 'GROWTH', label: 'Growth', description: 'Adds payroll, statutory, letters and the exit lifecycle.', modules: GROWTH },
  { key: 'ENTERPRISE', label: 'Enterprise', description: 'Everything, including NFA finance and performance.', modules: 'all' },
  { key: 'CUSTOM', label: 'Custom', description: 'Hand-picked modules.', modules: null },
];

export const isPlan = (k) => PLANS.some((p) => p.key === k);

/** Modules a plan includes. CUSTOM returns null — the caller keeps its own set. */
export function planModules(planKey) {
  const p = PLANS.find((x) => x.key === planKey);
  if (!p) return null;
  if (p.modules === 'all') return ALL_ORG_MODULES.slice();
  if (!p.modules) return null;
  return p.modules.filter((k) => ALL_ORG_MODULES.includes(k));
}

/** Every module an organisation could ever be sold (platform-only excluded). */
export const SELLABLE_MODULES = ALL_ORG_MODULES;
