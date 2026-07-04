# TrueHR — Project Status

**Operated by:** L R Technology (proprietor: Debasish Panigrahi, GSTIN 21BYYPP0116P1ZY)
**Product:** TrueHR — HRMS with a web admin console and a native Android employee app
**Last updated:** 4 July 2026

---

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
