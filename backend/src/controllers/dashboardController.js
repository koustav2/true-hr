import { query } from '../db/pool.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// GET /admin/stats — aggregate live metrics for the HR dashboard.
export async function stats(req, res, next) {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const org = req.orgId || null;
    const pipeline = (await query(
      `SELECT onboarding_status AS s, COUNT(*)::int AS n FROM employees
        WHERE ($1::bigint IS NULL OR organisation_id=$1)
        GROUP BY onboarding_status`, [org])).rows;
    const pc = (keys) => pipeline.filter((r) => keys.includes(r.s)).reduce((a, r) => a + r.n, 0);
    const headcount = pipeline.reduce((a, r) => a + r.n, 0);

    const one = async (sql, params = []) => Number((await query(sql, params)).rows[0]?.n || 0);
    const [leave, od, missPunch, compOff, tickets, policies, pubSlips, draftSlips] = await Promise.all([
      one(`SELECT COUNT(*)::int n FROM leave_requests r JOIN employees e ON e.id=r.employee_id
            WHERE r.status='PENDING' AND ($1::bigint IS NULL OR e.organisation_id=$1)`, [org]),
      one(`SELECT COUNT(*)::int n FROM on_duty r JOIN employees e ON e.id=r.employee_id
            WHERE r.status='PENDING' AND ($1::bigint IS NULL OR e.organisation_id=$1)`, [org]),
      one(`SELECT COUNT(*)::int n FROM miss_punch r JOIN employees e ON e.id=r.employee_id
            WHERE r.status='PENDING' AND ($1::bigint IS NULL OR e.organisation_id=$1)`, [org]),
      one(`SELECT COUNT(*)::int n FROM comp_off_requests r JOIN employees e ON e.id=r.employee_id
            WHERE r.status='PENDING' AND ($1::bigint IS NULL OR e.organisation_id=$1)`, [org]),
      one(`SELECT COUNT(*)::int n FROM support_tickets r JOIN employees e ON e.id=r.employee_id
            WHERE r.status='PENDING' AND ($1::bigint IS NULL OR e.organisation_id=$1)`, [org]),
      one(`SELECT COUNT(*)::int n FROM policies`),
      one(`SELECT COUNT(*)::int n FROM payslips p JOIN employees e ON e.id=p.employee_id
            WHERE p.year=$1 AND p.month=$2 AND p.status='PUBLISHED'
              AND ($3::bigint IS NULL OR e.organisation_id=$3)`, [year, month, org]),
      one(`SELECT COUNT(*)::int n FROM payslips p JOIN employees e ON e.id=p.employee_id
            WHERE p.year=$1 AND p.month=$2 AND p.status='DRAFT'
              AND ($3::bigint IS NULL OR e.organisation_id=$3)`, [year, month, org]),
    ]);

    const recent = (await query(
      `SELECT e.id, e.first_name, e.last_name, e.official_email, e.onboarding_status, d.title AS designation
         FROM employees e LEFT JOIN designations d ON d.id=e.designation_id
        ORDER BY e.created_at DESC LIMIT 6`)).rows;

    res.json({
      headcount,
      pipeline: {
        offerSent: pc(['OFFER_SENT']),
        filling: pc(['OFFER_ACCEPTED', 'DETAILS_PENDING', 'SENT_BACK']),
        review: pc(['DETAILS_SUBMITTED', 'HR_REVIEW']),
        active: pc(['ACTIVE']),
      },
      approvals: { leave, od, missPunch, compOff, total: leave + od + missPunch + compOff },
      openTickets: tickets,
      policies,
      payroll: { year, month, monthName: MONTHS[month - 1], published: pubSlips, draft: draftSlips, headcount },
      recentEmployees: recent.map((r) => ({
        id: r.id, name: `${r.first_name} ${r.last_name}`.trim(),
        designation: r.designation, email: r.official_email, status: r.onboarding_status,
      })),
    });
  } catch (e) { next(e); }
}
