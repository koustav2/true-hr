import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

// Static issue catalog (mirrors the Support Desk dropdowns). Served to the app so
// the dropdowns are data-driven; can be moved to a table later if HR needs to edit.
const CATALOG = {
  HR: {
    types: ['HRMIS Update Request', 'Salary Slip', 'My Vision Login', 'Request to HR', 'Insurance', 'ESIC', 'PF', 'Other'],
    details: {},          // HR has no sub-detail
    attachment: true,     // HR allows an optional document
  },
  IT: {
    types: ['IT Hardware', 'IT Software'],
    details: {
      'IT Hardware': ['Account Locked', 'Application Software', 'CCTV/DVR/Backup issue', 'Desktop', 'Email issue',
        'Hardware Issue', 'Headphones issue', 'Internet or VPN Client issue', 'Laptop', 'Others', 'Outlook configuration',
        'Printer Issue', 'Projector Issue', 'Server issue', 'Share Drive issue', 'System Installation', 'Tally Server Issue', 'Windows Installation'],
      'IT Software': ['Asset Management', 'Attendance Issue', 'Business Book', 'Calling Portal', 'Future Skills Portal',
        'HRMIS Portal', 'IGL Portal', 'Income Tax Portal', 'Invoice Portal', 'Just Job Portal/App', 'LearnCertify HUB',
        'Leave Issue', 'Live skills', 'MSIL Portal', 'My Vision India App', 'My Vision India Portal', 'NFA Portal',
        'NSDC BPO', 'Others', 'Payroll Portal', 'PMS-KPI Portal'],
    },
    attachment: false,
  },
  ADMIN: {
    types: ['Hygiene Issues', 'Others', 'Refreshment', 'Repair and Maintenance'],
    details: {
      'Hygiene Issues': ['Canteen', 'Cleaning', 'Wash Room', 'Water'],
      'Others': ['Stationery', 'Suggestion'],
      'Refreshment': ['Snacks/Lunch', 'Tea/Coffee'],
      'Repair and Maintenance': ['AC', 'Chair', 'DG', 'Doors', 'Fan', 'Furniture', 'Light', 'Seating Space', 'Switch & Socket', 'UPS', 'Work Station'],
    },
    attachment: false,
  },
};

// GET /support/catalog
export async function catalog(req, res) { res.json(CATALOG); }

function shape(r) {
  return {
    id: r.id,
    category: r.category,
    issueType: r.issue_type,
    issueDetail: r.issue_detail,
    description: r.description,
    status: r.status,
    hasAttachment: r.has_attachment === true,
    appliedAt: r.applied_at,
    resolutionNote: r.resolution_note,
    name: `${r.first_name} ${r.last_name}`.trim(),
    employeeCode: r.employee_code,
    email: r.official_email,
    phone: r.phone,
  };
}

// POST /support { category, issueType, issueDetail, description, attachment, attachmentMime }
export async function create(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { category, issueType, issueDetail, description, attachment, attachmentMime } = req.body;
    const cat = String(category || '').toUpperCase();
    if (!CATALOG[cat]) return res.status(400).json({ error: 'Invalid support category' });
    if (!issueType) return res.status(400).json({ error: 'Issue type is required' });
    // If this category/type has a detail list, require a detail.
    const detailList = CATALOG[cat].details[issueType];
    if (detailList && detailList.length && !issueDetail) return res.status(400).json({ error: 'Please select an issue detail' });

    const row = (await query(
      `INSERT INTO support_tickets (employee_id, category, issue_type, issue_detail, description, attachment, attachment_mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [empId, cat, issueType, issueDetail || null, description || null, attachment || null, attachmentMime || null])).rows[0];
    await audit(req.user.id, 'SUPPORT_CREATE', 'support_ticket', row.id, { category: cat, issueType });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// GET /support?category=&from=&to=
export async function list(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const cat = String(req.query.category || '').toUpperCase();
    const params = [empId];
    let where = `s.employee_id=$1`;
    if (cat && CATALOG[cat]) { params.push(cat); where += ` AND s.category=$${params.length}`; }
    if (req.query.from) { params.push(req.query.from); where += ` AND s.applied_at::date >= $${params.length}`; }
    if (req.query.to) { params.push(req.query.to); where += ` AND s.applied_at::date <= $${params.length}`; }
    const rows = (await query(
      `SELECT s.id, s.category, s.issue_type, s.issue_detail, s.description, s.status, s.applied_at, s.resolution_note,
              (s.attachment IS NOT NULL) AS has_attachment,
              e.employee_code, e.first_name, e.last_name, e.official_email, e.phone
       FROM support_tickets s JOIN employees e ON e.id=s.employee_id
       WHERE ${where} ORDER BY s.applied_at DESC`, params)).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /support/:id/attachment
export async function attachment(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const row = (await query(`SELECT employee_id, attachment, attachment_mime FROM support_tickets WHERE id=$1`, [req.params.id])).rows[0];
    if (!row?.attachment) return res.status(404).json({ error: 'No attachment' });
    if (row.employee_id !== empId) return res.status(403).json({ error: 'Not allowed' });
    res.setHeader('Content-Type', row.attachment_mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(row.attachment, 'base64'));
  } catch (e) { next(e); }
}
