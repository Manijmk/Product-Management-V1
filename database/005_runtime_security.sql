-- PMS Sprint 0E runtime privilege boundary.
--
-- pms_app is intentionally a NOLOGIN capability role. Deployment creates a
-- separate environment-specific LOGIN role (and password/credential) and
-- grants that login membership in pms_app. Credentials never belong in schema
-- migrations.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pms_app') THEN
        CREATE ROLE pms_app
            NOLOGIN
            NOSUPERUSER
            NOBYPASSRLS
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION
            NOINHERIT;
    END IF;
END
$$;

-- Converge an existing role to the required safe attributes as well.
ALTER ROLE pms_app
    NOLOGIN
    NOSUPERUSER
    NOBYPASSRLS
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOINHERIT;

-- Remove any inherited or SET ROLE escalation path left on a pre-existing
-- role. Deployment LOGIN roles may be members of pms_app; pms_app itself must
-- not be a member of any broader role.
DO $$
DECLARE
    granted_role RECORD;
BEGIN
    FOR granted_role IN
        SELECT parent_role.rolname
          FROM pg_auth_members membership
          JOIN pg_roles member_role ON member_role.oid = membership.member
          JOIN pg_roles parent_role ON parent_role.oid = membership.roleid
         WHERE member_role.rolname = 'pms_app'
    LOOP
        EXECUTE format('REVOKE %I FROM pms_app', granted_role.rolname);
    END LOOP;
END
$$;

-- The runtime role must never own tenant data. If a pre-existing role owns a
-- tenant-scoped base table, restore ownership to the migration executor.
DO $$
DECLARE
    owned_table RECORD;
BEGIN
    FOR owned_table IN
        SELECT n.nspname, c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_roles owner_role ON owner_role.oid = c.relowner
         WHERE n.nspname = 'pms'
           AND c.relkind IN ('r', 'p')
           AND owner_role.rolname = 'pms_app'
           AND EXISTS (
               SELECT 1
                 FROM pg_attribute a
                WHERE a.attrelid = c.oid
                  AND a.attname = 'tenant_id'
                  AND NOT a.attisdropped
           )
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I OWNER TO %I',
            owned_table.nspname,
            owned_table.relname,
            current_user
        );
    END LOOP;
END
$$;

-- Start from no direct object privileges and grant only the runtime surface.
REVOKE ALL PRIVILEGES ON SCHEMA pms FROM pms_app;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pms FROM pms_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pms FROM pms_app;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA pms FROM pms_app;

GRANT USAGE ON SCHEMA pms TO pms_app;

-- Tenant-owned operational tables use forced RLS. The tenant registry itself
-- is deliberately excluded because it is not protected by a tenant RLS policy.
DO $$
DECLARE
    tenant_table RECORD;
BEGIN
    FOR tenant_table IN
        SELECT n.nspname, c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'pms'
           AND c.relkind IN ('r', 'p')
           AND c.relname <> 'tenant'
           AND c.relname NOT IN (
               'inventory_ledger_entry',
               'money_ledger_entry',
               'payment_allocation'
           )
           AND EXISTS (
               SELECT 1
                 FROM pg_attribute a
                WHERE a.attrelid = c.oid
                  AND a.attname = 'tenant_id'
                  AND NOT a.attisdropped
           )
    LOOP
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE ON TABLE %I.%I TO pms_app',
            tenant_table.nspname,
            tenant_table.relname
        );
    END LOOP;
END
$$;

-- Reference data is read-only to the application runtime.
GRANT SELECT ON TABLE pms.inventory_state TO pms_app;

-- Ledger and allocation history is append-only at both privilege and trigger
-- layers. Corrections append reversal/adjustment rows.
GRANT SELECT, INSERT ON TABLE
    pms.inventory_ledger_entry,
    pms.money_ledger_entry,
    pms.payment_allocation
TO pms_app;

-- Identity-backed inserts require nextval/currval but not sequence inspection.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA pms TO pms_app;

-- Remove PostgreSQL's default PUBLIC execution path, then expose only the two
-- functions intentionally callable by application services. Trigger functions
-- continue to execute through their installed triggers.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pms FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pms
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    pms.assert_trip_accepts_new_stop(BIGINT, BIGINT),
    pms.normalize_trip_stop_order(BIGINT, BIGINT)
TO pms_app;

-- Views execute with the caller's privileges so their underlying forced-RLS
-- policies cannot be bypassed through the view owner.
ALTER VIEW pms.stock_on_hand_view SET (security_invoker = true);
ALTER VIEW pms.customer_container_balance_view SET (security_invoker = true);
ALTER VIEW pms.customer_balance_view SET (security_invoker = true);
ALTER VIEW pms.staff_cash_in_hand_view SET (security_invoker = true);
ALTER VIEW pms.trip_reconciliation_summary_view SET (security_invoker = true);

GRANT SELECT ON TABLE
    pms.stock_on_hand_view,
    pms.customer_container_balance_view,
    pms.customer_balance_view,
    pms.staff_cash_in_hand_view,
    pms.trip_reconciliation_summary_view
TO pms_app;

COMMIT;
