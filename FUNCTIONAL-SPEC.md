# TrueHR — Functional Specification (What it is & how it works)

A product-level description of the core HR system: every module, its rules and
its flows. No code or technology details — usable to rebuild the same behaviour
on any stack.

> **Excluded from this document:** the NFA / expense suite (NFA, settlements,
> reports, vendors, PMS) and all ESS self-service modules (attendance & punches,
> leave / comp-off / on-duty / miss punch, tasks, support desk, team list,
> address book, app dashboard & banners, mobile-app features).

**Covered:** the HR admin console — accounts & roles, sign-in, the employee
lifecycle (offer → e-joining → active → exit), payroll, resignation workflow,
notifications, reports and security rules.

---

## 1. Users, roles & permissions

| Role | What they can do |
|---|---|
| **Employee** | Holds a login; subject of HR processes (profile, payslips, resignation) |
| **HR Admin** | Everything about people: onboarding, profiles, documents, payroll, resignations, user accounts & role assignment |
| **IT Admin** | User accounts, roles, audit log |
| **Super Admin** | Everything, including creating/removing other Super Admins |

Rules:

- Any admin (HR/IT/Super) can create staff accounts, change a user's role
  (Employee ↔ HR Admin ↔ IT Admin) and enable/disable accounts.
- Only a Super Admin can grant or revoke Super Admin, or touch a Super Admin's account.
- Nobody can change their own role or disable their own account.
- An account with no employee profile cannot be demoted to "Employee".
- Every sensitive action is written to an audit log (who, what, when).

## 2. Signing in

- Login with **official email or Employee ID** + password.
- **Two-step login (employees only, switchable):** after a correct password the
  system emails a 6-digit code; the user enters it to finish signing in.
  Codes expire in 10 minutes, work once, and lock after 5 wrong tries.
  Admin roles sign in with password only.
- **Forgot password:** user enters email/Employee ID → 6-digit code is emailed →
  user sets a new password with the code. The response never reveals whether an
  account exists. Login codes and reset codes are separate — one can never be
  used for the other.
- **Session:** signing in issues a 7-day session. If an account is disabled,
  every live session stops working within seconds — not just future logins.
  A disabled account attempting login sees "account disabled — contact HR"
  (only after the correct password, so nothing is leaked to guessers).

## 3. Employee lifecycle

### 3.1 Offer & onboarding (e-joining)

1. **HR onboards a new hire** with basic details (name, contacts, role,
   department, managers, joining date, location). Managers are picked by
   searching name **or Employee ID**; either or both may be set.
2. An **offer email** goes to the personal email with an accept/reject link
   (valid a configurable number of days). HR can attach a signed offer letter
   PDF, **or** tick "auto-generate" and enter the annual CTC — the system then
   creates the Offer Letter + Annexure A (compensation sheet: Basic 50 % of CTC,
   HRA 40 % of Basic, employer PF, balance as special allowance) and links it in
   the email.
3. On acceptance the candidate fills the **e-joining form**, step by step:
   personal, family, addresses, education, languages, bank & statutory,
   documents, photo, e-signature. Validation rules (client-side and re-checked
   on the server):
   - Names: letters only. Mobile: exactly 10 digits. PIN: digits.
   - PAN `AAAAA9999A`, Aadhaar 12 digits, IFSC `AAAA0XXXXXX`, account number 9–18 digits.
   - Marital status *Single* hides all marriage fields; *Married* shows spouse /
     wedding / children rows. Father is fixed Male, Mother fixed Female.
   - Languages: Hindi / English / Others (with a "specify" box).
   - Address format: Line 1 → State → District → City → PIN.
4. **HR reviews** the submission: approve (a login account is created and
   credentials are emailed — Employee ID, official email, temporary password,
   forced change at first login) or send back with notes for correction.

### 3.2 While employed

- HR can edit the profile (designation, department, managers, CTC, location,
  emails, employment type…), upload/replace per-type documents, edit bank &
  statutory details, and reset the password (temporary password shown once +
  emailed; user must change it at next login). Resetting an admin's password
  requires an IT/Super admin.
- **Active / Inactive:** HR can deactivate an employee — login blocks instantly
  and the person disappears from directories and payroll runs. Reactivation
  restores everything. Only fully onboarded employees can be toggled.

### 3.3 Resignation & exit (workflow)

- A resignation carries: resignation date, last working date (notice period
  pre-filled from the profile) and reason.
- **Before submission a disclaimer warns** that the account will be blocked from
  the entire system immediately and everything needed (payslips, offer letter,
  documents) should be downloaded first; submission requires explicit consent.
- On submission the account is **blocked system-wide**. If any approver rejects,
  or the request is withdrawn, the account re-activates automatically; HR can
  also re-enable manually at any time.
- The request travels a **6-step sequential chain**:
  Reporting Manager → Functional Manager → Business Head → Office Admin →
  Finance → HR. Steps 3–5 are resolved from an admin-maintained approver matrix;
  a step with nobody assigned (where optional) is skipped automatically; HR can
  act in place of an unfilled mandatory step.
- Everyone involved sees a **stage table**: step name, approver's ID + name, and
  live status (Pending / Approved / Rejected / Bypassed / Waiting). A rejection
  anywhere ends the request. Approvers see requests waiting on them even when
  they are not the person's manager (e.g. Finance). The raiser and the next
  approver are emailed on every action.
- HR has an admin view of all resignations by status, with CSV export.

## 4. Payroll

### 4.1 Salary structure

- Per employee: monthly CTC, grade, Basic % of CTC, HRA % of Basic, PF % of
  Basic, Professional Tax, welfare, and fixed allowances (LTA, personal, city,
  performance, misc.). A **company default template** pre-fills everything
  except CTC, so setting up a person is usually just entering the CTC.
- **Special Allowance is automatic:** whatever part of the CTC is not consumed
  by Basic + HRA + fixed allowances is paid as Special Allowance — the gross
  always equals the monthly CTC.
- While editing, a **live breakup preview** shows Basic, HRA, Special Allowance,
  gross, each deduction, and net-in-hand, and warns if components exceed CTC.

### 4.2 Monthly run

1. HR picks month/year and clicks **Generate all**. For every *active* employee
   with a structure the system creates a **draft** payslip, automatically:
   - joiners mid-month are paid from their joining date;
   - approved leavers are paid up to their last working date;
   - approved unpaid-leave days (where a leave system feeds in) are deducted
     from days paid;
   - people not payable that month are skipped, with reasons listed.
2. HR reviews — summary cards (employees, structures set, generated, published,
   total net), per-slip PDF preview, search. Per-person overrides: manual days
   paid, arrears, bonus, TDS.
3. **Publish all** — every draft becomes final and its employee is emailed
   "your payslip is ready" with the net amount. Published slips are locked;
   corrections require unpublish → regenerate → publish.
4. **Bank sheet (CSV)** — the salary-transfer file: name, bank, IFSC, full
   account number, net pay. A payroll **register CSV** is also available.
- Payslip maths: earnings prorate by days paid ÷ days in month; PF is a % of
  prorated Basic; Professional Tax and welfare are fixed monthly deductions.

## 5. Notifications & email

Every email goes through a queue with automatic retries at increasing intervals,
so a mail-server outage never blocks the action itself. Templates are branded
with the company logo. Emails are sent for: offer, e-joining sent-back,
credentials, password-reset code, sign-in code, staff password reset, payslip
published, and every approval-chain action (to the raiser) plus "awaiting your
approval" (to the next approver, with the request's key facts).

## 6. Reports & exports

CSV (Excel-ready): employees (with status filter), payroll register, bank advice
sheet, resignations by status, audit log. PDFs: offer letter + Annexure A,
payslips, employee info sheet.

## 7. Security rules (behavioural)

- Passwords stored hashed; identity numbers and bank accounts encrypted at rest.
- One-time codes stored hashed, single-use, expiring, attempt-limited; login and
  code endpoints rate-limited against brute force.
- Disabled account = dead sessions everywhere within seconds.
- Role changes, status changes, payroll actions, resignation actions, password
  resets — all audit-logged.
- The public landing page exposes no login URLs; the portal and API live behind
  separate paths.
