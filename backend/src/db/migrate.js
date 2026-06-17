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
  console.log('[migrate] roles & states ensured');

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
