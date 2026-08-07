# Deploying the Super Admin / multi-org / multi-company release

A one-off runbook for **this** release. The normal redeploy (`DEPLOYMENT.md` §9) is
two commands, but this one alters **every existing employee and user_account row**,
so it gets a backup and a rehearsal first.

| | |
|---|---|
| Server | `root@66.116.242.17` (truehr.co.in) |
| Repo on server | `/opt/truehr` |
| Compose file | `docker-compose.prod.yml` with `--env-file .env.production` |
| DB user / name | `truehr` / `truehr` (inside the `db` container) |
| New env vars needed | **none** — nothing to add to `.env.production` |

---

## What this release changes in the database

Additive only. No column is dropped, renamed or rewritten, and the encrypted PII
columns (`aadhaar_enc`, `pan_enc`, `account_number_enc`) are never touched.

- New tables: `org_roles`, `org_role_modules`, `terminations`, `org_payroll_settings`
- New columns on `organisations`, `companies`, `user_accounts`, `employees`, `payslips`
- **Backfill**, which is the part that touches live rows:
  - every employee gets `organisation_id`
  - every account gets `organisation_id` + `org_role_id`
  - the earliest `SUPER_ADMIN` becomes the platform owner

The backfill maps each existing account onto the system role that mirrors the
guard it used to pass, so **behaviour after deploy is unchanged** — HR keeps
exactly what `requireStaff` gave them.

It is idempotent: safe to re-run on every deploy, and a second run is a no-op.

---

## Step 1 — Commit and push (on your Mac)

```bash
cd ~/dev/Freelencing-june-kp/True-HR

# See what is about to go out (≈25 modified, ≈20 new files)
git status
git diff --stat

# Safer: put it on a branch first, so main stays deployable
git checkout -b feature/superadmin-multiorg
git add -A
git commit -m "Super Admin: multi-org tenancy, custom roles + module permissions,
termination flow, attendance-driven payroll, multi-company per organisation"
git push -u origin feature/superadmin-multiorg
```

Then merge to `main` when you're happy (via a PR, or `git checkout main && git merge
feature/superadmin-multiorg && git push`). The server pulls `main`.

If you'd rather go straight to `main` as your existing runbook does, replace the
`checkout -b` line with nothing and `git push origin main`.

> `_to_delete/` and any `_stage*` folders are scratch — delete them before committing
> so they don't enter the repo.

---

## Step 2 — Back up the live database (on the server)

**Do not skip this.** It is your only way back if the backfill goes wrong.

```bash
ssh root@66.116.242.17
cd /opt/truehr

sudo docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U truehr truehr | gzip > /root/truehr-pre-superadmin-$(date +%F-%H%M).sql.gz

ls -lh /root/truehr-pre-superadmin-*.sql.gz     # confirm it is not 0 bytes
```

---

## Step 3 — Rehearse the migration on a copy (strongly recommended)

This proves the backfill against *your real data* without touching production.

```bash
cd /opt/truehr
BACKUP=$(ls -t /root/truehr-pre-superadmin-*.sql.gz | head -1)

# A scratch database inside the same container
sudo docker compose -f docker-compose.prod.yml exec -T db \
  psql -U truehr -d postgres -c "DROP DATABASE IF EXISTS truehr_rehearsal;"
sudo docker compose -f docker-compose.prod.yml exec -T db \
  psql -U truehr -d postgres -c "CREATE DATABASE truehr_rehearsal;"
gunzip -c "$BACKUP" | sudo docker compose -f docker-compose.prod.yml exec -T db \
  psql -U truehr -d truehr_rehearsal >/dev/null

# Run ONLY the migration against the copy, using the new code
sudo docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL="postgres://truehr:${POSTGRES_PASSWORD}@db:5432/truehr_rehearsal" \
  backend node src/db/migrate.js
```

(If `$POSTGRES_PASSWORD` isn't in your shell, read it from `.env.production` first:
`export $(grep POSTGRES_PASSWORD .env.production | xargs)`.)

Expect to see, with your real counts:

```
[migrate] schema applied
[migrate] roles & states ensured
[migrate:tenancy] scoped N employee(s) to their organisation
[migrate:tenancy] mapped N account(s) onto system roles
[migrate:tenancy] organisations, roles & permissions ensured
```

Then check nothing was left behind:

```bash
sudo docker compose -f docker-compose.prod.yml exec -T db psql -U truehr -d truehr_rehearsal -c "
SELECT
  (SELECT count(*) FROM employees     WHERE organisation_id IS NULL) AS employees_without_org,
  (SELECT count(*) FROM user_accounts WHERE organisation_id IS NULL) AS accounts_without_org,
  (SELECT count(*) FROM user_accounts WHERE org_role_id     IS NULL) AS accounts_without_role,
  (SELECT count(*) FROM user_accounts WHERE is_platform_admin)       AS platform_owners;"
```

**All three "without" columns must be 0, and `platform_owners` must be 1.**
If not, stop and send me the output — do not deploy.

Clean up the rehearsal copy:

```bash
sudo docker compose -f docker-compose.prod.yml exec -T db \
  psql -U truehr -d postgres -c "DROP DATABASE truehr_rehearsal;"
```

---

## Step 4 — Deploy

```bash
cd /opt/truehr
git pull

sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Watch migrate + seed run on boot; Ctrl-C once you see "listening on"
sudo docker compose -f docker-compose.prod.yml logs -f backend
```

The backend container runs `migrate && seed && server` on start, so the schema and
backfill apply automatically.

> **Never** `docker compose down -v` — the `-v` deletes the `truehr_pgdata` volume
> and with it the database.
> **Never** change `PII_ENCRYPTION_KEY` — it decrypts stored bank/PAN/Aadhaar data.

The Next.js build is memory-hungry; if it is killed on the 4 GB box, confirm swap is
on (`swapon --show`) — `DEPLOYMENT.md` §2 has the swap setup.

---

## Step 5 — Verify

```bash
# 1. Health
curl -s https://truehr.co.in/api/health/ready

# 2. The founding Super Admin is the platform owner
sudo docker compose -f docker-compose.prod.yml exec -T db psql -U truehr -d truehr -c "
SELECT ua.email, ua.role, r.key AS org_role, ua.organisation_id, ua.is_platform_admin
  FROM user_accounts ua LEFT JOIN org_roles r ON r.id = ua.org_role_id
 ORDER BY ua.id LIMIT 10;"

# 3. Roles + permissions were seeded (expect SUPER_ADMIN 21, HR_ADMIN 20, IT_ADMIN 4)
sudo docker compose -f docker-compose.prod.yml exec -T db psql -U truehr -d truehr -c "
SELECT r.key, count(m.module_key) AS modules
  FROM org_roles r LEFT JOIN org_role_modules m ON m.role_id = r.id
 GROUP BY r.key ORDER BY r.key;"
```

Then in the browser at **https://truehr.co.in/app** — sign in as your Super Admin:

1. Existing screens still work: Employees, Payroll, Resignations.
2. New sidebar entries appear: **Companies**, **Roles & permissions**, **Terminations**, **Organisations**.
3. Sign in as HR and confirm HR does **not** see Roles, Audit or Organisations.
4. Open Payroll → **Attendance rules** and confirm "deduct unexplained" is **off**
   (absences are flagged for review, not deducted).

### First payroll run after this deploy — read this

Payroll now derives days-paid from attendance. Before publishing a real month:

1. Generate the run but **do not publish**.
2. Look at the "Needs attendance review" count and the per-person day breakdown.
3. If the punch data looks wrong (people marked absent who were present), leave
   "deduct unexplained" off — nobody's pay is affected while it is off.

`publish-all` sends every affected employee an email, so treat that click as final.

---

## Rollback

If something is wrong after deploy:

```bash
cd /opt/truehr
git log --oneline -3                 # find the previous commit
git checkout <previous-commit-sha>
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The old code ignores the new tables and columns, so **code rollback alone is usually
enough** — the schema being additive is what makes this safe.

If you must also restore the data:

```bash
BACKUP=$(ls -t /root/truehr-pre-superadmin-*.sql.gz | head -1)
sudo docker compose -f docker-compose.prod.yml stop backend web
sudo docker compose -f docker-compose.prod.yml exec -T db psql -U truehr -d postgres \
  -c "DROP DATABASE truehr;" -c "CREATE DATABASE truehr;"
gunzip -c "$BACKUP" | sudo docker compose -f docker-compose.prod.yml exec -T db psql -U truehr -d truehr
sudo docker compose -f docker-compose.prod.yml start backend web
```

---

## Notes

- **`backend/.env` is local development only.** It currently has a doubled value
  (`DATABASE_URL=DATABASE_URL=postgres://...`) which is worth fixing, but it does not
  affect the server — production reads `.env.production` on the VPS.
- **The Android app is unchanged** by this release. It consumes none of these admin
  endpoints, so no rebuild is required.
- Daily backups: `DEPLOYMENT.md` §10 has the 2 AM cron. Worth having on before this
  release if it isn't already.
