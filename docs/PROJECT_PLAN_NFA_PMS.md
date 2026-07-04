# TrueHR — Build Plan: NFA, PMS & Extended Approvals

**Source:** client reference demos of GreenHR, 27 June 2026 (see `MEETING_VIDEO_ANALYSIS_2026-06-27.md` + `docs/video-notes/`).
**Scope:** full phased plan. **Platforms per phase:** Backend (Express/PostgreSQL) + Web admin (Next.js) + Android (Compose) together.
**Conventions:** follow existing patterns — tables in `backend/src/db/schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`, migrate.js applies on boot), one controller per module + registration in `routes/index.js`, web pages under `web/app/admin/*`, Android feature screens under `presentation/feature/` with Hilt VM + Retrofit DTOs + repository.

---

## Phase 0 — Shared foundation: generic approval-chain engine (~1 week)

Everything the client showed (NFA 6-stage, settlement 6-stage, resignation 6-stage, PMS 4-level) is the same pattern. Build it once.

**Schema**
- `approval_flows` (id, code e.g. `NFA`, `NFA_SETTLEMENT`, `RESIGNATION`, name, active)
- `approval_flow_stages` (flow_id, seq, role_key e.g. REPORTING_MANAGER / FINANCE_INITIATOR / PROJECT_LEADER / BUSINESS_LEADER / FINANCE / FINAL_APPROVAL, resolver_type: `manager_chain` | `named_user` | `matrix`, optional_bypass boolean)
- `approval_instances` (flow_id, subject_type, subject_id, status, current_stage_seq)
- `approval_actions` (instance_id, stage_seq, approver_employee_id, action: APPROVED / REJECTED / QUERY_HOLD / BYPASSED, remarks, acted_at)
- `approver_matrix` (project_id, expense_category_id, zone_id → project_leader_id, finance_id, business_leader_id, finance_initiator_id, final_approver_id) — powers GreenHR's auto-derived approver names.

**Behavior**
- Resolve full chain at submission; display read-only on create forms (like GreenHR).
- Auto-**bypass** stages whose approver can't be resolved (GreenHR: "System By-Pass Matrix Manager Not Available") — record BYPASSED action.
- `QUERY_HOLD` returns the item to the raiser with a query status ("Query Raised By: <role>"); resubmission resumes at stage 1 or the querying stage (decide: querying stage).
- Rejection stamps rejecting role+name into subject status (GreenHR shows "Finance Rejected-<name>").
- Every action → `audit_log`.

**API** `GET /api/approvals/pending` (per-user queue across flows), `POST /api/approvals/:instanceId/act` (approve/reject/query + remarks), `GET /api/approvals/:instanceId` (trail).

**Verification:** unit-style script seeding a 6-stage flow and walking approve/query/reject/bypass paths.

---

## Phase 1 — Masters & admin CRUD (~1 week)

New masters demoed (all searchable, deduped, in-app managed — not Excel):

- `business_operations` (14 values), `group_companies` (cost-to-company entities), `cost_zones`, `projects` (linked to business_operation + company), `office_locations` (city/office-code/center + special "Client-Side"), `clients_vendors` (unified master, type flag)
- Expense hierarchy: `expense_categories` → `expense_headers` → `expense_subheaders` (3 levels, ~17/50/200+ rows). Seed from the client's "Expanse-Header-NFA" Excel (ask client for the file; structure fully captured in video notes).
- `vendor_registrations` (statutory: PAN/GST/ESIC/PF/MSMED/NSIC each value + document upload; addresses, contacts; admin approve) and `agreements` (project, location, client, type e.g. RENT, start/end, scanned copy, approve + register).

**Web:** `admin/masters` page group (DataTable CRUD per master, CSV import/export for hierarchy). **API:** `GET /api/meta/nfa-masters` cascade endpoint (operation → projects, categories; category → headers → subheaders) so clients cascade **without page reloads** (fix GreenHR's postback pain). **Android:** none (masters consumed read-only via meta endpoint).

---

## Phase 2 — NFA module core: create + approve + pay (~2–3 weeks) ← biggest item

**Schema**
- `nfas` (nfa_code `NFA<year><seq>` via sequence, employee_id, raise_for Expense/PurchaseRequest, business_operation_id, company_id, project_id, expense_category_id, zone_id, location_id, client_vendor_id, month, payment_type enum [ADVANCE_SELF, ADVANCE_VENDOR, REIMB_SELF, REIMB_VENDOR, PPS_CANDIDATE, INCENTIVE], billable_type enum [NON_BILLABLE, BILLABLE_CLIENT, BILLABLE_PARTNER], billed_state Billed/ToBeBilled, invoice_date, invoice_amount, expected_payment_date, settlement_due_date default +7d, purpose, description, priority H/M/L, attachment doc_id, status, approval_instance_id)
- `nfa_lines` (nfa_id, header_id, subheader_id, nfa_amount, logistic_amount, total generated) + totals computed server-side
- Status values: DRAFT? (skip — direct submit), PENDING, QUERY_<role>, REJECTED_<role>, APPROVED, PAYMENT_RELEASED

**Rules**
- Conditional fields when billable-from-client (invoice block) — validate server-side.
- Approver chain resolved from `approver_matrix` at submit; shown on form beforehand via `GET /api/nfa/approvers?project=&category=&zone=`.
- Finance stage gets a "Release Payment" action → status PAYMENT_RELEASED, opens settlement window.
- Per-employee **ledger** endpoint: FY counts (raised/released/settled) + amounts (received/settled/balance).

**API** (`nfaController.js`): create, list mine (year/month filters), detail + trail, approver queue, act, update-by-approver (mandatory update remark, audited), release payment, ledger, Excel export (reuse existing export util or add `exceljs`).

**Web admin:** `admin/nfa` — queue (filters like GreenHR: date range, location, entity, client, status, type, search by emp/NFA code), detail with chain + Approve/Query/Reject/Edit, reports tab (see Phase 4), masters links.

**Android:** NFA hub tile → Create NFA (cascading selects, line-item grid with running totals, attachment via existing camera/file flow), My NFAs list (dual status chips), NFA detail + trail, approver inbox (managers see team NFAs; same review pattern as leave/OD screens).

---

## Phase 3 — Settlement cycle (~1–1.5 weeks)

- `nfa_settlements` (nfa_id, amount, docs, raised_at, status PENDING / IN_PROGRESS / CLOSED / AUTO_REJECTED, approval_instance_id) with its own 6-stage flow: RPT_MGR → FUNCTIONAL_HEAD → ADMIN → FINANCE → DIRECTOR → CLOSER.
- **Auto-reject job**: daily cron (node-cron, or reuse email-worker loop) — settlements not submitted by `settlement_due_date` + grace get AUTO_REJECTED; employee must resubmit (banner in app, like GreenHR's notice).
- Employee: "Submit Your Settlement" action on released NFAs (amount + expense proof docs), settlement status report.
- Web: settlement approval queue + Approved/Rejected Settlement report (year/month filter, Excel export).
- Android: submit settlement screen + settlement status list.

---

## Phase 4 — Admin analytics & reports (~1 week)

- Dashboard cards: FY NFA raised/approved/released counts + amounts, pending by stage.
- **Project-wise expense** rollup (Company → Project → Category → Header → SubHeader, date range) — single SQL GROUP BY report.
- Client billing report (billable NFAs by client, billed vs to-be-billed).
- All reports: filterable + Export Excel. Web only.

---

## Phase 5 — PMS / KPI module (~2–3 weeks)

**Schema**
- `kpis` (employee_id, year, month, status DRAFT / RM_PENDING / LOCKED / DISCUSS, submitted_at, approved_at) + `kpi_kras` (kpi_id, description, weightage %, measurement_bands jsonb e.g. `[{min:90,max:104,rating:3},...]`) — weightages must sum to 100; "Copy Previous KPI" endpoint.
- `pms_submissions` (kpi_id, status NOT_SUBMITTED / APPROVAL_PENDING / FUNCTIONAL_APPROVED, self ratings per KRA: mtd_target, mtd_achieved, self_rating, self_remarks; mgr_rating, mgr_remarks)
- `pms_final_ratings` (submission_id; per level MATRIX / REPORTING / FUNCTIONAL / HR: pli_rating band, pli_pct, remarks, bypassed flag) — reuse approval engine with 4-level flow + bypass.
- Grade config table (OAT-5 ≥120 … SBT-1 ≤59) + rating-band colors.

**Flows:** employee creates monthly KPI → RM Approve/Discuss (Discuss = query-hold) → locked → employee submits PMS self-assessment → rating chain → final grade; monthly dashboard strip (Pending-HR / Pending-RPT / band colors).

**Web:** `admin/pms` — team KPI queue, PMS approval queue, final-rating form, promotion recommendation list (flag on consistently high grades), grade-system config. **Android:** My Performance (year list like GreenHR's MyKpi), Create/Edit KPI, Submit PMS, Team KPI/PMS approval screens, dashboard performance strip.

---

## Phase 6 — Extended E-Resignation + polish (~1 week)

- Migrate existing resignation review to the approval engine with the 6-stage chain (RM, Functional Head, IT Infra, Office Admin, Finance, HR) — each stage named person + email + status + remarks + date, as in the demo.
- Add clearance-ish stage semantics (IT Infra / Office Admin act as clearances).
- Dashboard additions: pending-approvals card includes NFA/PMS/settlement counts; Android dashboard tiles for NFA and PMS.

**Deferred / confirm with client:** HR Induction videos, Investment Declaration, Tax Management, My Asset Details, Feedback, JustJob/eTask analogs, Offer Request, PM Vishwakarma — not planned unless client confirms scope.

---

## Cross-cutting decisions

1. **No postback UX** — all cascades from one meta endpoint, cached client-side; searchable selects (web: existing DataTable/select components; Android: dropdown with search).
2. **Money as NUMERIC(14,2)**, computed totals server-side; never trust client totals.
3. **Excel export** standardized via one util (add `exceljs` to backend).
4. **Documents** reuse existing `documents` table + upload flow.
5. **Notifications**: reuse email queue — notify next approver on each stage transition, raiser on reject/query/release.
6. **Audit**: every approval action, approver-edit, auto-reject → `audit_log`.
7. **Seeding**: request from client — expense-hierarchy Excel, entity/project/zone lists, approver matrix. Blocker for UAT, not for build.

## Timeline (single dev, sequential)

| Phase | Weeks | Cumulative |
|---|---|---|
| 0 Approval engine | 1 | 1 |
| 1 Masters | 1 | 2 |
| 2 NFA core | 2.5 | 4.5 |
| 3 Settlements | 1.5 | 6 |
| 4 Reports | 1 | 7 |
| 5 PMS/KPI | 2.5 | 9.5 |
| 6 E-Resignation ext + polish | 1 | 10.5 |

~10–11 weeks total; NFA usable end-to-end (raise → approve → pay → settle) after ~6 weeks.

## Open questions for the client

1. Query-Hold resume point: restart chain or resume at querying stage?
2. Who maintains the approver matrix — HR admin UI or config per project?
3. Settlement auto-reject grace period (GreenHR's exact timer unknown — no audio in recordings).
4. Are Purchase Request NFAs identical in flow or do they need a PO/asset link?
5. PLI % → payroll: should PMS PLI feed TrueHR payroll compute engine?
6. Which deferred modules (Induction, Investment Declaration, Assets…) are actually in scope?
