# How to deploy this

Everything is committed on `main`, **17 commits ahead of `origin/main`**, and nothing
is live yet. Full suite: 466 passing, 0 failing.

Work through this top to bottom. Steps 1–3 are the ones that stop you having a bad
evening.

---

## 1. Push (on your Mac)

I could not do this from here. Your remote is `git@github-personal.com:...`, an SSH
alias that lives in your Mac's `~/.ssh/config` — the Linux VM I reach your files
through has neither that alias nor your key.

```bash
cd ~/dev/Freelencing-june-kp/True-HR
git push origin main
```

That publishes 17 commits, not just today's. Four of them (`c3cb754`, `ee058ad`,
`e75f9bc`, `4cf7953`) were already on your local `main` before I started — your
earlier tenant-scoping and demo-seed work. That's expected; just know it's going up.

---

## 2. Back up the database — do not skip this

```bash
ssh <your-vps>
cd /opt/truehr
sudo docker exec truehr-db pg_dump -U postgres truehr | gzip > ~/truehr-$(date +%F-%H%M).sql.gz
ls -lh ~/truehr-*.sql.gz
```

The migration **merges duplicate departments, designations and levels** and repoints
the people who held the losing rows. Re-running the migration does not undo that.
Reverting the code is `git revert -m 1 ed952a3`; reverting the data is this dump.

---

## 3. See what the merge will actually do

Run these against production *before* deploying. If they all come back empty — which
they will if you run one company per organisation — the migration only stamps
`organisation_id` and there is nothing to think about.

```bash
sudo docker exec -i truehr-db psql -U postgres truehr <<'SQL'
-- departments that will merge into one
SELECT c.organisation_id, lower(d.name) AS name, count(*) AS copies
  FROM departments d JOIN companies c ON c.id = d.company_id
 GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 3 DESC;

-- designations that will merge
SELECT c.organisation_id, lower(g.title) AS title, count(*) AS copies
  FROM designations g JOIN companies c ON c.id = g.company_id
 GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 3 DESC;

-- ladder rungs that will merge (they collide on the rung number)
SELECT organisation_id, level_no, count(*) FROM org_levels
 GROUP BY 1,2 HAVING count(*) > 1;

-- employees with no organisation: their approval chains have been stalling
SELECT count(*) AS employees_with_no_org FROM employees WHERE organisation_id IS NULL;

-- two people in one organisation sharing an email would block the new index
SELECT organisation_id, lower(official_email), count(*)
  FROM employees WHERE organisation_id IS NOT NULL
 GROUP BY 1,2 HAVING count(*) > 1;
SQL
```

The last one is the only query that can make a step fail. If it returns rows, fix
those duplicates first — the migration logs a warning and carries on without the
index rather than crashing, but you want the index.

---

## 4. Add the two new environment variables

```bash
cd /opt/truehr
sudo nano .env.production
```

```
PLATFORM_SUPPORT_EMAIL=maitykoustav2911@gmail.com   # where master tickets are announced
TRUST_PROXY_HOPS=1                                  # 1 is the default; only change if a CDN is added
```

`PLATFORM_SUPPORT_EMAIL` unset just means master tickets appear in the Platform inbox
without emailing you.

---

## 5. Deploy

```bash
cd /opt/truehr
git pull
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations run on boot and are safe to re-run. **Never** `docker compose down -v` —
that deletes the database volume.

Watch the output:

```bash
sudo docker logs -f truehr-backend
```

These four lines are the ones that matter:

```
[migrate] stamped organisation_id on N employee(s)
[migrate] official_email unique per organisation
[migrate] structure scoped to organisation — stamped N row(s), merged M duplicate(s), repointed K employee link(s)
[migrate] organisation-wide uniqueness ensured on structure
```

`merged M` should match what step 3 predicted. Any line starting `[migrate] WARNING`
or `could not` wants reading before you carry on.

---

## 6. Check it came up

```bash
curl https://truehr.co.in/api/health/ready        # {"ok":true,"db":"up"} — used to 404
curl -o /dev/null -w '%{http_code}\n' https://truehr.co.in/api/employees   # 401
curl -sI https://truehr.co.in/api/health | grep -i content-security-policy # now present
```

Then in the portal:

- **Hierarchy & levels** — the company picker is gone and the page names your
  organisation. Click **Build ladder from grades**: the "not placed" column fills in
  one go.
- **Switch organisation** (top right) — each organisation now shows its real headcount
  instead of "0 employees".
- **Contact TrueHR** — in the sidebar above Sign out, and in the ESS tab bar. Raise a
  test ticket; it should appear under **Platform › Master tickets** on your Master
  login and email `PLATFORM_SUPPORT_EMAIL`.
- **truehr.co.in/privacy** — section 11 now shows a real address.

---

## 7. Android

The manifest changes need a new build to reach anyone: cleartext HTTP is now
staging-only and `allowBackup` is off.

```bash
cd android
./gradlew clean :app:assembleProdRelease
```

I could not re-run this at the end — Maven Central was rate-limiting my sandbox
(HTTP 429). An earlier build in this session succeeded and the only Android changes
since are two manifest attributes plus the new staging overlay, both validated as
well-formed XML. Confirm the build before shipping to Play.

---

## If it goes wrong

```bash
# code only — data stays merged
git revert -m 1 ed952a3 && git push origin main
# then redeploy as in step 5

# data as well
gunzip -c ~/truehr-<timestamp>.sql.gz | sudo docker exec -i truehr-db psql -U postgres truehr
```

---

## Still open, deliberately

**The JWT lives in `localStorage`** and lasts seven days with no server-side
revocation beyond disabling the account. You chose to handle this separately, which I
think is right: moving to an httpOnly cookie touches web login, the API proxy, Android
SSO and needs CSRF protection added, and rushing it into this deploy is how you break
login for everyone. The CSP now shipping is the practical mitigation in the meantime,
and the XSS route that made it exploitable is closed.
