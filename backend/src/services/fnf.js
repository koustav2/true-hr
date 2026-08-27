// Full & Final settlement computation — the exit-pay maths GreenHR has and TRUE HR lacked.
// Pure/DB-free so it is unit-testable. Ties onto the existing resignation record
// (does NOT replace or touch the resignation approval chain or the NFA settlement suite).
//
// Components (all monthly-CTC / structure driven):
//   + Salary for days worked in the final (partial) month
//   + Leave encashment  (unused paid-leave balance × per-day Basic+DA, capped)
//   + Gratuity          (if ≥ 5 years: 15/26 × last-drawn Basic × completed years)
//   + Bonus / arrears   (manual add)
//   - Notice-period recovery (shortfall days × per-day gross), TDS, advances, asset dues
// Net = payable − recoverable.  Positive → company pays the employee; negative → employee owes.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dInMonth = (y, m) => new Date(y, m, 0).getDate();
export const PER_DAY_BASE = 26; // statutory divisor for gratuity & leave encashment

export function daysBetweenInclusive(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return Math.max(0, Math.round((d2 - d1) / 86400000) + 1);
}
export function completedYears(doj, lwd) {
  const a = new Date(doj), b = new Date(lwd);
  let y = b.getFullYear() - a.getFullYear();
  const anniv = new Date(a); anniv.setFullYear(a.getFullYear() + y);
  if (anniv > b) y -= 1;
  return Math.max(0, y);
}

/**
 * @param {object} p
 *  monthlyCtc, basic (monthly), da(monthly,0), grossMonthly
 *  dateOfJoining, lastWorkingDate (ISO)
 *  leaveBalanceDays, noticeShortfallDays
 *  arrears, bonus, tds, advances, assetRecovery, otherEarnings, otherDeductions
 *  gratuityEligibleYears (default 5)
 * @returns {{lines:Array, earnings:number, deductions:number, net:number, gratuity:number, ...}}
 */
export function computeFnf(p = {}) {
  const monthlyCtc = Number(p.monthlyCtc) || 0;
  const basic = Number(p.basic) || r2(monthlyCtc * 0.5);
  const da = Number(p.da) || 0;
  const gross = Number(p.grossMonthly) || monthlyCtc;
  const lwd = p.lastWorkingDate;
  const dim = lwd ? dInMonth(new Date(lwd).getFullYear(), new Date(lwd).getMonth() + 1) : 30;

  // 1) Final-month salary for days actually worked (1st → LWD of that month).
  const finalMonthDays = lwd ? new Date(lwd).getDate() : 0;
  const perDayGross = gross / dim;
  const finalMonthSalary = r2(perDayGross * finalMonthDays);

  // 2) Leave encashment: unused paid days × per-day (Basic+DA)/26.
  const leaveDays = Math.max(0, Number(p.leaveBalanceDays) || 0);
  const perDayWage = (basic + da) / PER_DAY_BASE;
  const leaveEncashment = r2(perDayWage * leaveDays);

  // 3) Gratuity: 15/26 × (Basic+DA) × completed years, if service ≥ eligible years.
  const years = (p.dateOfJoining && lwd) ? completedYears(p.dateOfJoining, lwd) : 0;
  const eligYears = Number(p.gratuityEligibleYears ?? 5);
  const gratuity = years >= eligYears ? r2((15 / PER_DAY_BASE) * (basic + da) * years) : 0;

  const arrears = Number(p.arrears) || 0;
  const bonus = Number(p.bonus) || 0;
  const otherEarnings = Number(p.otherEarnings) || 0;

  // Recoveries
  const noticeShortfall = Math.max(0, Number(p.noticeShortfallDays) || 0);
  const noticeRecovery = r2(perDayGross * noticeShortfall);
  const tds = Number(p.tds) || 0;
  const advances = Number(p.advances) || 0;
  const assetRecovery = Number(p.assetRecovery) || 0;
  const otherDeductions = Number(p.otherDeductions) || 0;

  const lines = [
    { type: 'earning', label: `Salary for ${finalMonthDays} day(s) worked`, amount: finalMonthSalary },
    { type: 'earning', label: `Leave encashment (${leaveDays} day)`, amount: leaveEncashment },
    { type: 'earning', label: `Gratuity (${years} yr${years === 1 ? '' : 's'})`, amount: gratuity },
    { type: 'earning', label: 'Arrears', amount: arrears },
    { type: 'earning', label: 'Bonus', amount: bonus },
    { type: 'earning', label: 'Other earnings', amount: otherEarnings },
    { type: 'deduction', label: `Notice recovery (${noticeShortfall} day)`, amount: noticeRecovery },
    { type: 'deduction', label: 'TDS', amount: tds },
    { type: 'deduction', label: 'Advances / loans', amount: advances },
    { type: 'deduction', label: 'Asset / IT recovery', amount: assetRecovery },
    { type: 'deduction', label: 'Other deductions', amount: otherDeductions },
  ].filter((l) => l.amount);

  const earnings = r2(finalMonthSalary + leaveEncashment + gratuity + arrears + bonus + otherEarnings);
  const deductions = r2(noticeRecovery + tds + advances + assetRecovery + otherDeductions);
  const net = r2(earnings - deductions);
  return {
    lines, earnings, deductions, net,
    breakup: { finalMonthDays, finalMonthSalary, leaveDays, leaveEncashment, gratuity, completedYears: years,
      noticeShortfall, noticeRecovery, perDayGross: r2(perDayGross), perDayWage: r2(perDayWage) },
    payableBy: net >= 0 ? 'company' : 'employee',
  };
}
