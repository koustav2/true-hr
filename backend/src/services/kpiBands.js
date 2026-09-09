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
