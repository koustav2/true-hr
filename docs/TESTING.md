# TrueHR — Local Test Guide

Branch: `feature/nfa-suite-enabled` (web NFA on, app unchanged). Docker Desktop must be running.

## 1. Start everything

```bash
cd ~/dev/Freelencing-june-kp/True-HR
git checkout feature/nfa-suite-enabled
docker compose up -d --build
```

- Web → http://localhost:5173 · API → http://localhost:4000 · Postgres → localhost:5433
- Migrations + seed run automatically. Seeded logins:
  - HR admin: `hr@truehr.example / Hr@12345`
  - Super admin: `superadmin@truehr.example / Super@12345`

## 2. Automated backend suite (110 checks)

```bash
cd backend
export DATABASE_URL=postgres://truehr:truehr@localhost:5433/truehr   # match backend/.env
export JWT_SECRET=x
export PII_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
for t in test-approval-engine test-masters test-nfa test-settlement test-reports test-resignation-chain test-vendors; do
  node scripts/$t.js
done
```

All 7 must end `N passed, 0 failed`.

## 3. Hardening spot-checks

```bash
curl -si http://localhost:4000/health | grep -i "x-content-type\|x-frame"   # helmet headers
curl -s  http://localhost:4000/health/ready                                # {"ok":true,"db":"up"}
for i in $(seq 1 22); do curl -s -o /dev/null -w "%{http_code} " -X POST \
  http://localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"x@x.x","password":"bad"}'; done; echo                       # ends in 429s
```

## 4. Create a test employee (needed for /ess)

1. Log in at http://localhost:5173 as HR → **Onboard employee** (use a personal email you can fake).
2. Offer email is printed to the backend log:
   `docker compose logs -f backend` → look for `[mailer:DEV]` → copy the `/onboarding/accept?token=…` link.
3. Open the link → accept → complete the 4-step wizard → submit.
4. Back as HR: **Review queue → Approve**. The credentials email (Employee ID + temp password) is also in the backend log.
5. Log out; log in as that employee → you land on **/ess** (must change password first).

Tip: to make the employee a manager's report (for team/approval testing), onboard a second
employee and set the first as their reporting manager on the onboarding form.

## 5. Employee portal walkthrough (/ess)

Follow the tabs left to right — each maps to a feature the app has:

1. **Dashboard** — performance strip, ledger, tiles render.
2. **Attendance** — monthly calendar loads; Daily punches empty (punching is app-only); Miss-Punch: apply "1,2" for last month → shows PENDING.
3. **Leave** — Apply (balances shown, half-day toggle for eligible types) → My Leaves shows PENDING → Cancel works. Team Approvals: from the manager login, approve it.
4. **NFA** — Create NFA end-to-end:
   - HR first: Admin → **NFA & Finance → Masters** — add a Project, Location, Client; bulk-import a few expense-hierarchy rows.
   - Employee: Create NFA (watch cascading dropdowns + auto approver chain) → submit.
   - Manager (or HR override): **Approvals** tab → Approve; try **Query/Hold** once — employee sees QUERY on My NFAs and can resubmit.
   - HR: Admin → NFA queue → detail → approve remaining stages → **Release payment**.
   - Employee: My NFAs → open it → **Submit Your Settlement** → chain appears; approve stages from manager/HR side until CLOSE.
5. **Performance** — Submit KPI (weightages must total 100) → manager approves (Team KPI in admin PMS or the manager's /ess is admin-side) → employee Submit PMS per KRA → rate through the chain → grade appears + dashboard strip updates.
6. **Tasks** — manager assigns a task to the employee; employee Start → Close.
7. **Payslips** — HR: Payroll → generate + publish a slip; employee sees + downloads the PDF.
8. **Support** — create an HR ticket → HR resolves in Admin → Support Desk.
9. **Policies** — HR uploads a policy PDF (Admin → Policies) → employee downloads.
10. **Vendors** — register a vendor + upload an agreement → HR approves in Admin → Vendors; approved vendor appears in the NFA client/vendor dropdown.
11. **Resignation** — apply → chain shows RM stage pending → manager approves → walk to HR stage → status APPROVED. Withdraw path: apply again is blocked while active.
12. **Profile** — profile fields, My Team (manager login), searchable Address Book.

## 6. App → web SSO (My ESS tile)

1. Android Studio: Build Variants → **stagingDebug** → run on emulator (backend at 10.0.2.2:4000, web at 10.0.2.2:5173 — `npm run dev` in `web/` if not using Docker for web).
2. Log in as the employee → tap **My ESS** → browser opens `…/sso?t=…` → lands on /ess already signed in.
3. Negative check: wait 2 minutes on the app screen after an error / reuse an old link → "Invalid or expired link".

## 7. Admin side quick pass

As HR at /admin: NFA queue filters + detail actions, NFA reports (all 4 tabs + Export Excel downloads a valid .xlsx), Masters CRUD (delete needs the two-step confirm), PMS tabs, Vendors approvals.

## 8. Release build (main branch)

```bash
git checkout main       # flags off — NFA/ESS hidden everywhere
```
Rebuild the app → dashboard has no NFA/ESS/Performance tiles; web /ess shows "coming soon"; admin sidebar has no NFA sections. Then Generate Signed APK (prodRelease).

## Known app-only features (by design)

Punch in/out and Tour tracking need camera/GPS — mobile app only. Web shows a pointer note.
