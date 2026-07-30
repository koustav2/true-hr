# TrueHR — Codebase Guide (HR core)

> Scope matches `FUNCTIONAL-SPEC.md`: the HR core only. **Excluded:** the NFA /
> expense suite (NFA, settlements, NFA reports, vendors, PMS) and the ESS
> self-service modules (attendance & punches, leave / comp-off / on-duty /
> miss punch, tasks, support desk, team list, address book, banners, tours, and
> the entire Android app — which is ESS end to end). Their code lives in the
> same repo but is not documented here.

**Live:** https://truehr.co.in (landing) · web portal under `/app` · API under `/api`
**Stack:** Node.js (Express, ESM) + PostgreSQL · Next.js 14 web portal · Docker Compose + host nginx (VPS)

---

## Repository layout

```
True-HR/
├── backend/          Express API + PostgreSQL schema, workers, PDF/email services
├── web/              Next.js 14 admin + ESS portal (basePath /app in production)
├── android/          Android ESS app (out of scope here)
├── deploy/
│   ├── landing/      Static marketing page served at truehr.co.in root
│   └── nginx/        Host nginx vhost (TLS, routing: / /app /api)
└── docker-compose.prod.yml   Production stack: db + backend + web
```

## Backend — entry & runtime

| File | Purpose |
|---|---|
| `backend/src/server.js` | Express app: helmet security headers, CORS allowlist (`CORS_ORIGINS`), rate limits (login/OTP endpoints 20/15 min, global 1500/5 min), JSON body up to 20 MB, health probes `/health` + `/health/ready`, starts background workers |
| `src/config/index.js` | Env-driven config; **refuses to boot in production with default secrets** (JWT_SECRET, PII_ENCRYPTION_KEY, DATABASE_URL) |
| `src/routes/index.js` | Single route table — every endpoint with its auth guard |
| `src/db/pool.js` | pg Pool + `query()` + `tx()` transaction helper |
| `src/db/schema.sql` | Full schema, idempotent (`CREATE TABLE IF NOT EXISTS` / `ALTER … IF NOT EXISTS`) |
| `src/db/migrate.js` | Applies schema.sql + enum additions + in-place data fixes; safe to re-run on every deploy |
| `src/db/seed.js` | Base seed (company, HR account, masters) |

## Auth & accounts

**Files:** `controllers/authController.js`, `controllers/userController.js`, `middleware/auth.js`

- **Login** `POST /auth/login` — email **or** Employee ID + password.
- **Two-step login (employees only)** — when `LOGIN_OTP=true`, a 6-digit code is
  emailed after the password; `POST /auth/login/verify-otp` completes sign-in.
  Admin roles skip the OTP. Codes: SHA-256 hashed at rest, 10-min expiry, single
  use, locked after 5 wrong attempts. Stored in `password_reset_otps` with a
  `purpose` column (`LOGIN` vs `RESET`) so the two flows can't cross.
- **Forgot password** `POST /auth/forgot-password` → emailed OTP →
  `POST /auth/reset-password` (no account enumeration).
- **Sessions** — JWT (7 days). `authenticate` middleware re-checks the account
  status per request (30 s in-memory cache + `invalidateAccountStatus()` on
  writes), so disabling an account kills live sessions immediately.
- **Roles** — `EMPLOYEE`, `HR_ADMIN`, `IT_ADMIN`, `SUPER_ADMIN`. Guards:
  `requireStaff` (HR+Super), `requireAdmin` (IT+Super), `requireAnyAdmin`, `requireSuperAdmin`.
- **User management** — create staff accounts, `POST /admin/users/:id/role`
  (role change), `POST /admin/users/:id/status` (enable/disable). Super-admin
  accounts only touchable by a super admin; no self-changes. Audit-logged.

## Employee lifecycle

**Files:** `controllers/employeeController.js`, `controllers/onboardingController.js`,
`services/offerLetterPdf.js`, `utils/crypto.js`, `utils/tokens.js`

- `createEmployee` — validates name/phone, inserts employee `OFFER_SENT`, creates
  the onboarding row + hashed magic accept token (expiry `OFFER_EXPIRY_DAYS`),
  emails the offer. Optional uploaded offer-letter PDF, or **auto-generation**
  (`autoOfferLetter` + `ctc`) of Offer Letter + Annexure A via `offerLetterPdf.js`.
- `onboardingController` — the candidate-facing e-joining steps with server-side
  format validation (PAN `^[A-Z]{5}\d{4}[A-Z]$`, Aadhaar `^\d{12}$`,
  IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`, account 9–18 digits, letters-only names,
  10-digit phone), marital-status field logic, address with district.
- HR review → approve (creates `user_accounts`, emails credentials with forced
  password change) or send back with notes.
- Profile management: `updateEmployee` (whitelisted columns incl. CTC/location/
  emails with `user_accounts` email sync), `uploadEmployeeDocument`
  (replace-on-upload, 8 MB), `updateBankStatutory` (PII re-encrypted, blanks keep
  old values), `resetEmployeePassword` (temp `Thr@######`, elevated-role guard),
  `generateOfferLetter`, `setEmployeeActive` (ACTIVE ↔ INACTIVE + account
  enable/disable).
- Photos: `GET /me/photo` (own), `GET /employees/:id/photo` (same-company guard).
- PII (Aadhaar, PAN, bank account) AES-encrypted at rest (`PII_ENCRYPTION_KEY`,
  never rotate on a live DB). Base64-in-Postgres pattern for all file blobs.

## Resignation workflow

**Files:** `controllers/resignationController.js`, `services/approvalEngine.js`,
`controllers/approvalController.js` (matrix admin)

- Generic **approval engine**: flows → stages (resolver types `manager_chain`,
  `matrix`, `named_user`; `optional_bypass` auto-skips unresolvable optional
  stages), instances with per-stage status, staff override for unresolved
  mandatory stages, and `notify()` fire-and-forget emails (raiser on every
  action, next approver with a subject-details table).
- RESIGNATION flow: RM → Functional Manager → Business Head → Office Admin →
  Finance → HR (stages 3–5 from `approver_matrix`).
- `context` returns the stage table (role label, approver, live status) —
  resolved as a preview before applying, real statuses after.
- `team` shows pending requests to managers **and** to the current-stage matrix
  approver (fixes chain stalls).
- **Account block policy**: `apply` disables the account (+ session-cache
  invalidation); reject/withdraw re-enables via `reenableAccount()`; HR can
  re-enable from Users & roles. Disclaimer lives in the ESS UI (out of scope).

## Payroll

**Files:** `controllers/payrollController.js`, `services/paySlipPdf.js`

- `salary_structures` (per employee) + `company_salary_templates` (default).
- `computePayslip()` — pay engine; auto-balancing **Special Allowance** keeps
  gross = CTC; earnings prorate by `daysPaid/daysInMonth`; PF on prorated basic.
- `runInputs()` — proration window from `date_of_joining` / approved
  `last_working_date`, minus approved LWP days overlapping the window.
- `generateAll` (bulk drafts + skip reasons), `generate` (single, manual
  overrides: daysPaid/arrears/bonus/TDS), `publish` / `publishAll`
  (+ `payslip_published` email), `unpublish`, `remove` (drafts only),
  `exportBankSheet` (CSV with decrypted account numbers), `adminList`
  (run sheet + summary totals). Published slips are locked (409 on regenerate).

## Email

**Files:** `services/emailQueue.js`, `services/mailer.js`, `services/emailTemplates.js`

- DB-backed queue (`email_queue`), worker every 5 s, 5 attempts with exponential
  backoff (1/4/9/16 min via `next_attempt_at`). Never blocks a request.
- Mailer: SendGrid or SMTP; console log in dev.
- Templates: offer, credentials, sent-back, OTP (shared modern template for
  reset + sign-in codes), payslip published, approval action/pending.

## Environment variables (production)

```
NODE_ENV=production  PORT=4000
DATABASE_URL=…       JWT_SECRET=…          PII_ENCRYPTION_KEY=<64 hex>
APP_BASE_URL=https://truehr.co.in/app
CORS_ORIGINS=https://truehr.co.in,https://www.truehr.co.in
MAIL_FROM=…  SMTP_HOST=…  SMTP_PORT=587  SMTP_USER=…  SMTP_PASS=…  (or SENDGRID_API_KEY)
LOGIN_OTP=true|false        # two-step employee login (needs working SMTP)
OFFER_EXPIRY_DAYS=3  COMPANY_NAME=…  SUPPORT_PHONE=…  COMPANY_ADDRESS=…
```

## Tests

`backend/scripts/test-*.js` — self-contained suites (controller harness + a real
Postgres; run with `DATABASE_URL`, `JWT_SECRET`, `PII_ENCRYPTION_KEY` against a
migrated DB). HR-core suites: `test-password-reset`, `test-login-otp`,
`test-user-roles`, `test-payroll-run`, `test-resignation-chain`,
`test-resignation-block`. Each prints `N passed, M failed`, non-zero exit on failure.

## Deployment (VPS)

```
# Mac
git push origin main
# server
cd /opt/truehr && git pull
sudo cp deploy/landing/* /var/www/truehr-landing/          # if landing changed
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

- Compose: `db` (Postgres 16, not exposed), `backend` (127.0.0.1:4000, runs
  migrate + seed + server on boot), `web` (127.0.0.1:5173, `NEXT_PUBLIC_BASE_PATH=/app`).
- Host nginx (certbot TLS): `/` → landing, `^~ /app` → web, `^~ /api/` → backend.
- **Never** `docker compose down -v` (destroys the DB volume); never rotate
  `PII_ENCRYPTION_KEY` on a live system.
- Verify: `curl https://truehr.co.in/api/health/ready`, then
  `sudo docker exec truehr-backend node scripts/send-test-mail.js you@example.com`.
