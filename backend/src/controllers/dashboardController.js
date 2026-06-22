import { query } from '../db/pool.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// GET /admin/stats — aggregate live metrics for the HR dashboard.
export async function stats(req, res, next) {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const pipeline = (await query(
      `SELECT onboarding_status AS s, COUNT(*)::int AS n FROM employees GROUP BY onboarding_status`)).rows;
    const pc = (keys) => pipeline.filter((r) => keys.includes(r.s)).reduce((a, r) => a + r.n, 0);
    const headcount = pipeline.reduce((a, r) => a + r.n, 0);

    const one = async (sql, params = []) => Number((await query(sql, params)).rows[0]?.n || 0);
    const [leave, od, missPunch, compOff, tickets, policies, pubSlips, draftSlips] = await Promise.all([
      one(`SELECT COUNT(*)::int n FROM leave_requests WHERE status='PENDING'`),
      one(`SELECT COUNT(*)::int n FROM on_duty WHERE status='PENDING'`),
      one(`SELECT COUNT(*)::int n FROM miss_punch WHERE status='PENDING'`),
      one(`SELECT COUNT(*)::int n FROM comp_off_requests WHERE status='PENDING'`),
      one(`SELECT COUNT(*)::int n FROM support_tickets WHERE status='PENDING'`),
      one(`SELECT COUNT(*)::int n FROM policies`),
      one(`SELECT COUNT(*)::int n FROM payslips WHERE year=$1 AND month=$2 AND status='PUBLISHED'`, [year, month]),
      one(`SELECT COUNT(*)::int n FROM payslips WHERE year=$1 AND month=$2 AND status='DRAFT'`, [year, month]),
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
