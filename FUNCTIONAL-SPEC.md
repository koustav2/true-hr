# TrueHR — Functional Specification (What it is & how it works)

A product-level description of the HRMS: every module, its rules and its flows.
No code or technology details — this document can be used to rebuild the same
behaviour on any stack. The NFA / expense suite is excluded.

**The system has three faces:**

1. **Web admin console** — for HR, IT Admin and Super Admin.
2. **Web ESS portal** — employee self-service in the browser.
3. **Mobile app (Android)** — employee self-service in your pocket.

---

## 1. Users, roles & permissions

| Role | What they can do |
|---|---|
| **Employee** | Own attendance, leave, payslips, tasks, tickets, policies, resignation, profile, team (if manager) |
| **HR Admin** | Everything about people: onboarding, profiles, documents, payroll, resignations, leave config, banners, policies, support desk, user accounts & role assignment |
| **IT Admin** | User accounts, roles, audit log |
| **Super Admin** | Everything, including creating/removing other Super Admins |

Rules:

- Any admin (HR/IT/Super) can create staff accounts, change a user's role
  (Employee ↔ HR Admin ↔ IT Admin) and enable/disable accounts.
- Only a Super Admin can grant or revoke Super Admin, or touch a Super Admin's account.
- Nobody can change their own role or disable their own account.
- Every sensitive action is written to an audit log (who, what, when).

## 2. Signing in

- One login for app and web: **official email or Employee ID** + password.
- **Two-step login (employees only, switchable):** after a correct password the
  system emails a 6-digit code; the user enters it to finish signing in.
  Codes expire in 10 minutes, work once, and lock after 5 wrong tries.
  Admin roles sign in with password only.
- **Forgot password:** user enters email/Employee ID → 6-digit code is emailed →
  user sets a new password with the code. The response never reveals whether an
  account exists.
- **Session:** signing in issues a 7-day session. If HR disables the account,
  every live session stops working within seconds — not just future logins.
- **App → web handoff:** from the app, "My ESS (Web)" opens the browser already
  signed in via a 60-second one-time token.

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
   documents, photo, e-signature. Validation rules:
   - Names: letters only. Mobile: exactly 10 digits. PIN: digits.
   - PAN `AAAAA9999A`, Aadhaar 12 digits, IFSC `AAAA0XXXXXX`, account number 9–18 digits.
   - Marital status *Single* hides all marriage fields; *Married* shows spouse /
     wedding / children rows. Father is fixed Male, Mother fixed Female.
   - Languages: Hindi / English / Others (with a "specify" box).
   - Address format: Line 1 → State → District → City → PIN.
4. **HR reviews** the submission: approve (a login account is created and
   credentials are emailed) or send back with notes for correction.

### 3.2 While employed

- HR can edit the profile (designation, department, managers, CTC, location,
  emails, employment type…), upload/replace per-type documents, edit bank &
  statutory details, reset the password (temporary password shown once +
  emailed; user must change it at next login).
- Employee photo appears everywhere the name appears — dashboard, team list,
  address book — with initials as fallback.
- **Active / Inactive:** HR can deactivate an employee — login blocks instantly
  and the person disappears from the directory, team lists and payroll runs.
  Reactivation restores everything.

### 3.3 Resignation & exit

- The employee applies with resignation date, last working date (notice period
  pre-filled) and reason.
- **Before submitting, a disclaimer warns:** submitting blocks the account from
  the entire system immediately — download payslips, offer letter and documents
  first. Only after "I understand" does it submit.
- On submission the account is **blocked system-wide**. If any approver rejects,
  or the request is withdrawn, the account re-activates automatically; HR can
  also re-enable manually at any time.
- The request travels a **6-step sequential chain**:
  Reporting Manager → Functional Manager → Business Head → Office Admin →
  Finance → HR. Steps 3–5 come from an admin-maintained approver matrix;
  a step with nobody assigned (where optional) is skipped automatically; HR can
  act in place of an unfilled mandatory step.
- Both the employee and every approver see a **stage table**: step name,
  approver's ID + name, and live status (Pending / Approved / Rejected /
  Bypassed / Waiting). A rejection anywhere ends the request.
- Approvers see requests "waiting on me" even if they are not the person's
  manager (e.g. Finance). Raiser and next approver are emailed on every action.

## 4. Attendance

- **Punch IN / OUT** with GPS location; the address is captured and shown.
  After punching, the screen shows the summary (e.g. `20/07/2026 | 09:30 AM`,
  location) right below the button.
- **Views:** daily, monthly calendar, team attendance (managers).
- **Attendance hold:** a manager can hold someone's day — the employee cannot
  punch OUT until the hold is released.
- **Miss punch:** request a missed IN/OUT for a past day; manager approves.
- **On-duty:** request full/half-day out-of-office work with place and reason.
- **Back-date rule:** nothing can be requested for a date before the person's
  joining date (miss punch, leave, on-duty, comp-off).

## 5. Leave

- Leave types with yearly quotas and per-type behaviour: Earned, Casual, Sick
  (certificate allowed), Restricted Holiday, Monthly Holiday, Maternity,
  Menstrual, **Leave Without Pay** (no balance needed), Work From Home.
  Some types allow half days; some are single-date only.
- Employee applies with dates and reason → manager approves/rejects → balances
  update automatically. Comp-off can be earned against a worked-off day and used.
- HR configures allocations and balances.
- Approved **LWP feeds payroll** (unpaid days reduce that month's salary).

## 6. Payroll

### 6.1 Salary structure

- Per employee: monthly CTC, grade, Basic % of CTC, HRA % of Basic, PF % of
  Basic, Professional Tax, welfare, and fixed allowances (LTA, personal, city,
  performance, misc.). A **company default template** pre-fills everything
  except CTC.
- **Special Allowance is automatic:** whatever part of the CTC is not consumed
  by Basic + HRA + fixed allowances is paid as Special Allowance — the gross
  always equals the monthly CTC.
- While editing, a **live breakup preview** shows Basic, HRA, Special Allowance,
  gross, each deduction, and net-in-hand, and warns if components exceed CTC.

### 6.2 Monthly run

1. HR picks month/year and clicks **Generate all**. For every *active* employee
   with a structure the system creates a **draft** payslip, automatically:
   - joiners mid-month are paid from their joining date;
   - approved leavers are paid up to their last working date;
   - approved Leave-Without-Pay days are deducted from days paid;
   - people not payable that month are skipped, with reasons listed.
2. HR reviews (summary cards: employees, structures set, generated, published,
   total net; per-slip PDF preview; search). Per-person overrides: manual days
   paid, arrears, bonus, TDS.
3. **Publish all** — every draft becomes visible to its employee, who is emailed
   "your payslip is ready" with the net amount. Published slips are locked;
   corrections require unpublish → regenerate → publish.
4. **Bank sheet (CSV)** — the transfer file: name, bank, IFSC, full account
   number, net pay. A payroll **register CSV** is also available.
- Employees see and download their published payslips (PDF) in app and web.

## 7. Support desk, policies, tasks, banners

- **Support desk:** employees raise HR / IT / Admin tickets with a subject and
  description; staff reply and close; the employee sees the thread.
- **Policies:** HR uploads company policies/formats; everyone can view/download.
- **Tasks:** create tasks for yourself or your team, track status, see a team
  summary (managers).
- **App banners:** HR uploads images (single or bulk) that rotate automatically
  in the app dashboard carousel; each has a delete action.

## 8. Team & directory

- **Team list** (always visible): a manager sees direct/functional reports with
  photo, ID, designation, contact and manager names; non-managers see a friendly
  empty state.
- **Address book:** company-wide directory with photo, designation, department,
  contact, city/state and search.

## 9. Notifications & email

Every email goes through a queue with automatic retries (increasing gaps), so a
mail-server outage never blocks the action itself. Templates are branded with
the company logo. Emails are sent for: offer, e-joining sent-back, credentials,
password reset code, sign-in code, staff password reset, payslip published, and
every approval-chain action (to the raiser) plus "awaiting your approval"
(to the next approver, with the request's key facts).

## 10. Reports & exports

CSV (Excel-ready) exports: employees (with status filter), payroll register,
bank advice sheet, resignations by status, audit log. PDFs: offer letter +
Annexure A, payslips, employee info sheet.

## 11. Security rules (behavioural)

- Passwords stored hashed; identity numbers and bank accounts encrypted at rest.
- OTPs stored hashed, single-use, expiring, attempt-limited; login and OTP
  endpoints rate-limited against brute force.
- Disabled account = dead sessions everywhere within seconds.
- Role changes, status changes, payroll actions, resignation actions, password
  resets — all audit-logged.
- The public landing page exposes no login URLs; portal and API live behind
  separate paths.
