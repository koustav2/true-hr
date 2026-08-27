// Statutory rate logic — Professional Tax (state slabs) and Minimum Wage (state × skill).
// Pure and DB-free so it is unit-testable; controllers may pass DB overrides.
// Reference parity: GreenHR exposes PT-by-state and a minimum-wage floor by skill
// categorisation. These built-in tables are sensible defaults an admin can override
// via the statutory-rate masters (professional_tax_slabs / minimum_wages tables).

const canon = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Monthly Professional Tax slabs by state. Each entry: [uptoMonthlyGross, taxForThatBand].
// Last band uses Infinity. Amounts in INR/month. February specials (e.g. MH ₹300 in Feb)
// are handled by the optional `month` arg. States without PT return 0.
const PT_SLABS = {
  'maharashtra':   { slabs: [[7500, 0], [10000, 175], [Infinity, 200]], febExtra: 100 },
  'karnataka':     { slabs: [[24999, 0], [Infinity, 200]] },
  'west bengal':   { slabs: [[10000, 0], [15000, 110], [25000, 130], [40000, 150], [Infinity, 200]] },
  'tamil nadu':    { slabs: [[21000, 0], [30000, 135], [45000, 315], [60000, 690], [75000, 1025], [Infinity, 1250]], perHalfYear: true },
  'andhra pradesh':{ slabs: [[15000, 0], [20000, 150], [Infinity, 200]] },
  'telangana':     { slabs: [[15000, 0], [20000, 150], [Infinity, 200]] },
  'gujarat':       { slabs: [[12000, 0], [Infinity, 200]] },
  'madhya pradesh':{ slabs: [[18750, 0], [25000, 125], [33333, 167], [Infinity, 208]] },
  'odisha':        { slabs: [[13304, 0], [25000, 125], [Infinity, 200]] },
  'bihar':         { slabs: [[25000, 0], [41666, 83], [83333, 166], [Infinity, 208]] },
  'assam':         { slabs: [[10000, 0], [15000, 150], [25000, 180], [Infinity, 208]] },
  'kerala':        { slabs: [[11999, 0], [17999, 120], [29999, 180], [Infinity, 208]], perHalfYear: true },
  'jharkhand':     { slabs: [[25000, 0], [41666, 100], [66666, 150], [83333, 175], [Infinity, 208]] },
  'meghalaya':     { slabs: [[4166, 0], [12500, 100], [16666, 150], [Infinity, 208]] },
  'sikkim':        { slabs: [[20000, 0], [30000, 125], [40000, 150], [Infinity, 200]] },
  'chhattisgarh':  { slabs: [[Infinity, 0]] },
  'punjab':        { slabs: [[Infinity, 200]] },   // fixed ₹200/month for taxable persons
};

// States/UTs with NO professional tax at all.
const NO_PT = new Set(['delhi', 'haryana', 'uttar pradesh', 'uttarakhand', 'rajasthan',
  'goa', 'himachal pradesh', 'arunachal pradesh', 'jammu and kashmir', 'ladakh',
  'chandigarh', 'andaman and nicobar islands', 'lakshadweep', 'dadra and nagar haveli',
  'daman and diu', 'manipur', 'mizoram', 'nagaland', 'tripura', 'puducherry']);

/**
 * Professional Tax deduction for a month.
 * @param {string} state
 * @param {number} monthlyGross
 * @param {object} [opts] { month:1-12, overrides:[{upto,amount}] }
 * @returns {number} PT in INR (0 if the state has none / gross below threshold)
 */
export function professionalTax(state, monthlyGross, opts = {}) {
  const g = Number(monthlyGross) || 0;
  const key = canon(state);
  if (Array.isArray(opts.overrides) && opts.overrides.length) {
    return slabLookup(opts.overrides.map((o) => [Number(o.upto), Number(o.amount)]), g);
  }
  if (NO_PT.has(key)) return 0;
  const rec = PT_SLABS[key];
  if (!rec) return 0; // unknown state → no PT rather than a wrong guess
  let pt = slabLookup(rec.slabs, g);
  if (rec.febExtra && Number(opts.month) === 2 && pt > 0) pt += rec.febExtra; // e.g. Maharashtra Feb ₹300
  return pt;
}

function slabLookup(slabs, gross) {
  for (const [upto, amt] of slabs) if (gross <= upto) return amt;
  return slabs.length ? slabs[slabs.length - 1][1] : 0;
}

// Representative monthly minimum wages (INR) by skill category — used as a FLOOR.
// These vary by state notification; kept conservative and overridable per state via DB.
const SKILLS = ['unskilled', 'semi skilled', 'skilled', 'highly skilled'];
const DEFAULT_MIN_WAGE = { unskilled: 12000, 'semi skilled': 13500, skilled: 15000, 'highly skilled': 17500 };
const STATE_MIN_WAGE = {
  'maharashtra': { unskilled: 13500, 'semi skilled': 14500, skilled: 15500, 'highly skilled': 17000 },
  'karnataka':   { unskilled: 14040, 'semi skilled': 15444, skilled: 16988, 'highly skilled': 18686 },
  'delhi':       { unskilled: 17494, 'semi skilled': 19279, skilled: 21215, 'highly skilled': 21215 },
  'tamil nadu':  { unskilled: 12000, 'semi skilled': 13000, skilled: 14500, 'highly skilled': 16000 },
  'west bengal': { unskilled: 11500, 'semi skilled': 12650, skilled: 13915, 'highly skilled': 15300 },
};

export function skillCategories() { return [...SKILLS]; }

/**
 * Minimum monthly wage floor for a state + skill category.
 * @returns {number} INR/month floor (0 when unknown → no floor enforced)
 */
export function minimumWage(state, category, opts = {}) {
  const cat = canon(category);
  if (opts.overrides && opts.overrides[cat] != null) return Number(opts.overrides[cat]) || 0;
  const st = STATE_MIN_WAGE[canon(state)];
  if (st && st[cat] != null) return st[cat];
  return DEFAULT_MIN_WAGE[cat] || 0;
}

/**
 * Compliance check for a computed monthly structure.
 * @returns {{ok:boolean, minWage:number, gross:number, pt:number, warnings:string[]}}
 */
export function complianceCheck({ state, category, monthlyGross, month } = {}) {
  const minWage = minimumWage(state, category);
  const pt = professionalTax(state, monthlyGross, { month });
  const warnings = [];
  if (minWage && Number(monthlyGross) < minWage) {
    warnings.push(`Gross ₹${Math.round(monthlyGross)} is below the ${category || 'applicable'} minimum wage ₹${minWage} for ${state || 'this state'}.`);
  }
  return { ok: warnings.length === 0, minWage, gross: Number(monthlyGross) || 0, pt, warnings };
}
