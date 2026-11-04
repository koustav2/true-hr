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
//
// QA v2 (C37, H121-H127): the upload checks it is the right template; the
// templates carry dropdowns and protect their read-only columns; CTC has a sane
// ceiling and "50,000" is read as a number; leave allocations respect the
// type's quota and gender; managers must be active and loops are refused;
// phones and emails are validated and emails kept unique; transfers map to the
// master names, check the pairing and carry an effective date; and a new
// "New employees" kind adds candidates in bulk.
// ============================================================================
import ExcelJS from 'exceljs';
import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { isV2 } from '../utils/apiVersion.js';
import { patterns, todayIST, ageOn, parseDate } from '../utils/validate.js';
import { activeEmployeeSql } from '../utils/people.js';
import { eligibleFor } from '../services/leaveTypes.js';
import { generateMagicToken } from '../utils/tokens.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { offerEmail } from '../services/emailTemplates.js';
import { config } from '../config/index.js';

const MAX_MONTHLY_CTC = 10000000; // ₹1 crore a month
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']; // what the portal offers
const TYPE_LABEL = { FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACT: 'Contract', INTERN: 'Intern' };

// A blank cell must never read as a value. ExcelJS gives null for an empty
// cell and Number(null) is 0, so the naive version silently wrote zeros over
// every column the user left alone — which on leave balances would wipe an
// entire tenant's allocations. So: null means "blank, leave it alone", NaN
// means "something is in the cell but it is not a number" and is reported.
// "50,000" is a number (H124).
const num = (raw) => {
  const v = typeof raw === 'object' && raw !== null && raw.result != null ? raw.result : raw;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(typeof v === 'string' ? v.replace(/[,₹\s]/g, '') : v);
  return Number.isFinite(n) ? n : NaN;
};
const str = (raw) => {
  const v = typeof raw === 'object' && raw !== null && !(raw instanceof Date)
    ? (raw.result ?? raw.text ?? raw.hyperlink ?? (Array.isArray(raw.richText) ? raw.richText.map((t) => t.text).join('') : ''))
    : raw;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').trim();
};
// A date cell (a real Excel date, or text as yyyy-mm-dd / dd-mm-yyyy).
const dateCell = (raw) => {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = str(raw);
  if (!s) return null;
  const m = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(s);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10);
  return parseDate(iso) ? iso : 'INVALID';
};

/** Header name → column number, tolerant of column order and case. */
function headerMap(ws) {
  const h = {};
  ws.getRow(1).eachCell((c, col) => { h[str(c.value).toLowerCase().replace(/\s*\*$/, '')] = col; });
  return h;
}

async function activeEmployees(orgId, companyId) {
  return (await query(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.phone, e.personal_email, e.gender,
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
      WHERE ${activeEmployeeSql('e')}
        AND ($1::bigint IS NULL OR e.organisation_id = $1)
        AND ($2::bigint IS NULL OR e.company_id = $2)
      ORDER BY e.employee_code`, [orgId || null, companyId || null])).rows;
}

const nameOf = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();

async function masters(orgId) {
  const deps = (await query(`SELECT id, name FROM departments WHERE ($1::bigint IS NULL OR organisation_id=$1) ORDER BY name`, [orgId || null])).rows;
  const desigs = (await query(`SELECT id, title, to_jsonb(d) ->> 'department_id' AS department_id FROM designations d
                                 WHERE ($1::bigint IS NULL OR organisation_id=$1) ORDER BY title`, [orgId || null])).rows;
  return { deps, desigs };
}

async function leaveTypesOf(orgId) {
  return (await query(
    `SELECT lt.id, lt.code, lt.name, lt.annual_quota, lt.requires_balance,
            COALESCE(to_jsonb(lt) ->> 'eligibility',
              CASE WHEN upper(lt.code) IN ('ML','MATERNITY') THEN 'FEMALE'
                   WHEN upper(lt.code) IN ('PTL','PATERNITY') THEN 'MALE' ELSE 'ALL' END) AS eligibility
       FROM leave_types lt
      WHERE lt.organisation_id = $1 AND lt.active
      ORDER BY lt.sort_order, lt.code`, [orgId || null])).rows;
}

// ── Kind registry ──────────────────────────────────────────────────────────
// columns(): sheet definition. Anything whose header starts with "New " is an
// input column; the rest are read-only context so HR knows which row is which.
// `lists` are the dropdown values a column takes (H122); `inputs` identify the
// template on upload (H121).
const KINDS = {
  salary: {
    label: 'Salary (monthly CTC)',
    sheet: 'Bulk Salary',
    inputs: ['new monthly ctc'],
    columns: () => [
      { header: 'Employee Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Current Monthly CTC', key: 'cur', width: 20 },
      { header: 'New Monthly CTC', key: 'new_monthly_ctc', width: 20, validate: { type: 'decimal', operator: 'between', formulae: [1, MAX_MONTHLY_CTC], error: `A monthly CTC between 1 and ${MAX_MONTHLY_CTC.toLocaleString('en-IN')}` } },
    ],
    row: (r) => ({ code: r.employee_code, name: nameOf(r), cur: Number(r.ctc) }),
  },
  info: {
    label: 'Contact & employment details',
    sheet: 'Bulk Info',
    inputs: ['new phone', 'new personal email', 'new location', 'new employment type'],
    columns: () => [
      { header: 'Employee Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Current Phone', key: 'cur_phone', width: 16 },
      { header: 'New Phone', key: 'new_phone', width: 16, validate: { type: 'textLength', operator: 'equal', formulae: [10], error: 'A 10-digit mobile number' } },
      { header: 'Current Personal Email', key: 'cur_pmail', width: 28 },
      { header: 'New Personal Email', key: 'new_personal_email', width: 28 },
      { header: 'Current Location', key: 'cur_loc', width: 18 },
      { header: 'New Location', key: 'new_location', width: 18 },
      { header: 'Current Employment Type', key: 'cur_type', width: 22 },
      { header: 'New Employment Type', key: 'new_employment_type', width: 22, list: 'types' },
    ],
    row: (r) => ({
      code: r.employee_code, name: nameOf(r),
      cur_phone: r.phone || '', cur_pmail: r.personal_email || '',
      cur_loc: r.location || '', cur_type: TYPE_LABEL[r.employment_type] || r.employment_type || '',
    }),
  },
  managers: {
    label: 'Reporting lines',
    sheet: 'Bulk Managers',
    inputs: ['new reporting manager code', 'new functional manager code', 'new operational manager code'],
    columns: () => [
      { header: 'Employee Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Current Reporting Manager Code', key: 'cur_rm', width: 28 },
      { header: 'New Reporting Manager Code', key: 'new_reporting_manager', width: 28, list: 'codes' },
      { header: 'Current Functional Manager Code', key: 'cur_fm', width: 28 },
      { header: 'New Functional Manager Code', key: 'new_functional_manager', width: 28, list: 'codes' },
      { header: 'Current Operational Manager Code', key: 'cur_om', width: 30 },
      { header: 'New Operational Manager Code', key: 'new_operational_manager', width: 30, list: 'codes' },
    ],
    row: (r) => ({
      code: r.employee_code, name: nameOf(r),
      cur_rm: r.rm_code || '', cur_fm: r.fm_code || '', cur_om: r.om_code || '',
    }),
  },
  transfer: {
    label: 'Department & designation transfer',
    sheet: 'Bulk Transfer',
    inputs: ['new department', 'new designation'],
    columns: () => [
      { header: 'Employee Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Current Department', key: 'cur_dep', width: 24 },
      { header: 'New Department', key: 'new_department', width: 24, list: 'departments' },
      { header: 'Current Designation', key: 'cur_desig', width: 26 },
      { header: 'New Designation', key: 'new_designation', width: 26, list: 'designations' },
      { header: 'New Effective Date', key: 'new_effective_date', width: 18, validate: { type: 'date', operator: 'greaterThan', formulae: [new Date('2000-01-01')], error: 'A date, dd-mm-yyyy' }, numFmt: 'dd-mm-yyyy' },
    ],
    row: (r) => ({
      code: r.employee_code, name: nameOf(r),
      cur_dep: r.department || '', cur_desig: r.designation || '',
    }),
  },
};

// Leave balances are per employee per leave type, so the sheet's shape depends
// on how the tenant has configured its leave types — the columns are built at
// download time and read back by the same header names. Every type is listed
// (H123): balance types get Current Allocated / Current Used / New Allocated,
// types without a balance (LWP, WFH) show the days used for reference.
KINDS['leave-balance'] = {
  label: 'Leave balances',
  sheet: 'Bulk Leave Balance',
  inputPattern: /^new .+ allocated$/,
  async prepare(req) {
    const types = await leaveTypesOf(req.orgId);
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
    { header: 'Gender', key: 'gender', width: 10 },
    ...ctx.types.flatMap((t) => (t.requires_balance ? [
      { header: `Current ${t.code} Allocated`, key: `cur_${t.code}`, width: 20 },
      { header: `Current ${t.code} Used`, key: `used_${t.code}`, width: 18 },
      { header: `New ${t.code} Allocated`, key: `new_${t.code.toLowerCase()}_allocated`, width: 20,
        validate: { type: 'decimal', operator: 'between', formulae: [0, Number(t.annual_quota) > 0 ? Number(t.annual_quota) : 365], error: Number(t.annual_quota) > 0 ? `0 to ${Number(t.annual_quota)} (the ${t.code} annual quota)` : '0 to 365' } },
    ] : [
      { header: `${t.code} Used (no balance kept)`, key: `used_${t.code}`, width: 24 },
    ])),
  ],
  row: (r, ctx) => {
    const out = { code: r.employee_code, name: nameOf(r), gender: r.gender || '' };
    for (const t of ctx.types) {
      const b = ctx.byEmp.get(Number(r.id))?.[t.code];
      if (t.requires_balance) out[`cur_${t.code}`] = Number(b?.allocated ?? 0);
      out[`used_${t.code}`] = Number(b?.used ?? 0);
    }
    return out;
  },
};

// C37: add many candidates at once. They start in "Offer sent" like a one-by-one
// add; the offer email goes out only if HR ticks "Send offer emails".
KINDS.employees = {
  label: 'New employees (candidates)',
  sheet: 'Bulk New Employees',
  inputs: ['first name', 'last name', 'personal email'],
  noCode: true,
  columns: () => [
    { header: 'First Name *', key: 'fn', width: 18 },
    { header: 'Last Name *', key: 'ln', width: 18 },
    { header: 'Personal Email *', key: 'pmail', width: 28 },
    { header: 'Official Email *', key: 'omail', width: 28 },
    { header: 'Phone', key: 'phone', width: 14, validate: { type: 'textLength', operator: 'equal', formulae: [10], error: 'A 10-digit mobile number' } },
    { header: 'Gender', key: 'gender', width: 10, list: 'genders' },
    { header: 'Date of Birth', key: 'dob', width: 14, numFmt: 'dd-mm-yyyy' },
    { header: 'Date of Joining *', key: 'doj', width: 16, numFmt: 'dd-mm-yyyy' },
    { header: 'Department', key: 'dep', width: 22, list: 'departments' },
    { header: 'Designation', key: 'desig', width: 24, list: 'designations' },
    { header: 'Employment Type', key: 'type', width: 16, list: 'types' },
    { header: 'Location', key: 'loc', width: 16 },
    { header: 'Reporting Manager Code', key: 'rm', width: 22, list: 'codes' },
    { header: 'Annual CTC', key: 'ctc', width: 14, validate: { type: 'decimal', operator: 'between', formulae: [0, MAX_MONTHLY_CTC * 12], error: 'An annual CTC in rupees' } },
  ],
  row: () => null,
};

const isKind = (k) => Object.prototype.hasOwnProperty.call(KINDS, k);

/** Which kind a sheet's headers look like (for "this is not a … template"). */
function kindOfHeaders(h) {
  const keys = Object.keys(h);
  for (const [k, spec] of Object.entries(KINDS)) {
    if (spec.inputPattern && keys.some((x) => spec.inputPattern.test(x))) return k;
    if (spec.inputs && spec.inputs.some((x) => keys.includes(x))) return k;
  }
  return null;
}

// GET /admin/bulk/:kind/template
export async function template(req, res) {
  const kind = String(req.params.kind || '').toLowerCase();
  if (!isKind(kind)) return res.status(404).json({ error: 'Unknown bulk template.' });
  const spec = KINDS[kind];
  const ctx = spec.prepare ? await spec.prepare(req) : {};
  const rows = spec.noCode ? [] : (ctx.emps || await activeEmployees(req.orgId, req.companyScope));
  const { deps, desigs } = await masters(req.orgId);

  const wb = new ExcelJS.Workbook();
  wb.keywords = `truehr-bulk:${kind}`;
  const ws = wb.addWorksheet(spec.sheet);
  const cols = spec.columns(ctx);
  ws.columns = cols.map(({ header, key, width }) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(spec.row(r, ctx));

  // Dropdown values live on a hidden sheet so lists of any length work (H122).
  const lists = {
    types: EMPLOYMENT_TYPES.map((t) => TYPE_LABEL[t]),
    departments: deps.map((d) => d.name),
    designations: desigs.map((d) => d.title),
    codes: rows.length ? rows.map((r) => r.employee_code) : (await activeEmployees(req.orgId, req.companyScope)).map((r) => r.employee_code),
    genders: ['Male', 'Female', 'Other'],
  };
  const listWs = wb.addWorksheet('Lists', { state: 'veryHidden' });
  const listRef = {};
  Object.entries(lists).forEach(([name, values], i) => {
    const col = i + 1;
    listWs.getCell(1, col).value = name;
    values.forEach((v, j) => { listWs.getCell(j + 2, col).value = v; });
    const letter = listWs.getColumn(col).letter;
    listRef[name] = values.length ? `Lists!$${letter}$2:$${letter}$${values.length + 1}` : null;
  });

  // Input columns: unlocked, with a dropdown or a range check. Everything else
  // (Employee Code, Name, "Current …") stays locked under sheet protection.
  const lastRow = Math.max(rows.length + 1, spec.noCode ? 501 : 2);
  cols.forEach((c, idx) => {
    const col = ws.getColumn(idx + 1);
    const isInput = spec.noCode || /^new /i.test(c.header);
    if (c.numFmt) col.numFmt = c.numFmt;
    for (let r = 2; r <= lastRow; r += 1) {
      const cell = ws.getCell(r, idx + 1);
      if (isInput) cell.protection = { locked: false };
      if (c.list && listRef[c.list]) {
        cell.dataValidation = { type: 'list', allowBlank: true, formulae: [listRef[c.list]], showErrorMessage: true, errorTitle: 'Pick from the list', error: 'Choose a value from the dropdown.' };
      } else if (c.validate) {
        cell.dataValidation = { allowBlank: true, showErrorMessage: true, errorTitle: 'Check the value', ...c.validate };
      }
    }
  });
  await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, autoFilter: true, sort: false, insertRows: !!spec.noCode });

  // A short instruction sheet keeps the "why is my upload skipping rows" tickets away.
  const help = wb.addWorksheet('How to use');
  help.columns = [{ header: 'Instructions', key: 'i', width: 110 }];
  help.getRow(1).font = { bold: true };
  const lines = spec.noCode ? [
    `This template adds: ${spec.label}. One row per person.`,
    'Columns marked * are required. Dates as dd-mm-yyyy. Department, designation, employment type and manager come from the dropdowns.',
    'Each person is added as a candidate with status "Offer sent". The offer email is sent only if you tick "Send offer emails" when you apply.',
    'Upload it back on the Bulk utilities screen. Use "Preview only" first — every row is checked and nothing is written.',
  ] : [
    `This template updates: ${spec.label}.`,
    'Fill only the columns whose header starts with "New". Leave a cell blank to leave that value unchanged.',
    'The Employee Code, Name and "Current …" columns are locked — rows are matched on Employee Code.',
    'Only active employees are listed and can be updated here.',
    'Upload it back on the Bulk utilities screen. Use "Preview only" first to see what would change.',
  ];
  lines.forEach((i) => help.addRow({ i }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bulk-${kind}-template.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/** Resolve an employee code inside the caller's scope. */
async function findByCode(code, req, { activeOnly = false } = {}) {
  return (await query(
    `SELECT e.id, e.company_id, e.gender, e.reporting_manager_id, ${activeEmployeeSql('e')} AS is_active FROM employees e
      WHERE lower(e.employee_code)=lower($1) AND ($2::bigint IS NULL OR e.organisation_id=$2)
        AND ($3::bigint IS NULL OR e.company_id=$3)
        ${activeOnly ? `AND ${activeEmployeeSql('e')}` : ''}`,
    [code, req.orgId || null, req.companyScope || null])).rows[0];
}

// POST /admin/bulk/:kind { file: base64, dryRun: bool, sendOffer?: bool }
export async function upload(req, res) {
  const kind = String(req.params.kind || '').toLowerCase();
  if (!isKind(kind)) return res.status(404).json({ error: 'Unknown bulk template.' });
  const spec = KINDS[kind];
  const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';
  const v2 = isV2(req);

  const b64 = req.body?.file;
  if (!b64) return res.status(400).json({ error: 'No file uploaded.' });
  let ws;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(String(b64).replace(/^data:[^,]*,/, ''), 'base64'));
    ws = wb.worksheets.find((s) => s.name === spec.sheet) || wb.worksheets.find((s) => s.state !== 'veryHidden' && s.state !== 'hidden') || wb.worksheets[0];
  } catch { return res.status(400).json({ error: 'Could not read that spreadsheet.' }); }
  if (!ws) return res.status(400).json({ error: 'The workbook has no sheets.' });

  const h = headerMap(ws);
  // H121: a different template is refused, not read as "nothing filled in".
  if (v2) {
    const looks = kindOfHeaders(h);
    if (looks !== kind) {
      const other = looks ? ` — it looks like a ${KINDS[looks].label} template` : '';
      return res.status(400).json({ error: `This file is not a ${spec.label} template${other}. Download the ${spec.label} template and fill that in.` });
    }
  }
  if (kind === 'employees') return uploadNewEmployees(req, res, ws, h, dryRun);

  const codeCol = h['employee code'];
  if (!codeCol) return res.status(400).json({ error: 'That sheet has no "Employee Code" column — download a fresh template.' });

  const ctx = { v2 };
  if (kind === 'leave-balance') ctx.types = (await leaveTypesOf(req.orgId)).filter((t) => t.requires_balance);
  if (kind === 'transfer') Object.assign(ctx, await masters(req.orgId));
  if (kind === 'managers') {
    // The reporting graph as it stands, so a loop made by this file (or by this
    // file and the database together) can be refused (H125).
    const g = (await query(`SELECT id, reporting_manager_id FROM employees WHERE ($1::bigint IS NULL OR organisation_id=$1)`, [req.orgId || null])).rows;
    ctx.graph = new Map(g.map((r) => [String(r.id), r.reporting_manager_id ? String(r.reporting_manager_id) : null]));
  }
  if (kind === 'info') ctx.seenEmails = new Map();

  const results = [];
  let changed = 0, skipped = 0, failed = 0;

  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const code = str(row.getCell(codeCol).value);
    if (!code) continue;

    const emp = await findByCode(code, req, { activeOnly: v2 });
    if (!emp) { results.push({ code, status: 'error', detail: 'No active employee with that code in your scope' }); failed++; continue; }

    let changes;
    try { changes = await readRow(kind, row, h, ctx, req, emp); }
    catch (e) { results.push({ code, status: 'error', detail: e.message }); failed++; continue; }

    if (!changes.length) { results.push({ code, status: 'skipped', detail: 'Nothing filled in' }); skipped++; continue; }

    if (!dryRun) {
      try { await writeRow(kind, emp, changes, ctx); }
      catch (e) { results.push({ code, status: 'error', detail: e.message }); failed++; continue; }
    }
    results.push({ code, status: dryRun ? 'would change' : 'updated', detail: changes.filter((c) => c.label).map((c) => `${c.label} → ${c.display}`).join('; ') });
    changed++;
  }

  if (!dryRun && changed) {
    await audit(req.user.id, `BULK_${kind.toUpperCase().replace(/-/g, '_')}_UPLOAD`, 'employees', null,
      { changed, skipped, failed, rows: results.length, ...(ctx.effective ? { effectiveDates: ctx.effective } : {}) });
  }
  // `updated` is kept as an alias so the older Bulk Salary caller keeps working.
  res.json({ kind, dryRun, changed, updated: changed, skipped, failed, total: results.length, results });
}

/** Read one sheet row into a list of intended changes. Throws on bad input. */
async function readRow(kind, row, h, ctx, req, emp) {
  const cell = (name) => (h[name] ? row.getCell(h[name]).value : null);
  const out = [];
  const v2 = ctx.v2;

  if (kind === 'salary') {
    const v = num(cell('new monthly ctc'));
    if (v === null) return out;
    if (Number.isNaN(v)) throw new Error('New Monthly CTC is not a number');
    if (v <= 0) throw new Error('New Monthly CTC must be greater than zero');
    if (v2 && v > MAX_MONTHLY_CTC) throw new Error(`New Monthly CTC ₹${v.toLocaleString('en-IN')} is above the ₹${MAX_MONTHLY_CTC.toLocaleString('en-IN')} a month limit — check the figure`);
    out.push({ field: 'monthly_ctc', label: 'Monthly CTC', value: Math.round(v), display: `₹${Math.round(v).toLocaleString('en-IN')}` });
    return out;
  }

  if (kind === 'info') {
    const phone = str(cell('new phone')).replace(/^\+?91[-\s]?/, '').replace(/[\s-]/g, '');
    if (phone) {
      if (v2 ? !patterns.mobile.test(phone) : !/^[0-9+\-\s()]{6,20}$/.test(phone)) throw new Error(`"${phone}" is not a valid 10-digit mobile number`);
      out.push({ field: 'phone', label: 'Phone', value: phone, display: phone });
    }
    const mail = str(cell('new personal email')).toLowerCase();
    if (mail) {
      if (!patterns.email.test(mail)) throw new Error(`"${mail}" is not a valid email`);
      if (v2) {
        const taken = (await query(
          `SELECT employee_code FROM employees WHERE id <> $2 AND (lower(personal_email)=$1 OR lower(official_email)=$1)
             AND ($3::bigint IS NULL OR organisation_id=$3) LIMIT 1`, [mail, emp.id, req.orgId || null])).rows[0];
        if (taken) throw new Error(`${mail} already belongs to ${taken.employee_code || 'another person'}`);
        const dup = ctx.seenEmails.get(mail);
        if (dup && dup !== String(emp.id)) throw new Error(`${mail} is given to two employees in this file`);
        ctx.seenEmails.set(mail, String(emp.id));
      }
      out.push({ field: 'personal_email', label: 'Personal email', value: mail, display: mail });
    }
    const loc = str(cell('new location'));
    if (loc) out.push({ field: 'location', label: 'Location', value: loc, display: loc });
    const type = str(cell('new employment type')).toUpperCase().replace(/[\s-]+/g, '_');
    if (type) {
      const ok = v2 ? EMPLOYMENT_TYPES : ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'];
      if (!ok.includes(type)) throw new Error(`Employment type must be one of: ${ok.map((t) => TYPE_LABEL[t] || t).join(', ')}`);
      out.push({ field: 'employment_type', label: 'Employment type', value: type, display: TYPE_LABEL[type] || type });
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
      if (v2 && !mgr.is_active) throw new Error(`${mcode} is not an active employee, so cannot be a manager`);
      if (v2 && field === 'reporting_manager_id') {
        // Walk up from the new manager; reaching this employee is a loop.
        const seen = new Set(); let cur = String(mgr.id);
        while (cur && !seen.has(cur)) {
          if (cur === String(emp.id)) throw new Error(`Reporting loop: ${mcode} already reports (directly or through others) to this employee`);
          seen.add(cur); cur = ctx.graph.get(cur) || null;
        }
        ctx.graph.set(String(emp.id), String(mgr.id)); // later rows see this change
      }
      out.push({ field, label, value: Number(mgr.id), display: mcode });
    }
    return out;
  }

  if (kind === 'transfer') {
    const depRaw = str(cell('new department'));
    const desigRaw = str(cell('new designation'));
    let dep = null; let desig = null;
    if (depRaw) {
      dep = ctx.deps.find((d) => d.name.toLowerCase() === depRaw.toLowerCase());
      if (!dep) throw new Error(`Department "${depRaw}" does not exist — pick one from the list`);
      // H127: stored and shown with the master's own spelling.
      out.push({ field: 'department_id', label: 'Department', value: Number(dep.id), display: dep.name });
    }
    if (desigRaw) {
      desig = ctx.desigs.find((d) => d.title.toLowerCase() === desigRaw.toLowerCase());
      if (!desig) throw new Error(`Designation "${desigRaw}" does not exist — pick one from the list`);
      out.push({ field: 'designation_id', label: 'Designation', value: Number(desig.id), display: desig.title });
    }
    if (v2 && desig && desig.department_id) {
      const depId = dep ? String(dep.id) : String((await query(`SELECT department_id FROM employees WHERE id=$1`, [emp.id])).rows[0]?.department_id || '');
      if (depId && String(desig.department_id) !== depId) throw new Error(`${desig.title} does not belong to that department`);
    }
    if (v2 && out.length) {
      const eff = dateCell(cell('new effective date'));
      if (!eff) throw new Error('New Effective Date is required for a transfer');
      if (eff === 'INVALID') throw new Error('New Effective Date is not a valid date (use dd-mm-yyyy)');
      const today = todayIST();
      if (eff > today) throw new Error(`The transfer takes effect on ${eff.split('-').reverse().join('-')} — upload it on or after that date`);
      const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
      if (eff < yearAgo) throw new Error('New Effective Date is more than a year ago');
      out.push({ field: null, label: 'Effective', value: eff, display: eff.split('-').reverse().join('-') });
      ctx.effective = ctx.effective || {};
      ctx.effective[String(emp.id)] = eff;
    }
    return out;
  }

  if (kind === 'leave-balance') {
    for (const t of ctx.types) {
      const v = num(cell(`new ${t.code.toLowerCase()} allocated`));
      if (v === null) continue;
      if (Number.isNaN(v)) throw new Error(`${t.code} allocation is not a number`);
      if (v < 0) throw new Error(`${t.code} allocation cannot be negative`);
      if (v2) {
        const quota = Number(t.annual_quota) || 0;
        const cap = quota > 0 ? quota : 365;
        if (v > cap) throw new Error(`${t.code} allocation ${v} is more than ${quota > 0 ? `the ${t.code} annual quota of ${quota}` : '365 days'}`);
        if (!eligibleFor(emp.gender, t.eligibility)) throw new Error(`${t.name || t.code} is for ${String(t.eligibility).toLowerCase()} employees only`);
        if (Math.round(v * 2) !== v * 2) throw new Error(`${t.code} allocation must be in half days`);
      }
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
  const cols = changes.filter((c) => c.field);
  if (!cols.length) return;
  const sets = cols.map((c, i) => `${c.field} = $${i + 2}`).join(', ');
  await query(`UPDATE employees SET ${sets} WHERE id = $1`, [emp.id, ...cols.map((c) => c.value)]);
}

// ── New employees (candidates) ─────────────────────────────────────────────
async function uploadNewEmployees(req, res, ws, h, dryRun) {
  const sendOffer = req.body?.sendOffer === true || req.body?.sendOffer === 'true';
  const { deps, desigs } = await masters(req.orgId);
  const company = (await query(
    `SELECT id FROM companies WHERE ($1::bigint IS NULL OR organisation_id=$1) AND active IS NOT FALSE ORDER BY id LIMIT 1`,
    [req.orgId || null])).rows[0];
  if (!company) return res.status(409).json({ error: 'This organisation has no company set up yet.' });
  const cell = (row, name) => (h[name] ? row.getCell(h[name]).value : null);
  const today = todayIST();
  const maxDoj = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const seen = new Set();
  const results = []; const ready = [];
  let failed = 0;

  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const r = {
      firstName: str(cell(row, 'first name')), lastName: str(cell(row, 'last name')),
      personalEmail: str(cell(row, 'personal email')).toLowerCase(), officialEmail: str(cell(row, 'official email')).toLowerCase(),
      phone: str(cell(row, 'phone')).replace(/^\+?91[-\s]?/, '').replace(/[\s-]/g, ''),
      gender: str(cell(row, 'gender')).toUpperCase(),
      dob: dateCell(cell(row, 'date of birth')), doj: dateCell(cell(row, 'date of joining')),
      dep: str(cell(row, 'department')), desig: str(cell(row, 'designation')),
      type: str(cell(row, 'employment type')).toUpperCase().replace(/[\s-]+/g, '_'),
      loc: str(cell(row, 'location')), rm: str(cell(row, 'reporting manager code')),
      ctc: num(cell(row, 'annual ctc')),
    };
    if (!r.firstName && !r.lastName && !r.personalEmail && !r.officialEmail) continue; // empty row
    const label = `Row ${i}`;
    const errs = [];
    if (!r.firstName || !patterns.name.test(r.firstName)) errs.push('First name is required (letters only)');
    if (!r.lastName || !patterns.name.test(r.lastName)) errs.push('Last name is required (letters only)');
    if (!patterns.email.test(r.personalEmail)) errs.push('Personal email is missing or invalid');
    if (!patterns.email.test(r.officialEmail)) errs.push('Official email is missing or invalid');
    if (r.phone && !patterns.mobile.test(r.phone)) errs.push(`Phone "${r.phone}" is not a valid 10-digit mobile number`);
    if (r.gender && !['MALE', 'FEMALE', 'OTHER'].includes(r.gender)) errs.push('Gender must be Male, Female or Other');
    if (r.dob === 'INVALID') errs.push('Date of birth is not a valid date');
    else if (r.dob && (ageOn(r.dob, today) ?? 0) < 18) errs.push('Date of birth must be at least 18 years ago');
    if (!r.doj) errs.push('Date of joining is required');
    else if (r.doj === 'INVALID') errs.push('Date of joining is not a valid date');
    else {
      if (r.doj > maxDoj) errs.push('Date of joining is more than a year ahead');
      if (r.dob && r.dob !== 'INVALID' && (ageOn(r.dob, r.doj) ?? 0) < 18) errs.push('Joining date must be after the 18th birthday');
    }
    const dep = r.dep ? deps.find((d) => d.name.toLowerCase() === r.dep.toLowerCase()) : null;
    if (r.dep && !dep) errs.push(`Department "${r.dep}" does not exist`);
    const desig = r.desig ? desigs.find((d) => d.title.toLowerCase() === r.desig.toLowerCase()) : null;
    if (r.desig && !desig) errs.push(`Designation "${r.desig}" does not exist`);
    if (r.type && !EMPLOYMENT_TYPES.includes(r.type)) errs.push(`Employment type must be one of: ${EMPLOYMENT_TYPES.map((t) => TYPE_LABEL[t]).join(', ')}`);
    let rmId = null;
    if (r.rm) {
      const m = await findByCode(r.rm, req, { activeOnly: true });
      if (!m) errs.push(`Reporting manager "${r.rm}" is not an active employee`); else rmId = m.id;
    }
    if (r.ctc !== null && (Number.isNaN(r.ctc) || r.ctc < 0 || r.ctc > MAX_MONTHLY_CTC * 12)) errs.push('Annual CTC is not a sensible amount');
    for (const m of [r.personalEmail, r.officialEmail]) {
      if (!m) continue;
      if (seen.has(m)) errs.push(`${m} appears twice in this file`);
    }
    if (patterns.email.test(r.officialEmail)) {
      const dupe = (await query(`SELECT 1 FROM employees WHERE lower(official_email)=$1 OR lower(personal_email)=$1`, [r.officialEmail])).rowCount;
      if (dupe) errs.push(`${r.officialEmail} is already in use`);
    }
    if (patterns.email.test(r.personalEmail)) {
      const dupe = (await query(`SELECT 1 FROM employees WHERE (lower(personal_email)=$1 OR lower(official_email)=$1) AND ($2::bigint IS NULL OR organisation_id=$2)`,
        [r.personalEmail, req.orgId || null])).rowCount;
      if (dupe) errs.push(`${r.personalEmail} is already in use`);
    }
    seen.add(r.personalEmail); seen.add(r.officialEmail);
    const name = `${r.firstName} ${r.lastName}`.trim();
    if (errs.length) { results.push({ code: `${label} · ${name || '—'}`, status: 'error', detail: errs.join('; ') }); failed++; continue; }
    ready.push({ ...r, label, name, depId: dep?.id || null, desigId: desig?.id || null, desigTitle: desig?.title || null, rmId });
    results.push({ code: `${label} · ${name}`, status: dryRun ? 'would add' : 'added', detail: `Candidate, joining ${r.doj.split('-').reverse().join('-')}${sendOffer ? ', offer email sent' : ', no email sent'}` });
  }

  if (!dryRun && ready.length) {
    for (const r of ready) {
      const made = await tx(async (c) => {
        const emp = (await c.query(
          `INSERT INTO employees
            (company_id, first_name, last_name, dob, gender, phone, personal_email, official_email,
             department_id, designation_id, reporting_manager_id, date_of_joining, employment_type, location,
             ctc, onboarding_status, created_by, organisation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'OFFER_SENT',$16,(SELECT organisation_id FROM companies WHERE id=$1))
           RETURNING *`,
          [company.id, r.firstName, r.lastName, r.dob || null, r.gender || null, r.phone || null, r.personalEmail, r.officialEmail,
           r.depId, r.desigId, r.rmId, r.doj, r.type || 'FULL_TIME', r.loc || null, r.ctc ?? null, req.user.id])).rows[0];
        const ob = (await c.query(`INSERT INTO onboarding (employee_id, state, current_step) VALUES ($1,'OFFER_SENT',0) RETURNING *`, [emp.id])).rows[0];
        const { raw, hash } = generateMagicToken();
        await c.query(`INSERT INTO onboarding_tokens (onboarding_id, token_hash, purpose, expires_at) VALUES ($1,$2,'ACCEPT',$3)`,
          [ob.id, hash, new Date(Date.now() + config.offerExpiryDays * 24 * 3600 * 1000)]);
        return { emp, ob, raw };
      });
      if (sendOffer) {
        try {
          const tpl = offerEmail({
            name: r.name, designation: r.desigTitle, location: r.loc || null,
            joiningBy: r.doj.split('-').reverse().join('/'),
            acceptUrl: `${config.appBaseUrl}/onboarding/accept?token=${made.raw}`,
            viewLetterUrl: `${config.appBaseUrl}/api/onboarding/offer-letter?token=${made.raw}`,
            hasOfferLetter: false, expiryDays: config.offerExpiryDays,
          });
          await enqueueEmail({ to: r.personalEmail, subject: tpl.subject, html: tpl.html, template: 'OFFER', onboardingId: made.ob.id });
        } catch { /* the candidate exists; HR can resend the offer from their profile */ }
      }
      await audit(req.user.id, 'CREATE_EMPLOYEE', 'employee', made.emp.id, { bulk: true, offerEmailed: sendOffer });
    }
    await audit(req.user.id, 'BULK_EMPLOYEES_UPLOAD', 'employees', null, { added: ready.length, failed, offerEmailed: sendOffer });
  }
  res.json({ kind: 'employees', dryRun, changed: ready.length, updated: ready.length, skipped: 0, failed, total: results.length, results, sendOffer });
}

// ── Backwards-compatible salary routes (the Bulk Salary screen predates this) ──
export const salaryTemplate = (req, res) => { req.params.kind = 'salary'; return template(req, res); };
export const salaryUpload = (req, res) => { req.params.kind = 'salary'; return upload(req, res); };

// GET /admin/bulk/kinds — what the UI offers.
export function kinds(req, res) {
  res.json(Object.entries(KINDS)
    .filter(([key]) => key !== 'employees' || isV2(req))
    .map(([key, v]) => ({ key, label: v.label })));
}
