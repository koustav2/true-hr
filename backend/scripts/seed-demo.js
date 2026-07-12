// Demo data for end-to-end testing (idempotent — safe to run repeatedly).
//
//   node scripts/seed-demo.js
//
// Seeds: NFA masters (companies, projects, locations, clients, expense
// hierarchy), a wildcard approver matrix (Finance + Business Leader), two
// login-ready demo people (manager + employee with leave balances), and
// three dashboard banners. Prints all demo credentials at the end.
import zlib from 'zlib';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';
import * as nfaC from '../src/controllers/nfaController.js';
import * as setC from '../src/controllers/settlementController.js';
import * as pmsC from '../src/controllers/pmsController.js';
import * as supC from '../src/controllers/supportController.js';
import * as taskC from '../src/controllers/taskController.js';
import * as venC from '../src/controllers/vendorController.js';

const q = (sql, params) => pool.query(sql, params);

// Drive a controller like an HTTP call (same trick the test scripts use).
function call(fn, { params = {}, query = {}, body = {}, user }) {
  return new Promise((resolve) => {
    const req = { params, query, body, user };
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(d) { resolve({ status: this._s, data: d }); }, setHeader() {}, send(d) { resolve({ status: this._s, data: d }); } };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}
const asEmp = (id) => ({ sub: null, employeeId: id, role: 'EMPLOYEE' });
const asHr = (id) => ({ sub: null, employeeId: id, role: 'HR_ADMIN' });

// Approve an NFA through its whole chain: keep acting as whoever the
// current pending stage resolves to until the instance leaves PENDING.
async function approveChain(nfaId) {
  for (let i = 0; i < 8; i++) {
    const row = (await q(
      `SELECT ais.approver_employee_id AS aid, ai.status
         FROM nfas n JOIN approval_instances ai ON ai.id = n.approval_instance_id
         JOIN approval_instance_stages ais ON ais.instance_id = ai.id AND ais.seq = ai.current_stage_seq
        WHERE n.id = $1`, [nfaId])).rows[0];
    if (!row || row.status !== 'PENDING' || !row.aid) return row?.status;
    await call(nfaC.actOn, { params: { id: nfaId }, body: { action: 'APPROVED', remarks: 'Approved (demo)' }, user: asEmp(row.aid) });
  }
  return null;
}

/* ── tiny PNG writer: solid-colour banner images (1200×400) ── */
function solidPng(w, h, [r, g, b]) {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)]);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

async function main() {
  const log = (m) => console.log(`[demo] ${m}`);
  const companyId = (await q(`SELECT id FROM companies ORDER BY id LIMIT 1`)).rows[0]?.id;
  if (!companyId) { console.error('Run the base seed first (node src/db/seed.js)'); process.exit(1); }

  /* ── 1. Masters ── */
  for (const name of ['True Kind Foundation', 'L R Technology', 'Vision India']) {
    await q(`INSERT INTO group_companies (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
  }
  const gc = (await q(`SELECT id FROM group_companies ORDER BY id LIMIT 1`)).rows[0].id;

  const ops = (await q(`SELECT id, name FROM business_operations ORDER BY id LIMIT 4`)).rows;
  const projects = ['Skill Development Center — Noida', 'Solar O&M — Odisha', 'Corporate HQ', 'CSR Field Program'];
  for (const [i, name] of projects.entries()) {
    await q(`INSERT INTO projects (name, business_operation_id, group_company_id)
             VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING`, [name, ops[i % ops.length]?.id || null, gc]);
  }

  for (const [name, kind] of [['Noida', 'CITY'], ['New Delhi', 'CITY'], ['Bhubaneswar', 'CITY'], ['Mumbai', 'CITY'], ['Client-Side', 'SPECIAL']]) {
    await q(`INSERT INTO office_locations (name, kind) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`, [name, kind]);
  }

  for (const [name, type] of [['NTPC Vidyut Vyapar Nigam', 'CLIENT'], ['District Skill Mission', 'CLIENT'], ['Sharma Stationers & Suppliers', 'VENDOR'], ['City Cab Services', 'VENDOR']]) {
    await q(`INSERT INTO clients_vendors (name, type) SELECT $1,$2
             WHERE NOT EXISTS (SELECT 1 FROM clients_vendors WHERE lower(name)=lower($1))`, [name, type]);
  }

  // Expense hierarchy: headers + sub-headers under the first few seeded categories.
  const hierarchy = [
    ['Utility Expenses', ['Electricity Bill', 'Water Bill', 'Internet & Broadband']],
    ['Travel & Conveyance', ['Local Conveyance', 'Outstation Travel', 'Fuel Reimbursement']],
    ['Office Supplies', ['Stationery', 'Pantry & Housekeeping', 'Printer Consumables']],
    ['Recharge & Bill Payment', ['Mobile Recharge', 'DTH / Data Card']],
  ];
  const cats = (await q(`SELECT id, name FROM expense_categories ORDER BY id LIMIT ${hierarchy.length}`)).rows;
  for (const [i, [header, subs]] of hierarchy.entries()) {
    const cat = cats[i % cats.length];
    if (!cat) break;
    const h = (await q(
      `INSERT INTO expense_headers (category_id, name) VALUES ($1,$2)
       ON CONFLICT (category_id, name) DO UPDATE SET active=true RETURNING id`, [cat.id, header])).rows[0].id;
    for (const s of subs) {
      await q(`INSERT INTO expense_subheaders (header_id, name) VALUES ($1,$2) ON CONFLICT (header_id, name) DO NOTHING`, [h, s]);
    }
  }
  log('masters: companies, projects, locations, clients/vendors, expense hierarchy');

  /* ── 2. Demo people (login-ready) ── */
  async function ensurePerson({ code, first, last, email, managerId = null, role = 'EMPLOYEE', password }) {
    let emp = (await q(`SELECT id FROM employees WHERE lower(official_email)=lower($1)`, [email])).rows[0];
    if (!emp) {
      emp = (await q(
        `INSERT INTO employees (company_id, employee_code, first_name, last_name, personal_email, official_email,
           reporting_manager_id, employment_type, onboarding_status)
         VALUES ($1,$2,$3,$4,$5,$5,$6,'FULL_TIME','ACTIVE') RETURNING id`,
        [companyId, code, first, last, email, managerId])).rows[0];
    }
    const acc = await q(`SELECT 1 FROM user_accounts WHERE lower(email)=lower($1)`, [email]);
    if (!acc.rowCount) {
      await q(`INSERT INTO user_accounts (employee_id, email, password_hash, role, status)
               VALUES ($1,$2,$3,$4,'ACTIVE')`, [emp.id, email, await hashPassword(password), role]);
    }
    return emp.id;
  }
  const managerId = await ensurePerson({ code: 'TKF9001', first: 'Demo', last: 'Manager', email: 'demo.manager@truehr.example', password: 'Demo@12345' });
  const employeeId = await ensurePerson({ code: 'TKF9002', first: 'Demo', last: 'Employee', email: 'demo.employee@truehr.example', managerId, password: 'Demo@12345' });

  // Leave balances (create the standard types if leave config was never opened).
  if (!(await q(`SELECT 1 FROM leave_types LIMIT 1`)).rowCount) {
    const types = [['EL', 'Earned Leave', 18], ['CL', 'Casual Leave', 7], ['SL', 'Sick Leave', 7], ['LWP', 'Leave Without Pay', 0]];
    for (const [i, [code, name, quota]] of types.entries()) {
      await q(`INSERT INTO leave_types (code, name, annual_quota, requires_balance, sort_order)
               VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING`, [code, name, quota, quota > 0, i]);
    }
  }
  for (const emp of [managerId, employeeId]) {
    await q(
      `INSERT INTO leave_balances (employee_id, leave_type_id, allocated)
       SELECT $1, id, annual_quota FROM leave_types WHERE requires_balance
       ON CONFLICT (employee_id, leave_type_id) DO NOTHING`, [emp]);
  }
  log('people: demo manager + employee (leave balances allotted)');

  /* ── 3. Approver matrix: wildcard Finance + Business Leader stages ── */
  const finance = (await q(`SELECT id FROM employees WHERE lower(official_email) LIKE 'arjun.pillai@%' LIMIT 1`)).rows[0]?.id || managerId;
  const bizLead = (await q(`SELECT id FROM employees WHERE lower(official_email) LIKE 'anil.verma@%' LIMIT 1`)).rows[0]?.id || managerId;
  for (const [roleKey, approver] of [['FINANCE', finance], ['BUSINESS_LEADER', bizLead]]) {
    await q(
      `INSERT INTO approver_matrix (project_id, expense_category_id, zone_id, role_key, approver_employee_id)
       SELECT NULL, NULL, NULL, $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM approver_matrix
         WHERE project_id IS NULL AND expense_category_id IS NULL AND zone_id IS NULL AND role_key=$1)`,
      [roleKey, approver]);
  }
  log('approver matrix: FINANCE + BUSINESS_LEADER wildcards (chains now resolve past the RM)');

  /* ── 4. Dashboard banners ── */
  if (!(await q(`SELECT 1 FROM app_banners LIMIT 1`)).rowCount) {
    const banners = [
      ['Welcome to TRUE HR', [30, 58, 138]],   // navy
      ['We value your work', [22, 101, 52]],   // green
      ['Announcements', [109, 40, 217]],       // violet
    ];
    for (const [i, [name, rgb]] of banners.entries()) {
      await q(`INSERT INTO app_banners (image, mime, filename, sort_order) VALUES ($1,'image/png',$2,$3)`,
        [solidPng(1200, 400, rgb), `${name.toLowerCase().replace(/\s+/g, '-')}.png`, i + 1]);
    }
    log('banners: 3 sample images (replace via Admin → App Banners)');
  }

  /* ── 5. Live transactions, so the portal looks like the GreenHR demo ── */
  const hrEmp = (await q(`SELECT employee_id FROM user_accounts WHERE role='HR_ADMIN' AND employee_id IS NOT NULL LIMIT 1`)).rows[0]?.employee_id || managerId;
  const already = await q(`SELECT 1 FROM nfas n JOIN approval_instances ai ON ai.id=n.approval_instance_id
                            WHERE ai.raised_by_employee_id=$1 LIMIT 1`, [employeeId]);
  if (!already.rowCount) {
    const proj = (await q(`SELECT p.id, p.business_operation_id op, p.group_company_id gc FROM projects p ORDER BY id LIMIT 1`)).rows[0];
    const zone = (await q(`SELECT id FROM cost_zones ORDER BY id LIMIT 1`)).rows[0].id;
    const loc = (await q(`SELECT id FROM office_locations ORDER BY id LIMIT 1`)).rows[0].id;
    const cv = (await q(`SELECT id FROM clients_vendors ORDER BY id LIMIT 1`)).rows[0].id;
    const hdr = (await q(`SELECT h.id, h.category_id cat, s.id sub FROM expense_headers h
                          JOIN expense_subheaders s ON s.header_id=h.id ORDER BY h.id, s.id LIMIT 1`)).rows[0];
    const due = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const mkNfa = (purpose, amount, priority = 'MEDIUM') => call(nfaC.create, {
      body: {
        raiseFor: 'EXPENSE', businessOperationId: proj.op, groupCompanyId: proj.gc, projectId: proj.id,
        expenseCategoryId: hdr.cat, zoneId: zone, locationId: loc, clientVendorId: cv,
        expenseMonth: new Date().getMonth() + 1, paymentType: 'ADVANCE_SELF', billableType: 'NON_BILLABLE',
        settlementDueDate: due, purpose, description: `${purpose} (demo data)`, priority,
        lines: [{ headerId: hdr.id, subheaderId: hdr.sub, nfaAmount: amount, logisticAmount: 0 }],
      },
      user: asEmp(employeeId),
    });

    // A: stays PENDING at the Reporting Manager (shows up in manager approvals)
    const a = await mkNfa('Team uniforms advance', 12000, 'HIGH');

    // B: fully approved + payment released (fills the employee ledger)
    const b = await mkNfa('Field travel advance — site visit', 8500);
    await approveChain(b.data.id);
    const finApprover = (await q(`SELECT approver_employee_id a FROM approver_matrix WHERE role_key='FINANCE' LIMIT 1`)).rows[0]?.a || hrEmp;
    await call(nfaC.releasePayment, { params: { id: b.data.id }, user: asHr(finApprover) });

    // C: released AND settlement submitted (settlement chain in progress)
    const c = await mkNfa('Training material purchase', 5000);
    await approveChain(c.data.id);
    await call(nfaC.releasePayment, { params: { id: c.data.id }, user: asHr(finApprover) });
    await call(setC.submit, { params: { id: c.data.id }, body: { amount: 4800, remarks: 'Bills attached (demo)' }, user: asEmp(employeeId) });

    log(`NFAs: ${a.data.nfaCode || '#1'} pending · ${b.data.nfaCode || '#2'} payment released · ${c.data.nfaCode || '#3'} settlement in progress`);

    // KPI/PMS: last month fully graded, current month waiting on the RM
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const kras = [
      { description: 'Complete assigned field visits and reports on time', weightage: 40 },
      { description: 'Maintain data accuracy in HRMIS entries', weightage: 35 },
      { description: 'Support team training sessions', weightage: 25 },
    ];
    const k1 = await call(pmsC.createKpi, { body: { year: prev.getFullYear(), month: prev.getMonth() + 1, kras }, user: asEmp(employeeId) });
    if (k1.status === 201 || k1.status === 200) {
      const kid = k1.data.id;
      await call(pmsC.reviewKpi, { params: { id: kid }, body: { action: 'APPROVE' }, user: asEmp(managerId) });
      const det = await call(pmsC.detail, { params: { id: kid }, user: asEmp(employeeId) });
      await call(pmsC.submitPms, {
        params: { id: kid },
        body: { scores: (det.data.kras || []).map((k) => ({ kraId: k.id, mtdTarget: 100, mtdAchieved: 105, selfRating: 4, selfRemarks: 'Targets met' })) },
        user: asEmp(employeeId),
      });
      const sub = (await q(`SELECT id FROM pms_submissions WHERE kpi_id=$1`, [kid])).rows[0];
      if (sub) {
        // rate through whatever stages resolve (unresolved ones auto-bypass)
        for (let i = 0; i < 5; i++) {
          const st = (await q(
            `SELECT ais.approver_employee_id aid, ai.status FROM approval_instances ai
              JOIN approval_instance_stages ais ON ais.instance_id=ai.id AND ais.seq=ai.current_stage_seq
             WHERE ai.subject_type='pms' AND ai.subject_id=$1`, [sub.id])).rows[0];
          if (!st || st.status !== 'PENDING') break;
          // Unresolved mandatory stage waits for a staff override — rate as HR then.
          const actor = st.aid ? asEmp(st.aid) : asHr(hrEmp);
          const r = await call(pmsC.rate, { params: { id: sub.id }, body: { pliRating: 4, pliPct: 110, remarks: 'Good month (demo)' }, user: actor });
          if (r.status >= 400) break;
        }
      }
      await call(pmsC.createKpi, { body: { year: now.getFullYear(), month: now.getMonth() + 1, kras }, user: asEmp(employeeId) });
      log('PMS: last month graded (SAT), current month KPI pending with RM');
    }

    // Support ticket + a task from the manager + an approved vendor
    await call(supC.create, { body: { category: 'HR', issueType: 'Salary Slip', description: 'Requesting salary slip for last month (demo)' }, user: asEmp(employeeId) });
    await call(taskC.create, { body: { assignedTo: employeeId, title: 'Prepare monthly MIS report', description: 'Compile the field MIS for review (demo)', dueDate: due }, user: asEmp(managerId) });
    const v = await call(venC.createVendor, {
      body: { companyName: 'Sunrise Facility Services', natureOfBusiness: 'Housekeeping & Facility', typeOfCompany: 'Proprietorship', pan: 'ABCDE1234F', contactPerson: 'R. Gupta', contactPhone: '9876543210' },
      user: asEmp(employeeId),
    });
    if (v.data?.id) await call(venC.reviewVendor, { params: { id: v.data.id }, body: { action: 'APPROVED' }, user: asHr(hrEmp) });
    log('extras: support ticket, assigned task, approved vendor');
  } else {
    log('transactions already present — skipped');
  }

  console.log(`
──────────────────────────────────────────────────
Demo logins (web ${''}+ app):
  Employee : demo.employee@truehr.example / Demo@12345   → lands on /ess
  Manager  : demo.manager@truehr.example  / Demo@12345   → approves leave/NFA/PMS
  HR admin : hr@truehr.example            / Hr@12345     → /admin

E2E script: employee creates NFA (masters are filled, chain = RM →
Business Leader → Finance) → manager approves → HR releases payment →
employee submits settlement. Leave: apply as employee → approve as manager.
──────────────────────────────────────────────────`);
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
