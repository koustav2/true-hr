// One vocabulary for every code the API returns. Screens must never print a raw
// enum (FULL_TIME, PAYMENT_RELEASED, in_stock …): call label(value) instead.
const MAP = {
  // Onboarding / employment state — one name per stage on every screen.
  OFFER_SENT: 'Offer sent', OFFER_ACCEPTED: 'Offer accepted', DETAILS_PENDING: 'Filling details',
  DETAILS_SUBMITTED: 'Awaiting review', HR_REVIEW: 'In review', SENT_BACK: 'Sent back',
  APPROVED: 'Approved', ACTIVE: 'Active', INACTIVE: 'Inactive', REJECTED: 'Rejected',
  EXPIRED: 'Expired', JOINING: 'Joining', EXITED: 'Exited',
  // Employment type
  FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACT: 'Contract', INTERN: 'Intern',
  CONSULTANT: 'Consultant', PROBATION: 'Probation', TRAINEE: 'Trainee',
  // Gender / marital
  MALE: 'Male', FEMALE: 'Female', OTHER: 'Other', SINGLE: 'Single', MARRIED: 'Married',
  DIVORCED: 'Divorced', WIDOWED: 'Widowed',
  // Generic workflow
  PENDING: 'Pending', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed',
  REOPENED: 'Reopened', CANCELLED: 'Cancelled', WITHDRAWN: 'Withdrawn', DRAFT: 'Draft',
  SUBMITTED: 'Submitted', VERIFIED: 'Verified', PUBLISHED: 'Published', FINALISED: 'Finalised',
  PAID: 'Paid', REVOKED: 'Reversed', QUERY: 'Query raised', QUERY_HOLD: 'On query', HOLD: 'On hold',
  ON_HOLD: 'On hold', SKIPPED: 'Skipped', BYPASSED: 'System bypass', AUTO_REJECTED: 'Auto-rejected',
  // Subscription
  TRIAL: 'Trial', PAST_DUE: 'Payment overdue', SUSPENDED: 'Suspended',
  // NFA
  PAYMENT_RELEASED: 'Payment released', ADVANCE_SELF: 'Advance (self)', ADVANCE_VENDOR: 'Advance (vendor)',
  REIMB_SELF: 'Reimbursement (self)', REIMB_VENDOR: 'Reimbursement (vendor)', PPS_CANDIDATE: 'PPS candidate',
  BILLABLE: 'Billable', NON_BILLABLE: 'Non-billable', EXPENSE: 'Expense', PURCHASE_REQUEST: 'Purchase request',
  // Masters
  CITY: 'City', OFFICE: 'Office', CENTER: 'Centre', SPECIAL: 'Special', CLIENT: 'Client', VENDOR: 'Vendor', BOTH: 'Client & vendor',
  // Assets
  IN_STOCK: 'In stock', ASSIGNED: 'Assigned', REPAIR: 'In repair', RETIRED: 'Retired', LOST: 'Lost',
  // Scheduler
  ONCE: 'One time', DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly',
  ALL: 'Everyone', COMPANY: 'Company', DEPARTMENT: 'Department', PAUSED: 'Paused',
  // Roles
  SUPER_ADMIN: 'Super Admin', HR_ADMIN: 'HR Admin', IT_ADMIN: 'IT Admin', EMPLOYEE: 'Employee',
  // KPI / PMS
  'PENDING-RPT': 'Pending with reporting manager', RM_PENDING: 'Pending with reporting manager',
  // Exit kinds
  RESIGNATION: 'Resignation', TERMINATION: 'Termination',
  // Asset condition
  NEW: 'New', GOOD: 'Good', FAIR: 'Fair', DAMAGED: 'Damaged',
  // NFA / settlement / PMS workflow
  LOCKED: 'Approved', DISCUSS: 'Sent back for discussion', ONGOING: 'Ongoing', FUNCTIONAL_APPROVED: 'Rated',
  APPROVAL_PENDING: 'Approval pending', NOT_SUBMITTED: 'Not submitted', CLOSE: 'Settled',
  BILLABLE_CLIENT: 'Billable to client', BILLABLE_PARTNER: 'Billable to partner', INCENTIVE: 'Incentive',
  // Approval stages
  REPORTING_MANAGER: 'Reporting manager', FUNCTIONAL_MANAGER: 'Functional manager', FUNCTIONAL_HEAD: 'Functional head',
  BUSINESS_HEAD: 'Business head', BUSINESS_LEADER: 'Business leader', PROJECT_LEADER: 'Project leader',
  OFFICE_ADMIN: 'Office admin', FINANCE: 'Finance', FINANCE_INITIATOR: 'Finance initiator',
  FINAL_APPROVAL: 'Final approval', HR: 'Human resources', ADMIN: 'Admin', IT_INFRA: 'IT infrastructure',
};

// Known code → label; unknown SHOUTY_CODE or lower_code → "Sentence case".
export function label(v) {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v);
  if (MAP[s]) return MAP[s];
  const up = s.toUpperCase().replace(/[\s-]+/g, '_');
  if (MAP[up]) return MAP[up];
  if (/^[A-Z0-9_]+$/.test(s) || /^[a-z0-9_ ]+$/.test(s)) {
    const t = s.replace(/_/g, ' ').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return s;
}

// <select> options from a list of codes, labelled.
export const options = (codes) => codes.map((c) => ({ value: c, label: label(c) }));

// Dates: one display format across the portal (dd-mm-yyyy), from either an ISO
// string or a Date, without the UTC off-by-one of toISOString() in India.
export function fmtDate(v) {
  if (!v) return '—';
  const s = typeof v === 'string' ? v : (v instanceof Date ? isoLocal(v) : String(v));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}
export function isoLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Today as YYYY-MM-DD in the browser's own timezone (use for date input defaults).
export const todayIso = () => isoLocal(new Date());
