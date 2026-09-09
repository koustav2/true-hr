// ============================================================================
// Bulk Excel utilities — GreenHR parity for its "Bulk Update" family.
//
// One engine, several kinds. Every kind works the same way: download a template
// already filled in with what the system holds today, edit the columns marked
// "New …", upload it back. Rows are matched on Employee Code, and a row with no
// new value is skipped rather than blanked — so a partially filled sheet is safe.
//
// `dryRun` reports exactly what would change without writing anything, which is
// what makes a 400-row sheet reviewable before it lands on payroll.
// ============================================================================
import ExcelJS from 'exceljs';
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

// A blank cell must never read as a value. ExcelJS gives null for an empty
// cell and Number(null) is 0, so the naive version silently wrote zeros over
// every column the user left alone — which on leave balances would wipe an
// entire tenant's allocations. So: null means "blank, leave it alone", NaN
// means "something is in the cell but it is not a number" and is reported.
const num = (raw) => {
  const v = typeof raw === 'object' && raw !== null && raw.result != null ? raw.result : raw;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const str = (raw) => {
  const v = typeof raw === 'object' && raw !== null
    ? (raw.result ?? raw.text ?? raw.hyperlink ?? '')
    : raw;
  return String(v ?? '').trim();
};

/** Header name → column number, tolerant of column order and case. */
function headerMap(ws) {
  const h = {};
  ws.getRow(1).eachCell((c, col) => { h[str(c.value).toLowerCase()] = col; });
  return h;
}

async function activeEmployees(orgId, companyId) {
  return (await query(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.phone, e.personal_email,
            e.official_email, e.location, e.employment_type, e.company_id,
            dep.name AS department, dg.title AS designation,
            rm.employee_code AS rm_code, fm.employee_code AS fm_code, om.employee_code AS om_code,
            COALESCE(ss.monthly_ctc, 0) AS ctc
       FROM employees e
       LEFT JOIN departments dep ON dep.id = e.department_id
       LEFT JOIN designations dg ON dg.id = e.designation_id
       LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
       LEFT JOIN employees fm ON fm.id = e.function_manager_id
       LEFT JOIN employees om ON om.id = e.operational_manager_id
       LEFT JOIN salary_structures ss ON ss.employee_id = e.id
      WHERE e.onboarding_status = 'ACTIVE'
        AND ($1::bigint IS NULL OR e.organisation_id = $1)
        AND ($2::bigint IS NULL OR e.company_id = $2)
      ORDER BY e.employee_code`, [orgId || null, companyId || null])).rows;
}

const nameOf = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();

// ── Kind registry ──────────────────────────────────────────────────────────
// columns(): sheet definition. Anything whose header starts with "New " is an
// input column; the rest are read-only context so HR knows which row is which.
const KINDS = {
  salary: {
    label: 'Salary (monthly CTC)',
    sheet: 'Bulk Salary',
    columns: () => [
      { header: 'Employee Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Current Monthly CTC', key: 'cur', width: 20 },
      { header: 'New Monthly CTC', key: 'new_monthly_ctc', width: 20 },
    ],
    row: (r) => ({ code: r.employee_code, name: nameOf(r), cur: Number(r.ctc) }),
  },
  info: {
    label: 'Contact & employment details',
    sheet: 'Bulk Info',
    columns: () => [
      { header: 'Employee Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Current Phone', key: 'cur_phone', width: 16 },
      { header: 'New Phone', key: 'new_phone', width: 16 },
      { header: 'Current Personal Email', key: 'cur_pmail', width: 28 },
      { header: 'New Personal Email', key: 'new_personal_email', width: 28 },
      { header: 'Current Location', key: 'cur_loc', width: 18 },
      { header: 'New Location', key: 'new_location', width: 18 },
      { header: 'Current Employment Type', key: 'cur_type', width: 22 },
      { header: 'New Employment Type', key: 'new_employment_type', width: 22 },
    ],
    row: (r) => ({
      code: r.employee_code, name: nameOf(r),
      cur_phone: r.phone || '', cur_pmail: r.personal_email || '',
      cur_loc: r.location || '', cur_type: r.employment_type || '',
    }),
  },
  managers: {
    label: 'Reporting lines',
    sheet: 'Bulk Managers',
    columns: () => [
      { header: 'Employee Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Current Reporting Manager Code', key: 'cur_rm', width: 28 },
      { header: 'New Reporting Manager Code', key: 'new_reporting_manager', width: 28 },
      { header: 'Current Functional Manager Code', key: 'cur_fm', width: 28 },
      { header: 'New Functional Manager Code', key: 'new_functional_manager', width: 28 },
      { header: 'Current Operational Manager Code', key: 'cur_om', width: 30 },
      { header: 'New Operational Manager Code', key: 'new_operational_manager', width: 30 },
    ],
    row: (r) => ({
      code: r.employee_code, name: nameOf(r),
      cur_rm: r.rm_code || '', cur_fm: r.fm_code || '', cur_om: r.om_code || '',
    }),
  },
  transfer: {
    label: 'Department & designation transfer',
    sheet: 'Bulk Transfer',
    columns: () => [
      { header: 'Employee Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Current Department', key: 'cur_dep', width: 24 },
      { header: 'New Department', key: 'new_department', width: 24 },
      { header: 'Current Designation', key: 'cur_desig', width: 26 },
      { header: 'New Designation', key: 'new_designation', width: 26 },
    ],
    row: (r) => ({
      code: r.employee_code, name: nameOf(r),
      cur_dep: r.department || '', cur_desig: r.designation || '',
    }),
  },
};

// Leave balances are per employee per leave type, so the sheet's shape depends
// on how the tenant has configured its leave types — the columns are built at
// download time and read back by the same header names.
KINDS['leave-balance'] = {
  label: 'Leave balances',
  sheet: 'Bulk Leave Balance',
  async prepare(req) {
    // Leave types belong to the organisation, so the columns differ per tenant.
    const types = (await query(
      `SELECT id, code, name FROM leave_types
        WHERE organisation_id = $1 AND requires_balance AND active
        ORDER BY sort_order, code`, [req.orgId || null])).rows;
    const emps = await activeEmployees(req.orgId, req.companyScope);
    const bal = (await query(
      `SELECT lb.employee_id, lt.code, lb.allocated, lb.used
         FROM leave_balances lb JOIN leave_types lt ON lt.id = lb.leave_type_id
        WHERE lb.employee_id = ANY($1::bigint[])`, [emps.map((e) => e.id)])).rows;
    const byEmp = new Map();
    for (const b of bal) {
      if (!byEmp.has(Number(b.employee_id))) byEmp.set(Number(b.employee_id), {});
      byEmp.get(Number(b.employee_id))[b.code] = b;
    }
    return { types, byEmp, emps };
  },
  columns: (ctx) => [
    { header: 'Employee Code', key: 'code', width: 18 },
    { header: 'Name', key: 'name', width: 26 },
    ...ctx.types.flatMap((t) => ([
      { header: `Current ${t.code} Allocated`, key: `cur_${t.code}`, width: 22 },
      { header: `New ${t.code} Allocated`, key: `new_${t.code.toLowerCase()}_allocated`, width: 22 },
    ])),
  ],
  row: (r, ctx) => {
    const out = { code: r.employee_code, name: nameOf(r) };
    for (const t of ctx.types) out[`cur_${t.code}`] = Number(ctx.byEmp.get(Number(r.id))?.[t.code]?.allocated ?? 0);
    return out;
  },
};

const isKind = (k) => Object.prototype.hasOwnProperty.call(KINDS, k);

// GET /admin/bulk/:kind/template
export async function template(req, res) {
  const kind = String(req.params.kind || '').toLowerCase();
  if (!isKind(kind)) return res.status(404).json({ error: 'Unknown bulk template.' });
  const spec = KINDS[kind];
  const ctx = spec.prepare ? await spec.prepare(req) : {};
  const rows = ctx.emps || await activeEmployees(req.orgId, req.companyScope);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(spec.sheet);
  ws.columns = spec.columns(ctx);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(spec.row(r, ctx));

  // A short instruction sheet keeps the "why is my upload skipping rows" tickets away.
  const help = wb.addWorksheet('How to use');
  help.columns = [{ header: 'Instructions', key: 'i', width: 110 }];
  help.getRow(1).font = { bold: true };
  [
    `This template updates: ${spec.label}.`,
    'Fill only the columns whose header starts with "New". Leave a cell blank to leave that value unchanged.',
    'Do not change the Employee Code column or the header row — rows are matched on Employee Code.',
    'Employees who are not ACTIVE are not listed and cannot be updated here.',
    'Upload it back on the Bulk utilities screen. Use "Preview only" first to see what would change.',
  ].forEach((i) => help.addRow({ i }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bulk-${kind}-template.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/** Resolve an employee code inside the caller's scope. */
async function findByCode(code, req) {
  return (await query(
    `SELECT id, company_id FROM employees
      WHERE employee_code=$1 AND ($2::bigint IS NULL OR organisation_id=$2)
        AND ($3::bigint IS NULL OR company_id=$3)`,
    [code, req.orgId || null, req.companyScope || null])).rows[0];
}

// POST /admin/bulk/:kind { file: base64, dryRun: bool }
export async function upload(req, res) {
  const kind = String(req.params.kind || '').toLowerCase();
  if (!isKind(kind)) return res.status(404).json({ error: 'Unknown bulk template.' });
  const spec = KINDS[kind];
  const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';

  const b64 = req.body?.file;
  if (!b64) return res.status(400).json({ error: 'No file uploaded.' });
  let ws;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(b64, 'base64'));
    ws = wb.worksheets.find((s) => s.name === spec.sheet) || wb.worksheets[0];
  } catch { return res.status(400).json({ error: 'Could not read that spreadsheet.' }); }
  if (!ws) return res.status(400).json({ error: 'The workbook has no sheets.' });

  const h = headerMap(ws);
  const codeCol = h['employee code'];
  if (!codeCol) return res.status(400).json({ error: 'That sheet has no "Employee Code" column — download a fresh template.' });

  const ctx = kind === 'leave-balance'
    ? {
        types: (await query(
          `SELECT id, code FROM leave_types
            WHERE organisation_id = $1 AND requires_balance AND active ORDER BY code`,
          [req.orgId || null])).rows,
      }
    : {};

  const results = [];
  let changed = 0, skipped = 0, failed = 0;

  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const code = str(row.getCell(codeCol).value);
    if (!code) continue;

    const emp = await findByCode(code, req);
    if (!emp) { results.push({ code, status: 'error', detail: 'No active employee with that code in your scope' }); failed++; continue; }

    let changes;
    try { changes = await readRow(kind, row, h, ctx, req, emp); }
    catch (e) { results.push({ code, status: 'error', detail: e.message }); failed++; continue; }

    if (!changes.length) { results.push({ code, status: 'skipped', detail: 'Nothing filled in' }); skipped++; continue; }

    if (!dryRun) {
      try { await writeRow(kind, emp, changes, ctx); }
      catch (e) { results.push({ code, status: 'error', detail: e.message }); failed++; continue; }
    }
    results.push({ code, status: dryRun ? 'would change' : 'updated', detail: changes.map((c) => `${c.label} → ${c.display}`).join('; ') });
    changed++;
  }

  if (!dryRun && changed) {
    await audit(req.user.id, `BULK_${kind.toUpperCase().replace(/-/g, '_')}_UPLOAD`, 'employees', null,
      { changed, skipped, failed, rows: results.length });
  }
  // `updated` is kept as an alias so the older Bulk Salary caller keeps working.
  res.json({ kind, dryRun, changed, updated: changed, skipped, failed, total: results.length, results });
}

/** Read one sheet row into a list of intended changes. Throws on bad input. */
async function readRow(kind, row, h, ctx, req, emp) {
  const cell = (name) => (h[name] ? row.getCell(h[name]).value : null);
  const out = [];

  if (kind === 'salary') {
    const v = num(cell('new monthly ctc'));
    if (v === null) return out;
    if (Number.isNaN(v)) throw new Error('New Monthly CTC is not a number');
    if (v <= 0) throw new Error('New Monthly CTC must be greater than zero');
    out.push({ field: 'monthly_ctc', label: 'Monthly CTC', value: Math.round(v), display: `₹${Math.round(v)}` });
    return out;
  }

  if (kind === 'info') {
    const phone = str(cell('new phone'));
    if (phone) {
      if (!/^[0-9+\-\s()]{6,20}$/.test(phone)) throw new Error(`"${phone}" does not look like a phone number`);
      out.push({ field: 'phone', label: 'Phone', value: phone, display: phone });
    }
    const mail = str(cell('new personal email'));
    if (mail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error(`"${mail}" is not a valid email`);
      out.push({ field: 'personal_email', label: 'Personal email', value: mail, display: mail });
    }
    const loc = str(cell('new location'));
    if (loc) out.push({ field: 'location', label: 'Location', value: loc, display: loc });
    const type = str(cell('new employment type')).toUpperCase().replace(/[\s-]+/g, '_');
    if (type) {
      const ok = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'];
      if (!ok.includes(type)) throw new Error(`Employment type must be one of ${ok.join(', ')}`);
      out.push({ field: 'employment_type', label: 'Employment type', value: type, display: type });
    }
    return out;
  }

  if (kind === 'managers') {
    const map = [
      ['new reporting manager code', 'reporting_manager_id', 'Reporting manager'],
      ['new functional manager code', 'function_manager_id', 'Functional manager'],
      ['new operational manager code', 'operational_manager_id', 'Operational manager'],
    ];
    for (const [header, field, label] of map) {
      const mcode = str(cell(header));
      if (!mcode) continue;
      // "NONE" is how you clear a line — a blank cell means "leave it alone".
      if (/^none$/i.test(mcode)) { out.push({ field, label, value: null, display: 'cleared' }); continue; }
      const mgr = await findByCode(mcode, req);
      if (!mgr) throw new Error(`Manager code "${mcode}" not found in your scope`);
      if (Number(mgr.id) === Number(emp.id)) throw new Error('An employee cannot be their own manager');
      out.push({ field, label, value: Number(mgr.id), display: mcode });
    }
    return out;
  }

  if (kind === 'transfer') {
    const dep = str(cell('new department'));
    if (dep) {
      const d = (await query(
        `SELECT id FROM departments WHERE lower(name)=lower($1) AND company_id=$2`, [dep, emp.company_id])).rows[0];
      if (!d) throw new Error(`Department "${dep}" does not exist in this company — create it first`);
      out.push({ field: 'department_id', label: 'Department', value: Number(d.id), display: dep });
    }
    const desig = str(cell('new designation'));
    if (desig) {
      const g = (await query(
        `SELECT id FROM designations WHERE lower(title)=lower($1) AND company_id=$2`, [desig, emp.company_id])).rows[0];
      if (!g) throw new Error(`Designation "${desig}" does not exist in this company — create it first`);
      out.push({ field: 'designation_id', label: 'Designation', value: Number(g.id), display: desig });
    }
    return out;
  }

  if (kind === 'leave-balance') {
    for (const t of ctx.types) {
      const v = num(cell(`new ${t.code.toLowerCase()} allocated`));
      if (v === null) continue;
      if (Number.isNaN(v)) throw new Error(`${t.code} allocation is not a number`);
      if (v < 0) throw new Error(`${t.code} allocation cannot be negative`);
      out.push({ field: `leave:${t.id}`, label: `${t.code} allocated`, value: v, display: String(v) });
    }
    return out;
  }

  return out;
}

/** Persist the changes read for one row. */
async function writeRow(kind, emp, changes) {
  if (kind === 'salary') {
    await query(
      `INSERT INTO salary_structures (employee_id, monthly_ctc) VALUES ($1,$2)
       ON CONFLICT (employee_id) DO UPDATE SET monthly_ctc=EXCLUDED.monthly_ctc, updated_at=now()`,
      [emp.id, changes[0].value]);
    await query(`UPDATE employees SET ctc=$2 WHERE id=$1`, [emp.id, changes[0].value * 12]);
    return;
  }
  if (kind === 'leave-balance') {
    for (const c of changes) {
      const typeId = Number(String(c.field).split(':')[1]);
      await query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, allocated) VALUES ($1,$2,$3)
         ON CONFLICT (employee_id, leave_type_id) DO UPDATE SET allocated=EXCLUDED.allocated`,
        [emp.id, typeId, c.value]);
    }
    return;
  }
  // info / managers / transfer all write plain employee columns. The field names
  // come from the registry above, never from the sheet, so this cannot be
  // steered into an arbitrary column by a crafted header.
  const sets = changes.map((c, i) => `${c.field} = $${i + 2}`).join(', ');
  await query(`UPDATE employees SET ${sets} WHERE id = $1`, [emp.id, ...changes.map((c) => c.value)]);
}

// ── Backwards-compatible salary routes (the Bulk Salary screen predates this) ──
export const salaryTemplate = (req, res) => { req.params.kind = 'salary'; return template(req, res); };
export const salaryUpload = (req, res) => { req.params.kind = 'salary'; return upload(req, res); };

// GET /admin/bulk/kinds — what the UI offers.
export function kinds(req, res) {
  res.json(Object.entries(KINDS).map(([key, v]) => ({ key, label: v.label })));
}
