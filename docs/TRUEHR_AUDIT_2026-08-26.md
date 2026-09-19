# TrueHR — End-to-End Static Audit

**Date:** 26 August 2026
**Scope:** `backend/`, `web/`, `android/`, `deploy/`, root docs, `docs/`
**Excluded:** `true-kind-site/` (per request)
**Method:** Static code review only — no database was available, so the backend test suites (`backend/scripts/test-*.js`) were read but not executed, and Android/web were not built or run. Four reviewers each covered one area in parallel; this report merges and prioritizes their findings.

---

## Top issues to act on first

1. **Cross-tenant IDOR across most by-ID HR endpoints (backend, HIGH).** Employee records, payslips, offer letters, uploaded documents, and resignation actions are fetched/mutated by numeric ID with no check that the record belongs to the caller's organisation. List endpoints correctly scope by `req.orgId`; almost every single-record endpoint does not. An HR admin in one org can read or edit another org's employee PII, payslips, and documents by guessing/incrementing an ID.
   - `backend/src/controllers/employeeController.js` — `getEmployee`, `generateSheet`, `downloadDocument`, `downloadOfferLetter`, `approveOnboarding`, `sendBack`, `setEmployeeActive`, `updateEmployee`, `generateOfferLetter`, `uploadEmployeeDocument`, `updateBankStatutory`
   - `backend/src/controllers/payrollController.js` — `getStructure`, `setStructure`, `publish`, `unpublish`, `remove`, `adminDetail`, `adminPdf`
   - `backend/src/controllers/resignationController.js` — `chain`, `actOn`

2. **NFA / Settlements / Vendors / NFA-Reports have no tenant isolation at all (backend, HIGH).** The underlying tables (`nfas`, `nfa_settlements`, `vendor_registrations`, NFA master tables) have no `organisation_id` column, and the matching routes skip the `requireOrg` guard. Any admin with access to these modules in any org can see every org's NFA/expense/vendor records. Master data (projects, clients) is also globally unique-named, so two orgs can't reuse the same project name.

3. **`CORS_ORIGINS` is unset in the actual documented production deploy path (deploy, HIGH).** It's missing from `docker-compose.prod.yml`, `.env.production.example`, and `DEPLOYMENT.md`'s setup steps, even though `CODEBASE.md` lists it as required. When unset, `backend/src/server.js` falls back to wide-open CORS (`cors({})`). Following the documented deploy steps exactly ships an API with no CORS restriction.

4. **`employeePhoto` has no org/company scoping for admin accounts with no linked employee (backend, HIGH).** `authController.js:202-215` — the access check only handles "employee viewing their own photo" and "employee viewing a same-company colleague's photo." A pure staff/admin account (no `employeeId`) with any admin role skips both checks and can fetch any employee's photo by ID, across organisations.

5. **The tenant-isolation test suite doesn't test the endpoints that are actually broken (backend, MEDIUM-HIGH, compounds #1–#2).** `test-tenancy.js` covers list endpoints and role-change guards, all of which are correctly scoped — but never calls `getEmployee`, `payroll.adminDetail/publish`, or any NFA/settlement/vendor controller. "100 checks pass" gives false confidence about tenant isolation specifically.

6. **Core docs are ~3 weeks out of date relative to what's shipped (docs, MEDIUM-HIGH).** `CODEBASE.md`, `FUNCTIONAL-SPEC.md`, `HRMS_System_Plan.md`, and `PROJECT_STATUS.md` (all dated late July) describe a fixed 4-role, single-org, single-company model. `DEPLOY-SUPERADMIN-UPDATE.md` and `LOCAL-TESTING.md` (dated Aug 6) describe an already-shipping multi-org/multi-company/custom-roles/module-permissions/terminations release (`org_roles`, `org_role_modules`, `terminations`, `is_platform_admin`, new sidebar sections) that the other four docs never mention. This is also *why* the tenancy system in finding #1/#2 isn't documented anywhere — the docs a reviewer would naturally start from predate it entirely.

7. **Multi-company payroll filter is dead code on web (web, HIGH-ish UX/functional bug).** `web/app/admin/payroll/page.jsx` declares `companies` state but never calls `setCompanies` — the company selector, per-company scoping, and "Run payroll for `<company>`" labels are permanently unreachable. Payroll can't be filtered/run per legal entity from the web admin even though the backend and UI code were clearly built to support it.

8. **Android's "My ESS" behavior doesn't match either doc description (android, MEDIUM).** A fully-built native tile-grid ESS hub (`EssScreen.kt`, matches PROJECT_STATUS.md's description) exists in source but is never wired into navigation. What's actually live (`EssWebScreen.kt`, gated by `FeatureFlags.NFA_SUITE = false`) hands off to the system browser via SSO to the web portal. PROJECT_STATUS.md's line "My ESS dashboard tile is still a placeholder" is also stale — it's neither a placeholder nor the native hub described elsewhere in the same doc.

9. **`[contact email]` placeholder still unresolved (legal, MEDIUM, already known).** Confirmed still present in `legal/PRIVACY_POLICY.md`, `legal/TERMS_AND_CONDITIONS.md`, both legal PDFs, and `web/lib/legalContent.js` (lines 51, 99) — independently re-verified as of today, matches what PROJECT_STATUS.md already flags as a pre-publish blocker.

---

## Backend (`backend/`)

**Reviewed:** `server.js`, `config/index.js`, `routes/index.js`, `middleware/auth.js`, `db/pool.js`, `db/migrate.js`, `db/schema.sql` + `schema_tenancy.sql`, `utils/crypto.js` / `jwt.js` / `audit.js`, controllers/services for auth, employee, onboarding, resignation, payroll, approval engine, masters, NFA, settlements, vendors, users.

### High
- **Cross-tenant IDOR on by-ID HR/payroll endpoints** — see top issue #1.
- **NFA/Settlements/Vendors/Masters have no tenant isolation at all** — see top issue #2. `nfaController.js:adminList` (~line 354) builds its `WHERE` clause with no org filter or join to `employees.organisation_id`.
- **`employeePhoto` bypasses org/company scoping for admin accounts with no linked employee** — see top issue #4. `authController.js:202-215`.

### Medium
- **Audit trail broken for the entire NFA/PMS/Settlement/Vendor/Masters surface.** `signToken()` (`utils/jwt.js:4`) issues JWTs with `{id, role, employeeId}` — no `sub` claim, and `authenticate` never sets `req.user.sub`. But `mastersController.js`, `approvalController.js`, `nfaController.js`, `pmsController.js`, `settlementController.js`, `vendorController.js` all pass `req.user.sub` as the actor to `audit()`. Every resulting `audit_log` row gets `actor_user_id = NULL` — "who did what" is unrecoverable for this entire surface, contradicting the "full trail + audit" claim in PROJECT_STATUS.md. Functional approval logic is unaffected (it correctly uses `req.user.employeeId`), and `test-nfa.js` doesn't check `actor_user_id`, so this ships silently.
- **No transaction/row-locking in the approval engine's `act()`/`advance()`.** `services/approvalEngine.js:203-236` and `:178` read stage status then issue separate unbatched queries, none wrapped in `tx()`. Two near-simultaneous action calls (double-click, retry) can both pass the `PENDING` check before either writes, double-advancing a chain or duplicating an approval action. Not covered by `test-approval-engine.js` (sequential only).
- **`PII_ENCRYPTION_KEY` production check only rejects an all-zero key, not a malformed one.** `config/index.js:14` — a wrong-length/non-hex key passes the boot check, then `utils/crypto.js:4`'s `Buffer.from(..., 'hex')` produces a Buffer that isn't 32 bytes, and the first `createCipheriv` call throws at runtime (first employee-create with bank details) instead of failing cleanly at boot.
- **Two HR notification emails go to a non-routable placeholder address.** `onboardingController.js:108` (offer declined) and `:238` (submitted for HR review) both hardcode `to: 'hr@truehr.example'` instead of a real address/env var. In-app notifications for these events still work; the emails silently bounce/vanish.

### Low / info
- Route-guard inconsistency (`requireOrg` present on Employees/Payroll/Users, absent on NFA/Settlements/Vendors/PMS) is the routing-level symptom of the tenancy findings above — a good, minimal fix point once the schema gap is addressed.
- Multi-tenancy/custom-role subsystem (`organisationController.js`, `roleController.js`, `companyController.js`, `terminationController.js`, `schema_tenancy.sql`, ~15 routes) is entirely undocumented in `CODEBASE.md`/`PROJECT_STATUS.md` — consistent with finding #6 above.
- `helmet({crossOriginResourcePolicy: false})` (`server.js:18`) — minor defense-in-depth loss on the many endpoints that stream PII documents/photos.
- CORS default (allow-all when `CORS_ORIGINS` unset) is intentional per the code comment for a Bearer-token API — confirmed as-designed at the code level; the problem is that it's unset in the real deploy path (see top issue #3).

### What's solid
- No SQL injection risk anywhere — all dynamic table/column names come from fixed server-side whitelists, all values are parameterized.
- No TODO/FIXME/stub code found anywhere in `src/` — the backend is functionally complete, not placeholder-riddled.
- Auth/OTP/session/role logic, the payroll engine (proration, Special-Allowance balancing, PF-on-prorated-basic, publish/lock), and the resignation 6-stage flow with account-block/re-enable all match their doc descriptions exactly.

### Test coverage gaps (observed statically, suites not run)
21 test scripts exist. No dedicated onboarding/employee-lifecycle suite (only incidentally touched via `test-tenancy.js`). `test-tenancy.js` covers list/write-guard isolation but not by-ID read isolation — directly relevant to the top-priority IDOR finding. No suite checks `audit_log.actor_user_id` correctness, and none targets concurrent/racing approval actions.

---

## Web (`web/`)

**Reviewed:** `web/app/**`, `web/lib/api.js`, `auth.jsx`, `perms.jsx`, `csv.js`, `next.config.mjs`, `Dockerfile`, both nginx vhosts. No dev server/build run.

### High
- **Multi-company payroll run is dead code** — see top issue #7. `web/app/admin/payroll/page.jsx:82`.

### Medium
- **JWT stored in `localStorage`, with no Content-Security-Policy anywhere** (checked `next.config.mjs` headers and both nginx vhosts — no CSP in either). XSS would be able to read and exfiltrate the token; other security headers (X-Frame-Options, HSTS, etc.) are present, CSP specifically is not.
- **List-fetch failures render as empty state, not an error, in most of the app.** The pattern `.catch(() => setRows([]))` appears 49 times across 27 pages — a 401/403/500/network failure looks identical to "nothing here." `admin/nfa/page.jsx` is a rare counterexample with real error surfacing, showing the gap isn't universal.
- **Destructive/write actions are button-gated by `canManage()` in only 5 of ~20 admin pages** (companies, employee detail, roles, terminations, users). Everywhere else (NFA payment release, masters, PMS, vendors, payroll generate/publish/delete, support resolve, policies, banners, etc.) shows the action to any viewer regardless of manage permission — presumably backed by a real server-side check, but the UI doesn't disable/hide consistently, so a read-only viewer sees fully interactive controls that will 403 on click.
- **CSV export is vulnerable to formula/CSV injection.** `lib/csv.js`'s `esc()` escapes quotes/commas/newlines but never neutralizes a leading `=`, `+`, `-`, `@`. Free-text fields (vendor/client names, resignation/termination reasons) that start with one of those characters execute as a formula when the exported CSV is opened in Excel/Sheets. Affects the employees and payroll-register CSV exports.

### Low / info
- `lib/flags.js` comment says the NFA suite is "hidden for this release" while the actual value is `nfaSuite: true` (it's live) — stale comment, correct code.
- Undocumented app→web SSO handoff (`app/sso/page.jsx`, `POST /auth/web-sso`) — not mentioned in either core doc; token travels in the URL query string but is single-use/~60s TTL, so risk is low.
- An orphaned pre-Next.js Vite scaffold (`web/src/`, `index.html`, `vite.config.js`) is still in the repo, called out as unused in `.dockerignore` but could confuse a future contributor. Recommend deleting.
- A few unguarded `name[0]` initial-letter accesses would throw on an empty string — likely prevented server-side but no client guard.
- "Temporary password" field is `type="text"` (cleartext on screen) in the user-creation flow — probably intentional so HR can relay it, worth a conscious confirmation.

### What's solid
- File uploads are consistently base64-in-JSON, never raw multipart — no `FormData` usage anywhere, avoids binary-corruption edge cases in the API proxy route.
- Employee-detail and Users pages have genuinely careful permission-aware UI (rank-based edit, self-edit blocked, confirm modal on role change).
- `ConfirmClick` two-step-confirm component is real and used consistently on destructive actions.
- `next.config.mjs` basePath handling and both nginx vhosts are coherent and correctly explain what first looked like a doc contradiction between "single domain" and "two domains" — those describe web vs. Android respectively, both correct.
- No hardcoded secrets or debug `console.log` leftovers found.

---

## Android (`android/`)

**Reviewed:** 168 Kotlin files across auth/session, attendance+camera+GPS, tour tracking, leave/comp-off, resignation, ESS/NFA/PMS, push, DI/network, manifest, gradle config. Source-level only — not built/compiled (no SDK/emulator available; the docs already call for an Android Studio Rebuild pass).

### Medium
- **Session JWT stored in plaintext DataStore, eligible for Android Auto Backup.** `TokenStore.kt` uses an unencrypted `preferencesDataStore`, not `EncryptedSharedPreferences`/Tink-backed DataStore. `AndroidManifest.xml` has `allowBackup="true"` with no `dataExtractionRules`; a `backup_rules.xml` exists but is never referenced from the manifest, so it has no effect — the token file is included in the default full-backup behavior.
- **`usesCleartextTraffic="true"` is set globally, not scoped to the `staging` flavor.** It's only needed for the dev backend; the prod build (which already uses a hardcoded `https://` base URL) inherits the permission anyway since the manifest attribute isn't flavor-conditional. Low practical exposure today, but unnecessary attack surface in the shipped release build.
- **"My ESS" doesn't match either doc's description** — see top issue #8.
- **`TourTrackingService` loses the active tour ID on a process restart.** `START_STICKY` + a killed process redelivers a null Intent → `tourLocalId` becomes -1, but the foreground service (GPS + notification, draining battery) keeps running while every fix is silently dropped instead of being re-derived from the Room `activeTourFlow()`.

### Low
- `fallbackToDestructiveMigration()` on the offline tour/geotag Room DB — harmless today at schema version 1, but any future schema bump will silently wipe a field rep's unsynced offline location/geotag buffer with no migration path, and `exportSchema=false` means there's no history to build a real migration from later.
- Minor sequence race in `TourTrackingService.recordPoint` — back-to-back GPS fixes aren't guaranteed to serialize before the max-seq read, low practical risk given fix intervals vs. write latency.
- Attendance punch can proceed with `lat=null, lng=null` if the location fetch fails — may be intentional fallback UX, worth a conscious product decision rather than an implicit one.
- `PROJECT_STATUS.md`'s "Pending: Maps API key not yet added" is stale on this machine — `android/local.properties` already has a real-looking key locally (not committed, not a leak, just a stale doc note).

### What's solid
- No hardcoded secrets/URLs anywhere; base URLs come cleanly from Gradle product flavors.
- OkHttp logging interceptor is correctly gated to debug builds only (bodies, including the JWT header, are never logged in release).
- Force-logout-on-401 is correctly scoped to authenticated-request failures only, not login attempts.
- Change Password's lack of current-password verification is confirmed still true and, per the docs, a deliberate trade-off — not flagged as a bug.
- No TODO/FIXME anywhere in the app module; ViewModels consistently handle loading/error/finally state; permission request sequencing (fine → background location) and FileProvider path scoping are both done correctly.
- The nine material-icons-extended names PROJECT_STATUS.md flagged as needing verification are all correctly imported and correspond to real icons in the declared dependency — still needs the Android Studio compile pass the docs already call for, but nothing wrong found at the source level.

---

## Deploy / config / docs

**Reviewed:** `docker-compose.yml`, `docker-compose.prod.yml`, `deploy/` (landing + nginx), `.env*.example` + root `.env` (keys only, no values printed), `legal/`, all root `.md` docs, everything under `docs/`. `true-kind-site/` explicitly skipped.

### High
- **`CORS_ORIGINS` missing from the documented production deploy path** — see top issue #3.

### Medium-High
- **Four core docs are ~3 weeks stale relative to the shipped multi-org/multi-company release** — see top issue #6.

### Medium
- **`docs/TESTING.md` gives the wrong local Postgres credential** (`truehr/truehr`, which is actually the *production* credential) where the dev compose file, `backend/.env.example`, and `LOCAL-TESTING.md` all agree on `postgres/postgres`. Following `docs/TESTING.md` as written against the actual dev compose would fail to connect.
- **`[contact email]` placeholder still unresolved** — see top issue #9 (independently re-verified in 6 locations: both legal `.md` files, both legal PDFs, and `web/lib/legalContent.js` twice).
- **`README.md` is the most stale root doc** — states the role model is only `HR_ADMIN`/`EMPLOYEE` (missing even `IT_ADMIN`/`SUPER_ADMIN`, which older docs already had), claims the Android app is "not included in this v1 build" despite a fully built-out `android/` directory, and describes `docker-compose.yml` as "local PostgreSQL" when it launches db+backend+web together. Reads like an early v1 snapshot never updated as the product grew.
- **`DEPLOYMENT.md` is internally stale**: its top summary table still describes the whole app living at the root domain, contradicted by its own later "Landing page + /app split (added 2026-07)" section and by the actual nginx configs. The addendum is correct; the header table was never updated to match.
- Dev `docker-compose.yml` binds `db`/`backend`/`web` ports without a host-IP prefix (binds all interfaces) with default `postgres/postgres` credentials — fine on a laptop, but doesn't follow the same `127.0.0.1`-only pattern the prod compose file correctly uses; worth the same treatment if this file is ever run on a shared/networked box.

### Low / info
- Neither nginx vhost sets security headers (HSTS, X-Content-Type-Options, etc.) — by design, since `certbot --nginx` adds the TLS/redirect block at install time and `helmet` covers the backend, but static landing/`/app` HTML responses get no nginx-level hardening headers either way.
- A comment in `truehr.co.in.conf` references `~/truehr/deploy/landing` while every doc and script elsewhere consistently uses `/opt/truehr` — comment-only inconsistency, not used by any actual script.
- `PROJECT_STATUS.md:110`'s "No automated test suite" line directly contradicts its own lines describing 7 backend suites with 90–100 passing checks a few paragraphs earlier — charitably read as "no *Android* automated tests," but as literally written it's self-contradictory.
- `backend/.env` (separate dev-only file) has a known, already-documented doubled key: `DATABASE_URL=DATABASE_URL=...` — harmless under Docker (excluded via `.dockerignore`), breaks direct `npm start` on host. Confirmed still present, not a new issue.
- Minor repo hygiene, outside the requested scope but adjacent: a personal `.jpeg` file is tracked at repo root (and duplicated under an Android drawable folder), and `android/.idea/*` IDE metadata is tracked.

### What's solid
- No secrets committed to git — verified via `git ls-files` and `git status --ignored`; `.gitignore` correctly covers `.env`/`.env.production`.
- Prod compose network posture is good: DB fully internal (no exposed port), backend/web bound to loopback only, restart policies set, required secrets enforced via `${VAR:?}` so the stack refuses to start without them.
- The Postgres data volume is a durable named volume in both compose files, not ephemeral.
- nginx routing (`/`, `/app`, `/api`) matches `CODEBASE.md`'s description and the legacy-path redirect block covers every current route correctly.

---

## Suggested order of work

1. Fix the tenant-scoping gap (findings 1, 2, 4, 5) — this is the one cluster with real data-exposure consequences if the system is run multi-tenant in production today.
2. Set `CORS_ORIGINS` in the production compose/env and add it to the documented setup steps (finding 3).
3. Reconcile the docs — fold the Aug-6 super-admin/multi-org release into `CODEBASE.md`/`FUNCTIONAL-SPEC.md`/`PROJECT_STATUS.md`, or clearly mark the older four as superseded (finding 6), and fix the `docs/TESTING.md` credential.
4. Wire up the payroll company selector on web (finding 7), decide/document the Android "My ESS" behavior (finding 8), and clear the `[contact email]` placeholder before publishing (finding 9).
5. Everything else in the Medium/Low sections is worth a pass but isn't blocking.
