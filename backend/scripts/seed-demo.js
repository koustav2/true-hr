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

const q = (sql, params) => pool.query(sql, params);

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
