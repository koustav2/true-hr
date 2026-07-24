import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[migrate] schema applied');

  // Enum value additions must run on their own (cannot live inside the multi-statement transaction above).
  await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`);
  await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'IT_ADMIN'`);
  await pool.query(`ALTER TYPE onboarding_state ADD VALUE IF NOT EXISTS 'REJECTED'`);
  await pool.query(`ALTER TYPE onboarding_state ADD VALUE IF NOT EXISTS 'INACTIVE'`); // HR deactivated (client req #2)
  console.log('[migrate] roles & states ensured');

  // Resignation chain per client (13-07-2026): RM → FM → Business Head → Admin → Finance → HR.
  // Existing DBs seeded the old stage 3 (IT_INFRA/named_user) — update in place; new DBs
  // get the right rows from schema.sql. In-flight instances keep their copied stages.
  await pool.query(`
    UPDATE approval_flow_stages s SET role_key='BUSINESS_HEAD', resolver_type='matrix'
    FROM approval_flows f WHERE s.flow_id=f.id AND f.code='RESIGNATION' AND s.seq=3 AND s.role_key='IT_INFRA'`);
  await pool.query(`
    UPDATE approval_flow_stages s SET resolver_type='matrix'
    FROM approval_flows f WHERE s.flow_id=f.id AND f.code='RESIGNATION'
      AND s.seq IN (4,5) AND s.resolver_type='named_user'`);
  console.log('[migrate] resignation chain ensured (RM→FM→Business Head→Admin→Finance→HR)');

  // Unique secondary key on official email (guarded — duplicates won't crash startup).
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_employees_official_email ON employees (lower(official_email))`);
    console.log('[migrate] unique official_email index ensured');
  } catch (e) {
    console.warn('[migrate] could not create unique official_email index (duplicate emails exist?):', e.message);
  }

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
