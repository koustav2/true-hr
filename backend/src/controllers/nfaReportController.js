// NFA analytics & reports (Phase 4): dashboard counts, project-wise expense
// rollup (Category → Header → SubHeader), client billing report, CSV export.
import { query } from '../db/pool.js';

import ExcelJS from 'exceljs';

function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\n');
}

async function toXlsx(rows, columns, sheetName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, c.label.length + 4) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5E8F0' } };
  rows.forEach((r) => ws.addRow(r));
  return wb.xlsx.writeBuffer();
}

async function send(res, req, rows, columns, filename) {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(toCsv(rows, columns));
  }
  if (req.query.format === 'xlsx') {
    const buf = await toXlsx(rows, columns, filename.slice(0, 31));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return res.send(Buffer.from(buf));
  }
  res.json(rows);
}

// GET /admin/nfa-dashboard?fyStart=2026 — FY counts like the GreenHR admin panel.
export async function dashboard(req, res, next) {
  try {
    const now = new Date();
    const fyStart = Number(req.query.fyStart) || (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1);
    const from = `${fyStart}-04-01`, to = `${fyStart + 1}-04-01`;
    const n = (await query(
      `SELECT count(*) AS raised,
              count(*) FILTER (WHERE status IN ('APPROVED','PAYMENT_RELEASED')) AS approved,
              count(*) FILTER (WHERE status='PAYMENT_RELEASED') AS released,
              count(*) FILTER (WHERE status='PENDING') AS pending,
              count(*) FILTER (WHERE status='QUERY') AS query,
              count(*) FILTER (WHERE settlement_status='CLOSE') AS settled,
              COALESCE(sum(grand_total), 0) AS raised_amount,
              COALESCE(sum(grand_total) FILTER (WHERE status='PAYMENT_RELEASED'), 0) AS released_amount
         FROM nfas WHERE created_at >= $1 AND created_at < $2`, [from, to])).rows[0];
    const byStage = (await query(
      `SELECT st.role_key, count(*) AS pending
         FROM approval_instance_stages st
         JOIN approval_instances i ON i.id = st.instance_id AND i.status='PENDING' AND i.current_stage_seq = st.seq
        WHERE i.subject_type IN ('nfa','nfa_settlement') AND st.status='PENDING'
        GROUP BY st.role_key ORDER BY count(*) DESC`)).rows;
    res.json({
      financialYear: `${fyStart}-${fyStart + 1}`,
      totalRaised: Number(n.raised), totalApproved: Number(n.approved), paymentReleased: Number(n.released),
      pending: Number(n.pending), query: Number(n.query), settled: Number(n.settled),
      raisedAmount: Number(n.raised_amount), releasedAmount: Number(n.released_amount),
      pendingByStage: byStage.map((s) => ({ roleKey: s.role_key, count: Number(s.pending) })),
    });
  } catch (e) { next(e); }
}

// GET /admin/reports/project-expense?from=&to=&projectId=&format=csv
// GreenHR "Project Wise Expence": rollup per Company/Project/Category/Header/SubHeader/Location.
export async function projectExpense(req, res, next) {
  try {
    const params = [];
    const wh = [`n.status IN ('APPROVED','PAYMENT_RELEASED')`];
    if (req.query.from) { params.push(req.query.from); wh.push(`n.created_at >= $${params.length}`); }
    if (req.query.to) { params.push(req.query.to); wh.push(`n.created_at < ($${params.length}::date + 1)`); }
    if (req.query.projectId) { params.push(Number(req.query.projectId)); wh.push(`n.project_id = $${params.length}`); }
    const rows = (await query(
      `SELECT gc.name AS company, p.name AS project, ec.name AS category,
              h.name AS header, COALESCE(sh.name, '—') AS subheader, ol.name AS location,
              count(DISTINCT n.id) AS nfas, sum(l.total_amount) AS amount, max(n.created_at)::date AS last_date
         FROM nfa_lines l
         JOIN nfas n ON n.id = l.nfa_id
         JOIN group_companies gc ON gc.id = n.group_company_id
         JOIN projects p ON p.id = n.project_id
         JOIN expense_categories ec ON ec.id = n.expense_category_id
         JOIN expense_headers h ON h.id = l.header_id
         LEFT JOIN expense_subheaders sh ON sh.id = l.subheader_id
         JOIN office_locations ol ON ol.id = n.location_id
        WHERE ${wh.join(' AND ')}
        GROUP BY gc.name, p.name, ec.name, h.name, sh.name, ol.name
        ORDER BY gc.name, p.name, ec.name, h.name`, params)).rows
      .map((r) => ({ ...r, nfas: Number(r.nfas), amount: Number(r.amount) }));
    await send(res, req, rows, [
      { key: 'company', label: 'Cost To Company' }, { key: 'project', label: 'Project' },
      { key: 'category', label: 'Expense Category' }, { key: 'header', label: 'Expense Header' },
      { key: 'subheader', label: 'Sub Header' }, { key: 'location', label: 'Location' },
      { key: 'nfas', label: "NFA's" }, { key: 'amount', label: 'Expense Amount' }, { key: 'last_date', label: 'Date' },
    ], 'project-wise-expense');
  } catch (e) { next(e); }
}

// GET /admin/reports/client-billing?from=&to=&format=csv — billable NFAs by client.
export async function clientBilling(req, res, next) {
  try {
    const params = [];
    const wh = [`n.billable_type IN ('BILLABLE_CLIENT','BILLABLE_PARTNER')`];
    if (req.query.from) { params.push(req.query.from); wh.push(`n.created_at >= $${params.length}`); }
    if (req.query.to) { params.push(req.query.to); wh.push(`n.created_at < ($${params.length}::date + 1)`); }
    const rows = (await query(
      `SELECT cv.name AS client, n.billable_type, COALESCE(n.billed_state,'—') AS billed_state,
              count(*) AS nfas, sum(n.grand_total) AS amount,
              COALESCE(sum(n.invoice_amount), 0) AS invoiced_amount
         FROM nfas n LEFT JOIN clients_vendors cv ON cv.id = n.client_vendor_id
        WHERE ${wh.join(' AND ')}
        GROUP BY cv.name, n.billable_type, n.billed_state
        ORDER BY cv.name NULLS LAST`, params)).rows
      .map((r) => ({ ...r, client: r.client || '—', nfas: Number(r.nfas), amount: Number(r.amount), invoiced_amount: Number(r.invoiced_amount) }));
    await send(res, req, rows, [
      { key: 'client', label: 'Client' }, { key: 'billable_type', label: 'Billable Type' },
      { key: 'billed_state', label: 'Billed / To be billed' }, { key: 'nfas', label: "NFA's" },
      { key: 'amount', label: 'Amount' }, { key: 'invoiced_amount', label: 'Invoiced Amount' },
    ], 'client-billing');
  } catch (e) { next(e); }
}

// GET /admin/nfa/export?…same filters as /admin/nfa…&format=csv — flat NFA export.
export async function nfaExport(req, res, next) {
  try {
    const params = [];
    const wh = ['TRUE'];
    if (req.query.status) { params.push(req.query.status); wh.push(`n.status = $${params.length}`); }
    if (req.query.from) { params.push(req.query.from); wh.push(`n.created_at >= $${params.length}`); }
    if (req.query.to) { params.push(req.query.to); wh.push(`n.created_at < ($${params.length}::date + 1)`); }
    const rows = (await query(
      `SELECT n.nfa_code, e.employee_code, e.first_name || ' ' || e.last_name AS employee,
              gc.name AS company, p.name AS project, ec.name AS category, ol.name AS location,
              COALESCE(cv.name,'') AS client, n.payment_type, n.billable_type, n.priority,
              n.total_nfa_amount, n.total_logistic_amount, n.grand_total,
              n.status, COALESCE(n.status_label,'') AS status_label, COALESCE(n.settlement_status,'') AS settlement_status,
              n.settlement_due_date, n.purpose, n.created_at::date AS raised_date
         FROM nfas n
         JOIN employees e ON e.id=n.employee_id
         JOIN group_companies gc ON gc.id=n.group_company_id
         JOIN projects p ON p.id=n.project_id
         JOIN expense_categories ec ON ec.id=n.expense_category_id
         JOIN office_locations ol ON ol.id=n.location_id
         LEFT JOIN clients_vendors cv ON cv.id=n.client_vendor_id
        WHERE ${wh.join(' AND ')} ORDER BY n.created_at DESC LIMIT 5000`, params)).rows;
    await send(res, req, rows, [
      { key: 'nfa_code', label: 'NFA Code' }, { key: 'employee_code', label: 'Emp Code' }, { key: 'employee', label: 'Employee' },
      { key: 'company', label: 'Cost To Company' }, { key: 'project', label: 'Project' }, { key: 'category', label: 'Category' },
      { key: 'location', label: 'Location' }, { key: 'client', label: 'Client' }, { key: 'payment_type', label: 'Payment Type' },
      { key: 'billable_type', label: 'Billable Type' }, { key: 'priority', label: 'Priority' },
      { key: 'total_nfa_amount', label: 'NFA Amount' }, { key: 'total_logistic_amount', label: 'Logistic Amount' },
      { key: 'grand_total', label: 'Grand Total' }, { key: 'status', label: 'NFA Status' }, { key: 'status_label', label: 'Status Detail' },
      { key: 'settlement_status', label: 'Settlement Status' }, { key: 'settlement_due_date', label: 'Settlement Due' },
      { key: 'purpose', label: 'Purpose' }, { key: 'raised_date', label: 'Raised Date' },
    ], 'nfa-report');
  } catch (e) { next(e); }
}

// GET /admin/reports/pending-settlements?format= — amount pending for settlement (client req #17).
export async function pendingSettlements(req, res, next) {
  try {
    const rows = (await query(
      `SELECT n.nfa_code, e.employee_code, e.first_name || ' ' || e.last_name AS employee,
              gc.name AS company, p.name AS project, n.grand_total AS amount_received,
              COALESCE(n.settlement_status,'PENDING') AS settlement_status,
              n.settlement_due_date,
              GREATEST(0, (now()::date - n.settlement_due_date))::int AS days_overdue
         FROM nfas n
         JOIN employees e ON e.id=n.employee_id
         JOIN group_companies gc ON gc.id=n.group_company_id
         JOIN projects p ON p.id=n.project_id
        WHERE n.status='PAYMENT_RELEASED' AND COALESCE(n.settlement_status,'PENDING') <> 'CLOSE'
        ORDER BY n.settlement_due_date NULLS LAST, n.created_at`)).rows
      .map((r) => ({ ...r, amount_received: Number(r.amount_received) }));
    await send(res, req, rows, [
      { key: 'nfa_code', label: 'NFA Code' }, { key: 'employee_code', label: 'Emp Code' },
      { key: 'employee', label: 'Employee' }, { key: 'company', label: 'Cost To Company' },
      { key: 'project', label: 'Project' }, { key: 'amount_received', label: 'Amount Pending (₹)' },
      { key: 'settlement_status', label: 'Settlement Status' },
      { key: 'settlement_due_date', label: 'Due Date' }, { key: 'days_overdue', label: 'Days Overdue' },
    ], 'pending-settlements');
  } catch (e) { next(e); }
}

// GET /admin/reports/company-expense?from=&to=&format= — one row per company (client req #17).
export async function companyExpense(req, res, next) {
  try {
    const params = [];
    const wh = [`n.status IN ('APPROVED','PAYMENT_RELEASED')`];
    if (req.query.from) { params.push(req.query.from); wh.push(`n.created_at >= $${params.length}`); }
    if (req.query.to) { params.push(req.query.to); wh.push(`n.created_at < ($${params.length}::date + 1)`); }
    const rows = (await query(
      `SELECT gc.name AS company, count(DISTINCT n.id) AS nfas,
              count(DISTINCT n.employee_id) AS employees,
              sum(n.total_nfa_amount) AS nfa_amount, sum(n.total_logistic_amount) AS logistic_amount,
              sum(n.grand_total) AS total_amount
         FROM nfas n JOIN group_companies gc ON gc.id = n.group_company_id
        WHERE ${wh.join(' AND ')}
        GROUP BY gc.name ORDER BY sum(n.grand_total) DESC`, params)).rows
      .map((r) => ({ ...r, nfas: Number(r.nfas), employees: Number(r.employees),
        nfa_amount: Number(r.nfa_amount), logistic_amount: Number(r.logistic_amount), total_amount: Number(r.total_amount) }));
    await send(res, req, rows, [
      { key: 'company', label: 'Cost To Company' }, { key: 'nfas', label: "NFA's" },
      { key: 'employees', label: 'Employees' }, { key: 'nfa_amount', label: 'NFA Amount' },
      { key: 'logistic_amount', label: 'Logistic Amount' }, { key: 'total_amount', label: 'Total Expense' },
    ], 'company-wise-expense');
  } catch (e) { next(e); }
}
