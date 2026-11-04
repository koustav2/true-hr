// Field validation shared by the v2 API. Mirrors web/lib/validate.js so the
// portal can show the same messages before a request is ever sent.
//
// Usage:
//   const v = validator();
//   v.require('firstName', body.firstName, 'First name');
//   v.check('phone', body.phone, rules.mobile, 'Enter a valid 10-digit mobile number');
//   v.throwIfAny();            // 400 { error, fields: { phone: '…' } }
import { AppError } from '../middleware/error.js';

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

export const patterns = {
  name: /^[A-Za-z][A-Za-z .'-]*$/,                 // letters, spaces, dot, apostrophe, hyphen
  mobile: /^[6-9]\d{9}$/,                          // Indian mobile
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  pin: /^[1-9]\d{5}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  gstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  uan: /^\d{12}$/,
  esic: /^\d{17}$/,
  pf: /^[A-Z]{2}[A-Z]{3}\d{7}\d{3}\d{7}$/,         // e.g. MHBAN00123450000123456
  cin: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/,
  aadhaar: /^\d{12}$/,
  isoDate: /^\d{4}-\d{2}-\d{2}$/,
  hex: /^#[0-9a-fA-F]{6}$/,
  url: /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i,
  code: /^[A-Z0-9]{2,16}$/,
};

export function parseDate(v) {
  if (blank(v) || !patterns.isoDate.test(String(v).slice(0, 10))) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

// Today's date in India, as YYYY-MM-DD. The server runs in UTC; between 00:00
// and 05:30 IST the UTC date is still yesterday.
export function todayIST() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function ageOn(dob, onIso = todayIST()) {
  const b = parseDate(dob); const o = parseDate(onIso);
  if (!b || !o) return null;
  let age = o.getUTCFullYear() - b.getUTCFullYear();
  const m = o.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && o.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

export function toNumber(v) {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

export function validator() {
  const fields = {};
  const add = (key, msg) => { if (!fields[key]) fields[key] = msg; };
  const api = {
    fields,
    add,
    has: (key) => !!fields[key],
    require(key, value, label) {
      if (blank(value)) add(key, `${label} is required`);
      return api;
    },
    // Optional unless `required`; a blank optional value is skipped.
    check(key, value, rule, msg, { required = false, label } = {}) {
      if (blank(value)) { if (required) add(key, `${label || 'This field'} is required`); return api; }
      const s = String(value).trim();
      const ok = rule instanceof RegExp ? rule.test(s) : !!rule(s);
      if (!ok) add(key, msg);
      return api;
    },
    name(key, value, label, opts = {}) {
      return api.check(key, value, (s) => patterns.name.test(s) && s.length <= 80,
        `${label} should contain letters only`, { ...opts, label });
    },
    mobile(key, value, label = 'Mobile number', opts = {}) {
      return api.check(key, normaliseMobile(value) || value,
        patterns.mobile, `${label} must be a valid 10-digit mobile number starting with 6-9`, { ...opts, label });
    },
    email(key, value, label = 'Email', opts = {}) {
      return api.check(key, value, patterns.email, `${label} is not a valid email address`, { ...opts, label });
    },
    pattern(key, value, kind, label, opts = {}) {
      const hint = { pan: 'like ABCDE1234F', gstin: '15 characters, like 21ABCDE1234F1Z5', ifsc: 'like SBIN0001234',
        uan: '12 digits', esic: '17 digits', pin: '6 digits', cin: '21 characters', aadhaar: '12 digits',
        pf: 'like MHBAN00123450000123456', hex: 'like #0A5FD1', url: 'like www.example.com', code: '2-16 letters or digits' }[kind];
      const norm = ['pan', 'gstin', 'ifsc', 'pf', 'cin', 'code'].includes(kind) ? String(value ?? '').toUpperCase() : value;
      return api.check(key, norm, patterns[kind], `${label} is not valid${hint ? ` (${hint})` : ''}`, { ...opts, label });
    },
    date(key, value, label, { required = false, min, max, minMsg, maxMsg } = {}) {
      if (blank(value)) { if (required) add(key, `${label} is required`); return api; }
      const d = parseDate(value);
      if (!d) { add(key, `${label} is not a valid date`); return api; }
      const s = String(value).slice(0, 10);
      if (min && s < min) add(key, minMsg || `${label} cannot be before ${min}`);
      if (max && s > max) add(key, maxMsg || `${label} cannot be after ${max}`);
      return api;
    },
    number(key, value, label, { required = false, min, max, integer = false, decimals } = {}) {
      const n = toNumber(value);
      if (n === null) { if (required) add(key, `${label} is required`); return api; }
      if (Number.isNaN(n)) { add(key, `${label} must be a number`); return api; }
      if (integer && !Number.isInteger(n)) add(key, `${label} must be a whole number`);
      if (decimals !== undefined && Math.round(n * 10 ** decimals) !== n * 10 ** decimals) {
        add(key, `${label} can have at most ${decimals} decimal places`);
      }
      if (min !== undefined && n < min) add(key, `${label} cannot be less than ${min}`);
      if (max !== undefined && n > max) add(key, `${label} cannot be more than ${max.toLocaleString('en-IN')}`);
      return api;
    },
    oneOf(key, value, allowed, label, opts = {}) {
      return api.check(key, value, (s) => allowed.includes(s), `${label} must be one of: ${allowed.join(', ')}`, { ...opts, label });
    },
    text(key, value, label, { required = false, min = 0, max = 2000 } = {}) {
      if (blank(value)) { if (required) add(key, `${label} is required`); return api; }
      const s = String(value).trim();
      if (s.length < min) add(key, `${label} must be at least ${min} characters`);
      if (s.length > max) add(key, `${label} must be at most ${max} characters`);
      if (!/[A-Za-z0-9]/.test(s)) add(key, `${label} must contain letters or digits`);
      return api;
    },
    get ok() { return Object.keys(fields).length === 0; },
    throwIfAny(status = 400) {
      const keys = Object.keys(fields);
      if (!keys.length) return;
      const err = new AppError(keys.length === 1 ? fields[keys[0]] : `Please fix ${keys.length} fields: ${keys.map((k) => fields[k]).join('; ')}`, status);
      err.fields = fields;
      throw err;
    },
  };
  return api;
}

// Case-insensitive name collision check inside one organisation.
// `table`/`col` are code constants, never user input.
export async function nameTaken(query, table, col, orgId, value, { exceptId = null, orgCol = 'organisation_id' } = {}) {
  if (blank(value)) return false;
  const r = await query(
    `SELECT 1 FROM ${table} WHERE lower(trim(${col})) = lower(trim($1))
       AND (${orgCol} IS NOT DISTINCT FROM $2) AND ($3::bigint IS NULL OR id <> $3) LIMIT 1`,
    [value, orgId ?? null, exceptId]);
  return r.rowCount > 0;
}

export const INDIAN_STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

// Canonical state name for free text ("ODISHA", " odisha ") or null if unknown.
export function canonicalState(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return INDIAN_STATES.find((x) => x.toLowerCase() === s) || null;
}

// "+91 98765 43210", "91-9876543210", "09876543210" → "9876543210". A plain
// 10-digit number is left alone even when it starts with 91 (9123456780).
export function normaliseMobile(v) {
  const d = String(v ?? '').replace(/[\s-]/g, '');
  if (/^\d{10}$/.test(d)) return d;
  const m = /^(?:\+?91|0)(\d{10})$/.exec(d);
  return m ? m[1] : d;
}
