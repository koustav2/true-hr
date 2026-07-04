# Meeting Video Analysis — 27 June 2026 (GreenHR reference demos)

Frame-by-frame analysis of two silent Google Meet screen recordings (no audio track in either file). Both are demos of **GreenHR** (`visionindiaapp.in/MyVisionIndia`, footer "Vision India Services") plus its admin panel (`vispl.co.in/PMS`) — the client's reference HRMS. These are the systems whose features are being scoped for TrueHR.

| Recording | Duration | Presenter | Content |
|---|---|---|---|
| 12:15 PM (.mov) | 28:29 | Koustav (phone-screen mirror, Brave/Android, logged in as Debasish Panigrahi) | NFA create form, masters, approval trail, NFA Report, settlement |
| 8:56 PM (.mov) | 51:16 | Vinay Gupta (desktop, logged in as Vinay Kumar Gupta, Manager) | Dashboard, HR Induction, full PMS/KPI cycle, NFA deep-dive, admin PMS panel, vendors/agreements, settlement chains, E-Resignation menu |

Participants across the calls: Koustav (host), Debasish, Nishikanta Mohapatra, KP Muzik Xpress, Vinay Kumar / Vinay Gupta. Meet chat never used.

Detailed per-segment notes (all readable fields, dropdown values, table columns, timestamps): see `docs/video-notes/`.

---

## 1. NFA (Note For Approval) — expense / advance / purchase-request module

The dominant topic (~70% of total footage). Full lifecycle: **Create → multi-stage approval → Payment Released → Settlement → settlement approval → Close**, with a per-employee ledger.

### 1.1 Create NFA (employee self-service, `CreateNFA.aspx`)

Section **Project Details** — all fields mandatory:

| Field | Type / options observed |
|---|---|
| NFA Raise For | Expense / Purchase Request |
| Business Operation | 14 options: Advisory Services, BPO, Corporate, CSR Initiative, Infra Set Up & Support, IT/Software, KPO, Managed Services, O&M, Skilling, Sourcing, Staffing, Training & Development |
| Cost to Company | 12 group legal entities (Vision India, Sapling Global, North Star, Vision India Talent Foundation, …) |
| Select Project | Filtered by Business Operation (Skilling → PMKVY, DDU-GKY, RPL, PLTP, Saksham Phase-2, PM Vishwakarma, NUA Odisha, Suryamitra, …) |
| Expense Category | Context-dependent (~17 categories: General Administrative, Skill Project, IT Infra, IT Software, HR, Marketing & Branding, Asset Procurement, Banking & Finance, Charitable Activity, …) |
| Cost Approval Zone | Corporate / North Star / South-East / North-West |
| Location | Large master: cities + office codes (A-11 Noida) + project centers (DDUGKY-Hooghly) + special "Client-Side" |
| Client/Vendor Name | Single huge searchable client+vendor master |
| Select Month | Jan–Dec (month the expense pertains to) |
| Payment Type | Advance for self / Advance for Vendor / Reimbursement for self / Reimbursement for Vendor / PPS for Candidate / Incentive Payment |
| Billable Type | Non-billable from client / Billable from client / Billable from Partner |
| Settlement Date | Default = today + 7 days, editable |

Conditional: **Billable from client** adds Select Type (Billed / To be billed), Invoice Date, Invoice Amount, "Do you have payment date?", Expected Date of Payment.

**Auto-derived approval chain** displayed read-only on the form — Reporting Manager, Project Leader, Finance, Business Leader — resolved from a project + expense-category + zone matrix; changing category clears/repopulates the names.

**Line items ("Add Headers")**: Expense Header → Sub Header (cascading), NFA Amount + Logistic Amount = Total per line; + Add builds a grid (Delete | SNo | Sub Header | Expense Header | NFA Amount | Logistic Amount | Total); auto Total NFA / Total Logistic / Grand Total. Then NFA Purpose*, NFA Description, Upload Reference Attachment, Priority (High/Medium/Low), Submit. NFA Code auto-generated `NFA<year><seq>` (e.g. NFA20263892).

Expense master is a 3-level hierarchy (Category → Header → SubHeader, ~17 categories / 200+ subheaders) maintained in Excel and downloadable from the form ("Download Expense Header").

### 1.2 Approval workflow

Chain observed on `ApproveNFARPt.aspx` (Approval/Remarks table, in order):

1. Reporting Manager → 2. Finance Initiator → 3. Project Leader → 4. Business Leader → 5. Finance → 6. Final Approval (CEO/Director)

Each stage records name, status, remarks, date. Approver actions: **Approve / Query-Hold / Reject / Edit** + remarks + Download Attachment. Statuses seen: Pending, "Query Raised By: Reporting", Payment Released, CEO Approved-Payment Release, Finance Rejected-\<name\>, Finance Initiator Rejected. Approvers have a pending queue (`ViewNFARptApproval.aspx`) with date/status/location/employee filters + Export Excel. Approver can **edit** the NFA (`UpdateNFANew.aspx`) — everything editable, mandatory "NFA Update Remark".

### 1.3 Settlement cycle

- NFA Status and Settlement Status are separate (Payment Released vs Pending / In Progress / Close).
- After payment release, employee must "Submit Your Settlement"; **system auto-rejects stale settlements** and requires resubmission (banner on NFA Report).
- Settlement has its own 6-stage approval chain: **Reporting Manager → Functional Head → Admin → Finance → Director → NFA Closer**, each with approver/status/remarks/date (`NFASettlementStatus.aspx`, ~30 columns).
- **Show Ledger**: per-employee FY ledger — NFAs raised (87) / payments released (70) / settled (68); amount received ₹811,805 vs settled ₹801,119 vs balance ₹10,686 to be settled.

### 1.4 Admin panel (`vispl.co.in/PMS`, reached from GreenHR via tokenized "New NFA Link")

- Sidebar: Dashboard, My Projects, Project Details-NFA, NFA, NFA Report, Master (Location, Measurement), Vendor/Agreements (Approve Agreements, Vendor List, Vendor Registration).
- Dashboard KPIs: Running 136 / Completed / Total projects; Project Leader 35, Business Leader 18; FY totals — NFA Raised 21,586 / Approved 16,110 / Payment Released 15,751.
- View NFA admin queue: rich filters (dates, location, entity, client, status, type + employee/NFA-code search), "Guidelines For Financial Initiator", Export Excel.
- Reports: NFA Report, NFA Settlement, **Project Wise Expense** (Category → Header → SubHeader rollup per project/location), Client Billing Report.

### 1.5 Vendors & agreements

- **Vendor Registration**: statutory fields each with value + document upload — PAN, GST, ESIC, PF, MSMED, NSIC/SSI, company support docs; addresses (HO/branch/plant), nature of business, contacts; Export Excel; admin approval.
- **Agreements**: Upload Agreement (Project, Location, Client, Details, Type=RENT, Start/End dates, scanned copy); register with download + CreatedBy/On; admin "Approve Agreements".

---

## 2. PMS / KPI module (monthly performance cycle)

1. **Create KPI** monthly (`Create_Kpi.aspx`): KRA rows (description, weightage % summing to 100 under "BUSINESS"), measurement parameter bands per row (e.g. "90–104% → 3, 105–119% → 4, 120%+ → 5"; bands vary per role), Copy Previous KPI option, Download KPI.
2. **RM approves KPI** (`PendingKPINew.aspx` / `RptMgr_KPI_Approval.aspx`): actions Approve KPI / **Discuss** / Download; submit date and approval date both tracked → KPI Status: RM Approval Pending → Locked.
3. **Employee submits PMS** self-assessment monthly (Submit/Edit PMS): per-KRA MTD Target vs MTD Achieved, Self Rating + Remarks → PMS Status: Not Submitted → Approval Pending → Functional Approved.
4. **Final PMS Rating** (`ViewPMS.aspx`) — 4-level chain: **Matrix Manager → Reporting Manager → Functional Manager → HR**, each with PLI Rating (color-coded band), PLI %, Remarks; **system auto-bypasses missing levels** ("System By-Pass Matrix Manager Not Available"). Manager rating grid alongside self rating.
5. Grade ladder (published PDF): OAT-5 ≥120% / SAT-4 105–119% / AT-3 90–104% / BT-2 60–89% / SBT-1 ≤59%.
6. PMS Dashboard tiles: My Performance, Team KPI, Team PMS, Promotion Recommendation, Skill & Employment Ecosystem (Self/Manager/Functional), Team Member.
7. Employee dashboard shows a 12-month performance strip: Good & Consistent / Average / Below Average / Not Available / Pending, with Pending-HR / Pending-RPT stage chips.

---

## 3. Employee dashboard & other modules seen

- **Dashboard** (`UserDashboard.aspx`): tiles HR Induction, My Profile, Attendance, Leave, Support, COC/Emp. Undertaking, PMS, Feedback; quick buttons My Asset Details, Download Salary Slip, Tax Management, PM Vishwakarma Reg.; June attendance calendar (Present / Leave-OD / Absent / Week Off / Sick Leave); monthly performance strip; **policies & formats download library** (Variable Pay, Holiday Calendar, Leave, R&R, Star of the Month form, Local/Domestic Conveyance, Reimbursement Form, Longevity Award, Transfer & Deputation).
- **HR Induction**: multi-language induction videos (Choose Language + Proceed), mandatory watch-all with per-video checkbox, HR contact, feedback box.
- **E-Resignation** (under FullandFinal): three views — self, Team, Functional; earlier check of this video also showed a resignation form with employee details (code, vertical, notice period 30 days, resignation/last-working dates, reason) and a 6-stage approval table (Reporting Manager, Functional Head, IT Infra, Office Admin, Finance, Human Resource — each with named approver, email, date, status, remarks).
- Sidebar modules present but not demoed: Self HRMIS, JustJob, eTask Manager, Investment Declaration, Business COC/Undertaking, Offer Request, PM Vishwakarma Reg., Upload Rent Agreement.

---

## 4. Gap analysis vs current TrueHR

| GreenHR capability | TrueHR today | Gap |
|---|---|---|
| NFA expense/advance module (create, approve, settle, ledger) | Not present | **New module — largest work item** |
| 3-level expense master (Category→Header→SubHeader) + entity/project/zone/client masters | Not present | New masters + admin CRUD |
| Configurable multi-stage approval chains (6-stage NFA, 6-stage settlement, auto-derived approvers, bypass missing levels, Query/Hold) | Single-step manager/HR reviews | New generic approval-chain engine |
| PMS/KPI monthly cycle with ratings, PLI %, grades | Not present | New module |
| Vendor registration + agreements repository | Not present | New module |
| Settlement auto-reject timer | n/a | Scheduled job |
| Admin analytics (NFA rollups, project-wise expense, client billing) | Basic dashboard stats | New reports + Export Excel |
| E-Resignation multi-stage (6 approvers) | Resignation with team review exists | Extend approval chain |
| Investment Declaration, Tax Management, Asset Details, HR Induction videos, Feedback | Not present | Optional scope — confirm with client |
| Attendance calendar, leave, payroll slips, policies, support desk | Already built in TrueHR | Parity (TrueHR mostly richer) |

## 5. Reference-app pain points to avoid in TrueHR

Full-page blocking "Please wait… do not click back" spinners on every dropdown change (server postbacks); slow loads/blank pages; duplicate and junk vendor master entries ("testing", duplicate Schneider rows); typos in labels ("Bussiness Leader", "Expence Header", "Expanses"); Excel-maintained masters instead of in-app admin; no async UX. TrueHR should use client-side cascading data, searchable selects, deduped masters, and background processing.

---

*Analysis method: ~480 frames sampled at 10-second intervals across both videos (plus full-resolution zoom crops), deduplicated and reviewed frame-by-frame. Neither file contains an audio stream, so spoken discussion could not be transcribed.*
