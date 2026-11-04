// Client-side mirror of backend/src/utils/validate.js. Same rules and messages,
// so a form can show every error at once before submitting; the server still
// re-checks everything.
export const patterns = {
  name: /^[A-Za-z][A-Za-z .'-]*$/,
  mobile: /^[6-9]\d{9}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  pin: /^[1-9]\d{5}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  gstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  uan: /^\d{12}$/,
  esic: /^\d{17}$/,
  pf: /^[A-Z]{2}[A-Z]{3}\d{7}\d{3}\d{7}$/,
  cin: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/,
  aadhaar: /^\d{12}$/,
  hex: /^#[0-9a-fA-F]{6}$/,
  url: /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i,
  code: /^[A-Z0-9]{2,16}$/,
};
const HINT = { pan: 'like ABCDE1234F', gstin: '15 characters, like 21ABCDE1234F1Z5', ifsc: 'like SBIN0001234',
  uan: '12 digits', esic: '17 digits', pin: '6 digits', cin: '21 characters', aadhaar: '12 digits',
  pf: 'like MHBAN00123450000123456', hex: 'like #0A5FD1', url: 'like www.example.com', code: '2-16 letters or digits' };

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
export const toNumber = (v) => (blank(v) ? null : Number(String(v).replace(/,/g, '').trim()));

// const v = validator(); v.require('name', form.name, 'Name') …; if (!v.ok) setErrors(v.fields)
export function validator() {
  const fields = {};
  const add = (k, m) => { if (!fields[k]) fields[k] = m; };
  const api = {
    fields,
    add,
    require(k, val, lbl) { if (blank(val)) add(k, `${lbl} is required`); return api; },
    check(k, val, rule, msg, { required = false, label } = {}) {
      if (blank(val)) { if (required) add(k, `${label || 'This field'} is required`); return api; }
      const s = String(val).trim();
      if (!(rule instanceof RegExp ? rule.test(s) : rule(s))) add(k, msg);
      return api;
    },
    name(k, val, lbl, o = {}) { return api.check(k, val, (s) => patterns.name.test(s) && s.length <= 80, `${lbl} should contain letters only`, { ...o, label: lbl }); },
    mobile(k, val, lbl = 'Mobile number', o = {}) {
      const s = normaliseMobile(val);
      return api.check(k, s || val, patterns.mobile, `${lbl} must be a valid 10-digit mobile number starting with 6-9`, { ...o, label: lbl });
    },
    email(k, val, lbl = 'Email', o = {}) { return api.check(k, val, patterns.email, `${lbl} is not a valid email address`, { ...o, label: lbl }); },
    pattern(k, val, kind, lbl, o = {}) {
      const norm = ['pan', 'gstin', 'ifsc', 'pf', 'cin', 'code'].includes(kind) ? String(val ?? '').toUpperCase() : val;
      return api.check(k, norm, patterns[kind], `${lbl} is not valid${HINT[kind] ? ` (${HINT[kind]})` : ''}`, { ...o, label: lbl });
    },
    date(k, val, lbl, { required = false, min, max, minMsg, maxMsg } = {}) {
      if (blank(val)) { if (required) add(k, `${lbl} is required`); return api; }
      const s = String(val).slice(0, 10);
      const d = new Date(`${s}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) { add(k, `${lbl} is not a valid date`); return api; }
      if (min && s < min) add(k, minMsg || `${lbl} cannot be before ${min}`);
      if (max && s > max) add(k, maxMsg || `${lbl} cannot be after ${max}`);
      return api;
    },
    number(k, val, lbl, { required = false, min, max, integer = false } = {}) {
      const n = toNumber(val);
      if (n === null) { if (required) add(k, `${lbl} is required`); return api; }
      if (Number.isNaN(n)) { add(k, `${lbl} must be a number`); return api; }
      if (integer && !Number.isInteger(n)) add(k, `${lbl} must be a whole number`);
      if (min !== undefined && n < min) add(k, `${lbl} cannot be less than ${min}`);
      if (max !== undefined && n > max) add(k, `${lbl} cannot be more than ${max.toLocaleString('en-IN')}`);
      return api;
    },
    text(k, val, lbl, { required = false, min = 0, max = 2000 } = {}) {
      if (blank(val)) { if (required) add(k, `${lbl} is required`); return api; }
      const s = String(val).trim();
      if (s.length < min) add(k, `${lbl} must be at least ${min} characters`);
      if (s.length > max) add(k, `${lbl} must be at most ${max} characters`);
      if (!/[A-Za-z0-9]/.test(s)) add(k, `${lbl} must contain letters or digits`);
      return api;
    },
    get ok() { return Object.keys(fields).length === 0; },
  };
  return api;
}

// Date helpers for <input type="date"> bounds.
export function addYears(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + n); return d.toISOString().slice(0, 10); }
export function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Merge server field errors (err.fields) with a fallback message for the form.
export const serverFields = (err) => err?.fields || {};

export const INDIAN_STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

// "+91 98765 43210", "91-9876543210", "09876543210" → "9876543210". A plain
// 10-digit number is left alone even when it starts with 91 (9123456780).
export function normaliseMobile(v) {
  const d = String(v ?? '').replace(/[\s-]/g, '');
  if (/^\d{10}$/.test(d)) return d;
  const m = /^(?:\+?91|0)(\d{10})$/.exec(d);
  return m ? m[1] : d;
}
