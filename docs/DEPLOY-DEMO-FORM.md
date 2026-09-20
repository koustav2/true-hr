# Deploying the landing page and the demo form

Four commits are waiting. Two change only the website; two change the API and
the database as well, so this is not the "copy one file" deploy the landing
page needed last time.

Work through it in order. Every step says what you should see if it worked.

---

## Before you start

You need the password for your VPS and about twenty minutes. Nothing here
takes the site down for more than a few seconds, and step 2 gives you a way
back if anything goes wrong.

---

## 0. Know where the repo is

Everything below assumes the checkout on the VPS is at `/opt/truehr`. Confirm
it, because the rest of the guide is wrong if it lives somewhere else:

```bash
cd /opt/truehr && git rev-parse --show-toplevel
```

**You should see:** `/opt/truehr`.

If that errors, find it and use that path throughout instead:

```bash
find / -maxdepth 4 -name docker-compose.prod.yml -not -path '*/node_modules/*' 2>/dev/null
```

---

## 1. Push from your Mac

```bash
cd ~/dev/Freelencing-june-kp/True-HR
git status            # should say "nothing to commit, working tree clean"
git push origin main
```

**You should see:** four commits listed, ending with
`feat(landing): a working "book a demo" form`.

---

## 2. Back up the database — do not skip this

Step 5 runs a migration that adds two things to the database. Migrations here
only ever add, never delete, but take the backup anyway. It costs a minute.

On the VPS:

```bash
cd /opt/truehr
docker compose -f docker-compose.prod.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip > ~/truehr-backup-$(date +%F-%H%M).sql.gz
ls -lh ~/truehr-backup-*.sql.gz
```

**You should see:** a file of a few hundred KB or more. If it is a few bytes,
the dump failed — stop and tell me before going further.

---

## 3. Get the new code

```bash
cd /opt/truehr
git pull origin main
```

**You should see:** `backend/`, `deploy/landing/` and
`docker-compose.prod.yml` among the changed files.

---

## 4. Add the two email settings

Open the production settings file:

```bash
nano .env.production
```

Add these two lines at the bottom (or edit them if they are already there):

```
PLATFORM_SUPPORT_EMAIL=maitykoustav2911@gmail.com
SALES_EMAIL=info@lrtechnology.in
```

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

- `SALES_EMAIL` is where demo requests go.
- `PLATFORM_SUPPORT_EMAIL` is where master tickets go. **This was never being
  passed to the container before**, so those alerts have not been reaching
  you. This deploy fixes that.

---

## 5. Rebuild the API

```bash
cd /opt/truehr
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build backend
```

This takes a couple of minutes. The container runs the migration itself as it
starts, so there is no separate migrate command.

**You should see, in the logs:**

```bash
docker compose -f docker-compose.prod.yml logs --tail=40 backend
```

- `[migrate] schema applied`
- `[truehr-api] listening on http://localhost:4000 (production)`

If you see a red error mentioning `demo_requests` or `reply_to`, stop and send
me the output.

---

## 6. Copy the landing page across

The landing page now has a `shots/` folder beside it, so the copy has to be
recursive. Copying `index.html` on its own is what leaves you with a page
full of blank frames.

```bash
cd /opt/truehr
test -d deploy/landing/shots || echo "WRONG PLACE — deploy/landing/shots is not here"
rsync -a --delete deploy/landing/ /var/www/truehr-landing/
ls /var/www/truehr-landing/shots/ | wc -l
```

**You should see:** `7`.

The `test -d` line is there because rsync's "No such file or directory" is
easy to skim past, and a mistyped source path with `--delete` on the far side
is not a mistake you want to make twice.

`--delete` removes the nine screenshots that are no longer used. It is safe
here because that folder holds nothing but the landing page.

---

## 7. Check it actually works

**The page:** open `https://truehr.co.in` in a private window. Click through
the six topic buttons — Attendance, Leave, Approvals, Payroll, Performance,
Structure. Each should show its own picture.

**The form, for real:** scroll to the bottom and book a demo with your own
email address. You should get the green tick and "Thank you — that reached
us".

**The email:** check `info@lrtechnology.in` within a minute or two. Hit reply
on it — it should address your reply to the email you typed into the form,
not to no-reply.

**If no email arrives,** the lead is still saved. Check it landed:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT full_name, work_email, company_name, created_at
  FROM demo_requests ORDER BY id DESC LIMIT 5;
SQL
```

And check why the mail did not go:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT to_email, status, attempts, error
  FROM email_queue
 WHERE template = 'demo_request'
 ORDER BY id DESC LIMIT 3;
SQL
```

A row with `status = FAILED` and an error about SMTP means the mail settings
need attention, not the form.

---

## If something goes wrong

Roll the code back but keep the data:

```bash
cd /opt/truehr
git reset --hard HEAD~4
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build backend
rsync -a --delete /opt/truehr/deploy/landing/ /var/www/truehr-landing/
```

The new database table and column simply sit unused. Nothing else reads them.

To restore the data as well:

```bash
gunzip -c ~/truehr-backup-YYYY-MM-DD-HHMM.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

---

## Still open, deliberately

- **The privacy policy does not yet mention the demo form.** You are now
  collecting names, work emails and phone numbers from the public. Add a line
  before this is live for long — ask me and I will draft it.
- **`next@14.2.5` has a known vulnerability.** Unrelated to this work, but
  worth its own session.
- **Where to read the leads.** They are in the database and in your inbox.
  There is no screen for them yet; say the word and I will add one to the
  platform-owner console beside Master tickets.
