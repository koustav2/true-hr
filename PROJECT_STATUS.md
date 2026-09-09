# TrueHR — Project Status

**Operated by:** L R Technology (proprietor: Debasish Panigrahi, GSTIN 21BYYPP0116P1ZY)
**Product:** TrueHR — HRMS with a web admin console and a native Android employee app
**Last updated:** 9 September 2026

---

## CHECKPOINT — 9 September 2026 (GreenHR parity pass: five modules closed)

Commits `92d3c83` → `e39cc26`. **Committed, not yet pushed, not yet deployed.**

The GreenHR tenant was crawled page by page — 129 pages across 21 menus — and
each one assessed against what TRUE HR actually has in code. Score before this
pass: 56 have / 38 partial / 28 missing / 4 n/a. Five of the highest-value gaps
are now closed, taking the missing count to 19.

### 1. Change requests — module `CHANGEREQ`
Closes GreenHR's *Pending Info Approvals* and *Pending Bank Changes*.
An employee cannot edit their own record: they propose a change from
`/ess/change-request` and HR decides at `/admin/change-requests`. Nothing is
written until approval, a rejection must carry a reason the employee sees, and
only one request per kind may be open at a time.
- New table `employee_change_requests` (kind, JSONB payload, status, reviewer).
- Field whitelist per kind — PROFILE / ADDRESS / BANK — so a crafted payload
  can never reach a column it shouldn't.
- Bank account numbers are re-encrypted on apply, never stored in the clear.

### 2. Organisation chart — module `ORGCHART`
`GET /admin/org-chart` returns a flat feed; the client builds the forest. The
reporting, functional and operational lines are each selectable. Anyone whose
manager is missing or out of scope surfaces as a root instead of vanishing, and
a manager cycle is broken at the second visit rather than recursing.

### 3. Increment management — module `INCREMENT`
The biggest gap: `salary_structures` is one row per employee, so editing a CTC
destroyed the previous figure and there was no record of who approved it.
- New table `salary_increments` — the ledger: old/new monthly CTC, grade,
  designation, reason, and the three timestamps.
- **Propose → approve → apply**, deliberately separate. Only APPLIED touches
  payroll, so an April increment can be prepared in February without disturbing
  February's payslip. The summary flags approved revisions already past their
  effective date.
- Apply refreshes `employees.ctc` (what the offer annexure reads) and can issue
  the INCREMENT / PROMOTION letter through the existing letters engine.
- A reduction is refused unless typed as a CORRECTION; an applied revision
  cannot be cancelled — a correction supersedes it — so the trail is never
  rewritten.

### 4. Bulk utilities — module `BULK`
GreenHR ships seven separate bulk-update screens; TRUE HR had bulk salary
alone. One engine now covers five kinds — salary, contact & employment details,
all three manager lines, department/designation transfer, leave balances —
because they are the same round trip.
- Templates download pre-filled with current values; a blank cell means *leave
  it alone*; `NONE` clears a manager line.
- **Preview only** (`dryRun`) reports every intended change and writes nothing,
  which is what makes a 400-row sheet reviewable before it lands on payroll.
- The column written comes from the registry in the controller, never from the
  sheet, so a crafted header cannot steer an UPDATE.
- Rows are matched on employee code inside the caller's org and company scope;
  managers and transfers are validated against real rows before any write.
- `/admin/bulk-salary` now redirects into the unified screen; its PAYROLL-gated
  API routes are unchanged.

### 5. HRMIS reports — module `HRMIS`
Replaces GreenHR's *Active HRMIS* / *Inactive HRMIS* pair with one seven-sheet
workbook — People, Compensation, Statutory, Leave balances, Assets, Exits,
Headcount — scoped to active or everyone.
- PAN and Aadhaar stay encrypted: the Statutory sheet reports only whether each
  is *on file*, so a bulk download can never leak them while per-employee
  access stays audited on the employee's own screen.
- The screen flags data gaps first — no salary structure, no bank details, no
  UAN, no reporting manager — before the file goes to finance. Every export is
  written to the audit log.

### Verification done this pass
- `next build` of the whole web app in a clean install: all 6 new routes compile.
- Every one of the **35 new SQL statements** planned against the real schema in
  a throwaway Postgres loaded from `schema.sql` + `schema_tenancy.sql`.
- The backend run locally against that database: migrate + seed clean, then all
  new endpoints exercised, including the bulk Excel round trip and PDF output.

Two real bugs were caught that way and fixed in `e39cc26`:
- `/admin/org-chart` filtered on `'REJECTED'`, which is **not** a member of the
  `onboarding_state` enum — the endpoint would have 500'd on its first call.
- ExcelJS returns `null` for an empty cell and `Number(null)` is `0`, so blank
  "New …" columns read as deliberate zeros. On bulk leave balances that would
  have wiped a tenant's allocations. `num()` now separates blank (skip) from
  unparseable (reported).

### Still open from the parity matrix
Increment *eligibility* report; bulk shift and profile/grade (no shift model
yet); family details & family floaters (needs a dependants table); shifts, work
schedules, geofence config and attendance-cycle setup; salary-calculator UI;
per-company SMTP; asset brand/invoice masters; department-scoped notifications.

---

## CHECKPOINT — 8 September 2026 (multi-tenancy hardening, live E2E verification, enterprise UI)

Commits `62f615e` → `737d954`. Everything below is committed and pushed; **the VPS rebuild is still outstanding** (see Deploy, bottom).

### 1. Multi-tenancy & RBAC — the 3-tier hierarchy

```
Master (is_platform_admin)  →  creates organisations + each org's first Super Admin
   Super Admin (per org)    →  creates HR / IT admins, owns the permission matrix
      HR Admin · IT Admin · custom roles (CEO, Payroll Officer, …)
      Employee              →  self-service only
```

- **Module matrix is the single source of truth.** `config/modules.js` lists every permissionable section; a Super Admin ticks View / Manage per role on **Roles & permissions** and it takes effect on the next page load — no deploy. Enforcement is three-layered: nav visibility → page gate → `requireModule()` on every endpoint.
- **Page-level gate added** (`7bf83a8`). Nav previously only *hid* links, so a typed URL still rendered the page and 403'd on load. `AdminShell` now blocks any section the live `/me/permissions` payload disallows and shows a Restricted panel with a route back.
- **Master is locked to Platform › Organisations** — every other admin route bounces back (`3913229`, broadened in `7bf83a8`). Labelled *Master*, not *Super Admin* (`78575c4`), since the platform owner sits above the per-org matrix.
- **Per-company scope** for HR/IT admins (`57ff8e9`): `user_accounts.company_id` narrows employee lists / review queue to one legal entity; NULL = whole organisation.
- **Companies** removed from HR/IT (`62f615e`) and **user creation removed from HR** (`53a4a93`) — both with migration steps that revoke the grant on existing databases, since `adoptNewModules` only ever adds. A Super Admin can still re-grant either deliberately.
- **Roles & permissions is now reachable** from Users & accounts (`737d954`) — it was referenced as plain bold text, so the screen was only findable by scrolling the nav.

### 2. Bugs found and fixed

| Bug | Fix |
|---|---|
| **Tenant data leak** — dashboard "Recent employees" had no org filter, so an empty new org showed other tenants' people | `42f386d` — scoped by `organisation_id` |
| **Offer letter permanently blocked** — CTC had two sources of truth: `salary_structures.monthly_ctc` (set from Payroll) vs `employees.ctc` (hire time only). `generateOfferLetter` read only the latter | `30a4678` — falls back to `monthly_ctc × 12` |
| **Logged out on every org switch** — token-hydration race: `PermProvider` fired `/me/permissions` before `AuthProvider` restored the token → 401 → auto-logout | `f3e05c9` — `api.js` falls back to stored auth |
| **Checkboxes rendered as grey browser defaults** app-wide (no Tailwind forms plugin) | `c21f21c` → `accent-*`, works natively |

### 3. Enterprise (SAP-Fiori-style) UI — `2acf58f`, `bbe6e21`, `6a215f3`, `78575c4`

Presentation only; **no functional or logic changes**. Supersedes the short-lived Plus Jakarta direction (`e25cd80`…`c99539f`).

- **Tokens, same names / new values** — so all 58 pages inherited the change untouched. IBM Plex Sans + Plex Mono; one accent blue (`#0a5fd1`) with `pos`/`crit`/`neg` reserved strictly for state; **`rounded-xl2` 16px→6px, `xl3` 20px→8px** (this alone compacted every card, input and button); shallow crisp shadows; flat ground.
- **Shell bar** — dark chrome across admin *and* ESS: logo, tenant context, search, org switcher, role chip, avatar menu. Compact left nav with left-accent active state.
- **Launchpads** — Dashboard and Master Organisations rebuilt as KPI tiles above dense tables (uppercase micro-headers, semantic status dots, right-aligned tabular numerics).
- **`components/ui.jsx`** restyled with an unchanged exported API (verified: zero missing imports across 57 consuming pages), plus new `Avatar`, `Badge`, `PageHeader`, `StatTile`, `ObjectHeader`.

### 4. Live end-to-end verification (against production, real logins)

- **~100 read/report checks** — 71 returned real data, 24 valid-but-empty (unused features), **0 defects**. Documents confirmed generating: employee sheet, offer letter, **Form 16**, payslip bank CSV, bulk-salary XLSX.
- **100 permission checks** (25 module endpoints × 4 roles) — matrix behaves exactly as designed: HR 403 on Companies/Roles/Audit/Organisations; IT 403 on all payroll & PII; Super Admin 403 on Organisations; Master full.
- **40 write flows** exercised in a throwaway sandbox org, then purged: structure, employee CRUD, leave, salary/payroll generation, statutory + nominees, PT/min-wage, letters (template + issue), assets (create/assign/return), NFA masters, approver matrix, vendors, roles + permission updates, users, notification schedules, F&F (preview → create → finalise → paid), termination.
- **Full onboarding chain 7/7** — public offer view → accept (token rotation) → form → details (profile/bank/statutory/address) → e-sign → HR review queue → approve, which generated employee code `ZZES5001` and the credentials email.

### 5. Operational findings (not code bugs)

- **Payroll is blocked for most staff** — for September, 19 employees in scope but only **3 have a salary structure**; 0 payslips generated. Any run skips the other 16.
- **`employee_code` is assigned at onboarding approval**, so `null` codes are people who never completed the flow — not a defect. Those staff can only sign in by email, not Employee ID.
- **Seeded `@truehr.example` passwords are committed in `seed.js`** (`Super@12345`, `Admin@12345`, `Hr@12345`, `It@12345`). Rotate or disable the demo accounts now that real tenants exist.
- **TRUE HR contains real people** — 13 of 24 employees have live `@tkf.co.in`, `@breatheagain.life` and personal Gmail addresses. Never run write tests against it: letters, onboarding, wishes and the scheduler all send real email.

### 6. Subscription — per-organisation module entitlements (`7d22296`)

A **second, outer gate above the role matrix**. The Master sells modules per tenant; a Super Admin's Roles & Permissions can only grant from within that set. Effective access is now:

```
organisation entitlement  ∩  role grant
```

- **Schema**: `organisation_modules (organisation_id, module_key, enabled)` plus `plan`, `subscription_status`, `subscription_expires_at`, `subscription_note` on `organisations`.
- **Plans**: `STARTER` (11 modules — people, onboarding, leave, policies, support, users/roles/audit) · `GROWTH` (+ payroll, statutory, investment declarations, F&F, letters, exits, assets, banners, companies) · `ENTERPRISE` (all 28) · `CUSTOM` (hand-picked). Picking a plan replaces the set; ticking modules by hand flips the plan to CUSTOM.
- **Enforcement**: `loadContext` loads the tenant's entitlement set, and `hasModule()` checks it *before* the role perms — so revoking a module closes that section for everyone in the tenant, at the API as well as the nav. **Fails OPEN on zero rows** so a pre-migration database can never lock itself out; `migrate.js` backfills every existing organisation with the full set as a known-good baseline.
- **Expiry**: an explicit `EXPIRED` status, or a past `subscription_expires_at`, collapses the tenant to **Dashboard only** — its people can still sign in and see why, instead of hitting dead pages.
- **API** (platform owner only): `GET`/`PUT /admin/organisations/:id/subscription`. New organisations seed entitlements from the chosen plan. `/me/permissions` now reports the subscription so the portal can explain a missing section as "not in your plan".
- **Master console**: a **Plan** column (plan chip + module count) opening a subscription editor — plan presets, status, expiry, internal note, and the full module list as grouped checkboxes with SENSITIVE flags.

**Not yet done for this feature:** no billing/invoicing (status and expiry are recorded, not charged), no self-serve upgrade, and the Super Admin's Roles screen does not yet grey out modules the tenant hasn't bought — it just can't grant them (the server refuses).

### 7. Open items

- **Deploy** — backend *and* web changed, so `--build` both. The subscription migration runs automatically on backend boot and backfills all tenants with every module, so nothing changes for existing orgs until the Master revokes something.
- **Purge `ZZ ESS SANDBOX` (`ZZESS`, org 7)** — leftover test tenant (1 employee, 2 logins). Use the guarded purge script pattern in this doc's history.
- **Breathe Again (`NIRA`) is SUSPENDED but is still the Master's "working here" org** — switch to TRUE HR, then decide purge vs restore.
- **Decide whether IT Admin keeps user-creation** — it currently can (accounts are its remit); only HR was restricted.
- **ESS employee-side flows untested** — leave apply, attendance punch, tasks, raise NFA, support, tax declaration, resignation. Needs an employee login, which only exists after the onboarding chain.
- **UI verified structurally only** — esbuild-validated all 79 JSX/JS files, but the sandbox's egress proxy blocks Chromium, so nothing was visually confirmed. Check the **shell bar on mobile** and **dark-mode tokens** first after deploy.
- **Android untouched by this pass** and still needs an Android Studio compile-verify (see the 4 July pending list).

## NEW — NFA / PMS build (from GreenHR reference demos, 27-06-2026)

Source: `docs/MEETING_VIDEO_ANALYSIS_2026-06-27.md` (frame-by-frame analysis) and `docs/PROJECT_PLAN_NFA_PMS.md` (phased plan). Phases 0–6 implemented; all backend flows verified by test scripts in `backend/scripts/` — **90 checks pass against a fresh PostgreSQL** (`test-approval-engine`, `test-masters`, `test-nfa`, `test-settlement`, `test-reports`, `test-resignation-chain`).

- **Approval-chain engine** (`approvalEngine.js`): one generic engine powers NFA (6-stage), settlements (6-stage), resignation (6-stage), PMS (4-level). Approver resolution via manager chain / named user / approver matrix (most-specific match); auto-bypass of unresolvable optional stages; Approve / Query-Hold / Reject with remarks; resubmit resumes at querying stage; staff override; "ROLE Rejected-<name>" labels; full trail + audit.
- **NFA masters**: business operations, group companies, zones, projects, locations, unified clients/vendors, 3-level expense hierarchy (Category→Header→SubHeader) with paste-from-Excel bulk import; single `/meta/nfa-masters` payload → all cascading client-side (no postbacks). Web: `admin/masters`.
- **NFA module**: create (server-computed totals, `NFA<year><seq>` codes, conditional invoice block for billable-from-client, auto-derived approver chain preview), my list, approver inbox, approver edit with mandatory remark, finance-only payment release, per-employee FY ledger, admin queue with filters. Web: `admin/nfa`. Android: NFA hub + Create + My NFAs + Approvals + Detail (chain, act, resubmit) + ledger card.
- **Settlements**: submit after payment release, own 6-stage chain (RM→Functional Head→Admin→Finance→Director→Closer), reject → resubmit, **auto-reject worker** for overdue unsubmitted settlements (`SETTLEMENT_GRACE_DAYS`, default 7), admin report; settlement block in the web NFA modal.
- **Reports**: admin NFA dashboard (FY counts + pending by stage), project-wise expense rollup, client billing, flat NFA export — all with CSV export.
- **PMS/KPI**: monthly KPI (KRA weightages sum 100, measurement bands, Copy Previous), RM Approve/Discuss, PMS self-assessment (weighted self rating), 4-level PLI rating chain with matrix-manager bypass, grade ladder OAT-5…SBT-1, My Performance list. Web: `admin/pms`.
- **E-Resignation**: new resignations run the 6-stage chain (RM, Functional Head, IT Infra, Office Admin, Finance, HR) with `/resignation/:id/chain` + `/act`; legacy rows keep old review endpoints.

**Also built (GreenHR parity pass, 4 July):**
- **Vendor Registration + Agreements backend** (statutory fields + doc slots, admin approve; approved vendors auto-join the clients/vendors master) — 10 checks pass (`test-vendors.js`). Endpoints: `/vendors`, `/agreements`, admin reviews.
- **Android settlements**: settlement section on NFA detail (submit / resubmit after auto-reject, chain view) + Settlement Approvals inbox.
- **Android ESS hub** (`My ESS`): GreenHR-style self-service dashboard — tile grid (Profile, Attendance, Leave, Support, PMS, NFA, Salary, Policies, HR Induction/Feedback/COC placeholders, E-Resignation) + **12-month performance strip** with grade colors.
- **Android PMS**: My Performance list, Create KPI (KRA weightages + Copy Previous), KPI detail + Submit PMS (per-KRA MTD target/achieved/self-rating), Team KPI approvals (Approve/Discuss) + PMS rating queue with rate dialog.
- Dashboard tiles added: NFA, My Performance, Team KPI & PMS; NFA menu now includes Update Settlement + Settlement Approvals.

**Gap-closure pass (4 July, later):**
- **Real .xlsx export** (exceljs) on all report endpoints (`?format=xlsx`, CSV still available) — verified valid workbook output.
- **Web `admin/nfa-reports`**: FY dashboard cards + pending-by-stage, Project-wise Expense, Client Billing, Settlement register — all with Excel/CSV export buttons (authenticated blob download via `downloadFile` in `lib/api.js`).
- **Web `admin/vendors`**: vendor registrations + agreements with Approve/Reject.
- **Android**: Vendor Registration and Upload Agreement forms + own-lists, wired into the NFA menu.
- All 7 backend test suites are rerun-safe: **100 checks pass** (`test-approval-engine` 20, `test-masters` 14, `test-nfa` 22, `test-settlement` 17, `test-reports` 9, `test-resignation-chain` 8, `test-vendors` 10).

**UI/UX polish pass (4 July, latest):**
- **Android**: searchable picker dialogs for large masters (>12 options — fixes GreenHR's endless vendor scrolling); proper Material date pickers on all date fields (NFA settlement/invoice/expected dates, agreement start/end); NFA menu now a proper 2-column tile grid (was overflowing with 7 tiles in one row); status filter chips on My NFAs; KPI self-rating is a 1–5 grade picker (5-OAT…1-SBT) instead of free text.
- **Web**: sidebar reorganized into Workspace / NFA & Finance / Performance / Administration groups (was 13 flat items); two-step confirm on destructive actions (master delete, vendor/agreement reject) via new `ConfirmClick` component in `ui.jsx`. All pages re-verified with esbuild.

**Pending for this build:**
- **All new Android code must be compile-verified in Android Studio** (sandbox cannot build Android; code follows existing app patterns — clean Rebuild; check material-icons-extended names: RequestQuote, Insights, Grade, School, Forum, Gavel, AccountBalance, CalendarMonth, Search).
- Approver-matrix admin UI; HR Induction videos / Feedback / COC / Asset / Tax content (placeholder screens); document uploads on vendor/agreement forms (columns exist, picker not wired).
- Client inputs: real expense-hierarchy Excel, entity/project/zone lists, approver matrix, settlement grace period, PLI→payroll linkage (see open questions in the plan doc).

---

## Stack

- **Backend:** Node.js (ESM) + Express + PostgreSQL (`pg`), JWT auth, encrypted PII, audit logging, PDF via pdfkit.
- **Web admin:** Next.js 14 (App Router), Tailwind, runtime API proxy.
- **Android app:** Kotlin, Jetpack Compose (Material 3), Hilt (MVVM), Retrofit/OkHttp, Room, WorkManager, Google Maps Compose, FusedLocation.
- **Deployment:** Docker Compose (db + backend + web) on a VPS, Nginx + Let's Encrypt, two domains — `truehr.co.in` (web) and `api.truehr.co.in` (API).

---

## Completed — Backend (Express + PostgreSQL)

- Auth: login by official email **or** employee code, JWT, change password.
- Onboarding: offer → accept/reject → full PIS form → e-signature → HR review queue; PIS PDF.
- Employees: CRUD; sensitive PII (bank account, PAN, Aadhaar) encrypted at rest.
- Attendance: punch in/out, daily, monthly, team, hold/release, regularized-days.
- Miss-punch: apply + manager review (blocks days already complete).
- On-Duty (OD): one-tap apply (photo + location), eligibility, review, comp-off credit.
- Leave: state-wise statutory entitlements (from the Shops & Establishment Act PDF), HR-managed state holidays, working-day counting (skips Sundays + holidays), half-day, sick-leave certificate, cancel, overlap + one-day-gap rule, pending-aware balances.
- Comp-Off: earned from approved OD (30-day expiry), avail + team review.
- Support Desk: HR/IT/Admin ticket catalog, create, attachments, HR resolve.
- Policies: fixed document catalog, HR upload/replace, employee download.
- Tours: start/append-points/end (idempotent, offline-safe), server-side distance, geo-tags with photo; GPS outlier filtering.
- Payroll: per-employee salary structures, per-company default template (inherited), compute engine (prorated by days paid), payslip records + PDF, publish/unpublish lock.
- Dashboard stats aggregate (headcount, pipeline, approvals, tickets, payroll).
- Resignation: apply, team review, withdraw, HR admin list/review.
- Tasks: assign to reports, my tasks + summary counts, status update, team list + per-employee summary.

## Completed — Web Admin (Next.js)

- App shell: collapsible sidebar (persisted) + top bar + mobile drawer, profile menu.
- Dashboard-first landing with live metric cards + onboarding pipeline + pending approvals.
- Employees (searchable/sortable/paginated DataTable), Review queue with e-signature pad.
- Leave configuration (holidays / state entitlements / leave types).
- Support Desk portal (filter + resolve).
- Policies manager (per-slot upload/replace/delete).
- Payroll (monthly run sheet, salary-structure editor, company default template, generate/publish/unpublish, PDF).
- Resignations (list + approve/reject).
- Users & roles, Audit log.
- Public **/privacy** and **/terms** pages.

## Completed — Android App (TrueHR)

- Login (with Privacy/Terms links), splash, profile, PF/ESIC/Insurance, change password.
- Dashboard tile grid.
- Attendance: mark (location + camera), daily (with total working hours), monthly, team, hold.
- Miss-punch, one-tap OD (same flow as attendance).
- Leave: apply (matches reference UI), view, team; comp-off avail + team.
- Support Desk hub + create/view tickets.
- Policies (list + open/download via FileProvider).
- **Tour Management:** hub, Live Tracking (Google map, Start/End, live km + points, foreground service, offline buffer + WorkManager sync), Tour Details (cards with route line), Tour Route (full blue route + total distance), Geo-Tag capture (overlay photo), Geo-Tag list (photo + mini-map).
- **Salary Slip:** own published slips list + ss_format detail + PDF download.
- Address Book, Team List (grouped state-wise + search).
- Resignation + Team Resignation.
- **Tasks:** Task Summary (counts + status update), Assign Task, Team Tasks.
- Cross-cutting: force-logout on 401, "No team yet" message on all team screens (visible to everyone), predictive-back enabled.

---

## Pending / external (not blockers we control)

- **Google Maps API key** — must be added to `android/local.properties`; maps render blank until then (km/route data still works).
- **Contact email** — replace the `[contact email]` placeholder in the legal docs, PDFs, and `web/lib/legalContent.js` before publishing.
- **My ESS** dashboard tile is still a placeholder screen.
- **Change Password** has no current-password verification (deliberate, per request) — a security trade-off.
- No automated test suite; Android compiles/verifies in Android Studio (clean Rebuild).
- Optional, not built: leave auto-approve, year-end carry-forward, manager/HR web view of team tours.
- Legal documents are customized templates — have a lawyer review before publishing.

---

## Deploy checklist

1. **Backend + web:** on the VPS — `git pull` then `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build` (migrations apply automatically).
2. **Android:** add `MAPS_API_KEY` to `android/local.properties`, then clean Rebuild / Generate Signed APK.
3. **Legal:** replace `[contact email]`; Play Store privacy URL = `https://truehr.co.in/privacy`.
4. Never run `docker compose down -v` (deletes the DB volume). Keep `.env.production` off Git. Never rotate `PII_ENCRYPTION_KEY`.
