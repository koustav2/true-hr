import { query } from '../db/pool.js';
import { activeEmployeeSql, candidateSql } from '../utils/people.js';
import { todayIST } from '../utils/validate.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// GET /admin/stats — aggregate live metrics for the HR dashboard.
//
// "Employee" here means activeEmployeeSql() (decision D7): onboarded, with a
// code, not past an approved last working day. Candidates are counted apart.
// Every count is bounded by the caller's organisation and, for a company-
// scoped admin, by their company. New fields are additive; v1 keeps its keys.
export async function stats(req, res, next) {
  try {
    const [y, m] = todayIST().split('-').map(Number);
    const year = y;
    const month = m;

    const org = req.orgId || null;
    const co = req.companyScope || null;
    // Employee-scoped predicate shared by every per-employee count below.
    const scopeE = `($1::bigint IS NULL OR e.organisation_id=$1) AND ($2::bigint IS NULL OR e.company_id=$2)`;
    const P = [org, co];

    const pipeline = (await query(
      `SELECT e.onboarding_status AS s, COUNT(*)::int AS n FROM employees e
        WHERE ${scopeE} AND ${candidateSql('e')}
        GROUP BY e.onboarding_status`, P)).rows;
    const pc = (keys) => pipeline.filter((r) => keys.includes(r.s)).reduce((a, r) => a + r.n, 0);

    const one = async (sql, params = P) => {
      try { return Number((await query(sql, params)).rows[0]?.n || 0); }
      catch (e) { console.warn('[dashboard] count failed:', e.message); return 0; }
    };
    const pendingVia = (table, statusSql = `r.status='PENDING'`, empCol = 'employee_id') =>
      one(`SELECT COUNT(*)::int n FROM ${table} r JOIN employees e ON e.id=r.${empCol} WHERE ${statusSql} AND ${scopeE}`);

    const [headcount, leave, od, missPunch, compOff, tickets, policies, pubSlips, draftSlips,
      changeRequests, nfaPending, nfaQuery, vendors, agreements, taxDecl, resignations, kpiPending, pmsPending,
      inactive] = await Promise.all([
      one(`SELECT COUNT(*)::int n FROM employees e WHERE ${scopeE} AND ${activeEmployeeSql('e')}`),
      pendingVia('leave_requests'),
      pendingVia('on_duty'),
      pendingVia('miss_punch'),
      pendingVia('comp_off_requests'),
      pendingVia('support_tickets', `r.status IN ('PENDING','IN_PROGRESS','REOPENED')`),
      // policies had no organisation column, so this tile counted every
      // tenant's documents — a live readout of how much other tenants hold.
      one(`SELECT COUNT(*)::int n FROM policies WHERE ($1::bigint IS NULL OR organisation_id=$1)`, [org]),
      // Payslips of employees who are on payroll now (H2): candidates and
      // people who have left no longer inflate the denominator.
      one(`SELECT COUNT(*)::int n FROM payslips p JOIN employees e ON e.id=p.employee_id
            WHERE p.year=$3 AND p.month=$4 AND p.status='PUBLISHED' AND ${scopeE} AND ${activeEmployeeSql('e')}`, [...P, year, month]),
      one(`SELECT COUNT(*)::int n FROM payslips p JOIN employees e ON e.id=p.employee_id
            WHERE p.year=$3 AND p.month=$4 AND p.status='DRAFT' AND ${scopeE} AND ${activeEmployeeSql('e')}`, [...P, year, month]),
      pendingVia('employee_change_requests'),
      pendingVia('nfas'),
      pendingVia('nfas', `r.status IN ('QUERY','QUERY_HOLD')`),
      pendingVia('vendor_registrations', `r.status='PENDING'`, 'registered_by'),
      pendingVia('agreements', `r.status='PENDING'`, 'uploaded_by'),
      pendingVia('investment_declarations', `r.status='submitted'`),
      pendingVia('resignations', `r.status='PENDING'`),
      pendingVia('kpis', `r.status IN ('RM_PENDING','DISCUSS')`),
      one(`SELECT COUNT(*)::int n FROM pms_submissions s JOIN kpis k ON k.id=s.kpi_id JOIN employees e ON e.id=k.employee_id
            WHERE s.status='APPROVAL_PENDING' AND ${scopeE}`),
      one(`SELECT COUNT(*)::int n FROM employees e WHERE ${scopeE} AND e.onboarding_status='INACTIVE'`),
    ]);

    const recent = (await query(
      `SELECT e.id, e.first_name, e.last_name, e.official_email, e.onboarding_status, d.title AS designation,
              ${activeEmployeeSql('e')} AS is_employee
         FROM employees e LEFT JOIN designations d ON d.id=e.designation_id
        WHERE ${scopeE}
        ORDER BY e.created_at DESC LIMIT 6`, P)).rows;

    const review = pc(['DETAILS_SUBMITTED', 'HR_REVIEW']);
    // Every HR approval queue, with where to act on it (C2/H3).
    const queues = [
      { key: 'onboarding', label: 'Onboarding submissions to review', count: review, href: '/admin/review' },
      { key: 'changeRequests', label: 'Profile change requests', count: changeRequests, href: '/admin/change-requests?status=PENDING' },
      { key: 'nfa', label: 'NFAs pending', count: nfaPending, href: '/admin/nfa?status=PENDING' },
      { key: 'nfaQuery', label: 'NFAs on query', count: nfaQuery, href: '/admin/nfa?status=QUERY' },
      { key: 'vendors', label: 'Vendor registrations', count: vendors, href: '/admin/vendors?status=PENDING' },
      { key: 'agreements', label: 'Agreements', count: agreements, href: '/admin/vendors?tab=agreements&status=PENDING' },
      { key: 'taxDeclarations', label: 'Investment declarations to verify', count: taxDecl, href: '/admin/tax-declarations?status=submitted' },
      { key: 'resignations', label: 'Resignations pending', count: resignations, href: '/admin/resignations?status=PENDING' },
      { key: 'kpis', label: 'KPIs awaiting manager rating', count: kpiPending, href: '/admin/pms?status=RM_PENDING' },
      { key: 'pms', label: 'PMS ratings awaiting approval', count: pmsPending, href: '/admin/pms?status=APPROVAL_PENDING' },
    ];

    res.json({
      headcount,
      candidates: pipeline.reduce((a, r) => a + r.n, 0),
      inactive,
      pipeline: {
        offerSent: pc(['OFFER_SENT']),
        filling: pc(['OFFER_ACCEPTED', 'DETAILS_PENDING', 'SENT_BACK']),
        review,
        active: headcount,
      },
      approvals: { leave, od, missPunch, compOff, total: leave + od + missPunch + compOff },
      queues,
      queuesTotal: queues.reduce((a, q) => a + q.count, 0),
      openTickets: tickets,
      policies,
      payroll: { year, month, monthName: MONTHS[month - 1], published: pubSlips, draft: draftSlips, headcount },
      recentEmployees: recent.map((r) => ({
        id: r.id, name: `${r.first_name} ${r.last_name}`.trim(),
        designation: r.designation, email: r.official_email, status: r.onboarding_status,
        isCandidate: !r.is_employee && !['INACTIVE', 'REJECTED', 'EXPIRED', 'ACTIVE'].includes(r.onboarding_status),
      })),
    });
  } catch (e) { next(e); }
}
