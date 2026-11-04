# Web app: fix plan for the TKF HRMS bug sheet

Source: `TKF HRMS Bug Sheet.xlsx`, web app only. Plan only; no code has been changed.

**Point IDs** refer to the sheet tabs:

| Prefix | Sheet | Points |
|---|---|---|
| **M** | Super Admin (Master) | 11 |
| **C** | Company (org Super Admin) | 53 |
| **H** | HR login | 141 (the two unnumbered rows after H48 are **H48a**, offers not auto-expired, and **H48b**, offer without department) |
| **E** | Employee Login | 67 |

About 272 points in total. Roughly 40 are the same defect reported from two logins (C↔E, C↔H).

**Tags**

- **[bug]**: wrong behaviour; fix it.
- **[val]**: missing input validation.
- **[ux]**: labels, confirmations, empty states.
- **[enh]**: new feature; needs scoping. It is listed in the backlog and is not part of the fix phases.
- ✅ **confirmed in code**: I traced the root cause.

---

## Phase 0: decisions needed before coding

These change how several points are fixed, so they need an answer first.

| # | Decision | Points affected | Recommendation |
|---|---|---|---|
| D1 | What does Master "Switch to" mean? Today the Master is locked to Organisations, so switching changes only a label. | M8 | Let the Master open the tenant's admin screens after switching, in read-only or full mode, with a banner saying so. Otherwise remove the action. |
| D2 | When should an account be blocked on resignation? Today it is blocked the moment the employee applies. | E48, H85, H86, H135, C50 | Keep access during the notice period, block on the last working day automatically, and allow withdrawal before approval. |
| D3 | When should the login go live? Today the account becomes ACTIVE and the password is emailed on HR approval, even if joining is weeks away. | H43, H44, H46 | Status "Joining" until the date of joining. The account is created on approval but enabled on the DOJ. Send a set-password link instead of a plain password. |
| D4 | Where should the sign-in code go? Today it goes only to the official email, which often doesn't exist yet. | H46, H47 | Send it to the verified personal email until the official mailbox is confirmed. Or skip the code for the first sign-in made with the emailed credentials. |
| D5 | Where do leave quotas come from? Today State Entitlements (global, with duplicate ODISHA/Odisha rows) override Leave Types, with no proration. | C45, E17, E8, H59, H133 | Make the organisation's Leave Types quota the single source, with an optional per-state override, and prorate from the DOJ. |
| D6 | Do salary structures still matter? Today Basic %/HRA % in "Set structure" are ignored, because payroll follows Payslip components. | C20, H70, H73, H80, H131 | Remove the fixed template from Set structure. The structure keeps only monthly CTC plus per-employee overrides, and everything else comes from Payslip components. |
| D7 | Which statuses count where? | M5, H1, H2, H55, H67 | One rule. "Employees" = ACTIVE with an employee code. Candidates are counted separately. Exited = past the LWD. |

---

## Phase 1: critical. Data leaks between organisations, login blockers, broken pages

Fix and deploy these first. Several put one company's data in front of another company.

### 1A. Data leaking across organisations

| Points | Problem | Root cause / fix | Where |
|---|---|---|---|
| C17, C44, E6 | One org's holidays appear in, and can be deleted from, another org | ✅ The `holidays` table has no `organisation_id`; all queries are unscoped. Add the column, backfill to the owning org, and scope list/add/delete plus the `/leave/holidays` and attendance-calendar reads. | `backend/src/db/schema*.sql`, `controllers/leaveAdminController.js`, `leaveController.js:39`, `attendanceController.js`, `services/attendancePayroll.js` |
| C45, E17, H58, C18 | Leave quotas come from a global State Entitlements table (ODISHA and Odisha both exist) | ✅ `leave_entitlements` is keyed by state only, with no org. Scope it per org, normalise state case, and apply D5. | `schema.sql:400`, `leaveAdminController.js`, `leaveController.js` `ensureBalances` |
| C49, E45 | Employees of a new org download TRUE HR's policy files | The table has `organisation_id`, but the ESS `/policies` list and file download don't filter by it. | `controllers/policyController.js` |
| C46, E28, E21 | NFA dropdowns show another org's masters; NFA numbers continue another org's sequence | The `/meta/nfa-masters` read is unscoped, and `nfa_code_seq` is keyed by year only. Scope masters by org and make the sequence `(organisation_id, year)`. | `controllers/nfaController.js`, `mastersController.js`, `metaController.js`, `schema.sql:822` |
| H111 | The Masters page shows "No entries" while NFAs use projects and zones | Probably the same scoping problem in reverse: the masters were stamped onto the first org by migration. Fixed with C46; plus a data fix. | `db/schema_tenancy.sql:560-572` |
| C50, E52 | A new org's resignation chain shows TRUE HR approvers | ✅ The resignation `context` reads `approver_matrix` with no org filter. | `controllers/resignationController.js:~88-93` |
| C48, E41 | Support issue types include TRUE HR's "My Vision Login" | ✅ The support catalog is a hard-coded constant. Make it per-org configurable, or at least strip TKF-specific entries from the default. | `controllers/supportController.js:6-40` |
| C3 | Ticket #10 for a new org's first ticket | The ticket number is the global row id. Add a per-org ticket number. | `supportController.js`, schema |
| C29, C5, C6, C53, H28, H29, H45 | A new org's letterhead, offer email and onboarding pages say "True HR / True Kind Foundation / Noida" | ✅ The email templates use global `COMPANY`/`ADDRESS`/`WEBSITE` constants that fall back to TKF values. A new org's document branding defaults to TRUE HR. Pass the org's branding (`document_profiles`) into every template; new orgs start from their own name. | `services/emailTemplates.js:1-8`, `services/docProfile.js`, `controllers/onboardingController.js`, `web/app/onboarding/*` |
| C39, C52 (header), E66 | An approved employee isn't in Users & accounts; the header shows "True HR" | ✅ `approveOnboarding` creates the login with no `organisation_id` or `org_role_id`, which is only patched on the next server restart. Set both on insert. Also stop the `ON CONFLICT (email)` overwrite of an existing account, and set `must_change_password=true`. | `controllers/employeeController.js:383-388` |

### 1B. Login and first-access blockers

| Points | Problem | Root cause / fix | Where |
|---|---|---|---|
| C52, E66 | The employee lands on `/app/admin`, sees "Restricted section" and an empty sidebar | ✅ After the forced password change, the page always goes to `/admin`. Use `homeFor(role)`. The admin shell should also send an EMPLOYEE to `/ess` instead of showing Restricted. | `web/app/change-password/page.jsx:21`, `web/app/admin/layout.jsx` |
| H46, H47 | A new employee never receives the sign-in code and can't log in | The code goes only to the official email. Check production mail delivery (`email_queue` status/error) and the sender (currently a personal Gmail, which is likely to be throttled or spam-filtered). Apply D4. Show an error when the send fails instead of "code emailed". | `controllers/authController.js:29-70`, `services/emailQueue.js`, `.env.production` SMTP settings |
| H36 | The "password has been reset" email body is raw JSON | ✅ `resetEmployeePassword` passes the whole `{subject, html}` object as `html`. Pass `.html`. | `controllers/userController.js:195-199` |
| C53, E67, H44, H45 | The welcome email shows `\n`, "Employee I'D", NGO "mission" text and a plain-text password | ✅ Template text. Fix the label and wording, use org branding, and send a set-password link per D3. Check whether the `\n` comes from the same object-as-html bug; at least the reset path has it. | `services/emailTemplates.js:101-120` |
| H135 | ACTIVE employee with login DISABLED | A side effect of resignation blocking (D2). Show the reason on the profile. | `resignationController.js:157` |
| H86 | Exited employees still log in after their LWD | No automatic block on the LWD. Add a daily job that disables the account and sets the status after the LWD (D2). | new worker in `backend/src/services/` |
| H43 | Login is active 19 days before the DOJ | D3 | `employeeController.js` `approveOnboarding` |

### 1C. Broken screens

| Points | Problem | Fix | Where |
|---|---|---|---|
| C16, H57, H35 (empty Sub-department/Branch) | Master data page: "Internal server error" | ✅ SQL uses alias `c`, which is never defined (`WHERE c.organisation_id` while the join is to `organisations o`). | `controllers/orgMasterController.js:123-124, 170-171` |
| H79 | Payslip components: fields lose focus after every keystroke | ✅ The `Table` component is defined inside the page's render, so it remounts on each keystroke. Move it to module level. | `web/app/admin/salary-components/page.jsx:110` |
| H25, H26, H27 | The auto offer letter shows another candidate ("Dear Rocky", `{{Software Engineer}}`, `[nsdjshgd]`), a garbage signatory and DOJ "—" | The org's saved offer template contains literal test text, and the placeholders aren't filled. Fix the placeholder substitution, validate the template on save (C29: unknown placeholders), clean the TKF template data, and pass the DOJ to the annexure. | `services/offerLetterPdf.js`, `services/letters.js`, `controllers/docProfileController.js` |
| H128, H129 | HRMIS dates export as "Sat Jul 03" with no year; Last Login is corrupted | ✅ `String(date).slice(0,10)` on a JS Date. Write real Excel dates. | `controllers/hrmisController.js:17, 105` |
| C28, H97, H98 | Letters print garbage dates; the "Missing: signatoryName" error appears but the letter is still issued | Same `String(date).slice` bug. Validate before issuing. | `controllers/letterController.js:53, 118, 128`, `incrementController.js:193` |
| H130 | HRMIS annual CTC ≠ monthly × 12 | Two CTC sources (`employees.ctc` and `salary_structures.monthly_ctc`). Derive from one source. | `hrmisController.js` |

---

## Phase 2: employee lifecycle and status (candidates and exited staff showing everywhere)

One shared helper fixes most of this group. Add `activeEmployeeFilter()` (ACTIVE plus an employee code, before the LWD) on the backend, and use it in every picker and count.

| Points | Screen showing the wrong people | Fix |
|---|---|---|
| H1, H2, M5, H55, C40 (Employee role "People 0") | Dashboard headcount, payroll card, Master org count, hierarchy counts | Apply the D7 rule everywhere |
| H67, C20 (candidate in payroll) | Payroll list | Active only |
| H81 | Statutory search | Active only; show the employee code, not the internal id |
| C26, H89, H88 | Termination picker; picker doesn't refresh after a reversal | Active only; refetch after revoke |
| C27, H90, H91 | F&F: a candidate who never joined was paid ₹1,43,500 | Exited, or with an approved exit, only |
| H96, H99, C28 | Letters: confirmation/relieving letters for candidates and active staff | Restrict per letter type (relieving/experience need an approved exit) |
| H52, H54, C14 | Org chart shows OFFER_SENT candidates and exited managers; the Operational manager line is never filled | Active only; add the Operational manager field to the employee form, or hide that line type |
| H85, H113, E56 | Exited staff in payroll, approvers, NFA lists, address book | Daily LWD job (D2) plus the active filter |
| H20, H37, C8, H24 | The same stage is called OFFER SENT / PENDING / DETAILS_PENDING / Filling details | One status-label map in `web/lib/` used by every screen |
| C11, H21, H22 | Employees filter missing "Filling details"; count ignores the filter; wrong empty state | `web/app/admin/employees/page.jsx` |
| H48a | Offers past the 3-day validity stay OFFER_SENT | `services/expiryWorker.js` only expires used ACCEPT tokens; also expire unopened ones |
| C12, H42, H33 | Approve allowed with no department, designation, manager or documents, and a duplicate personal email | Server-side checks in `approveOnboarding` |
| H87, H136, H84, E51 | Resignation before DOJ, future "raised on", LWD before the resignation date, notice ignored | Validate dates in `resignationController.apply`; record any notice shortfall |
| H109 | Exiting employee has open advances | Show them in F&F under "Advances / Loans" (links to Phase 4) |

---

## Phase 3: forms and validation (one shared validator, used by both web and API)

Most [val] points are the same few rules repeated. Build `web/lib/validate.js` and a matching `backend/src/utils/validate.js` with these rules:

- name (letters)
- Indian mobile (`[6-9]\d{9}`)
- email
- PIN (6 digits)
- PAN, GSTIN, IFSC, UAN (12 digits), ESIC (17), CIN
- date in the past / in the future, DOB 18+, DOJ ≥ DOB
- positive amount with a maximum and 2 decimals
- percentage 0–100
- case-insensitive unique name

All errors are shown together, and a modal stays open and keeps the user's input when there is an error.

| Area | Points |
|---|---|
| Organisation form (Master) | M1, M2, M3, M10 |
| Onboard / edit employee | C4, C10, H9, H10, H11, H13, H15, H17, H19, H48 (duplicate email gives no error), H48b, H12 (designation not in department), H14 (location → dropdown) |
| E-joining (candidate) | C7, H31, H32, H34 (bank from IFSC); state/district/city become dropdowns; C6, H30 (work email shown in Title Case: show as entered; block accepting an expired offer) |
| Bank and statutory IDs | C24, H132, H131 (IFSC), C38 (company GSTIN/PAN/PF/ESIC), C29, H100 (branding GSTIN/CIN/PAN/PIN/phone/web, plus the stuck accent-colour error) |
| Structure and masters | C15, H56, C33 (case duplicates, junk names), C18, H61 (holiday dates, duplicates), C19 (duplicate leave-type names, quota of 500), C40 (duplicate role names; only the built-in role may act as Super Admin) |
| Vendors and agreements | H114, H115, H117, E46, E47, C35 |
| Scheduler | C31, H106, H107 (hour 0–23, minutes, weekday names, date for one-time schedules, duplicate warning) |
| Assets | C42 (negative cost) |
| Change requests (ESS) | E59, E60, E61 (also: don't send unchanged fields, don't create an empty request) |
| Contact TrueHR | E62 |
| Error inside modal / form stays open | H74, C22, C10, E19 (raw `businessOperationId is required` → readable) |

---

## Phase 4: payroll, tax and money

| Points | Problem | Fix | Where |
|---|---|---|---|
| C20, H70, H73, H80 | Set structure ignores Payslip components; negative/150% values; free-text grade | Decision D6. Pre-fill CTC from the offer (H71). Grade from the designation. | `payrollController.js:224-260`, `web/app/admin/payroll` |
| H71, H35 (edit CTC blank) | Offer CTC isn't carried into the structure or employee record | Create the structure on approval from the offer CTC | `employeeController.approveOnboarding` |
| C21 | Days paid 45/30, negative arrears, huge TDS, negative net pay; unpublish of a "locked" slip; no confirmations | Validate manual inputs; block net < 0; confirm publish/delete; decide on unpublish (lock or audit) | `payrollController.js:485`, web payroll page |
| H68 | Payslips published before the month ends | Block publishing, or warn, before the month closes | `payrollController.publish*` |
| H69 | PT ₹200 on ₹6,000 gross | Apply the state slab on gross, by work location | `services/statutoryRates.js` |
| H72, C21 | Year dropdown is 2024–2026 only | Generate the years dynamically | web payroll page |
| H78 | Component preview net ≠ payroll net (Welfare Trust ₹20) | Use one compute path for both | `services/payComponents.js` |
| C23 | Deductions above gross are allowed | Warn or block | `payComponentController.js` |
| C22, H75, H76, H77 | Increments: no maker-checker; applied before the effective date; current CTC not shown; type "correction" UI | Require a different approver; apply only on/after the effective date; show current CTC; annual/monthly toggle | `incrementController.js`, web increments page |
| C24, H82 | UAN/PF/ESIC stored in two places; nominee share 150%; gratuity text with no fields | One source (statutory profile); shares must total 100% | `statutoryController.js`, employee bank & statutory card |
| C25, H83, E34, E35, E36 | Investment declarations: raw labels, no confirmation, approved amount blank; ESS: empty or over-limit submissions, editable after submit | Section limits, non-negative values, lock after submit, save the approved amount | `taxDeclarationController.js`, `web/app/ess/tax` |
| C47, E37 | Tax projection uses 12 months for a November joiner | Project only the remaining months of the FY | `services/incomeTax.js`, tax controller |
| C27, H92, H93, H94, H95 | F&F: validation, pre-fill LWD/leave/notice/assets, edit/delete draft, status on the PDF, final salary/gratuity | ✅ The leave-balance query reads a column that doesn't exist (`balance`), so encashment is always 0. Fix that first. | `controllers/fnfController.js:15-25`, `services/fnf.js` |
| H110 | Settlements report amount/date ≠ NFA | Show advance, settled and balance separately | `nfaReportController.js` |

---

## Phase 5: leave and attendance

| Points | Problem | Fix |
|---|---|---|
| E4, E5 | Absent shown before the DOJ; Saturdays counted as working days; holidays shown as absent | Calendar starts at the DOJ, uses the week-off policy, and uses the org's (and location's) holidays; add a holiday tile |
| E7 | Miss-punch accepts invalid, future and duplicate dates; no in/out time; can't be cancelled | Validation, in/out time, cancel |
| E8, H134, H60, C19, H123 | Maternity/menstrual leave for men; no gender rule | Gender eligibility on the leave type; enforced on apply, allocation and bulk |
| E8, H133, C45 | No proration; 13 active employees have no balances | D5 plus allocation on joining |
| E9, C1, C41, H3 | Leave/miss-punch with no manager is stuck forever; HR can't act | Route to HR when there is no RM; HR leave/attendance approval screen (C41: there is no admin attendance screen today) |
| E10 | Adjacent leaves blocked outright | Replace the "one day gap" rule with the sandwich policy |
| E11, E12, E14 | Back-dated SL, RH on a non-RH day, half-day over a range, WFH with 0 balance, blank reason | Validation rules in `leaveController.apply` |
| E13 | Balance card ignores pending requests | ✅ `remaining = allocated − used`; subtract pending too |
| E15, E16, C19 | No cancel confirmation; no certificate upload; no RH list in Leave | Confirmation; attachment field; holiday/RH list |
| E18 | Comp-off: no message on an empty apply | Validation message (earning comp-off from OD is [enh]) |
| H59, H62, H63 | Quota source unclear; "Name" → "Occasion"; no holiday edit | D5; label; edit action |

---

## Phase 6: org setup, admin screens, reports

| Points | Fix |
|---|---|
| M4, M6, M7, M9, M11 | Org detail/edit/archive and search; past-expiry warning; module list matches the sidebar (add Wishes and Scheduler, drop modules with no screen); short code in the switcher; consistent header label; ticket empty state and Closed card |
| C38 | Company prefix editable until the first ID is issued; standard departments go to the company, not the whole org (or warn) |
| C39, C40 | Users list includes employees and shows the person's name; mask the password field; duplicate role names; readable labels |
| C43 | Audit log: log every write with a readable entity name and before/after values; filters; investigate the "older entries vanished" report (likely scoping by the actor's current org; `audit_log` has no `organisation_id`) |
| C30, H103, H104 | Policies: add/rename/remove per org; allow PDF/DOC/DOCX only |
| H105 | Uploaded banners never shown on web: add the banner carousel to the ESS dashboard |
| H64 | Wishes: work anniversary on the joining day (0 years). Start from year 1 and show the count |
| C2, H3 | Dashboard: clickable pipeline and pending counts; counts for every approval queue |
| H5, H6, H7, C3 | Support: resolution note required; modal X/Esc; duplicate warning |
| H121, H122, H124, H125, H126, H127, C37 | Bulk: detect the template type; dropdowns and protected columns; CTC upper limit; accept "50,000"; active managers only; no reporting loops; phone/email validation; department–designation pairing |
| H137 | HRMIS "Worth fixing" flags active employees with no department, designation or DOJ |
| C42, H138, H139 | Assets: edit/delete; assignment date and condition; return notes; repair/retired/lost statuses; readable labels |

---

## Phase 7: NFA, vendors, PMS, and other ESS screens

| Points | Fix |
|---|---|
| C32, H108, E24 | Readable NFA labels and one date format; confirm HR overrides; record actions under the actual user |
| C34, H112, E23 | Approvers list includes every chain stage (RM, FM, Office Admin, HR, Functional Head); block self-approval; NFA can't be raised with no approver; employee can withdraw |
| E20, E22 | Amounts positive, 2 decimals, with a maximum; no duplicate headers; no past settlement date |
| E25, E26 | Purchase-request fields; bill/invoice attachments ([enh] scope) |
| C35, H116 | Vendor approve/reject queue with a reason and audit trail; fix the guidance text |
| C36, H119, H120, E29, E30, E31 | Grade ranges continuous (fixes the 104.5% gap); grades configurable per org; HR override when there is no RM; only the current month for KPIs; target/actual fields |
| E1, E2, E3 | Dashboard: card for every menu; team wording/tabs only for managers; readable "Pending with Reporting Manager" |
| E32 | Tasks: hide Assign for non-managers; validation; rename "AROUND TIME" |
| E33 | Payslips: year/month filter |
| E40, E42 | Support: required fields and messages; ticket number and date; wrap long text; character limit |
| E49, E53 | Resignation and Profile: fill employee details from the master record |
| E54, E55 | Address book: show official contact only (privacy); show "+" emails as stored |
| E56, H23 | Search trims spaces and matches department/designation |
| E57, C13, C51, E58 | Change requests: withdraw/edit pending; show current vs proposed; pre-fill gender and address; readable values; confirm approve |

---

## Phase 8: UX consistency pass (sweep every page once)

| Topic | Points |
|---|---|
| Raw codes shown to users (FULL_TIME, PAYMENT_RELEASED, in stock, submitted…) → shared label map | M6, C8, C25, C31, C32, C33, C40, C42, E3, E24, H24, H83, H108, H136, H139 |
| Confirmation before destructive or irreversible actions | C9, C13, C17, C21, C24, C25, C32, C35, E15, E64 |
| Modals: X button, Esc, mobile-responsive PDF viewer | H6, H18, E23, E30 |
| Unsaved-changes prompt | H101 |
| Empty states that make sense ("No tickets found", "No change requests found"…) | M11, H22, H51, E27 |
| Sidebar keeps its scroll position | H4 (✅ `SidebarBody` is defined inside render in `web/app/admin/layout.jsx`) |
| Branded 404 page with navigation | E65 |
| Header shows the employee's name; menu doesn't overflow | E63 |
| "Generate offer" / "Reset password" need confirmation; hide Generate offer after joining | C9, H40 |
| PDF letterhead: logo overlap, duplicate address | H102 |

---

## Backlog: enhancements to scope separately

These ask for new features rather than fixes:

- **Support:** ticket workflow (H8), replies/assign/reopen (C3, M11).
- **Onboarding:**
  - offer letter preview before sending (H16);
  - candidate status actions (H38);
  - profile "View more" with HR edit (H39, C8);
  - per-document verify/reject (H50);
  - review-queue history (H49);
  - deactivation/termination emails (H41).
- **Org and structure:** level-order check on reporting lines (H53); bulk employee import (C37).
- **Wishes:** send greetings and configure them (H65, H66).
- **Leave and attendance:** earn comp-off from OD (E18).
- **NFA, vendors and PMS:**
  - purchase-request form and bill attachments (E25, E26);
  - query/response attachments (C32);
  - agreement upload and expiry (H118);
  - PMS cycle and all-employees view (H120).
- **ESS and documents:**
  - payslip CTC view and Form 16 (E33);
  - letter requests (E38) and asset requests (E39);
  - policy acknowledgement, versions, Policies/Formats split, upload of filled forms (E43, E44);
  - profile document upload (E53).
- **Audit:** before/after diffs (C43).

---

## How I'd sequence the work

1. **Week 1: Phase 0 decisions, then Phase 1.** These are data leaks and login blockers, so deploy them as soon as they are done. Most are small, targeted fixes plus one migration (holidays, entitlements, NFA sequence, ticket numbers).
2. **Week 2: Phase 2 and the shared validator from Phase 3.** One helper and one validator file remove about 60 points.
3. **Week 3: Phases 4 and 5.** Payroll and leave correctness. Re-run `backend/scripts/test-payroll-run.js` and `test-attendance-payroll.js`, and add cases for the bugs fixed.
4. **Week 4: Phases 6–8.** A UX sweep, then hand the sheet back to QA with each row's Dev Status updated.

**Data clean-up:** do it once, after Phase 1, on production with a backup. Covers junk masters (cvf, Dmeo, BJP…), the duplicate ODISHA row, the test offer template ("Dear Rocky"), duplicate Sriram orgs, the ZZ sandbox org, and demo accounts in real tenants.
