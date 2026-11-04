// Client-side mirror of backend/src/services/peopleRules.js checkEmployeeFields —
// same rules and messages, so HR sees every error before submitting (C4, C10).
import { validator, addYears, toNumber } from '@/lib/validate.js';
import { todayIso } from '@/lib/labels.js';

export const CTC_MIN = 10000;
export const CTC_MAX = 100000000;

// lib/validate mobile() strips a leading "91" even from a 10-digit number
// (9123456780 would fail); prefix +91 so that is the part stripped.
export const m10 = (x) => (/^\d{10}$/.test(String(x ?? '').trim()) ? `+91${String(x).trim()}` : x);
export const placeOk = (s) => /^[A-Za-z][A-Za-z .,'()-]*$/.test(String(s || '').trim()) && String(s).trim().length <= 80;

export const dateBounds = () => {
  const today = todayIso();
  return {
    today,
    dobMax: addYears(today, -18), dobMin: addYears(today, -80),
    dojMax: addYears(today, 1),
  };
};

/**
 * f: form values. creating = a new offer (DOJ cannot be in the past).
 * current: the saved record (edit), to skip re-checking an unchanged location.
 */
export function checkEmployee(f, { creating = false, current = {}, needCtc = false } = {}) {
  const v = validator();
  const { today, dobMax, dobMin, dojMax } = dateBounds();
  v.name('firstName', f.firstName, 'First name', { required: true });
  v.name('lastName', f.lastName, 'Last name', { required: true });
  v.mobile('phone', m10(f.phone), 'Mobile number');
  v.email('personalEmail', f.personalEmail, 'Personal email', { required: true });
  v.email('officialEmail', f.officialEmail, 'Official email', { required: true });
  if (f.personalEmail && f.officialEmail && f.personalEmail.trim().toLowerCase() === f.officialEmail.trim().toLowerCase()) {
    v.add('officialEmail', 'Official email must be different from the personal email');
  }
  v.date('dob', f.dob, 'Date of birth', { required: creating, max: dobMax, maxMsg: 'Employee must be at least 18 years old (date of birth must be in the past)', min: dobMin, minMsg: 'Date of birth looks too far in the past' });
  const minDoj = creating ? today : (f.dob ? addYears(f.dob, 18) : '1950-01-01');
  v.date('dateOfJoining', f.dateOfJoining, 'Date of joining', {
    required: true, min: minDoj, max: dojMax,
    minMsg: creating ? 'Date of joining cannot be in the past for a new offer' : 'Date of joining must be at least 18 years after the date of birth',
    maxMsg: 'Date of joining cannot be more than a year from today',
  });
  if (creating && f.dob && f.dateOfJoining && f.dateOfJoining < addYears(f.dob, 18)) {
    v.add('dateOfJoining', 'Date of joining must be at least 18 years after the date of birth');
  }
  v.require('departmentId', f.departmentId, 'Department');
  v.require('designationId', f.designationId, 'Designation');
  if (needCtc || String(f.ctc ?? '').trim()) {
    v.number('ctc', f.ctc, 'Annual CTC', { required: needCtc, min: CTC_MIN, max: CTC_MAX });
    const n = toNumber(f.ctc);
    if (n && Math.round(n * 100) !== n * 100) v.add('ctc', 'Annual CTC can have at most 2 decimal places');
  }
  if (f.location && String(f.location).trim() !== String(current.location || '').trim() && !placeOk(f.location)) {
    v.add('location', 'Location should contain letters only (e.g. Bhubaneswar, Odisha)');
  }
  for (const k of ['reportingManagerId', 'functionManagerId', 'operationalManagerId']) {
    if (current.id && f[k] && String(f[k]) === String(current.id)) v.add(k, 'An employee cannot be their own manager');
  }
  return v;
}

export const mgrLabel = (m) => `${m.first_name} ${m.last_name}${m.employee_code ? ` · ${m.employee_code}` : ''}${m.designation ? ` (${m.designation})` : ''}`;
