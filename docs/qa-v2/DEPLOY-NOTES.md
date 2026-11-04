# Deploying the v2 QA fix pass

Branch `fix/web-qa-v2`. Deploy the same way as usual. The backend container runs migrate + seed + server, and all the new migrations in `backend/src/db/migrations_v2/` are additive and safe to re-run.

Nginx needs no change: `/api/v2/*` is already proxied by `^~ /api/`.

## What changes for whom

- **Web portal** (`/app`): calls `/api/v2`, so it gets every fix in the retest sheet.
- **Android app and old browser tabs** (`/api`, v1): same contract as before.
  - Checked by comparing 141 Android GET calls between the old and new code: 0 differences.
  - v1 does get the data-leak, crash and wrong-data fixes, which can only correct what users see.

## Before or right after the deploy (ops)

1. **Email sender.** Production `MAIL_FROM` is a personal Gmail.
   - Set it to a company-domain address with SPF/DKIM, e.g. `TrueHR <no-reply@truehr.co.in>`.
   - The display name is now set per organisation automatically.
   - Then check delivery as Master: `GET /api/v2/admin/email-health`, plus the test send. The tester reported that sign-in codes never arrived (H47).
2. **Exit job: announce it.** On its first run, the new exit job makes employees whose approved last working day has already passed Inactive and disables their login. Examples: TKF9004, TKF5001.
3. **Welcome emails now send a set-password link.**
   - `APP_BASE_URL` must be the public portal URL (`https://truehr.co.in/app`), because the link is built from it.
4. **Data clean-up**, done by each organisation's admins in the UI:
   - junk NFA masters (cvf, Dmeo, BJP…);
   - demo-domain approver emails;
   - the "Demo Employee" / "Demo Manager" accounts;
   - historic resignations dated before the joining date (TKF9008);
   - TRUE HR's offer-letter template text ("Dear Rocky", "[nsdjshgd]"), under Branding.

## Decision for the owner

- **v1 `GET /api/me/profile`** still returns the bank account number, PAN and Aadhaar unmasked; v2 masks them.
  - It was left unchanged so the Android app keeps working.
  - Masking v1 too is safer, if the app doesn't display the raw numbers.

## Tests

Postgres for the suites (any 16.x):

```
sh scripts/v2/setup-db.sh truehr_test
DATABASE_URL=postgres://postgres@localhost:55432/truehr_test node scripts/v2/test-<area>.js
```

- **Areas:** auth, people, leave, payroll, org, workflow.
- **Existing suites:** `scripts/test-*.js` and `unit-*.mjs`.

## Android app 1.2.0 (uses API v2)

- Release only **after** this backend is live on `api.truehr.co.in`. The app now calls `/api/v2`, and the backend includes one small Android change: geo-tags keep the time they were captured.
- **Signing:** create `android/keystore.properties` and a release keystore, then build a signed `prodRelease` bundle for the Play Store. Without them the release APK is unsigned.
- **Old installs** keep using `/api` (v1) and keep working. Keep v1 running until most users have updated. Until then, old installs still block the account the moment a resignation is submitted, which is the old behaviour.
- **Building locally:** the repo has no Gradle wrapper. Use Android Studio, or the cached Gradle (`~/.gradle/wrapper/dists/gradle-8.11.1-bin/...`) with Android Studio's JBR as `JAVA_HOME`. The first release build needs network once, for `lint-gradle`.
- **Tests:**
  - `:app:testStagingDebugUnitTest` runs 44 unit tests.
  - `backend/scripts/v2/test-android.js` runs 24 server checks. It needs `seed_demo` on the database.
