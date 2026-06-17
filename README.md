# TRUE HR — HRMS (v1)

Employee onboarding system for the **TRUE HR** organisation (one seeded company, *True HR Pvt Ltd*).
HR runs everything from a premium web admin panel; the new hire completes onboarding via secure email links; once HR approves, the employee gets their Employee ID + credentials + app link by email.

```
HR creates employee  ──▶  offer email (personal inbox)  ──▶  employee accepts
      ──▶  employee fills bank/PF/Aadhaar/PAN + e-sign  ──▶  HR notified
      ──▶  HR approves  ──▶  credentials email (Employee ID + password + app link)  ──▶  ACTIVE
```

See **HRMS_System_Plan.md** for the full architecture, state machine, ER diagram and API reference.

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js + Express (plain JS, ES modules) |
| Database | PostgreSQL (`pg`) |
| Auth | JWT + bcrypt, role-based (`HR_ADMIN`, `EMPLOYEE`) |
| PII | AES-256-GCM encryption for Aadhaar, PAN, bank account (masked on display) |
| Email | SendGrid (primary) → SMTP fallback → dev-log; sent **async via a queue worker** |
| Web (admin + onboarding) | Next.js 14 (App Router) + React + Tailwind CSS |
| E-signature | Built-in canvas signature pad (stored as PNG + IP + timestamp) |

> The Android employee app is **not** included in this v1 build. The backend API is ready for it — the same `POST /api/auth/login` + `GET /api/me` endpoints serve the app. Manager panels/notifications are deferred to a later version per scope.

---

## Project layout

```
True-HR/
├── HRMS_System_Plan.md      # full design doc + diagrams
├── docker-compose.yml       # local PostgreSQL
├── backend/                 # Express API
│   ├── src/
│   │   ├── server.js
│   │   ├── config/  db/  utils/  middleware/  services/  controllers/  routes/
│   │   └── db/schema.sql    # full schema
│   └── .env.example
└── web/                     # Next.js admin panel + onboarding wizard
    ├── app/admin/           # HR console routes
    ├── app/onboarding/      # public onboarding routes (token links)
    ├── components/  lib/     # shared UI + api/auth helpers
    └── next.config.mjs       # proxies /api -> backend (:4000)
```

---

## Run everything with one command (Docker)

This builds and starts the database, backend (with migrations + seed) and web app together:

```bash
docker compose up -d --build
```

Then open **http://localhost:5173** and sign in as **hr@truehr.example / Hr@12345**.

- Web → http://localhost:5173 · API → http://localhost:4000 · Postgres → localhost:5433
- No mail provider is set, so offer/credentials emails are printed to the backend log — grab the acceptance link with:

  ```bash
  docker compose logs -f backend     # look for [mailer:DEV] and the /onboarding/accept?token=… URL
  ```

- To send real email or set your own secrets, create a `.env` next to `docker-compose.yml`:

  ```
  JWT_SECRET=your-long-random-string
  PII_ENCRYPTION_KEY=<output of: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
  SENDGRID_API_KEY=...        # optional
  ```

- Stop everything: `docker compose down` (add `-v` to also wipe the database volume).

> The bundled defaults are fine for local use, but set your own `JWT_SECRET` and `PII_ENCRYPTION_KEY` before any real deployment.

---

## Running locally (without Docker)

### 1. Database
```bash
docker compose up -d          # starts PostgreSQL on :5432
```

### 2. Backend
```bash
cd backend
cp .env.example .env
# generate a real PII key and paste it into .env as PII_ENCRYPTION_KEY:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm install
npm run migrate               # create tables
npm run seed                  # seed TRUE HR org, company, depts, designations + HR login
npm start                     # http://localhost:4000
```
Seed creates an HR admin: **hr@truehr.example / Hr@12345**

### 3. Web
```bash
cd web
npm install
npm run dev                   # http://localhost:5173  (proxies /api -> :4000)
```

---

## Trying the full flow

1. Sign in at `/login` as **hr@truehr.example / Hr@12345**.
2. **Onboard employee** → fill details → *Submit & send offer*. The offer email is queued; with no mail provider configured it's printed to the backend console (look for `[mailer:DEV]`) — copy the `/onboarding/accept?token=…` link.
3. Open that link → **Accept offer** → complete the 4-step wizard (bank, statutory, address, e-sign) → submit.
4. Back in the admin panel, **Review queue** → open the employee → **Approve**. The credentials email (Employee ID + temp password + app link) is queued/logged.
5. The employee's official email now has an `EMPLOYEE` login with `must_change_password` — used by the future Android app.

To send real emails, set `SENDGRID_API_KEY` (or `SMTP_*`) in `backend/.env`.

---

## Email worker

Outgoing mail is written to the `email_queue` table and sent by a background worker (polls every 5s), trying SendGrid first and falling back to SMTP. This keeps the API fast and gives automatic retries (up to 5 attempts) + a full `email_queue` audit trail.

---

## Security notes

- Onboarding links are random 32-byte tokens; only the **SHA-256 hash** is stored, they are single-use and expire in 7 days.
- Aadhaar, PAN and bank account numbers are **encrypted at rest** (AES-256-GCM) and only ever returned to HR **masked** (e.g. `••••••••1234`).
- All sensitive actions are written to `audit_log`.
- Set a strong `JWT_SECRET` and a unique `PII_ENCRYPTION_KEY` before any real use.

---

## Housekeeping

The frontend was migrated from Vite to Next.js. A few unused Vite leftovers may remain in `web/` and are safe to delete on your machine:

```bash
rm -rf web/.nm_trash_2 web/src web/index.html web/vite.config.js
```

The `web/.nm_trash_2/` directory (a partial install from the build environment) is git-ignored.
