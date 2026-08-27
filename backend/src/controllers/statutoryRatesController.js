// Statutory-rate masters + a payroll compliance check.
// Wraps the pure statutoryRates service; DB rows override the built-in tables.
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { professionalTax, minimumWage, complianceCheck, skillCategories } from '../services/statutoryRates.js';

export async function categories(_req, res) { res.json({ categories: skillCategories() }); }

export async function listPtSlabs(req, res) {
  const rows = (await query(
    `SELECT * FROM professional_tax_slabs WHERE ($1::bigint IS NULL OR organisation_id=$1) ORDER BY state, upto_gross`,
    [req.orgId || null])).rows;
  res.json({ slabs: rows });
}
export async function savePtSlabs(req, res) {
  const { state, slabs } = req.body || {};
  if (!state || !Array.isArray(slabs)) return res.status(400).json({ error: 'state and slabs[] required.' });
  await query(`DELETE FROM professional_tax_slabs WHERE state=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [state, req.orgId || null]);
  for (const s of slabs) {
    await query(`INSERT INTO professional_tax_slabs (state, upto_gross, amount, organisation_id) VALUES ($1,$2,$3,$4)`,
      [state, Number(s.upto), Number(s.amount), req.orgId || null]);
  }
  await audit(req.user.id, 'PT_SLABS_SAVE', 'professional_tax_slabs', null, { state, count: slabs.length });
  res.json({ ok: true });
}

export async function listMinWages(req, res) {
  const rows = (await query(
    `SELECT * FROM minimum_wages WHERE ($1::bigint IS NULL OR organisation_id=$1) ORDER BY state, category`,
    [req.orgId || null])).rows;
  res.json({ minWages: rows });
}
export async function saveMinWage(req, res) {
  const { state, category, monthlyAmount } = req.body || {};
  if (!state || !category) return res.status(400).json({ error: 'state and category required.' });
  await query(
    `INSERT INTO minimum_wages (state, category, monthly_amount, organisation_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (organisation_id, state, category) DO UPDATE SET monthly_amount=EXCLUDED.monthly_amount`,
    [state, category, Number(monthlyAmount) || 0, req.orgId || null]);
  await audit(req.user.id, 'MIN_WAGE_SAVE', 'minimum_wages', null, { state, category });
  res.json({ ok: true });
}

// Load DB overrides for a state, if any, then delegate to the pure service.
async function ptOverrides(orgId, state) {
  const rows = (await query(
    `SELECT upto_gross AS upto, amount FROM professional_tax_slabs
      WHERE state=$1 AND ($2::bigint IS NULL OR organisation_id=$2) ORDER BY upto_gross`, [state, orgId || null])).rows;
  return rows.length ? rows : null;
}
async function minWageOverrides(orgId, state) {
  const rows = (await query(
    `SELECT category, monthly_amount FROM minimum_wages
      WHERE state=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [state, orgId || null])).rows;
  if (!rows.length) return null;
  const o = {}; for (const r of rows) o[String(r.category).toLowerCase()] = Number(r.monthly_amount);
  return o;
}

export async function checkCompliance(req, res) {
  const { state, category, monthlyGross, month } = req.query;
  const gross = Number(monthlyGross) || 0;
  const ptOv = await ptOverrides(req.orgId, state);
  const mwOv = await minWageOverrides(req.orgId, state);
  const pt = professionalTax(state, gross, { month: month ? Number(month) : undefined, overrides: ptOv });
  const minWage = minimumWage(state, category, { overrides: mwOv });
  const base = complianceCheck({ state, category, monthlyGross: gross, month: month ? Number(month) : undefined });
  res.json({ ...base, pt, minWage, source: { pt: ptOv ? 'override' : 'builtin', minWage: mwOv ? 'override' : 'builtin' } });
}
