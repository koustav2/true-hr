# GreenHR-parity gap closure — backend

Branch: `feature/greenhr-parity-gaps`. **Additive only** — the NFA / expense suite
(nfa, settlements, reports, vendors) is untouched. Closes the six core-HR gaps found
when comparing TRUE HR against GreenHR (excluding NFA).

## What was added

| Gap (from the comparison) | New module | Key files |
|---|---|---|
| Statutory records + reports | PF/ESIC/Gratuity identifiers & nominations; PF register, ESIC register, Form-16 estimate | `controllers/statutoryController.js`, `services/docPdf.js` |
| Income-tax investment declaration | Employee submit → HR verify, old/new regime, section caps | `controllers/taxDeclarationController.js`, `services/incomeTax.js` |
| Full & Final settlement | Exit-pay compute (final salary, leave encashment, gratuity, notice recovery) + PDF | `controllers/fnfController.js`, `services/fnf.js` |
| Letters engine | 10 built-in letter types + custom templates, merge fields, issue+store+PDF | `controllers/letterController.js`, `services/letters.js` |
| Payroll compliance | Professional Tax by state + minimum-wage floor by skill; rate masters | `controllers/statutoryRatesController.js`, `services/statutoryRates.js` |
| Asset management | IT/non-IT asset register + assignment/return + ESS “my assets” | `controllers/assetController.js` |

10 new tables were appended to `backend/src/db/schema.sql` (all `CREATE TABLE IF NOT EXISTS`,
text+CHECK status columns — no enum migrations, nothing dropped).

## New API surface (all under `/api`)

```
Assets      GET/POST /admin/assets · PATCH /admin/assets/:id
            POST /admin/assets/:id/{assign,return} · GET /admin/employees/:employeeId/assets
            GET /me/assets · POST /me/assets/:id/acknowledge
Statutory   GET/PUT /admin/employees/:employeeId/statutory
            POST /admin/employees/:employeeId/statutory/nominees · DELETE /admin/statutory/nominees/:id
Reports     GET /admin/reports/pf-register · /esic-register · /form16/:employeeId   (?format=csv)
Rates       GET/POST /admin/statutory/pt-slabs · /min-wages · GET /admin/statutory/compliance-check
Tax decl    GET/POST /me/tax-declaration (+ /submit, /sections)
            GET /admin/tax-declarations(/:id) · POST /admin/tax-declarations/:id/verify
Letters     GET /admin/letters/types · POST /admin/letters/{templates,issue}
            GET /admin/letters/issued · /admin/letters/:id/pdf · GET /me/letters
F&F         POST /admin/fnf/preview/:employeeId · POST /admin/fnf/:employeeId
            POST /admin/fnf/:id/{finalise,paid} · GET /admin/fnf(/:id/pdf)
```

Admin routes are guarded by `requireAnyAdmin` (HR/IT/Super); ESS routes by `authenticate`.

## Verification done

- **44 pure-logic unit assertions pass** (run anywhere, no DB):
  `node scripts/unit-statutory.mjs unit-fnf.mjs unit-letters.mjs unit-incometax.mjs`
- Every new file passes `node --check`; the full route graph imports cleanly.
- **DB integration test** (needs PostgreSQL): `npm run migrate && node scripts/test-greenhr-gaps.js`

## Deliberate follow-ups (not in this pass)

1. **Wire PT-by-state into the payroll run.** `services/statutoryRates.js#professionalTax`
   is ready; the payroll compute still uses the fixed `professional_tax` on the structure.
   Swapping it in touches the core engine, so it was left as an explicit, tested opt-in.
2. **Web admin + ESS pages** for these endpoints (Next.js) — backend-first here.
3. **Register new module keys** (ASSETS/LETTERS/STATUTORY/TAX/FNF) in the roles registry
   so custom roles can grant them granularly (currently any-admin).
4. **Android** screens (sandbox cannot build Android).
5. Statutory rupee constants (PF 15k cap, ESIC 21k, tax slabs) are FY-dated defaults —
   confirm against the current year before go-live; all are admin-overridable.
