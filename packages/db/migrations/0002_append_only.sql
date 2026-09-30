-- The credit ledger and the admin audit log are append-only (docs/04 → Money,
-- CLAUDE.md rule 5): no UPDATE, DELETE or TRUNCATE, ever. A correction is a
-- new row. Balances move only through applyCredit (packages/db/src/credits.ts).
CREATE FUNCTION etb_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credit_transactions_append_only
  BEFORE UPDATE OR DELETE ON credit_transactions
  FOR EACH ROW EXECUTE FUNCTION etb_append_only();
--> statement-breakpoint
CREATE TRIGGER credit_transactions_no_truncate
  BEFORE TRUNCATE ON credit_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION etb_append_only();
--> statement-breakpoint
CREATE TRIGGER admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION etb_append_only();
--> statement-breakpoint
CREATE TRIGGER admin_audit_log_no_truncate
  BEFORE TRUNCATE ON admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION etb_append_only();
