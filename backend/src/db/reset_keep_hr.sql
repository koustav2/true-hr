-- ============================================================================
-- TRUE HR — Reset operational data, KEEP the HR setup.
--
-- KEEPS:  organisations, companies, departments, designations,
--         staff logins (Super Admin / HR / IT Admin — accounts with no employee),
--         demo managers (employee codes TKF1xxx).
--
-- WIPES:  every onboarded employee (TKF5xxx and any half-finished onboarding),
--         their attendance / OD / miss-punch / holds, documents, e-signatures,
--         bank + statutory + address records, onboarding + tokens,
--         employee login accounts, notifications, and the email queue.
--
-- Safe to re-run. Wrapped in a transaction — nothing changes unless it all succeeds.
-- ============================================================================
BEGIN;

-- 1) Attendance & request data (employee-scoped; demo managers have none) -----
DELETE FROM attendance_hold;
DELETE FROM attendance;
DELETE FROM miss_punch;
DELETE FROM on_duty;

-- 2) Onboarding artefacts ------------------------------------------------------
DELETE FROM documents;
DELETE FROM esignatures;
DELETE FROM employee_bank;
DELETE FROM employee_statutory;
DELETE FROM employee_addresses;
DELETE FROM onboarding_tokens;
DELETE FROM onboarding;

-- 3) Communications / logs -----------------------------------------------------
DELETE FROM notifications;       -- FK to user_accounts, so must precede step 4
DELETE FROM email_queue;         -- drop any pending offer / welcome emails
-- DELETE FROM audit_log;        -- uncomment to also clear the audit trail

-- 4) Employee login accounts (keep staff logins, which have employee_id IS NULL)
DELETE FROM user_accounts WHERE employee_id IS NOT NULL;

-- 5) The employees themselves: keep only the demo managers (TKF1xxx) -----------
--    Detach manager links first so self-references don't block the delete.
UPDATE employees
   SET reporting_manager_id   = NULL,
       function_manager_id    = NULL,
       operational_manager_id = NULL
 WHERE employee_code IS NULL OR employee_code NOT LIKE 'TKF1%';

DELETE FROM employees
 WHERE employee_code IS NULL OR employee_code NOT LIKE 'TKF1%';

COMMIT;

-- Sanity check (run separately if you like):
--   SELECT employee_code, first_name, last_name FROM employees ORDER BY employee_code;
--   SELECT email, role FROM user_accounts ORDER BY role;
