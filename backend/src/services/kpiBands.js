// ============================================================================
// KPI measurement bands — the rule that turns achievement into a rating.
//
// In GreenHR the band IS the measurement parameter: MTD Achieved against MTD
// Target gives an achievement %, and the band that % falls into is the rating
// (90–104% → 3, 105–119% → 4, 120%+ → 5, and the bands vary per role).
//
// True HR stored the bands on every KRA and printed them on the screen as a
// hint, but nothing read them: the employee simply picked a rating from a
// dropdown. So an employee could report 60% of target and still select 5, and a
// role-specific band set changed no number anywhere. This module closes that.
//
// Where a target or achievement is not numeric — "Launch 3 campaigns" is a
// legitimate KRA — there is nothing to compute from, so the entered rating
// stands. That is why a score records WHERE its rating came from.
// ============================================================================

export const RATING_SOURCES = ['BAND', 'ENTERED'];
export const MIN_RATING = 1;
export const MAX_RATING = 5;

export const DEFAULT_BANDS = [
  { min: 0, max: 59, rating: 1 },
  { min: 60, max: 89, rating: 2 },
  { min: 90, max: 104, rating: 3 },
  { min: 105, max: 119, rating: 4 },
  { min: 120, max: null, rating: 5 },
];

/** A number from a free-text field: "1,200", "85 %", " 96.5 " all parse. */
export function numeric(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[,\s%₹]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Achievement as a percentage of target, or null when it cannot be computed.
 * A zero target is not "infinite achievement" — it is an unusable divisor.
 */
export function achievementPct(target, achieved) {
  const t = numeric(target), a = numeric(achieved);
  if (t == null || a == null || t === 0) return null;
  return Math.round((a / t) * 10000) / 100;   // two decimals
}

/**
 * The rating for an achievement %, from this KRA's bands.
 *
 * A band is decided by its FLOOR: the answer is the highest band whose "from"
 * is at or below the achievement. That matters because bands are written with
 * whole-number bounds (0-59, 60-89, 90-104, …) while real achievement is
 * fractional — 7 of 6 is 116.67%, 119.5% happens all the time. Matching on the
 * printed range instead would drop those between two bands and score nothing,
 * so the upper bound is for reading and for validation, not for the lookup.
 *
 * Null only when the achievement is below every floor, which is a band set
 * that does not start at 0; the caller then keeps the entered rating.
 */
export function ratingFromBands(bands, pct) {
  if (pct == null || !Array.isArray(bands) || !bands.length) return null;
  const rows = bands
    .map((b) => ({ min: numeric(b?.min), rating: numeric(b?.rating) }))
    .filter((b) => b.min != null && b.rating != null)
    .sort((x, y) => x.min - y.min);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (pct >= rows[i].min) return rows[i].rating;
  }
  return null;
}

/**
 * Resolve one KRA score: derive from the bands where possible, else keep what
 * was entered.
 * @returns {{rating:number|null, pct:number|null, source:'BAND'|'ENTERED'}}
 */
export function resolveScore({ bands, mtdTarget, mtdAchieved, enteredRating }) {
  const pct = achievementPct(mtdTarget, mtdAchieved);
  const banded = ratingFromBands(bands, pct);
  if (banded != null) return { rating: banded, pct, source: 'BAND' };
  const entered = numeric(enteredRating);
  return { rating: entered, pct, source: 'ENTERED' };
}

/**
 * Validate a band set before it is stored. These are the shapes that would
 * silently mis-rate someone rather than fail loudly:
 *   - a gap, so a legitimate achievement % maps to no rating at all
 *   - an overlap, where the answer depends on row order
 *   - no open-ended top band, so beating target by a lot falls off the end
 * @returns {string|null} the problem, or null
 */
export function validateBands(bands, kraLabel = 'KRA') {
  if (bands == null) return null;                       // absent = use the default
  if (!Array.isArray(bands) || !bands.length) return `${kraLabel}: give at least one measurement band.`;
  if (bands.length > 10) return `${kraLabel}: ten bands is plenty.`;

  const rows = [];
  for (const b of bands) {
    const min = numeric(b?.min);
    const max = b?.max == null || b?.max === '' ? null : numeric(b.max);
    const rating = numeric(b?.rating);
    if (min == null) return `${kraLabel}: every band needs a "from" percentage.`;
    if (min < 0) return `${kraLabel}: a band cannot start below 0%.`;
    if (b?.max != null && b?.max !== '' && max == null) return `${kraLabel}: "${b.max}" is not a valid "to" percentage.`;
    if (max != null && max < min) return `${kraLabel}: a band ending at ${max}% cannot start at ${min}%.`;
    if (rating == null) return `${kraLabel}: every band needs a rating.`;
    if (rating < MIN_RATING || rating > MAX_RATING) return `${kraLabel}: ratings run ${MIN_RATING} to ${MAX_RATING}.`;
    rows.push({ min, max, rating });
  }

  rows.sort((x, y) => x.min - y.min);
  const openEnded = rows.filter((r) => r.max == null);
  if (openEnded.length > 1) return `${kraLabel}: only the top band may be open-ended.`;
  if (openEnded.length === 1 && openEnded[0] !== rows[rows.length - 1]) {
    return `${kraLabel}: the open-ended band must be the highest one.`;
  }
  if (!openEnded.length) return `${kraLabel}: the top band must be open-ended, or beating target by a lot would score nothing.`;

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    if (cur.min === prev.min) return `${kraLabel}: two bands both start at ${cur.min}%.`;
    if (prev.max == null) continue;
    if (cur.min <= prev.max) return `${kraLabel}: bands ${prev.min}–${prev.max}% and ${cur.min}–${cur.max ?? '∞'}% overlap.`;
    // The printed ranges should read as contiguous even though the lookup goes
    // by floor, so a set like 0–50 then 60+ is a mistake worth flagging: it
    // reads as if 51–59% scores nothing.
    if (cur.min > prev.max + 1) return `${kraLabel}: the bands read as if nothing covers ${prev.max + 1}–${cur.min - 1}%. Close the gap.`;
  }
  if (rows[0].min > 0) return `${kraLabel}: the lowest band must start at 0%, or missing target entirely would score nothing.`;
  return null;
}

/** Sorted, normalised bands ready to store. */
export const normaliseBands = (bands) => (Array.isArray(bands) && bands.length
  ? bands.map((b) => ({
      min: numeric(b.min),
      max: b.max == null || b.max === '' ? null : numeric(b.max),
      rating: numeric(b.rating),
    })).sort((x, y) => x.min - y.min)
  : DEFAULT_BANDS);

// ── Readable ranges and the grade ladder (QA v2: H119, C36, E31) ────────────
// A band or grade covers [its floor, the next floor): min inclusive, next min
// exclusive. Printed whole-number ranges like 90–104 left 104.5% in no grade;
// reading ranges as "90% to below 105%" makes the ladder continuous.

const fmtPct = (n) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

/** "90% to below 105%", "120% and above", "Below 60%". */
export function rangeLabel(min, nextMin) {
  if (nextMin == null) return `${fmtPct(min)} and above`;
  if (Number(min) === 0) return `Below ${fmtPct(nextMin)}`;
  return `${fmtPct(min)} to below ${fmtPct(nextMin)}`;
}

/** Bands with a readable `label` each (the floor of the next band is the ceiling). */
export function labelBands(bands) {
  const rows = (Array.isArray(bands) ? bands : [])
    .map((b) => ({ ...b, min: numeric(b?.min) }))
    .filter((b) => b.min != null)
    .sort((x, y) => x.min - y.min);
  return rows.map((b, i) => ({ ...b, label: rangeLabel(b.min, rows[i + 1]?.min ?? null) }));
}

/**
 * The grade for a percentage: the highest grade whose floor is at or below it.
 * `ladder` rows are { code, minPct }. Null only for a negative / missing pct.
 */
export function gradeForPct(ladder, pct) {
  const p = numeric(pct);
  if (p == null || !Array.isArray(ladder) || !ladder.length) return null;
  const rows = [...ladder].sort((a, b) => Number(a.minPct) - Number(b.minPct));
  for (let i = rows.length - 1; i >= 0; i--) if (p >= Number(rows[i].minPct)) return rows[i];
  return null;
}

/**
 * Validate an organisation's grade ladder. Returns { fields } keyed by row
 * (`grades.<i>.code` …) plus a general `grades` message, or null when valid.
 * Rules: 2-10 grades; grade numbers 1-10 and unique; codes 1-10 letters/digits
 * and unique (case-insensitive); a label; floors are numbers 0-1000, unique,
 * the lowest is 0, and a higher grade always has a higher floor.
 */
export function validateLadder(rows) {
  const fields = {};
  const add = (k, m) => { if (!fields[k]) fields[k] = m; };
  if (!Array.isArray(rows) || rows.length < 2) return { grades: 'Give at least two grades.' };
  if (rows.length > 10) return { grades: 'Ten grades is the most a ladder can have.' };
  const seenGrade = new Set(); const seenCode = new Set(); const seenMin = new Set();
  rows.forEach((g, i) => {
    const grade = Number(g?.grade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 10) add(`grades.${i}.grade`, 'Grade must be a whole number from 1 to 10');
    else if (seenGrade.has(grade)) add(`grades.${i}.grade`, `Grade ${grade} is used twice`);
    else seenGrade.add(grade);
    const code = String(g?.code ?? '').trim().toUpperCase();
    if (!code) add(`grades.${i}.code`, 'Code is required');
    else if (!/^[A-Z0-9+-]{1,10}$/.test(code)) add(`grades.${i}.code`, 'Code must be 1-10 letters or digits');
    else if (seenCode.has(code)) add(`grades.${i}.code`, `Code ${code} is used twice`);
    else seenCode.add(code);
    const label = String(g?.label ?? '').trim();
    if (!label) add(`grades.${i}.label`, 'Label is required');
    else if (label.length > 80 || !/[A-Za-z]/.test(label)) add(`grades.${i}.label`, 'Label must be up to 80 characters and contain letters');
    const min = numeric(g?.minPct);
    if (min == null) add(`grades.${i}.minPct`, 'From % is required');
    else if (min < 0 || min > 1000) add(`grades.${i}.minPct`, 'From % must be between 0 and 1000');
    else if (Math.round(min * 100) !== min * 100) add(`grades.${i}.minPct`, 'From % can have at most 2 decimal places');
    else if (seenMin.has(min)) add(`grades.${i}.minPct`, `Two grades both start at ${min}%`);
    else seenMin.add(min);
  });
  if (Object.keys(fields).length) return fields;
  const sorted = rows.map((g) => ({ grade: Number(g.grade), min: numeric(g.minPct) })).sort((a, b) => a.min - b.min);
  if (sorted[0].min !== 0) return { grades: 'The lowest grade must start at 0%, or a low score would get no grade.' };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].grade <= sorted[i - 1].grade) return { grades: 'A higher grade must start at a higher percentage.' };
  }
  return null;
}
