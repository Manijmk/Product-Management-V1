-- PMS Sprint 0E schema fixes.
-- Migrations 001-004 are checksummed and intentionally remain unchanged.
BEGIN;

SET search_path TO pms, public;

ALTER TABLE trip_reconciliation
    DROP CONSTRAINT ck_trip_recon_submit_actor;

ALTER TABLE trip_reconciliation
    ADD CONSTRAINT ck_trip_recon_submit_actor
    CHECK (
        status = 'OPEN'
        OR submitted_by_staff_id IS NOT NULL
        OR submitted_by_user_id IS NOT NULL
    );

COMMIT;
