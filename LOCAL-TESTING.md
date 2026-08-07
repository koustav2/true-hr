# Testing this release on localhost

Everything runs from `docker-compose.yml` (the dev compose): Postgres, the API and
the Next.js portal. No `.env` editing needed — the dev compose supplies the
database URL and dev secrets itself.

| | |
|---|---|
| Portal | http://localhost:5173 |
| API | http://localhost:4000/api |
| Postgres | `localhost:5433` · db `truehr` · user/pass `postgres`/`postgres` |
| Containers | `truehr-db`, `truehr-backend`, `truehr-web` |

Locally the portal is served at the **root** (no `/app` prefix) — that prefix is
production-only, set via a build arg.

---

## 1. Start it

```bash
cd ~/dev/Freelencing-june-kp/True-HR
docker compose up -d --build

# Watch migrate + seed run; Ctrl-C to stop watching (containers keep running)
docker compose logs -f backend
```

You should see:

```
[migrate] schema applied
[migrate] roles & states ensured
[migrate:tenancy] created default organisation
[migrate:tenancy] organisations, roles & permissions ensured
[seed] SUPER_ADMIN created -> superadmin@truehr.example / Super@12345
[seed] HR_ADMIN created -> hr@truehr.example / Hr@12345
[seed] IT_ADMIN created -> itadmin@truehr.example / It@12345
[truehr-api] listening on http://localhost:4000 (development)
```

Then open **http://localhost:5173**.

| Sign in as | Email | Password |
|---|---|---|
| Super Admin (platform owner) | `superadmin@truehr.example` | `Super@12345` |
| HR Admin | `hr@truehr.example` | `Hr@12345` |
| IT Admin | `itadmin@truehr.example` | `It@12345` |

No email is needed to sign in: `NODE_ENV=development` logs mail to the container
console instead of sending it, and admin roles skip the login OTP.

---

## 2. Run the automated tests (the fastest real check)

All 19 suites run **inside the backend container**, which already has the database
URL and secrets:

```bash
# One suite
docker exec truehr-backend node scripts/test-companies.js

# All of them
docker exec truehr-backend sh -c 'for f in scripts/test-*.js; do
  printf "%-30s" "$(basename $f)"; node "$f" >/tmp/o 2>&1 \
    && grep -oE "^[0-9]+ passed, [0-9]+ failed" /tmp/o | tail -1 \
    || { echo FAILED; tail -5 /tmp/o; }
done'
```

Expected: **19 suites, 370 checks, 0 failures.** The five that cover this release are
`test-tenancy`, `test-permissions`, `test-termination`, `test-attendance-payroll`
and `test-companies`.

---

## 3. Click through the new features

**Multi-company under one organisation** — Sidebar → **Companies** → *New company*.
Give it a name and a prefix like `ACM`. Then Employees → *Add employee*: a **Company**
dropdown now appears (it only shows when there's more than one). Pick the new company,
and notice Departments reload to that company's own list.

**Custom roles** — Sidebar → **Roles & permissions** → click the ready-made **CEO**
tile. Open it and see the module matrix. Now Users & accounts → *Add user* → choose
**Chief Executive Officer**. Sign in as that user in a private window: the sidebar is
much shorter, Payroll opens read-only, and Roles/Organisations are absent.

**Permissions actually bite** — as HR, try `http://localhost:5173/admin/roles`
directly. You get a "no access" message, and the API returns 403.

**Terminate** — Employees → open anyone → **Terminate**. Fill a reason and last
working day, click Review, read the consequences, confirm. A red banner appears on
their profile; **Reverse** undoes it and restores their login.

**Attendance payroll** — Payroll → **Attendance rules**. Confirm "deduct days that
attendance cannot explain" is **off**. Pick a past month and *Generate all*: the
Attendance column shows each person's days-paid breakdown, and anyone with no punches
is flagged "N days unaccounted" without losing pay.

**Multi-organisation** — Sidebar → **Organisations** → *New organisation*, tick
"also create the first Super Admin", and give it an email/password. Use the switcher
at the top right to move into it: employee and payroll lists are empty, because it's
a separate tenant. Sign in as that new admin in a private window and confirm they
cannot see TrueHR's data at all.

---

## 4. Test the migration against a copy of production

This is the rehearsal that matters most, and you can do it locally instead of on the
server. Copy a production dump onto your Mac first, then:

```bash
# Load the prod dump into a scratch database in your local container
docker exec -i truehr-db psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS prodcopy;"
docker exec -i truehr-db psql -U postgres -d postgres -c "CREATE DATABASE prodcopy;"
gunzip -c ~/truehr-prod-backup.sql.gz | docker exec -i truehr-db psql -U postgres -d prodcopy

# Run ONLY the migration against that copy
docker exec -e DATABASE_URL=postgres://postgres:postgres@db:5432/prodcopy \
  truehr-backend node src/db/migrate.js

# Nothing may be left unscoped
docker exec -i truehr-db psql -U postgres -d prodcopy -c "
SELECT
  (SELECT count(*) FROM employees     WHERE organisation_id IS NULL) AS employees_without_org,
  (SELECT count(*) FROM user_accounts WHERE organisation_id IS NULL) AS accounts_without_org,
  (SELECT count(*) FROM user_accounts WHERE org_role_id     IS NULL) AS accounts_without_role,
  (SELECT count(*) FROM user_accounts WHERE is_platform_admin)       AS platform_owners;"
```

The three "without" columns must be **0** and `platform_owners` must be **1**.
Run the migration a second time to confirm it's a clean no-op.

---

## 5. Start over from an empty database

Locally this is safe and is the only way to test a **fresh install** the way a new
customer would get it:

```bash
docker compose down -v          # -v drops the local volume: local data is deleted
docker compose up -d --build
```

> On the **production** server never use `-v` — there it deletes the real database.

---

## 6. Useful commands

```bash
docker compose ps                          # what's running
docker compose logs -f backend             # API logs (emails print here in dev)
docker compose logs -f web                 # Next.js logs
docker compose restart backend             # after a backend change
docker compose up -d --build web           # after a portal change
docker exec -it truehr-db psql -U postgres -d truehr    # SQL prompt

# Did the tenancy migration land?
docker exec -i truehr-db psql -U postgres -d truehr -c "\d org_roles"
docker exec -i truehr-db psql -U postgres -d truehr -c \
  "SELECT key, base_role, rank FROM org_roles ORDER BY rank;"
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `port 5433 already allocated` | A local Postgres is running. `brew services stop postgresql`, or change the host port in `docker-compose.yml`. |
| Portal loads but every call fails | Backend not up yet — `docker compose logs backend`. It waits for the DB healthcheck. |
| Web build killed during `up --build` | Give Docker Desktop more memory (Settings → Resources, 4 GB+). |
| Login says "account disabled" | You archived/suspended it while testing. `docker compose down -v && up -d --build` to reset. |
| Sidebar missing the new entries | Hard-refresh — the sidebar is built from `/me/permissions`, cached per page load. |

Running Node directly on the host instead of Docker? Then fix `backend/.env` first —
its `DATABASE_URL` is doubled (`DATABASE_URL=DATABASE_URL=postgres://...`). It does
not affect Docker, because `.dockerignore` excludes that file.
