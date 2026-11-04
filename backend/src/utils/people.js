// Who counts as an "employee" (decision D7 of the QA fix plan): onboarded
// (ACTIVE, with an employee code) and not past an approved last working day.
// Candidates (offer sent, filling details, awaiting review) are counted apart.
//
// `alias` is the employees table alias in the caller's query (a code constant).
export const activeEmployeeSql = (alias = 'e') => `(
  ${alias}.onboarding_status = 'ACTIVE'
  AND ${alias}.employee_code IS NOT NULL AND ${alias}.employee_code <> ''
  AND NOT EXISTS (
    SELECT 1 FROM resignations rx
     WHERE rx.employee_id = ${alias}.id AND rx.status = 'APPROVED'
       AND rx.last_working_date IS NOT NULL
       AND rx.last_working_date < (now() AT TIME ZONE 'Asia/Kolkata')::date)
)`;

export const candidateSql = (alias = 'e') =>
  `(${alias}.onboarding_status NOT IN ('ACTIVE','INACTIVE','REJECTED','EXPIRED'))`;
