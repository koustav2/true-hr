# TRUE HR — VPS Deployment Runbook

Deploy the **backend + web + database** on the BigRock VPS and serve it at
**https://truehr.co.in** over SSH. Database runs on the same VPS (in Docker).

| Item | Value |
|------|-------|
| Host | `66.116.242.17` (truehr.co.in) |
| OS | Ubuntu 22 |
| Stack | Docker Compose: `db` (Postgres) + `backend` (Node/Express) + `web` (Next.js) |
| Proxy/TLS | Nginx + Let's Encrypt on the host |
| Routing | `https://truehr.co.in` → web · `https://api.truehr.co.in` → backend |

> The admin web calls its own origin (`truehr.co.in/api`, no CORS). The Android app
> and any external client use the dedicated API subdomain **`https://api.truehr.co.in/`**.
> Both resolve to the same backend container.

> Files referenced below already exist in the repo: `docker-compose.prod.yml`,
> `deploy/nginx/truehr.co.in.conf`, `deploy/nginx/api.truehr.co.in.conf`, `.env.production.example`.

---

## 0. Before you start

1. **DNS** — In your DNS panel, point the domain (and API subdomain) at the VPS:
   - `A   truehr.co.in      → 66.116.242.17`
   - `A   www.truehr.co.in  → 66.116.242.17`
   - `A   api.truehr.co.in  → 66.116.242.17`
   Wait until `dig +short truehr.co.in` and `dig +short api.truehr.co.in` both return the IP. HTTPS issuance needs this.
2. **Push the code to a Git remote** (GitHub/GitLab private repo) from your Mac:
   ```bash
   cd ~/dev/Freelencing-june-kp/True-HR
   # make sure secrets are ignored
   printf "\n.env\n.env.production\n" >> .gitignore
   git init        # if not already a repo
   git add . && git commit -m "Deploy: production compose, nginx, runbook"
   git remote add origin git@github.com:<you>/true-hr.git
   git push -u origin main
   ```

---

## 1. SSH in & inspect the server

```bash
ssh root@66.116.242.17          # use your VPS root password / key
```

**Check what already owns ports 80/443** (you said "not sure"):
```bash
sudo ss -ltnp | grep -E ':80 |:443 ' || echo "80/443 are free"
systemctl status apache2 nginx 2>/dev/null | head -n 20
```
- *Nothing listed* → clean VPS, continue normally.
- *apache2 running* → stop & disable it so Nginx can use 80/443:
  ```bash
  sudo systemctl disable --now apache2
  ```
- *A control panel (cPanel/Plesk) is serving the site* → don't fight it; tell me and
  we'll run the stack on alternate ports and add a proxy entry inside the panel instead.

---

## 2. System prep

```bash
sudo apt update && sudo apt -y upgrade

# 2 GB swap helps the Next.js build on a 4 GB box (skip if you already have swap)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Firewall: allow SSH + web only
sudo apt -y install ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## 3. Install Docker + Nginx + Certbot

```bash
# Docker Engine + Compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo docker compose version          # confirm the plugin is present

# Nginx + Certbot
sudo apt -y install nginx certbot python3-certbot-nginx
```

---

## 4. Get the code

```bash
sudo mkdir -p /opt && cd /opt
git clone git@github.com:<you>/true-hr.git truehr   # or https://… with a token
cd /opt/truehr
```

---

## 5. Configure production secrets

```bash
cp .env.production.example .env.production

# generate strong secrets
echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" 2>/dev/null || openssl rand -hex 48)"
echo "PII_ENCRYPTION_KEY=$(openssl rand -hex 32)"

nano .env.production   # paste the secrets, set POSTGRES_PASSWORD, and your SMTP creds
```
Fill in: `POSTGRES_PASSWORD`, `JWT_SECRET`, `PII_ENCRYPTION_KEY` (64 hex chars),
`MAIL_FROM`, `SMTP_*`. Keep this file off Git.

> ⚠️ Set `PII_ENCRYPTION_KEY` **once** and never change it — it decrypts stored
> bank/PAN/Aadhaar data. Changing it later makes existing encrypted data unreadable.

---

## 6. Build & start the stack

```bash
cd /opt/truehr
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs -f backend   # watch migrate+seed, Ctrl-C to exit
```
The backend container auto-runs migrations + the idempotent seed on start
(org, company, departments, designations, and the Super Admin / HR / IT logins).

Quick local check (still on the VPS):
```bash
curl -s http://127.0.0.1:4000/api/health || curl -sI http://127.0.0.1:5173 | head -n1
```

---

## 7. Nginx site + HTTPS

```bash
# Web (truehr.co.in) + API subdomain (api.truehr.co.in)
sudo cp /opt/truehr/deploy/nginx/truehr.co.in.conf     /etc/nginx/sites-available/truehr.co.in
sudo cp /opt/truehr/deploy/nginx/api.truehr.co.in.conf /etc/nginx/sites-available/api.truehr.co.in
sudo ln -sf /etc/nginx/sites-available/truehr.co.in     /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/api.truehr.co.in /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default     # remove the Nginx welcome page
sudo nginx -t && sudo systemctl reload nginx

# Issue + auto-install Let's Encrypt certs for all three names (adds 443 blocks & HTTP→HTTPS redirect)
sudo certbot --nginx -d truehr.co.in -d www.truehr.co.in -d api.truehr.co.in --agree-tos -m you@example.com --redirect
```
Certbot installs a renewal timer automatically; confirm with `systemctl list-timers | grep certbot`.

Open **https://truehr.co.in** → admin login. Default HR login (change immediately):
`hr@truehr.example` / `Hr@12345`.

---

## 8. Point the Android app at production

In `android/.../data/remote` (the Retrofit base URL / NetworkModule), set the base URL to:
```
https://api.truehr.co.in/api/
```
(The `api` subdomain passes the path through to the backend's `/api` mount, so endpoints
resolve as `auth/login` → `https://api.truehr.co.in/api/auth/login`.)
Then rebuild the release APK in Android Studio (Build → Generate Signed Bundle/APK).
Because it's HTTPS, no cleartext-traffic exception is needed. *(Tell me and I'll make this
code change and wire it as a build flavor if you want a debug-vs-prod switch.)*

---

## 9. Redeploy after changes

```bash
cd /opt/truehr
git pull
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
Schema changes apply automatically (the backend runs migrations on boot).

---

## 10. Database backups (recommended)

```bash
# Manual dump
sudo docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U truehr truehr | gzip > ~/truehr-$(date +%F).sql.gz

# Daily 2 AM cron
( sudo crontab -l 2>/dev/null; echo '0 2 * * * cd /opt/truehr && docker compose -f docker-compose.prod.yml exec -T db pg_dump -U truehr truehr | gzip > /root/truehr-$(date +\%F).sql.gz' ) | sudo crontab -
```
Restore: `gunzip -c backup.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U truehr -d truehr`.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 502 Bad Gateway | `docker compose -f docker-compose.prod.yml ps` — is web/backend up? `logs backend` |
| Certbot fails | DNS not pointing to the IP yet, or 80 blocked — `sudo ufw status`, `dig +short truehr.co.in` |
| Uploads fail (413) | raise `client_max_body_size` in the Nginx conf (currently 25m) then `reload` |
| Emails not sending | check `SMTP_*` in `.env.production`; `logs backend` shows mail attempts |
| DB data gone after redeploy | never `docker compose down -v` — the `-v` deletes the `truehr_pgdata` volume |

## Security notes
- DB and app containers bind to `127.0.0.1` only; just 22/80/443 are open to the internet.
- Keep `.env.production` off Git. Rotate `JWT_SECRET` if leaked (logs users out); never rotate `PII_ENCRYPTION_KEY`.
- Consider creating a non-root sudo user and disabling root SSH login once set up.
