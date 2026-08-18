
-- Product Management System (PMS)
-- PostgreSQL DDL v1.3 - Sprint 0D Reconciliation + Cash Handover
-- Date: 2026-08-18
--
-- Requires:
--   PMS PostgreSQL DDL v1.0 / Sprint 0A
--   PMS PostgreSQL DDL v1.1 / Sprint 0B
--   PMS PostgreSQL DDL v1.2 / Sprint 0C
--
-- Scope:
--   TripReconciliation
--   TripStockReconciliation
--   TripCashReconciliation
--   CashHandover
--   ReconciliationException
--   PostReconciliationAdjustment
--
-- Core business rules:
--   1) Reconciliation compares ledger-derived expectation against actual physical stock/cash.
--   2) Delivery staff submits counts/cash; Tenant Owner/Admin approves variances.
--   3) Reconciled Trips are operationally closed.
--   4) Late-arriving genuine events after reconciliation are exceptions, never silently folded into closed EOD.
--   5) Corrections after reconciliation create explicit adjustment metadata and ledger reversal/adjustment rows.
--   6) Cash handover is a distinct two-party operational action: staff submits, owner/admin confirms.
--
-- IMPORTANT:
-- Each tenant-scoped request must execute:
--   SET LOCAL app.tenant_id = '<tenant_id>';
-- inside the request transaction.

BEGIN;

SET search_path TO pms, public;

-- ============================================================
-- 1. Trip Reconciliation Header
-- ============================================================

CREATE TABLE trip_reconciliation (
    reconciliation_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                     BIGINT NOT NULL,
    trip_id                       BIGINT NOT NULL,

    reconciliation_number         VARCHAR(80) NOT NULL,
    status                        VARCHAR(20) NOT NULL DEFAULT 'OPEN',

    started_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at                  TIMESTAMPTZ,
    approved_at                   TIMESTAMPTZ,
    reopened_at                   TIMESTAMPTZ,

    submitted_by_staff_id         BIGINT,
    submitted_by_user_id          BIGINT,
    approved_by_user_id           BIGINT,
    reopened_by_user_id           BIGINT,

    notes                         VARCHAR(1000),
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_trip_recon_tenant_id
        UNIQUE (tenant_id, reconciliation_id),

    CONSTRAINT uq_trip_recon_trip
        UNIQUE (tenant_id, trip_id),

    CONSTRAINT uq_trip_recon_number
        UNIQUE (tenant_id, reconciliation_number),

    CONSTRAINT fk_trip_recon_trip
        FOREIGN KEY (tenant_id, trip_id)
        REFERENCES trip(tenant_id, trip_id),

    CONSTRAINT fk_trip_recon_submitted_staff
        FOREIGN KEY (tenant_id, submitted_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_trip_recon_submitted_user
        FOREIGN KEY (tenant_id, submitted_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_trip_recon_approved_user
        FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_trip_recon_reopened_user
        FOREIGN KEY (tenant_id, reopened_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_trip_recon_status
        CHECK (status IN ('OPEN', 'SUBMITTED', 'APPROVED', 'REOPENED')),

    CONSTRAINT ck_trip_recon_submit_actor
        CHECK (
            submitted_by_staff_id IS NULL
            OR submitted_by_user_id IS NULL
            OR submitted_by_staff_id IS NOT NULL
            OR submitted_by_user_id IS NOT NULL
        ),

    CONSTRAINT ck_trip_recon_submitted_consistency
        CHECK (
            (status IN ('SUBMITTED', 'APPROVED', 'REOPENED') AND submitted_at IS NOT NULL)
            OR
            status = 'OPEN'
        ),

    CONSTRAINT ck_trip_recon_approved_consistency
        CHECK (
            (status = 'APPROVED' AND approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL)
            OR
            status <> 'APPROVED'
        ),

    CONSTRAINT ck_trip_recon_reopened_consistency
        CHECK (
            (status = 'REOPENED' AND reopened_at IS NOT NULL AND reopened_by_user_id IS NOT NULL)
            OR
            status <> 'REOPENED'
        )
);

CREATE INDEX ix_trip_recon_status
    ON trip_reconciliation (tenant_id, status, started_at DESC);

CREATE TRIGGER trg_trip_reconciliation_updated_at
BEFORE UPDATE ON trip_reconciliation
FOR EACH ROW
EXECUTE FUNCTION pms.set_updated_at();

-- ============================================================
-- 2. Trip Stock Reconciliation Detail
-- ============================================================

CREATE TABLE trip_stock_reconciliation (
    trip_stock_recon_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                      BIGINT NOT NULL,
    reconciliation_id              BIGINT NOT NULL,

    inventory_location_id          BIGINT NOT NULL,
    product_id                     BIGINT NOT NULL,
    inventory_state_id             BIGINT NOT NULL,

    expected_qty                   NUMERIC(14,3) NOT NULL,
    actual_qty                     NUMERIC(14,3) NOT NULL,
    variance_qty                   NUMERIC(14,3) GENERATED ALWAYS AS (actual_qty - expected_qty) STORED,

    variance_reason_code           VARCHAR(50),
    variance_notes                 VARCHAR(1000),

    approval_status                VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED',
    approved_by_user_id            BIGINT,
    approved_at                    TIMESTAMPTZ,

    adjustment_inventory_ledger_id BIGINT,

    counted_by_staff_id            BIGINT,
    counted_by_user_id             BIGINT,
    counted_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_trip_stock_recon_tenant_id
        UNIQUE (tenant_id, trip_stock_recon_id),

    CONSTRAINT uq_trip_stock_recon_dimension
        UNIQUE (
            tenant_id,
            reconciliation_id,
            inventory_location_id,
            product_id,
            inventory_state_id
        ),

    CONSTRAINT fk_trip_stock_recon_header
        FOREIGN KEY (tenant_id, reconciliation_id)
        REFERENCES trip_reconciliation(tenant_id, reconciliation_id),

    CONSTRAINT fk_trip_stock_recon_location
        FOREIGN KEY (tenant_id, inventory_location_id)
        REFERENCES inventory_location(tenant_id, inventory_location_id),

    CONSTRAINT fk_trip_stock_recon_product
        FOREIGN KEY (tenant_id, product_id)
        REFERENCES product(tenant_id, product_id),

    CONSTRAINT fk_trip_stock_recon_state
        FOREIGN KEY (inventory_state_id)
        REFERENCES inventory_state(inventory_state_id),

    CONSTRAINT fk_trip_stock_recon_approved_by
        FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_trip_stock_recon_adjustment
        FOREIGN KEY (tenant_id, adjustment_inventory_ledger_id)
        REFERENCES inventory_ledger_entry(tenant_id, inventory_ledger_id),

    CONSTRAINT fk_trip_stock_recon_counted_staff
        FOREIGN KEY (tenant_id, counted_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_trip_stock_recon_counted_user
        FOREIGN KEY (tenant_id, counted_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_trip_stock_recon_quantities
        CHECK (expected_qty >= 0 AND actual_qty >= 0),

    CONSTRAINT ck_trip_stock_recon_actor
        CHECK (
            counted_by_staff_id IS NOT NULL
            OR counted_by_user_id IS NOT NULL
        ),

    CONSTRAINT ck_trip_stock_recon_approval_status
        CHECK (approval_status IN (
            'NOT_REQUIRED',
            'PENDING',
            'APPROVED',
            'REJECTED'
        )),

    CONSTRAINT ck_trip_stock_recon_variance_reason
        CHECK (
            variance_qty = 0
            OR variance_reason_code IS NOT NULL
        ),

    CONSTRAINT ck_trip_stock_recon_approval_consistency
        CHECK (
            (approval_status = 'APPROVED' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
            OR
            approval_status <> 'APPROVED'
        )
);

CREATE INDEX ix_trip_stock_recon_header
    ON trip_stock_reconciliation (tenant_id, reconciliation_id);

CREATE INDEX ix_trip_stock_recon_variance
    ON trip_stock_reconciliation (tenant_id, reconciliation_id, variance_qty);

-- ============================================================
-- 3. Trip Cash Reconciliation
-- ============================================================

CREATE TABLE trip_cash_reconciliation (
    trip_cash_recon_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                       BIGINT NOT NULL,
    reconciliation_id               BIGINT NOT NULL,
    staff_id                        BIGINT NOT NULL,

    expected_cash                   NUMERIC(14,2) NOT NULL,
    actual_cash                     NUMERIC(14,2) NOT NULL,
    variance_amount                 NUMERIC(14,2) GENERATED ALWAYS AS (actual_cash - expected_cash) STORED,

    variance_reason_code            VARCHAR(50),
    variance_notes                  VARCHAR(1000),

    approval_status                 VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED',
    approved_by_user_id             BIGINT,
    approved_at                     TIMESTAMPTZ,

    adjustment_money_ledger_id      BIGINT,

    submitted_by_staff_id           BIGINT,
    submitted_by_user_id            BIGINT,
    submitted_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_trip_cash_recon_tenant_id
        UNIQUE (tenant_id, trip_cash_recon_id),

    CONSTRAINT uq_trip_cash_recon_staff
        UNIQUE (tenant_id, reconciliation_id, staff_id),

    CONSTRAINT fk_trip_cash_recon_header
        FOREIGN KEY (tenant_id, reconciliation_id)
        REFERENCES trip_reconciliation(tenant_id, reconciliation_id),

    CONSTRAINT fk_trip_cash_recon_staff
        FOREIGN KEY (tenant_id, staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_trip_cash_recon_approved_by
        FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_trip_cash_recon_adjustment
        FOREIGN KEY (tenant_id, adjustment_money_ledger_id)
        REFERENCES money_ledger_entry(tenant_id, money_ledger_id),

    CONSTRAINT fk_trip_cash_recon_submit_staff
        FOREIGN KEY (tenant_id, submitted_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_trip_cash_recon_submit_user
        FOREIGN KEY (tenant_id, submitted_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_trip_cash_recon_values
        CHECK (expected_cash >= 0 AND actual_cash >= 0),

    CONSTRAINT ck_trip_cash_recon_submit_actor
        CHECK (
            submitted_by_staff_id IS NOT NULL
            OR submitted_by_user_id IS NOT NULL
        ),

    CONSTRAINT ck_trip_cash_recon_approval_status
        CHECK (approval_status IN (
            'NOT_REQUIRED',
            'PENDING',
            'APPROVED',
            'REJECTED'
        )),

    CONSTRAINT ck_trip_cash_recon_reason
        CHECK (
            variance_amount = 0
            OR variance_reason_code IS NOT NULL
        ),

    CONSTRAINT ck_trip_cash_recon_approval_consistency
        CHECK (
            (approval_status = 'APPROVED' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
            OR
            approval_status <> 'APPROVED'
        )
);

CREATE INDEX ix_trip_cash_recon_header
    ON trip_cash_reconciliation (tenant_id, reconciliation_id);

CREATE INDEX ix_trip_cash_recon_variance
    ON trip_cash_reconciliation (tenant_id, reconciliation_id, variance_amount);

-- ============================================================
-- 4. Cash Handover
-- ============================================================

CREATE TABLE cash_handover (
    cash_handover_id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                       BIGINT NOT NULL,
    trip_id                         BIGINT,
    reconciliation_id               BIGINT,

    from_staff_id                   BIGINT NOT NULL,
    to_user_id                      BIGINT NOT NULL,

    amount                          NUMERIC(14,2) NOT NULL,
    status                          VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',

    submitted_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at                    TIMESTAMPTZ,
    disputed_at                     TIMESTAMPTZ,

    submitted_by_staff_id           BIGINT NOT NULL,
    confirmed_by_user_id            BIGINT,
    dispute_reason                  VARCHAR(1000),

    money_ledger_id                 BIGINT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_cash_handover_tenant_id
        UNIQUE (tenant_id, cash_handover_id),

    CONSTRAINT fk_cash_handover_trip
        FOREIGN KEY (tenant_id, trip_id)
        REFERENCES trip(tenant_id, trip_id),

    CONSTRAINT fk_cash_handover_reconciliation
        FOREIGN KEY (tenant_id, reconciliation_id)
        REFERENCES trip_reconciliation(tenant_id, reconciliation_id),

    CONSTRAINT fk_cash_handover_from_staff
        FOREIGN KEY (tenant_id, from_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_cash_handover_to_user
        FOREIGN KEY (tenant_id, to_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_cash_handover_submitted_staff
        FOREIGN KEY (tenant_id, submitted_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_cash_handover_confirmed_user
        FOREIGN KEY (tenant_id, confirmed_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_cash_handover_money_ledger
        FOREIGN KEY (tenant_id, money_ledger_id)
        REFERENCES money_ledger_entry(tenant_id, money_ledger_id),

    CONSTRAINT ck_cash_handover_amount
        CHECK (amount > 0),

    CONSTRAINT ck_cash_handover_status
        CHECK (status IN ('SUBMITTED', 'CONFIRMED', 'DISPUTED', 'CANCELLED')),

    CONSTRAINT ck_cash_handover_confirmed_consistency
        CHECK (
            (status = 'CONFIRMED'
                AND confirmed_at IS NOT NULL
                AND confirmed_by_user_id IS NOT NULL
                AND money_ledger_id IS NOT NULL)
            OR
            status <> 'CONFIRMED'
        ),

    CONSTRAINT ck_cash_handover_disputed_consistency
        CHECK (
            (status = 'DISPUTED'
                AND disputed_at IS NOT NULL
                AND dispute_reason IS NOT NULL)
            OR
            status <> 'DISPUTED'
        )
);

CREATE INDEX ix_cash_handover_trip
    ON cash_handover (tenant_id, trip_id, status);

CREATE INDEX ix_cash_handover_staff
    ON cash_handover (tenant_id, from_staff_id, submitted_at DESC);

-- ============================================================
-- 5. Reconciliation Exception
-- ============================================================

CREATE TABLE reconciliation_exception (
    reconciliation_exception_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                       BIGINT NOT NULL,
    reconciliation_id               BIGINT NOT NULL,

    exception_type                  VARCHAR(40) NOT NULL,
    severity                        VARCHAR(20) NOT NULL DEFAULT 'WARNING',

    trip_id                         BIGINT NOT NULL,
    trip_stop_id                    BIGINT,
    stop_event_id                   BIGINT,

    detected_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    detected_source                 VARCHAR(30) NOT NULL,

    description                     VARCHAR(1500) NOT NULL,

    status                          VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    resolved_by_user_id             BIGINT,
    resolved_at                     TIMESTAMPTZ,
    resolution_notes                VARCHAR(1500),

    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_recon_exception_tenant_id
        UNIQUE (tenant_id, reconciliation_exception_id),

    CONSTRAINT fk_recon_exception_header
        FOREIGN KEY (tenant_id, reconciliation_id)
        REFERENCES trip_reconciliation(tenant_id, reconciliation_id),

    CONSTRAINT fk_recon_exception_trip
        FOREIGN KEY (tenant_id, trip_id)
        REFERENCES trip(tenant_id, trip_id),

    CONSTRAINT fk_recon_exception_trip_stop
        FOREIGN KEY (tenant_id, trip_stop_id)
        REFERENCES trip_stop(tenant_id, trip_stop_id),

    CONSTRAINT fk_recon_exception_stop_event
        FOREIGN KEY (tenant_id, stop_event_id)
        REFERENCES stop_event(tenant_id, stop_event_id),

    CONSTRAINT fk_recon_exception_resolved_by
        FOREIGN KEY (tenant_id, resolved_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_recon_exception_type
        CHECK (exception_type IN (
            'LATE_STOP_EVENT',
            'STOCK_VARIANCE',
            'CASH_VARIANCE',
            'UNRESOLVED_TRIP_STOP',
            'OFFLINE_SYNC_EXCEPTION',
            'POST_CLOSE_CORRECTION',
            'OTHER'
        )),

    CONSTRAINT ck_recon_exception_severity
        CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),

    CONSTRAINT ck_recon_exception_source
        CHECK (detected_source IN (
            'SYSTEM',
            'STAFF',
            'ADMIN',
            'SYNC_ENGINE',
            'RECONCILIATION_ENGINE'
        )),

    CONSTRAINT ck_recon_exception_status
        CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),

    CONSTRAINT ck_recon_exception_resolved_consistency
        CHECK (
            (status = 'RESOLVED'
                AND resolved_by_user_id IS NOT NULL
                AND resolved_at IS NOT NULL)
            OR
            status <> 'RESOLVED'
        )
);

CREATE INDEX ix_recon_exception_open
    ON reconciliation_exception (tenant_id, reconciliation_id, status, severity);

CREATE INDEX ix_recon_exception_trip
    ON reconciliation_exception (tenant_id, trip_id, detected_at DESC);

-- ============================================================
-- 6. Post-Reconciliation Adjustment
-- ============================================================
-- This table does NOT replace ledger entries.
-- It is audit/approval metadata tying closed-trip corrections to
-- explicit append-only inventory/money adjustments or reversals.

CREATE TABLE post_reconciliation_adjustment (
    post_recon_adjustment_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                       BIGINT NOT NULL,
    reconciliation_id               BIGINT NOT NULL,
    trip_id                         BIGINT NOT NULL,

    reconciliation_exception_id     BIGINT,

    adjustment_type                 VARCHAR(30) NOT NULL,
    reason_code                     VARCHAR(50) NOT NULL,
    reason_notes                    VARCHAR(1500),

    requested_by_staff_id           BIGINT,
    requested_by_user_id            BIGINT,
    requested_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    approval_status                 VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    approved_by_user_id             BIGINT,
    approved_at                     TIMESTAMPTZ,

    inventory_ledger_id             BIGINT,
    money_ledger_id                 BIGINT,
    stop_event_id                   BIGINT,

    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_post_recon_adjustment_tenant_id
        UNIQUE (tenant_id, post_recon_adjustment_id),

    CONSTRAINT fk_post_recon_adjustment_header
        FOREIGN KEY (tenant_id, reconciliation_id)
        REFERENCES trip_reconciliation(tenant_id, reconciliation_id),

    CONSTRAINT fk_post_recon_adjustment_trip
        FOREIGN KEY (tenant_id, trip_id)
        REFERENCES trip(tenant_id, trip_id),

    CONSTRAINT fk_post_recon_adjustment_exception
        FOREIGN KEY (tenant_id, reconciliation_exception_id)
        REFERENCES reconciliation_exception(tenant_id, reconciliation_exception_id),

    CONSTRAINT fk_post_recon_adjustment_requested_staff
        FOREIGN KEY (tenant_id, requested_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_post_recon_adjustment_requested_user
        FOREIGN KEY (tenant_id, requested_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_post_recon_adjustment_approved_user
        FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_post_recon_adjustment_inventory_ledger
        FOREIGN KEY (tenant_id, inventory_ledger_id)
        REFERENCES inventory_ledger_entry(tenant_id, inventory_ledger_id),

    CONSTRAINT fk_post_recon_adjustment_money_ledger
        FOREIGN KEY (tenant_id, money_ledger_id)
        REFERENCES money_ledger_entry(tenant_id, money_ledger_id),

    CONSTRAINT fk_post_recon_adjustment_stop_event
        FOREIGN KEY (tenant_id, stop_event_id)
        REFERENCES stop_event(tenant_id, stop_event_id),

    CONSTRAINT ck_post_recon_adjustment_type
        CHECK (adjustment_type IN (
            'INVENTORY',
            'MONEY',
            'STOP_EVENT_CORRECTION',
            'MIXED'
        )),

    CONSTRAINT ck_post_recon_adjustment_requestor
        CHECK (
            requested_by_staff_id IS NOT NULL
            OR requested_by_user_id IS NOT NULL
        ),

    CONSTRAINT ck_post_recon_adjustment_status
        CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),

    CONSTRAINT ck_post_recon_adjustment_approval
        CHECK (
            (approval_status = 'APPROVED'
                AND approved_by_user_id IS NOT NULL
                AND approved_at IS NOT NULL)
            OR
            approval_status <> 'APPROVED'
        ),

    CONSTRAINT ck_post_recon_adjustment_link
        CHECK (
            inventory_ledger_id IS NOT NULL
            OR money_ledger_id IS NOT NULL
            OR stop_event_id IS NOT NULL
            OR approval_status <> 'APPROVED'
        )
);

CREATE INDEX ix_post_recon_adjustment_header
    ON post_reconciliation_adjustment (tenant_id, reconciliation_id, approval_status);

-- ============================================================
-- 7. Reconciliation summary view
-- ============================================================

CREATE OR REPLACE VIEW trip_reconciliation_summary_view AS
SELECT
    tr.tenant_id,
    tr.reconciliation_id,
    tr.trip_id,
    tr.reconciliation_number,
    tr.status,

    COALESCE(stock.total_stock_variance_abs, 0) AS total_stock_variance_abs,
    COALESCE(stock.stock_variance_line_count, 0) AS stock_variance_line_count,

    COALESCE(cash.total_cash_variance_abs, 0) AS total_cash_variance_abs,
    COALESCE(cash.cash_variance_line_count, 0) AS cash_variance_line_count,

    COALESCE(exc.open_exception_count, 0) AS open_exception_count,

    tr.started_at,
    tr.submitted_at,
    tr.approved_at
FROM trip_reconciliation tr
LEFT JOIN (
    SELECT
        tenant_id,
        reconciliation_id,
        SUM(ABS(variance_qty)) AS total_stock_variance_abs,
        COUNT(*) FILTER (WHERE variance_qty <> 0) AS stock_variance_line_count
    FROM trip_stock_reconciliation
    GROUP BY tenant_id, reconciliation_id
) stock
  ON stock.tenant_id = tr.tenant_id
 AND stock.reconciliation_id = tr.reconciliation_id
LEFT JOIN (
    SELECT
        tenant_id,
        reconciliation_id,
        SUM(ABS(variance_amount)) AS total_cash_variance_abs,
        COUNT(*) FILTER (WHERE variance_amount <> 0) AS cash_variance_line_count
    FROM trip_cash_reconciliation
    GROUP BY tenant_id, reconciliation_id
) cash
  ON cash.tenant_id = tr.tenant_id
 AND cash.reconciliation_id = tr.reconciliation_id
LEFT JOIN (
    SELECT
        tenant_id,
        reconciliation_id,
        COUNT(*) FILTER (WHERE status IN ('OPEN', 'UNDER_REVIEW')) AS open_exception_count
    FROM reconciliation_exception
    GROUP BY tenant_id, reconciliation_id
) exc
  ON exc.tenant_id = tr.tenant_id
 AND exc.reconciliation_id = tr.reconciliation_id;

-- ============================================================
-- 8. Guard: Trip can be reconciled only after approved reconciliation
-- ============================================================

CREATE OR REPLACE FUNCTION pms.validate_trip_reconciled_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_recon_status VARCHAR(20);
    v_open_exceptions BIGINT;
BEGIN
    IF OLD.status = NEW.status OR NEW.status <> 'RECONCILED' THEN
        RETURN NEW;
    END IF;

    SELECT status
      INTO v_recon_status
      FROM trip_reconciliation
     WHERE tenant_id = NEW.tenant_id
       AND trip_id = NEW.trip_id;

    IF v_recon_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Trip % cannot be reconciled until reconciliation is APPROVED',
            NEW.trip_id;
    END IF;

    SELECT COUNT(*)
      INTO v_open_exceptions
      FROM reconciliation_exception re
      JOIN trip_reconciliation tr
        ON tr.tenant_id = re.tenant_id
       AND tr.reconciliation_id = re.reconciliation_id
     WHERE tr.tenant_id = NEW.tenant_id
       AND tr.trip_id = NEW.trip_id
       AND re.status IN ('OPEN', 'UNDER_REVIEW');

    IF v_open_exceptions > 0 THEN
        RAISE EXCEPTION 'Trip % has % unresolved reconciliation exceptions',
            NEW.trip_id, v_open_exceptions;
    END IF;

    NEW.reconciled_at = COALESCE(NEW.reconciled_at, NOW());
    RETURN NEW;
END;
$$;

-- v1.1 already created trg_trip_status_transition.
-- This second BEFORE trigger enforces reconciliation-specific conditions.
CREATE TRIGGER trg_trip_reconciled_state_guard
BEFORE UPDATE OF status ON trip
FOR EACH ROW
EXECUTE FUNCTION pms.validate_trip_reconciled_state();

-- ============================================================
-- 9. Reconciliation status transition guard
-- ============================================================

CREATE OR REPLACE FUNCTION pms.validate_reconciliation_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'OPEN' AND NEW.status = 'SUBMITTED' THEN
        NEW.submitted_at = COALESCE(NEW.submitted_at, NOW());
        RETURN NEW;

    ELSIF OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'REOPENED') THEN
        IF NEW.status = 'APPROVED' THEN
            NEW.approved_at = COALESCE(NEW.approved_at, NOW());
        ELSE
            NEW.reopened_at = COALESCE(NEW.reopened_at, NOW());
        END IF;
        RETURN NEW;

    ELSIF OLD.status = 'APPROVED' AND NEW.status = 'REOPENED' THEN
        NEW.reopened_at = COALESCE(NEW.reopened_at, NOW());
        RETURN NEW;

    ELSIF OLD.status = 'REOPENED' AND NEW.status = 'SUBMITTED' THEN
        NEW.submitted_at = NOW();
        NEW.approved_at = NULL;
        NEW.approved_by_user_id = NULL;
        RETURN NEW;

    ELSE
        RAISE EXCEPTION 'Invalid reconciliation status transition: % -> %',
            OLD.status, NEW.status;
    END IF;
END;
$$;

CREATE TRIGGER trg_reconciliation_status_transition
BEFORE UPDATE OF status ON trip_reconciliation
FOR EACH ROW
EXECUTE FUNCTION pms.validate_reconciliation_status_transition();

-- ============================================================
-- 10. Cash handover transition guard
-- ============================================================

CREATE OR REPLACE FUNCTION pms.validate_cash_handover_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'SUBMITTED' AND NEW.status = 'CONFIRMED' THEN
        NEW.confirmed_at = COALESCE(NEW.confirmed_at, NOW());
        RETURN NEW;

    ELSIF OLD.status = 'SUBMITTED' AND NEW.status = 'DISPUTED' THEN
        NEW.disputed_at = COALESCE(NEW.disputed_at, NOW());
        RETURN NEW;

    ELSIF OLD.status = 'SUBMITTED' AND NEW.status = 'CANCELLED' THEN
        RETURN NEW;

    ELSIF OLD.status = 'DISPUTED' AND NEW.status IN ('CONFIRMED', 'CANCELLED') THEN
        IF NEW.status = 'CONFIRMED' THEN
            NEW.confirmed_at = COALESCE(NEW.confirmed_at, NOW());
        END IF;
        RETURN NEW;

    ELSE
        RAISE EXCEPTION 'Invalid cash handover status transition: % -> %',
            OLD.status, NEW.status;
    END IF;
END;
$$;

CREATE TRIGGER trg_cash_handover_status_transition
BEFORE UPDATE OF status ON cash_handover
FOR EACH ROW
EXECUTE FUNCTION pms.validate_cash_handover_transition();

-- ============================================================
-- 11. RLS
-- ============================================================

ALTER TABLE trip_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_reconciliation FORCE ROW LEVEL SECURITY;

ALTER TABLE trip_stock_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_stock_reconciliation FORCE ROW LEVEL SECURITY;

ALTER TABLE trip_cash_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_cash_reconciliation FORCE ROW LEVEL SECURITY;

ALTER TABLE cash_handover ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_handover FORCE ROW LEVEL SECURITY;

ALTER TABLE reconciliation_exception ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_exception FORCE ROW LEVEL SECURITY;

ALTER TABLE post_reconciliation_adjustment ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_reconciliation_adjustment FORCE ROW LEVEL SECURITY;

CREATE POLICY trip_reconciliation_tenant_isolation ON trip_reconciliation
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY trip_stock_reconciliation_tenant_isolation ON trip_stock_reconciliation
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY trip_cash_reconciliation_tenant_isolation ON trip_cash_reconciliation
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY cash_handover_tenant_isolation ON cash_handover
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY reconciliation_exception_tenant_isolation ON reconciliation_exception
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY post_recon_adjustment_tenant_isolation ON post_reconciliation_adjustment
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

-- ============================================================
-- 12. Operational notes for service layer
-- ============================================================
--
-- Reconciliation flow:
--
--   Trip COMPLETED
--      ↓
--   Create TripReconciliation (OPEN)
--      ↓
--   System calculates expected stock from InventoryLedger
--   System calculates expected cash from MoneyLedger
--      ↓
--   Staff enters actual physical stock/cash
--      ↓
--   Variances get reason + approval status
--      ↓
--   Staff/User SUBMITS reconciliation
--      ↓
--   Owner/Admin reviews:
--       - stock variances
--       - cash variances
--       - unresolved TripStops
--       - late offline events
--       - cash handover
--      ↓
--   APPROVE reconciliation
--      ↓
--   Trip -> RECONCILED
--
-- Cash handover:
--
--   Staff SUBMITS amount
--      ↓
--   Owner/Admin CONFIRMS
--      ↓
--   Service creates MoneyLedgerEntry:
--      transaction_type = STAFF_CASH_HANDOVER
--      from context = STAFF_CASH
--      destination context = TENANT_CASH
--      ↓
--   cash_handover.money_ledger_id links to that immutable ledger row.
--
-- Late-arriving stop after Trip reconciliation:
--
--   Sync engine receives StopEvent
--      ↓
--   Do NOT silently mutate closed reconciliation
--      ↓
--   Create ReconciliationException(LATE_STOP_EVENT)
--      ↓
--   Owner/Admin review
--      ↓
--   Create PostReconciliationAdjustment
--      ↓
--   append Inventory/Money adjustment or correction ledger rows
--      ↓
--   resolve exception
--
-- IMPORTANT:
-- Role authorization (Owner/Admin approval) must still be enforced
-- in the API/domain layer. DB FKs prove identity, not role membership.
--

COMMIT;
