// Support desk (org area, QA v2): per-organisation issue types, per-organisation
// ticket numbers, subject, assignment, a reply thread and the wider status set.
// Additive and idempotent; old code keeps working (new columns are nullable).
//
// The organisation that already uses the desk (the first one — TRUE HR) is
// seeded with EXACTLY the list the app showed before, so the v1 contract
// (Android) is unchanged: ADMIN keeps "Others" and IT has no "Other" type. The
// QA pass's consistency fixes ("Other" everywhere) are applied on v2 output
// only (supportController.v2Catalog). Every other organisation gets neutral
// defaults the first time its catalogue is read (supportController.ensureCatalog).

export const LEGACY = {
  HR: {
    attachment: true,
    types: ['HRMIS Update Request', 'Salary Slip', 'My Vision Login', 'Request to HR', 'Insurance', 'ESIC', 'PF', 'Other'],
    details: {},
  },
  IT: {
    attachment: false,
    types: ['IT Hardware', 'IT Software'],
    details: {
      'IT Hardware': ['Account Locked', 'Application Software', 'CCTV/DVR/Backup issue', 'Desktop', 'Email issue',
        'Hardware Issue', 'Headphones issue', 'Internet or VPN Client issue', 'Laptop', 'Others', 'Outlook configuration',
        'Printer Issue', 'Projector Issue', 'Server issue', 'Share Drive issue', 'System Installation', 'Tally Server Issue', 'Windows Installation'],
      'IT Software': ['Asset Management', 'Attendance Issue', 'Business Book', 'Calling Portal', 'Future Skills Portal',
        'HRMIS Portal', 'IGL Portal', 'Income Tax Portal', 'Invoice Portal', 'Just Job Portal/App', 'LearnCertify HUB',
        'Leave Issue', 'Live skills', 'MSIL Portal', 'My Vision India App', 'My Vision India Portal', 'NFA Portal',
        'NSDC BPO', 'Others', 'Payroll Portal', 'PMS-KPI Portal'],
    },
  },
  ADMIN: {
    attachment: false,
    types: ['Hygiene Issues', 'Others', 'Refreshment', 'Repair and Maintenance'],
    details: {
      'Hygiene Issues': ['Canteen', 'Cleaning', 'Wash Room', 'Water'],
      Others: ['Stationery', 'Suggestion'],
      Refreshment: ['Snacks/Lunch', 'Tea/Coffee'],
      'Repair and Maintenance': ['AC', 'Chair', 'DG', 'Doors', 'Fan', 'Furniture', 'Light', 'Seating Space', 'Switch & Socket', 'UPS', 'Work Station'],
    },
  },
};

export async function run(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_issue_types (
      id              BIGSERIAL PRIMARY KEY,
      organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      category        TEXT NOT NULL,                 -- HR | IT | ADMIN
      issue_type      TEXT NOT NULL,
      details         TEXT[] NOT NULL DEFAULT '{}',
      attachment      BOOLEAN NOT NULL DEFAULT true,
      active          BOOLEAN NOT NULL DEFAULT true,
      sort_order      INT NOT NULL DEFAULT 100,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_support_issue_type
      ON support_issue_types (organisation_id, category, lower(issue_type));

    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS organisation_id BIGINT REFERENCES organisations(id);
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS org_ticket_no   INT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS subject         TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_to     BIGINT REFERENCES user_accounts(id) ON DELETE SET NULL;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS support_ticket_comments (
      id              BIGSERIAL PRIMARY KEY,
      ticket_id       BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      author_user_id  BIGINT REFERENCES user_accounts(id) ON DELETE SET NULL,
      author_role     TEXT NOT NULL,                 -- STAFF | EMPLOYEE
      body            TEXT NOT NULL,
      event           TEXT,                          -- status change that came with it, if any
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_support_comments ON support_ticket_comments (ticket_id, created_at);
  `);

  // Organisation of every existing ticket, from its employee.
  await pool.query(`
    UPDATE support_tickets s SET organisation_id = e.organisation_id
      FROM employees e WHERE e.id = s.employee_id AND s.organisation_id IS NULL`);

  // Per-organisation numbers for tickets that have none, after any already given.
  await pool.query(`
    WITH base AS (
      SELECT organisation_id, COALESCE(MAX(org_ticket_no), 0) AS top
        FROM support_tickets WHERE organisation_id IS NOT NULL GROUP BY organisation_id
    ), numbered AS (
      SELECT s.id, b.top + ROW_NUMBER() OVER (PARTITION BY s.organisation_id ORDER BY s.applied_at, s.id) AS n
        FROM support_tickets s JOIN base b ON b.organisation_id = s.organisation_id
       WHERE s.org_ticket_no IS NULL
    )
    UPDATE support_tickets s SET org_ticket_no = numbered.n FROM numbered WHERE numbered.id = s.id`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_support_org_ticket_no
      ON support_tickets (organisation_id, org_ticket_no) WHERE organisation_id IS NOT NULL AND org_ticket_no IS NOT NULL`);

  // The existing organisation keeps its current list (seeded once).
  const first = (await pool.query(`SELECT id FROM organisations ORDER BY id LIMIT 1`)).rows[0];
  if (first) {
    // Repair a database seeded by the earlier draft of this migration, which
    // renamed ADMIN "Others" to "Other" and added IT "Other" in the stored list
    // (that leaked into v1). Only rows still exactly as that draft wrote them
    // are put back; anything HR has edited since is left alone. No-op on re-run.
    const fix = async (sql, params) => pool.query(sql, [first.id, ...params]);
    const prevIt = {
      'IT Hardware': [...LEGACY.IT.details['IT Hardware'].filter((x) => x !== 'Others'), 'Other'],
      'IT Software': [...LEGACY.IT.details['IT Software'].filter((x) => x !== 'Others'), 'Other'],
    };
    for (const [t, prev] of Object.entries(prevIt)) {
      await fix(`UPDATE support_issue_types SET details=$3 WHERE organisation_id=$1 AND category='IT' AND issue_type=$2 AND details=$4`,
        [t, LEGACY.IT.details[t], prev]);
    }
    await fix(`DELETE FROM support_issue_types WHERE organisation_id=$1 AND category='IT' AND issue_type='Other' AND details='{}'
                 AND NOT EXISTS (SELECT 1 FROM support_tickets st WHERE st.organisation_id=$1 AND st.category='IT' AND st.issue_type='Other')`, []);
    await fix(`UPDATE support_issue_types SET issue_type='Others', details=$2, sort_order=15
                WHERE organisation_id=$1 AND category='ADMIN' AND issue_type='Other' AND details=$3
                  AND NOT EXISTS (SELECT 1 FROM support_issue_types x WHERE x.organisation_id=$1 AND x.category='ADMIN' AND x.issue_type='Others')`,
      [LEGACY.ADMIN.details.Others, ['Stationery', 'Suggestion', 'Other']]);

    const has = (await pool.query(`SELECT 1 FROM support_issue_types WHERE organisation_id=$1 LIMIT 1`, [first.id])).rowCount;
    if (!has) {
      for (const [category, spec] of Object.entries(LEGACY)) {
        let i = 0;
        for (const t of spec.types) {
          i += 10;
          await pool.query(
            `INSERT INTO support_issue_types (organisation_id, category, issue_type, details, attachment, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
            [first.id, category, t, spec.details[t] || [], spec.attachment, i]);
        }
      }
    }
  }
}
