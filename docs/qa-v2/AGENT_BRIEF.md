# QA fix pass (API v2): brief for each area agent

The client's QA team tested the **web app** as four logins and filed 272 points:
- **Master**: the platform owner, `superadmin@truehr.example`.
- **Company Super Admin**: an organisation's own admin.
- **HR Admin**.
- **Employee**.

Every point is in `docs/qa-v2/points.json`. Each has an `id` (M = Master sheet, C = Company, H = HR, E = Employee; H48a/H48b are unnumbered rows), the tester's exact text (`bug`, `testData`, `note`), and an `area`. **You own every point whose `area` is yours.** The lead has accepted every recommendation in the tester's `note` column, plus the decisions below. Fix all your points, including feature requests. Where a full feature is genuinely out of proportion, build the smallest version that addresses the complaint and say so honestly in your results.

Repo: `/Users/nishi/Documents/Personal/true-hr`.
- `backend/` is Express ESM + Postgres. Read `CODEBASE.md` for orientation.
- `web/` is Next.js 14; the admin portal is `/admin/*`, the employee portal `/ess/*`, and the candidate flow `/onboarding/*`.
- The work branch is `fix/web-qa-v2`, already checked out. **Five other agents are editing other files in this same checkout at the same time.**

## The versioning rule (the user's hard requirement)

Existing users must not be affected. The Android app and any old web tab call **`/api/...` (v1)**, and that contract must not change. The web portal now calls **`/api/v2/...`**: `web/lib/api.js` sends every request there.

- The v2 mount is `app.use('/api/v2', markVersion(2), v2routes, routes)`.
  - Your area's v2-only routes go in `backend/src/routes/v2/<area>.js`, which is matched first.
  - Anything not matched there falls through to the shared v1 table `backend/src/routes/index.js`, with `req.apiVersion === 2`.
- In a shared handler, use `isV2(req)` from `backend/src/utils/apiVersion.js` to switch on new behaviour.
- **v2 only:** stricter validation, new required fields, changed response shapes, changed workflow behaviour (who can do what, and when).
- **Both versions (no gate):**
  - fixes for cross-tenant data leaks;
  - crashes and 500s;
  - wrong data written or shown (e.g. a broken SQL alias, PDF placeholders, email bodies);
  - background jobs.
  
  These can only make an existing user's experience correct, never break a client.
- New response fields may be **added** on v1 (clients ignore unknown keys). Never rename, remove or retype a v1 field.
- To give a v1 route different guards or behaviour on v2, declare the **same path** in your `routes/v2/<area>.js`. It is matched first for v2 only.
- DB changes must be **additive and idempotent**: `ADD COLUMN IF NOT EXISTS`, new tables, backfills that are no-ops on re-run. Old code must still work against the new schema. Put them in `backend/src/db/migrations_v2/<NN>_<area>.sql`, or `.js` exporting `async function run(pool)`. Use `NN` = auth 10, people 20, leave 30, payroll 40, org 50, workflow 60. `migrate.js` applies them in name order after everything else. **Never edit `schema.sql` or `schema_tenancy.sql`.**

## Decisions already taken (apply them)

| # | Decision |
|---|---|
| D1 | Master "Switch to" opens that tenant's admin console. The admin shell shows a banner "Working inside <org> as Master", with a link back to Organisations. |
| D2 | **Resignation:** applying no longer blocks the account (v2). A daily job disables the login and marks the employee exited on/after the approved last working day (both versions; it only acts after the LWD). The employee can withdraw before final approval. |
| D3 | **Login timing:** the onboarding approval creates the account; the employee status is `ACTIVE`, but the login only works from the date of joining. Before that, sign-in says "Your account opens on <DOJ>". The welcome email has a set-password link (a one-time token, using the existing reset-OTP/token pattern or a new token table), not a plain password, and `must_change_password` is true. |
| D4 | **Sign-in code:** goes to the verified personal email when the official mailbox isn't confirmed. If the mail can't be queued or sent, the user gets an error, not "code emailed". |
| D5 | **Leave quota:** single source is the organisation's Leave Types annual quota, with an optional per-state override (scoped per org, case-insensitive state names). Prorated from the DOJ for mid-year joiners. Gender eligibility per type. |
| D6 | **Salary structure** follows the company's Payslip components. "Set structure" keeps monthly CTC plus per-employee overrides only; the fixed Basic/HRA template is gone in v2. |
| D7 | **"Employee" in every count, list and picker** = `activeEmployeeSql()` in `backend/src/utils/people.js` (ACTIVE, has a code, not past an approved LWD). Candidates are listed/counted separately and labelled as candidates. |

## Shared foundation (read-only for you; already written)

**Backend**
- `utils/validate.js`: `validator()` with `.name .mobile .email .pattern(kind) .date .number .text .require .throwIfAny()` collects every error and throws `400 { error, fields: {key: msg} }`. Also `nameTaken()` (case-insensitive duplicate in an org), `todayIST()`, `ageOn()`, `canonicalState()` and `INDIAN_STATES`.
- `utils/people.js`: `activeEmployeeSql(alias)` and `candidateSql(alias)`.
- `utils/apiVersion.js`: `isV2(req)`.
- `middleware/error.js`: `AppError(msg, status, fields)`. The error handler now returns `fields`.
- `utils/asyncRoutes.js`: every route handler is now rejection-safe, so a throw in an async handler gives a 500 and never crashes the process.
- `src/app.js`: the Express app. `server.js` only listens and starts workers.

**Web**
- `lib/api.js`
  - `api.get/post/...` hits v2. A thrown error carries `.fields` and `.status`.
  - `fetchBlob(path)` and `openFile(path)`: an authenticated file in a new tab. It opens synchronously so popup blockers allow it, and throws the server's message instead of failing silently.
  - `downloadFile(path, name)`, `API_BASE`, `apiUrl(path)`.
  - **Replace every raw `fetch('/api/...')` in pages you own with these.**
- `lib/labels.js`
  - `label(code)`: never print raw enums like FULL_TIME or PAYMENT_RELEASED.
  - `fmtDate`: dd-mm-yyyy.
  - `todayIso()`: local date, never `toISOString().slice(0,10)`, which is UTC and gives the wrong day in India before 05:30.
- `lib/validate.js`: the same `validator()` rules client-side, plus `INDIAN_STATES` and `addYears/addDays`.
- `components/ui.jsx`
  - `Field` has an `error` prop.
  - `ErrorSummary({errors})`.
  - `Modal` now has an X and closes on Esc; `size="full"` is for PDF viewers.
  - `useConfirm()` returns `[confirm, ui]`: `if (!(await confirm({title, body, confirmLabel, tone:'danger'}))) return;` and render `{ui}` once.
- `components/StatusBadge.jsx`: uses one status vocabulary.

**Do not edit these shared files:**
- `lib/*`, `components/ui.jsx`, `components/StatusBadge.jsx`, `utils/validate.js`, `utils/people.js`, `utils/apiVersion.js`, `utils/asyncRoutes.js`, `middleware/error.js`, `app.js`, `routes/index.js`, `routes/v2/index.js`, `schema*.sql`, `migrate.js`.

If you truly need a change there (a missing label, a new nav item in `web/app/admin/layout.jsx` when you're not the owner, or a guard change in `routes/index.js` that a v2 override can't express), **don't make it**. List it under `leadRequests` in your results and work around it locally. The lead applies those at the end.

## Form standard for v2 (every form you touch)

1. **Validate client-side with `lib/validate.js`.** Show every error at once (`Field error=`, plus `ErrorSummary` on long forms). Submit is disabled only while saving.
2. **Re-validate server-side** with `utils/validate.js`, gated on `isV2(req)`. Return all field errors together.
3. **On an error the modal or form stays open and keeps the user's input** (C10, C22, H74).
4. **Destructive or irreversible actions use `useConfirm`**: delete, publish, approve, regenerate, reset password, verify & lock, sign out.
5. **Readable labels everywhere** (`label()`), sensible empty states ("No X found" when a filter has no results, not "Create your first…"), and search inputs trimmed.
6. **Dates:**
   - date inputs carry `min`/`max`;
   - a DOB must be in the past and 18+;
   - a DOJ must be on or after DOB + 18 and no more than about 1 year ahead;
   - money is positive, with sane upper bounds, accepts "50,000", and has at most 2 decimals.

## Tenancy

Every query on a tenant table must be bounded by the caller's organisation (`req.orgId`). Use company scope (`req.companyScope`) where the screen is company-scoped. Look at `utils/scope.js` and existing scoped queries. A record from another org must answer 404, never 403 and never the data. Cross-tenant leaks are fixed on both versions.

## Testing (mandatory)

**1. Get your own database.** Postgres runs locally on port 55432 (user `postgres`, no password). Create it with:

```
cd backend && sh scripts/v2/setup-db.sh truehr_<area>
```

Re-run that whenever you add a migration. **Only ever touch your own database.**

**2. Write `backend/scripts/v2/test-<area>.js`** on the HTTP harness `scripts/v2/_harness.js`:
- `start`, `login`, `get/post/patch/put/del` (default v2; pass `{v:1}` for v1);
- `makeOrg(masterToken)` for a second tenant;
- `ok(name, cond, extra)`, `section`, `finish`.

**3. Cover every point** you change, with one or more checks for the positive path and for the **negative scenarios**: invalid input rejected with a readable field message, a duplicate blocked, the wrong role or the wrong org refused (404), boundary values.

**4. Prove v1 compatibility.** For every v2 behaviour change, also assert the **old v1 behaviour still holds** on `{v:1}`.

**5. Run it:**

```
DATABASE_URL=postgres://postgres@localhost:55432/truehr_<area> node scripts/v2/test-<area>.js
```

**6. Run the existing suites relevant to your area** (`backend/scripts/test-*.js`, `unit-*.mjs`) against your own database. They must stay green. They call controllers directly, with `req.apiVersion` undefined, i.e. v1 behaviour. `test-masters.js` already crashed on a fresh database before this work started (baseline), so don't chase that unless it's in your area.

**7. Web:** `cd web && node scripts/check-jsx.mjs <files you changed>` must pass.
- **Do NOT run `next build` or `next dev`.** Other agents share `web/.next`; the lead builds at the end.
- Double-check your imports by reading them; there is no type checker.

**8. Housekeeping:**
- Do not `npm install`.
- Do not run any git command that changes state: no commit, stash, checkout, reset, restore or clean. Other agents' uncommitted work is in this tree. `git diff` and `git status` are fine.

## Output: `docs/qa-v2/results-<area>.json`

A JSON array, **one object per point id you own**, in id order:

```json
{
  "id": "C17",
  "status": "Fixed | Partially fixed | Deferred | Not a bug",
  "summary": "Plain-English, tester-facing: what was wrong and what changed.",
  "files": ["backend/src/controllers/leaveAdminController.js", "web/app/admin/leave-config/page.jsx"],
  "testSteps": "1. Log in as <role> … 2. Open … 3. Do … Expected: …",
  "negativeTests": "1. Enter … Expected error: '…' 2. …",
  "automated": "scripts/v2/test-leave.js — 'holidays are scoped per organisation', …",
  "v1Impact": "None (v2 only) | Applies to v1 too — <why it's safe>"
}
```

Test steps are for a manual tester using the **web app** at `https://truehr.co.in/app`. Name the login (Master / Company Super Admin / HR / Employee), the menu path, the data to enter and the expected result. Quote exact error messages.

Add a final object `{ "id": "_meta", "leadRequests": [...], "migrations": [...], "newEndpoints": [...], "testRun": "<paste the final N passed, M failed lines of your suite and the existing suites you ran>", "notes": "…" }`.

Be honest. If something isn't done, say "Partially fixed" or "Deferred" and why. The lead verifies by re-running your suite.
