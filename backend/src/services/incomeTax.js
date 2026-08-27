// Income-tax logic for the Investment Declaration module + Form-16 estimate.
// Old vs New regime, chapter VI-A caps, rebate 87A, 4% cess. Pure/DB-free.
// Slabs default to FY 2024-25; kept as data so an admin can update per year.

export const SECTION_CAPS = {
  '80C': 150000,        // LIC, PF, ELSS, tuition, principal…
  '80CCD1B': 50000,     // NPS additional
  '80D': 100000,        // medical insurance (self+parents senior max)
  '80E': Infinity,      // education-loan interest (no cap)
  '80EE': 50000,        // first-home-loan interest
  '80EEA': 150000,      // affordable-home-loan interest
  '80G': Infinity,      // donations (subject to qualifying limits, simplified)
  '80TTA': 10000,       // savings interest
  'SEC24': 200000,      // self-occupied house-property loan interest (loss)
  'HRA': Infinity,      // exemption computed elsewhere; passed through
};

export const STD_DEDUCTION = { old: 50000, new: 75000 };

// Regime slabs (annual taxable, rate). FY 2024-25.
export const SLABS = {
  old: [[250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]],
  new: [[300000, 0], [700000, 0.05], [1000000, 0.10], [1200000, 0.15], [1500000, 0.20], [Infinity, 0.30]],
};
// Rebate u/s 87A: taxable income at/below this → tax nil.
export const REBATE_87A = { old: 500000, new: 700000 };
export const CESS = 0.04;

const r0 = (n) => Math.round(Number(n) || 0);

// Aggregate declared investment line items into capped section totals.
// items: [{ section:'80C', amount:Number }]
export function aggregateDeductions(items = []) {
  const raw = {};
  for (const it of items) {
    const s = String(it.section || '').toUpperCase();
    raw[s] = (raw[s] || 0) + (Number(it.amount) || 0);
  }
  const capped = {}; let total = 0;
  for (const [s, amt] of Object.entries(raw)) {
    const cap = SECTION_CAPS[s] ?? Infinity;
    const val = Math.min(amt, cap);
    capped[s] = val; total += val;
  }
  return { raw, capped, total: r0(total) };
}

// Progressive slab tax on a taxable amount.
export function slabTax(taxable, regime = 'new') {
  const slabs = SLABS[regime] || SLABS.new;
  let tax = 0, prev = 0;
  for (const [upto, rate] of slabs) {
    if (taxable > prev) { tax += (Math.min(taxable, upto) - prev) * rate; prev = upto; }
    else break;
  }
  return tax;
}

/**
 * Compute annual tax for a regime.
 * @param {object} p { grossAnnual, regime, deductions:{capped,total}, otherExemptions }
 * old regime applies chapter VI-A deductions; new regime ignores them (only std + employer NPS).
 */
export function computeRegimeTax({ grossAnnual, regime = 'new', deductions = { capped: {}, total: 0 }, otherExemptions = 0 }) {
  const std = STD_DEDUCTION[regime] || 0;
  let taxable;
  if (regime === 'old') {
    taxable = Number(grossAnnual) - std - (deductions.total || 0) - (Number(otherExemptions) || 0);
  } else {
    // New regime: no chapter VI-A except employer NPS (80CCD2) which we treat via otherExemptions if passed.
    taxable = Number(grossAnnual) - std - (Number(otherExemptions) || 0);
  }
  taxable = Math.max(0, r0(taxable));
  let tax = 0;
  if (taxable > (REBATE_87A[regime] || 0)) tax = slabTax(taxable, regime);
  const cess = tax * CESS;
  return { regime, taxable, taxBeforeCess: r0(tax), cess: r0(cess), totalTax: r0(tax + cess), monthlyTds: r0((tax + cess) / 12) };
}

/**
 * Full estimate — both regimes side by side + the cheaper recommendation.
 */
export function estimateTax({ grossAnnual, items = [], otherExemptions = 0, employerNps = 0 }) {
  const deductions = aggregateDeductions(items);
  const old = computeRegimeTax({ grossAnnual, regime: 'old', deductions, otherExemptions });
  const neu = computeRegimeTax({ grossAnnual, regime: 'new', deductions, otherExemptions: employerNps });
  const recommended = neu.totalTax <= old.totalTax ? 'new' : 'old';
  return { grossAnnual: r0(grossAnnual), deductions, old, new: neu, recommended, saving: Math.abs(old.totalTax - neu.totalTax) };
}
