# TrueHR — Codebase Guide (Backend + Android App)

> Core HRMS documentation. The NFA / expense-approval suite (NFA, settlements,
> NFA reports, vendors, PMS rating chain) is intentionally **out of scope** here —
> those modules live in the same repo but are documented separately.

**Live:** https://truehr.co.in (landing) · web portal under `/app` · API under `/api`
**Stack:** Node.js (Express, ESM) + PostgreSQL · Next.js 14 web portal · Android (Kotlin, Jetpack Compose) · Docker Compose + host nginx (VPS)

---

## Repository layout

```
True-HR/
├── backend/          Express API + PostgreSQL schema, workers, PDF/email services
├── web/              Next.js 14 admin + ESS portal (basePath /app in production)
├── android/          Native Android ESS app (Kotlin, Compose, Hilt)
├── deploy/
│   ├── landing/      Static marketing page served at truehr.co.in root
│   └── nginx/        Host nginx vhost (TLS, routing: / /app /api)
└── docker-compose.prod.yml   Production stack: db + backend + web
```

---

## Backend (`backend/`)

### Entry & runtime

| File | Purpose |
|---|---|
| `src/server.js` | Express app: helmet security headers, CORS allowlist (`CORS_ORIGINS`), rate limits (login/OTP endpoints 20/15 min, global 1500/5 min), JSON body up to 20 MB, health probes `/health` + `/health/ready`, starts background workers |
| `src/config/index.js` | Env-driven config; **refuses to boot in production with default secrets** (JWT_SECRET, PII_ENCRYPTION_KEY, DATABASE_URL) |
| `src/routes/index.js` | Single route table — every endpoint with its auth guard |
| `src/db/pool.js` | pg Pool + `query()` + `tx()` transaction helper |
| `src/db/schema.sql` | Full schema, idempotent (`CREATE TABLE IF NOT EXISTS` / `ALTER … IF NOT EXISTS`) |
| `src/db/migrate.js` | Applies schema.sql + enum additions + in-place data fixes; safe to re-run on every deploy |
| `src/db/seed.js` | Base seed (company, HR account, leave types) |
| `scripts/seed-demo.js` | Demo data for end-to-end walkthroughs |

### Auth & accounts

- **Login** `POST /auth/login` — email **or** Employee ID + password.
- **Two-step login (employees only)** — when `LOGIN_OTP=true`, a 6-digit code is
  emailed after the password; `POST /auth/login/verify-otp` completes sign-in.
  HR/IT/Super admins skip the OTP. Codes: SHA-256 hashed at rest, 10-min expiry,
  single use, locked after 5 wrong attempts.
- **Forgot password** `POST /auth/forgot-password` → emailed OTP → `POST /auth/reset-password`
  (no account enumeration; same OTP hardening; `purpose` column separates login vs reset codes).
- **Sessions** — JWT (7 days). `middleware/auth.js#authenticate` also re-checks the
  account status per request (30 s in-memory cache), so disabling an account kills
  live sessions immediately.
- **Roles** — `EMPLOYEE`, `HR_ADMIN`, `IT_ADMIN`, `SUPER_ADMIN`. Guards:
  `requireStaff` (HR+Super), `requireAdmin` (IT+Super), `requireAnyAdmin` (all three), `requireSuperAdmin`.
- **User management** (`userController`) — HR/IT/Super can create staff accounts,
  change roles (`POST /admin/users/:id/role`) and enable/disable accounts; only a
  Super Admin may grant/revoke Super Admin. All changes audit-logged.
- **App→Web SSO** — the app requests a 60-second handoff token
  (`POST /auth/web-sso-token`) and opens `<web>/sso?t=…`; the web exchanges it for a session.

### Employee lifecycle (onboarding → active → exit)

1. **HR creates the employee** (`employeeController.createEmployee`) — offer email
   with a magic accept link (expiry `OFFER_EXPIRY_DAYS`). Optional signed offer-letter
   PDF upload, or **auto-generated Offer Letter + Annexure A** (`autoOfferLetter` + CTC;
   `services/offerLetterPdf.js`, compensation: Basic 50 %, HRA 40 % of basic, PF, special allowance).
2. **Candidate e-joining** (`onboardingController`) — multi-step form: personal,
   family (marital-status logic), addresses (Line 1 → State → District → City → PIN),
   education, languages (Hindi/English/Others + free text), bank & statutory
   (server-validated PAN/Aadhaar/IFSC/account formats), documents, photo, e-signature.
3. **HR review** — approve (creates the `user_accounts` login, emails credentials)
   or send back with notes.
4. **Active** — full profile editable by HR (whitelisted columns), per-type document
   upload/replace, bank/statutory edit (PII re-encrypted), staff password reset
   (temp `Thr@######`, forced change), photo served at `/me/photo` and
   `/employees/:id/photo` (same-company guard).
5. **Active ⇄ Inactive** — `POST /admin/employees/:id/active`; inactive = login
   blocked + excluded from directory, team lists and payroll runs.
6. **Resignation** — see below.

PII (Aadhaar, PAN, bank account) is AES-encrypted at rest via `utils/crypto.js`
(`PII_ENCRYPTION_KEY`); never rotate the key on a live database.

### Attendance & leave

- **Punch** `POST /attendance/punch` — geo-tagged IN/OUT with reverse-geocoded
  address; `GET /attendance/today` returns both punches; daily/monthly views.
- **Attendance hold** — a manager hold blocks the employee's punch-out until released.
- **Miss punch / On-duty / Comp-off / Leave** — request + approval flows
  (manager review). Leave types seeded (EL, CL, SL, RH, MH, ML, MSL, LWP, WFH)
  with per-type behaviour flags (half-day, single-date, certificate).
- **Back-date guard** (`utils/joining.js`) — no leave / miss-punch / OD / comp-off
  before the joining date (`isoDate()` normalises pg `Date` objects — reuse it for
  any date compare).
- **Leave admin** — balances, allocations, config.

### Payroll (`payrollController`)

- Per-employee **salary structure** (grade, monthly CTC, Basic %, HRA % of basic,
  PF %, PT, welfare, fixed allowances) with a **company default template**.
- `computePayslip()` — the pay engine. Unallocated CTC flows into a balancing
  **Special Allowance**, so gross always equals CTC. Earnings prorate by
  `daysPaid/daysInMonth`; PF on prorated basic; PT/welfare fixed.
- **One-click monthly run** `POST /admin/payslips/generate-all` — drafts for every
  active employee with a structure; auto-proration from joining date / approved
  last-working date, minus approved LWP days (`runInputs()`); skips + reasons returned.
- **Publish** — single or `publish-all` (emails every employee); published slips
  are locked (unpublish → regenerate → publish to correct).
- **Bank advice CSV** `GET /admin/payslips/export` — decrypted account numbers,
  IFSC, net pay for the salary transfer file.
- Payslip PDFs rendered by `services/paySlipPdf.js` (pdfkit); employees fetch
  their own published slips (`/payslips…`), staff any (`/admin/payslips/:id/pdf`).

### Resignation (`resignationController`)

- 6-stage sequential chain: **Reporting Manager → Functional Manager → Business
  Head → Office Admin → Finance → HR** (stages 3-5 resolved from the approver
  matrix; unassigned optional stages auto-bypass; HR can override an unresolved
  mandatory stage).
- `GET /resignation/context` returns the GreenHR-style stage table (role, approver
  code/name, live per-stage status) — preview before applying, live after.
- `GET /resignation/team` shows a pending request to managers **and** to whichever
  matrix approver holds the current stage.
- **Account block policy** — submitting a resignation disables the account
  system-wide immediately (client requirement); a disclaimer is shown first.
  Rejection or withdrawal re-enables it automatically; HR can re-enable manually.

### Other modules

- **Support desk** (`supportController`) — HR/IT/Admin tickets with replies.
- **Policies** (`policyController`) — HR uploads (base64-in-Postgres), employees download.
- **App banners** (`bannerController`) — dashboard carousel images (bulk upload, delete).
- **Tasks** (`taskController`) — my/assign/team tasks.
- **Live tour / geo-tag** (`tourController`) — field-visit tracking used by the app.
- **Dashboard** (`dashboardController`) — admin headcount/status cards.
- **Audit log** — `utils/audit.js`; every sensitive action writes `audit_log`.

### Email

- `services/emailQueue.js` — DB-backed queue (`email_queue`); worker every 5 s,
  5 attempts with **exponential backoff** (1/4/9/16 min). Never blocks a request.
- `services/mailer.js` — SendGrid or SMTP (`SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`);
  logs to console in dev.
- `services/emailTemplates.js` — offer, credentials, sent-back, OTP (modern
  standalone template with logo), payslip-published, approval action/pending
  (with subject-details table).

### Environment variables (production)

```
NODE_ENV=production  PORT=4000
DATABASE_URL=…       JWT_SECRET=…          PII_ENCRYPTION_KEY=<64 hex>
APP_BASE_URL=https://truehr.co.in/app
CORS_ORIGINS=https://truehr.co.in,https://www.truehr.co.in
MAIL_FROM=…  SMTP_HOST=…  SMTP_PORT=587  SMTP_USER=…  SMTP_PASS=…  (or SENDGRID_API_KEY)
LOGIN_OTP=true|false        # two-step employee login (needs working SMTP)
OFFER_EXPIRY_DAYS=3  COMPANY_NAME=…  SUPPORT_PHONE=…  COMPANY_ADDRESS=…
```

### Testing

`backend/scripts/test-*.js` — self-contained suites (controller harness + a real
Postgres). Run each with `DATABASE_URL`, `JWT_SECRET`, `PII_ENCRYPTION_KEY` set
against a schema-migrated database:
`test-password-reset` · `test-login-otp` · `test-user-roles` · `test-payroll-run`
· `test-resignation-chain` · `test-resignation-block` · `test-banners` · more.
Each prints `N passed, M failed` and exits non-zero on failure.

---

## Android app (`android/`)

ESS (Employee Self Service) app. Kotlin · Jetpack Compose (Material 3) · Hilt DI ·
Retrofit + kotlinx-serialization · Coil · DataStore. `minSdk 24` (**no `java.time`** —
use `SimpleDateFormat`), `targetSdk` current; ProGuard/R8 enabled for release
(`proguard-rules.pro` keeps serializers, Retrofit, OkHttp, workers).

### Architecture (clean-ish, 3 layers)

```
com.truehr.app
├── core/            UiState wrapper, error → friendly message helpers
├── data/
│   ├── remote/      ApiService (Retrofit), AuthInterceptor, DTOs
│   ├── local/       TokenStore (DataStore), db/
│   └── repository/  *RepositoryImpl — DTO → domain mapping
├── domain/
│   ├── model/       Plain data classes used by the UI
│   └── repository/  Interfaces the ViewModels depend on
├── di/              Hilt modules (network, repositories)
├── presentation/
│   ├── splash/ auth/ dashboard/ profile/ feature/   (one ViewModel per screen)
│   ├── navigation/  AppNavGraph + Routes; global 401 → logout → login
│   ├── components/  Shared composables (GradientHeader, AppTextField,
│   │                PrimaryButton, EmployeePhoto, CenterLoader, ErrorState…)
│   └── theme/       Colors (navy/green brand), typography
└── push/ tracking/  FCM + live-tour location
```

### Cross-cutting behaviour

- **Auth** — `AuthInterceptor` attaches the bearer token; any authenticated 401
  clears the token and emits a global logout event → back to the login screen.
- **Two-step login** — `LoginResponse.otpRequired` switches the login screen into
  the sign-in-code stage (resend / back supported).
- **Images** — the app-wide Coil `ImageLoader` (in `TrueHrApp`) uses the
  authenticated OkHttp client, so `AsyncImage(BuildConfig.BASE_URL + "…")` works
  for banners, `me/photo`, and `employees/{id}/photo` (initials fallback via
  `components.EmployeePhoto`).
- **Feature flags** — `FeatureFlags`: `NFA_SUITE=false` hides the NFA/Performance/
  Team-KPI tiles (web-only for this release); `MY_ESS=true` enables the web SSO tile.
- **Build variants** — dev (local base URL) / prod (`https://truehr.co.in/api/`,
  `WEB_URL=https://truehr.co.in/app`). Release: `minifyEnabled` + `shrinkResources`.
  Play uploads: bump `versionCode`, build prodRelease AAB, keep `mapping.txt`.

### Screens (core, non-NFA)

| Area | Screens |
|---|---|
| Auth | Splash, Login (+ OTP stage), Forgot Password (OTP → new password), Change Password |
| Dashboard | Banner carousel (auto-scroll, dots), photo avatar → My Profile, workspace tiles |
| Attendance | Mark attendance (punch + today's IN/OUT summary), daily, monthly, team, hold team, geo-tag, miss-punch (apply/list) |
| Leave | Menu, apply, list, comp-off, on-duty (apply/list) |
| Tasks | Summary, assign, team tasks |
| Salary | Salary slips list, payslip detail (PDF) |
| Support | Create ticket, view tickets |
| Policies | List + download |
| Team | Team list (photos), address book (photos), team attendance/resignations |
| Resignation | Apply (disclaimer → account block), stage-wise approval table, withdraw; manager review |
| Profile | My profile, notifications |
| Tour | Live tour, routes, details |
| Web ESS | In-app SSO handoff to the web portal |

---

## Deployment (VPS)

```
# on the Mac
git push origin main

# on the server
cd /opt/truehr && git pull
sudo cp deploy/landing/* /var/www/truehr-landing/          # if landing changed
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

- `docker-compose.prod.yml` — `db` (Postgres 16, no public port), `backend`
  (127.0.0.1:4000, runs migrate + seed + server on boot), `web` (127.0.0.1:5173,
  built with `NEXT_PUBLIC_BASE_PATH=/app`).
- Host **nginx** terminates TLS (certbot): `/` → static landing, `^~ /app` → web,
  `^~ /api/` → backend; legacy paths 308-redirect into `/app`.
- **Never** run `docker compose down -v` (destroys the database volume) and never
  rotate `PII_ENCRYPTION_KEY` on a live system.
- Verify: `curl https://truehr.co.in/api/health/ready`, then
  `sudo docker exec truehr-backend node scripts/send-test-mail.js you@example.com`.
