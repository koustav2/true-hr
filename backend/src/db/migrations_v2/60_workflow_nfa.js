// Workflow / NFA & approvals (QA v2). Additive and idempotent.
//
//  1. Approval actions record WHO acted (user + name) and whether it was an HR
//     override, so an override is never shown under the stage approver (C32).
//  2. Per-organisation NFA numbering (C46/E28): a counter per (org, year). The
//     organisation that already owns the legacy NFA numbers keeps the plain
//     NFA<year><nnnn> format and continues from the old global counter; every
//     other organisation gets its own series prefixed with its code
//     (e.g. ACME-NFA20260001), so numbers never collide across tenants.
//  3. NFA attachments (bills, invoices, quotations, reimbursement form, query
//     replies) and purchase-request item fields (E25/E26/C32).
//  4. H111 data repair: a master that is used only by one organisation's NFAs /
//     approver rows / agreements, and is either ownerless or not used at all by
//     its current owner, is handed to the organisation that uses it — unless
//     that organisation already has a master with the same name.
export async function run(pool) {
  await pool.query(`
    ALTER TABLE approval_instance_stages ADD COLUMN IF NOT EXISTS acted_by_user_id BIGINT;
    ALTER TABLE approval_instance_stages ADD COLUMN IF NOT EXISTS acted_by_name TEXT;
    ALTER TABLE approval_instance_stages ADD COLUMN IF NOT EXISTS is_override BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE approval_actions ADD COLUMN IF NOT EXISTS actor_user_id BIGINT;
    ALTER TABLE approval_actions ADD COLUMN IF NOT EXISTS actor_name TEXT;
    ALTER TABLE approval_actions ADD COLUMN IF NOT EXISTS is_override BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS nfa_org_seq (
      organisation_id BIGINT NOT NULL,
      year            INT NOT NULL,
      last_value      BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (organisation_id, year)
    );
    -- prefix '' = plain legacy format. No row = use the organisation's code.
    CREATE TABLE IF NOT EXISTS nfa_code_format (
      organisation_id BIGINT PRIMARY KEY,
      prefix          TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS nfa_documents (
      id          BIGSERIAL PRIMARY KEY,
      nfa_id      BIGINT NOT NULL REFERENCES nfas(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL DEFAULT 'BILL',  -- BILL | INVOICE | QUOTATION | REIMBURSEMENT_FORM | QUERY_REPLY | OTHER
      document    TEXT NOT NULL,
      mime        TEXT,
      filename    TEXT,
      uploaded_by BIGINT REFERENCES employees(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_nfa_documents_nfa ON nfa_documents (nfa_id);

    ALTER TABLE nfa_lines ADD COLUMN IF NOT EXISTS item_description TEXT;
    ALTER TABLE nfa_lines ADD COLUMN IF NOT EXISTS quantity NUMERIC(12,2);
    ALTER TABLE nfa_lines ADD COLUMN IF NOT EXISTS unit_rate NUMERIC(14,2);
    ALTER TABLE nfas ADD COLUMN IF NOT EXISTS vendor_quote_ref TEXT;
    ALTER TABLE nfas ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
  `);

  // The legacy owner: the organisation with the most existing NFAs. It keeps the
  // plain format, continuing from the old global counter for each year.
  await pool.query(`
    INSERT INTO nfa_code_format (organisation_id, prefix)
    SELECT e.organisation_id, '' FROM nfas n JOIN employees e ON e.id = n.employee_id
     WHERE e.organisation_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM nfa_code_format WHERE prefix = '')
     GROUP BY e.organisation_id ORDER BY count(*) DESC, e.organisation_id LIMIT 1
    ON CONFLICT (organisation_id) DO NOTHING`);
  await pool.query(`
    INSERT INTO nfa_org_seq (organisation_id, year, last_value)
    SELECT f.organisation_id, s.year, s.last_value FROM nfa_code_format f CROSS JOIN nfa_code_seq s
     WHERE f.prefix = ''
    ON CONFLICT (organisation_id, year) DO NOTHING`);

  // ── H111 masters repair ─────────────────────────────────────────────────
  const usage = {
    business_operations: [['nfas', 'business_operation_id', 'employee_id']],
    group_companies: [['nfas', 'group_company_id', 'employee_id']],
    projects: [['nfas', 'project_id', 'employee_id'], ['agreements', 'project_id', 'uploaded_by'], ['approver_matrix', 'project_id', null]],
    expense_categories: [['nfas', 'expense_category_id', 'employee_id'], ['approver_matrix', 'expense_category_id', null]],
    cost_zones: [['nfas', 'zone_id', 'employee_id'], ['approver_matrix', 'zone_id', null]],
    office_locations: [['nfas', 'location_id', 'employee_id'], ['agreements', 'location_id', 'uploaded_by']],
    clients_vendors: [['nfas', 'client_vendor_id', 'employee_id'], ['agreements', 'client_id', 'uploaded_by']],
  };
  for (const [table, uses] of Object.entries(usage)) {
    const parts = uses.map(([t, col, empCol]) => (empCol
      ? `SELECT u.${col} AS mid, e.organisation_id AS org FROM ${t} u JOIN employees e ON e.id = u.${empCol} WHERE u.${col} IS NOT NULL AND e.organisation_id IS NOT NULL`
      : `SELECT u.${col} AS mid, u.organisation_id AS org FROM ${t} u WHERE u.${col} IS NOT NULL AND u.organisation_id IS NOT NULL`));
    const r = await pool.query(`
      WITH used AS (${parts.join(' UNION ALL ')}),
      single AS (SELECT mid, min(org) AS org FROM used GROUP BY mid HAVING count(DISTINCT org) = 1)
      UPDATE ${table} m SET organisation_id = s.org
        FROM single s
       WHERE m.id = s.mid
         AND m.organisation_id IS DISTINCT FROM s.org
         AND NOT EXISTS (SELECT 1 FROM used u WHERE u.mid = m.id AND u.org = m.organisation_id)
         AND NOT EXISTS (SELECT 1 FROM ${table} x WHERE x.organisation_id = s.org
                           AND lower(trim(x.name)) = lower(trim(m.name)) AND x.id <> m.id)`);
    if (r.rowCount) console.log(`[migrate] v2 workflow: ${r.rowCount} ${table} row(s) re-attached to the organisation that uses them`);
  }
  // Headers and sub-headers follow their parent.
  await pool.query(`UPDATE expense_headers h SET organisation_id = c.organisation_id
      FROM expense_categories c WHERE c.id = h.category_id AND h.organisation_id IS DISTINCT FROM c.organisation_id`);
  await pool.query(`UPDATE expense_subheaders s SET organisation_id = h.organisation_id
      FROM expense_headers h WHERE h.id = s.header_id AND s.organisation_id IS DISTINCT FROM h.organisation_id`);
}
