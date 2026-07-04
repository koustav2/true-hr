# VIDEO 1 — Segment 900s–1709s (15:00 – 28:29) — GreenHR demo notes

Source: silent Google Meet screen recording; presenter shares a PHONE screen mirror (Android, Brave browser) showing GreenHR at `visionindiaapp.in`. Meet room: meet.google.com/sxm-axsh-ewx. Wall clock in Meet UI runs 12:30 PM – 12:43 PM during this segment; phone shows an ongoing voice call timer (~20:55 → ~33:10), battery 58%→56%.

## Participants (Meet "People" panel open throughout)
- Koustav — meeting host, PRESENTING (phone mirror is his), hand raised in "Raised hands (1)"
- Nishikanta Mohapatra
- Debasish (tile "D"; the GreenHR account used in the demo is **Debasish Panigrahi**)
- KP Muzik Xpress
- Vinay Kumar
- 6 participants total; "Contributors 6" section listed. No Meet chat opened in this segment.

The ENTIRE segment is a walkthrough of GreenHR's **NFA (Note For Approval) / expense-advance module**: raising an NFA, its approval trail, the Reporting Manager view, and the employee NFA Report / settlement screen.

---

## 15:00–19:50 (900–1190, Meet 12:30–12:35) — "Create NFA" form, variant: Advance for self + Non-billable from client

App page: GreenHR NFA creation form (employee self-service). Form section shown mid-scroll with these fields (zoom at 905s, phone 12:30):

- **Select Month:** * = June (dropdown)
- **Payment Type:** * = Advance for self (dropdown)
- **Select Billable Type:** * = Non-billable from client (dropdown)
- **Settlement Date:** * = 04/07/2026 (date)
- **Reporting Manager:** Tapan Kumar Karua (auto-filled, read-only)
- **Project Leader:** Navneet Nigam (auto-filled)
- **Finance:** Balwant Prasad Singh (auto-filled)
- **Bussiness Leader:** [sic] Amit Pahuja (auto-filled)

### "Add Headers" block (expense line-item entry)
- **Expense Header:** dropdown — options seen when opened (~17:30 / 1050s, zoom confirmed):
  - Select / **General Category Expense** / **Miscellaneous Exp.** / **PMJJBY & PMSBY Insurance** / **Skill Project Expanses** [sic] / **Training Partner Cost**
- **Sub Header:** * dropdown — options under "Skill Project Expanses" (~17:45 / 1066s, zoom confirmed):
  - Select / **Accreditation and Affiliation Cost** / **Batch Assessment Cost** / **Boarding & Lodging For Candidates** / **Book Expenses** / **Dress and uniform expenses** / **Incentive Expenses** / **Legal Fees** / **Mobilization Expenses** / **OTTC Expense** / **Post placement support (PPS)** / **Training complete candidates refreshment**
- **NFA Amount:** * (numeric; presenter typed 20000 via phone numeric keypad ~12:33)
- **Logistic Amount:** * (typed 100; in one pass 500)
- **Total Amount:** * (auto = NFA + Logistic, e.g. 20100 / 20500)
- **+ Add** button → appends line to "Headers Details" table

### "Headers Details" table (added line items)
Columns: **Delete | SNo | Sub Header | Expence Header [sic] | NFA Amount | Logistic Amount | Total Amount**
Row example: Delete | 1 | Dress and uniform expenses | Skill Project Expanses | 20000 | 100 | 20100

### Totals + submission fields (below table; zoom at 1230s)
- **Total NFA Amount:** * (auto, 20000)
- **Total Logistic Amount:** * (auto, 100)
- **Grand Total:** * (auto, 20100)
- **NFA Purpose:** * (text, placeholder "Purpose")
- **NFA Description:** (text, placeholder "Item Description")
- **Upload Reference Attachment:** (Choose file | No file chosen)
- **Priority Level:** * (dropdown; "High" selected)
- **Submit** button (pink/magenta)

~19:50 (1190s): after scrolling back to top, the same form's **"Project Details"** header section is visible (details fully read at 22:10 zoom, identical values — see below).

---

## 20:00–21:30 (1200–1290, Meet 12:35–12:36) — Form top ("Project Details") + billable variant

GreenHR page header: **GreenHR** logo, hamburger menu, user avatar dropdown, **Log Out** button, link **"Download Expense Header"** (downloads the expense-header master list).

### "Project Details" section (zoom at 1330s; same values at 1230s)
- **NFA Raise For:** * = Expense (dropdown)
- **Business Operation:** * = Skilling (dropdown)
- **Cost to Company:** * = Vision India (dropdown = paying group entity)
- **Select Project:** * = PLTP (dropdown)
- **Expense Category:** * = Skill Project Expenses (dropdown)
- **Cost Approval Zone:** * = South-East (dropdown)
- **Location:** * = Bhadrak (dropdown)
- **Client/Vendor Name:** * = Odisha Skill Development Authority (dropdown)
- **Select Month:** * = June
- **Payment Type:** * = Advance for self
- **Select Billable Type:** * = (continues below)

### Billable-from-client variant (~21:30 / 1290s, zoom confirmed) — extra conditional fields appear
When **Select Billable Type = "Billable from client"**, form adds:
- **Select Type:** * dropdown = options **Select / Billed / To be billed** (dropdown opened ~12:36, 1250s)
- **Invoice Date:** * (DD/MM/YYYY) — shown when "Billed"
- **Invoice Amount:** *
- **Do you have payment date? :** * (Select dropdown)
- **Expected Date of Payment:** * (DD/MM/YYYY; date-picker calendar opened at ~1290s)
- **Settlement Date:** * = 04/07/2026
Then same auto-filled approver chain (Reporting Manager / Project Leader / Finance / Bussiness Leader) and Add Headers block.

~12:36 (1260s): full-screen loader while submitting/reloading: spinner + red text **"Please wait... Do not click the back button or close this browser tab."**

---

## 22:00–22:30 (1320–1350, Meet 12:37) — Main navigation sidebar (hamburger menu)

Sidebar (dark green), user **Debasish Panigrahi** with photo. Menu items (zoom at 1335s & 1370s):
- **Dashboard**
- **Self HRMIS**
- **JustJob**
- **eTask Manager**
- **NFA** (expandable; expanded shows sub-items):
  - **NFA** (create)
  - **View NFA (Rpt Mgr)**
  - **Update Settlement**
  - **Upload Rent Agreement**
  - **Vendor Registration**
- **Investment Declaration**
- **Business COC / Undertaking** (expandable)
- **E-Resignation** (expandable)
- **Offer Request**
- **PM Vishwakarma Reg.**
Below sidebar: link "Download Expense Header".

---

## 22:30–23:00 (1350–1380, Meet 12:37) — "NFA Details (Reporting Manager)" screen (approver search view)

Opened from NFA > View NFA (Rpt Mgr). Title: **NFA Details (Reporting Manager)** + **Export Excel** button (green). Filter fields (zoom 1340/1350):
- **From Date:** * = 27/06/2026
- **To Date:** * = 27/06/2026
- **NFA Status:** * dropdown (values seen: Select; Pending)
- **Location:** dropdown (Select Location; "Agra" seen selected)
- **Employee Code:** (text)
- **Submit** button
Results panel: **Details** — "No Data found for the criteria you selected."
Footer: "2023 © All Rights Reserved - Vision India Services". (Chrome "Translate page? Hindi to English" toast visible.)

---

## 23:10 (1390, Meet 12:38) — Single NFA detail view (read-only, with approval trail)

Scrolled detail of an existing NFA (zoom confirmed):
- **Payment Type:** Reimbursement for Vendor
- **Billed/To be Billed:** To be billed
- **Expected Date of Payment:** 10/03/2026
- **NFA Settlement date:** 20/03/2026
- **Item Description:** "Kindly Approve The Food Bill For The Period ..."

**Expense Details** table: columns **S.No | Expense Header | Sub Header** → row: 1 | Fooding Expense | "Catering costs for business events, parties, or train..."
Amount strip: **NFA Amount: 200121 | Logistic Amount: 0 | Total Amount: 2001..** (truncated)

**Approval / Remarks** table: columns **Status | Approved / Reject Remarks** — 6 sequential approval rows (multi-level approval chain):
1. Approved — "Approved as per email approval received from Navneet Sir"
2. Approved — "Approved as per tax invoice"
3. Approved — "OK"
4. Approved — "ok"
5. Approved — "recomended for approval" [sic]
6. Approved — "ok"

Below: **Remarks:** input, **Download Attachment** link.
→ Requirement signal: NFA passes through ~6 approval stages (RM → Project Leader → Finance → Business Leader → CEO → payout), each with remarks; attachments downloadable.

---

## 23:40–25:30 (1420–1530, Meet 12:39–12:41) — "NFA Report" screen (employee's own NFA list + settlement)

Title: **NFA Report**. Action buttons across top: **Check/Update Settlement** (pink) | **Create NFA** (pink) | **Export Excel** (green).
Highlighted note: *"Please submit your settlement. If it has already been submitted, please check its status. If it has been auto-rejected by the system, then please resubmit your settlement."* → settlement can be **auto-rejected by the system** (timeout rule) and must be resubmitted.

Filters: **Year:** 2026 (dropdown), **Month:** All (dropdown), **Submit**.

**View Details** table: columns **Action | View NFA | Sno | NFA Status**
- Action column: blank for most rows; **"Submit Your Settlement"** link on rows 7 and 13 (advance taken, settlement pending)
- View NFA: "View NFA" link per row (17 rows visible)
- NFA Status values observed:
  - **Payment Released** (majority)
  - **CEO Approved - Payment Releas...** (row 4)
  - **Finance Rejected-Balwant Pras...** (rows 16, 17 — rejection status carries rejecting person's name)

---

## 25:30–28:29 (1530–1709, Meet 12:41–12:43 end) — Fresh blank NFA form; master dropdowns; cascading reloads

Presenter opens **Create NFA** again — blank form (zoom 1560s):
- NFA Raise For: Expense | Business Operation: Select | Cost to Company: Select | Select Project: Select | Expense Category: Select Category | Cost Approval Zone: Select | Location: Select Location | Client/Vendor Name: Select Client | Select Month: Select Month | Payment Type: Select | Select Billable Type: Select | Settlement Date: 04/07/2026 (pre-filled) | Reporting Manager: Tapan Kumar Karua (pre-filled) | Project Leader/Finance/Business Leader: blank until project chosen | Add Headers (Expense Header / Sub Header)

**Cost to Company dropdown** opened (~27:10 / 1630s) — group-entity master list:
- Select / **Green Call Technology Private Limited** / **Live Skills Global** / **North Star** / **North Star Techno Services Pvt. Ltd.** / **Prapyam India Pvt Ltd** / **Sajawon Communication Pvt Ltd** / **Sapling Global** / **Skillvisa International Pvt Ltd** / **Vaankargha Pvt Ltd** / **Vision India** / **Vision India Talent Foundation**

**Business Operation** changed to **IT / Software** (vs earlier "Skilling") with Cost to Company = Vision India (~27:20 / 1640s) → dependent dropdowns (Project, Expense Category, Zone, Location, Client) reload with **"Please wait... Do not click the back button or close this browser tab."** spinner → dropdown contents are **cascading, driven by Business Operation + Cost to Company selection**.

Segment (and video) ends ~12:43 with this blank/reloading Create NFA form on screen.

---

## Key requirement takeaways from this segment
1. **NFA (expense/advance approval) module** is central: create NFA, multi-line expense headers, multi-level approval trail with remarks, payment release, then **settlement** cycle (submit settlement after advance; auto-reject + resubmit logic).
2. **Master-data driven cascading dropdowns**: Business Operation → Cost to Company (12 group entities) → Project → Expense Category → Cost Approval Zone → Location → Client/Vendor; Expense Header → Sub Header masters (downloadable via "Download Expense Header").
3. **Payment Type variants** alter the form: Advance for self vs Reimbursement for Vendor; Billable type (Billable from client / Non-billable from client) adds Billed/To-be-billed, Invoice Date/Amount, payment-date fields.
4. **Auto-derived approver chain** displayed on the form: Reporting Manager, Project Leader, Finance, Business Leader (named individuals), plus CEO stage seen in statuses.
5. **Statuses**: Pending, Payment Released, CEO Approved-Payment Release, Finance Rejected-<name>; approver-facing report (NFA Details for Reporting Manager) and employee-facing NFA Report, both with **Export Excel**.
6. Sidebar reveals wider product scope for reference: Dashboard, Self HRMIS, JustJob, eTask Manager, NFA (+ Update Settlement, Upload Rent Agreement, Vendor Registration), Investment Declaration, Business COC/Undertaking, E-Resignation, Offer Request, PM Vishwakarma Reg.
7. Mobile-web usage is a real scenario (whole demo done from a phone browser, responsive layout).
