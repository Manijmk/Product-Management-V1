-- Sprint 0 runtime privilege boundary. The application should connect using
-- a LOGIN role that is a member of this NOLOGIN group role.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pms_app') THEN
        CREATE ROLE pms_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA pms TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pms TO pms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pms TO pms_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pms TO pms_app;

-- PostgreSQL views otherwise execute with the view owner's privileges. These
-- settings make the derived projections honor the caller's forced RLS context.
ALTER VIEW pms.stock_on_hand_view SET (security_invoker = true);
ALTER VIEW pms.customer_container_balance_view SET (security_invoker = true);
ALTER VIEW pms.customer_balance_view SET (security_invoker = true);
ALTER VIEW pms.staff_cash_in_hand_view SET (security_invoker = true);
ALTER VIEW pms.trip_reconciliation_summary_view SET (security_invoker = true);

REVOKE UPDATE, DELETE ON pms.inventory_ledger_entry FROM pms_app;
REVOKE UPDATE, DELETE ON pms.money_ledger_entry FROM pms_app;
REVOKE UPDATE, DELETE ON pms.payment_allocation FROM pms_app;

COMMIT;
