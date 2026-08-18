
-- Product Management System (PMS)
-- PostgreSQL DDL v1.1 - Sprint 0B Operations
-- Date: 2026-08-18
--
-- Requires:
--   PMS PostgreSQL DDL v1.0 / Sprint 0A already applied.
--
-- Scope:
--   Route
--   RouteStopTemplate
--   RouteStopProduct
--   Vehicle
--   Trip
--   TripStaff
--   TripStop
--   TripStopProduct
--
-- Business rules encoded:
--   1) Route is a reusable template, not the immutable truth of a day.
--   2) Trip is the actual operational run and may exist without a Route.
--   3) TripStop may be added after dispatch by staff/admin/customer-order flow.
--   4) Pending stops may be reordered during an active Trip.
--   5) Existing and temporary/new customers may be added to an active Trip.
--   6) Shop quantity can be unknown before visit through RETURN_MATCHED mode.
--   7) forecast_qty is planning-only and must never be treated as actual delivery.
--   8) Multiple staff members may participate in the same Trip.
--   9) Completed historical stops are not silently deleted or rewritten.
--
-- IMPORTANT:
-- Tenant-scoped requests must execute:
--   SET LOCAL app.tenant_id = '<tenant_id>';
-- inside the request transaction.

BEGIN;

SET search_path TO pms, public;

-- ============================================================
-- 1. Route
-- ============================================================

CREATE TABLE route (
    route_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    route_code          VARCHAR(50) NOT NULL,
    route_name          VARCHAR(200) NOT NULL,
    description         VARCHAR(500),
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id  BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_route_tenant_route UNIQUE (tenant_id, route_id),
    CONSTRAINT uq_route_tenant_code UNIQUE (tenant_id, route_code),

    CONSTRAINT fk_route_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenant(tenant_id),

    CONSTRAINT fk_route_created_by
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_route_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX ix_route_tenant_status
    ON route (tenant_id, status);

CREATE TRIGGER trg_route_updated_at
BEFORE UPDATE ON route
FOR EACH ROW
EXECUTE FUNCTION pms.set_updated_at();

-- ============================================================
-- 2. Route Stop Template
-- ============================================================

CREATE TABLE route_stop_template (
    route_stop_template_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id               BIGINT NOT NULL,
    route_id                BIGINT NOT NULL,
    party_id                BIGINT NOT NULL,
    default_sequence        NUMERIC(18,6) NOT NULL,
    preferred_time_from     TIME,
    preferred_time_to       TIME,
    notes                   VARCHAR(500),
    active_status           VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id      BIGINT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_route_stop_template_tenant_id
        UNIQUE (tenant_id, route_stop_template_id),

    CONSTRAINT uq_route_stop_template_route_party
        UNIQUE (tenant_id, route_id, party_id),

    CONSTRAINT fk_route_stop_template_route
        FOREIGN KEY (tenant_id, route_id)
        REFERENCES route(tenant_id, route_id),

    CONSTRAINT fk_route_stop_template_party
        FOREIGN KEY (tenant_id, party_id)
        REFERENCES party(tenant_id, party_id),

    CONSTRAINT fk_route_stop_template_created_by
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_route_stop_template_sequence
        CHECK (default_sequence > 0),

    CONSTRAINT ck_route_stop_template_time_window
        CHECK (
            preferred_time_from IS NULL
            OR preferred_time_to IS NULL
            OR preferred_time_to > preferred_time_from
        ),

    CONSTRAINT ck_route_stop_template_status
        CHECK (active_status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX ix_route_stop_template_route_sequence
    ON route_stop_template (tenant_id, route_id, default_sequence);

CREATE INDEX ix_route_stop_template_party
    ON route_stop_template (tenant_id, party_id, active_status);

CREATE TRIGGER trg_route_stop_template_updated_at
BEFORE UPDATE ON route_stop_template
FOR EACH ROW
EXECUTE FUNCTION pms.set_updated_at();

-- ============================================================
-- 3. Route Stop Product
-- ============================================================

CREATE TABLE route_stop_product (
    route_stop_product_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id               BIGINT NOT NULL,
    route_stop_template_id  BIGINT NOT NULL,
    party_product_id        BIGINT NOT NULL,
    quantity_mode           VARCHAR(30) NOT NULL,
    planned_qty             NUMERIC(14,3),
    forecast_qty            NUMERIC(14,3),
    notes                   VARCHAR(500),
    active_status           VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id      BIGINT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_route_stop_product_tenant_id
        UNIQUE (tenant_id, route_stop_product_id),

    CONSTRAINT uq_route_stop_product_template_party_product
        UNIQUE (tenant_id, route_stop_template_id, party_product_id),

    CONSTRAINT fk_route_stop_product_template
        FOREIGN KEY (tenant_id, route_stop_template_id)
        REFERENCES route_stop_template(tenant_id, route_stop_template_id),

    CONSTRAINT fk_route_stop_product_party_product
        FOREIGN KEY (tenant_id, party_product_id)
        REFERENCES party_product(tenant_id, party_product_id),

    CONSTRAINT fk_route_stop_product_created_by
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_route_stop_product_quantity_mode
        CHECK (quantity_mode IN ('FIXED_PLANNED', 'RETURN_MATCHED', 'AD_HOC')),

    CONSTRAINT ck_route_stop_product_planned_qty
        CHECK (
            (quantity_mode = 'FIXED_PLANNED' AND planned_qty IS NOT NULL AND planned_qty > 0)
            OR
            (quantity_mode <> 'FIXED_PLANNED' AND (planned_qty IS NULL OR planned_qty > 0))
        ),

    CONSTRAINT ck_route_stop_product_forecast_qty
        CHECK (forecast_qty IS NULL OR forecast_qty > 0),

    CONSTRAINT ck_route_stop_product_status
        CHECK (active_status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX ix_route_stop_product_template
    ON route_stop_product (tenant_id, route_stop_template_id, active_status);

CREATE TRIGGER trg_route_stop_product_updated_at
BEFORE UPDATE ON route_stop_product
FOR EACH ROW
EXECUTE FUNCTION pms.set_updated_at();

-- ============================================================
-- 4. Vehicle
-- ============================================================

CREATE TABLE vehicle (
    vehicle_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            BIGINT NOT NULL,
    registration_no      VARCHAR(50) NOT NULL,
    vehicle_type         VARCHAR(50) NOT NULL,
    capacity             NUMERIC(14,3),
    capacity_unit        VARCHAR(30),
    ownership_type       VARCHAR(30) NOT NULL DEFAULT 'OWNED',
    status               VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    notes                VARCHAR(500),
    created_by_user_id   BIGINT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_vehicle_tenant_vehicle UNIQUE (tenant_id, vehicle_id),
    CONSTRAINT uq_vehicle_tenant_registration UNIQUE (tenant_id, registration_no),

    CONSTRAINT fk_vehicle_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenant(tenant_id),

    CONSTRAINT fk_vehicle_created_by
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_vehicle_capacity
        CHECK (capacity IS NULL OR capacity > 0),

    CONSTRAINT ck_vehicle_ownership
        CHECK (ownership_type IN ('OWNED', 'RENTED', 'LEASED', 'THIRD_PARTY')),

    CONSTRAINT ck_vehicle_status
        CHECK (status IN ('ACTIVE', 'IN_SERVICE', 'BREAKDOWN', 'RETIRED', 'INACTIVE'))
);

CREATE INDEX ix_vehicle_tenant_status
    ON vehicle (tenant_id, status);

CREATE TRIGGER trg_vehicle_updated_at
BEFORE UPDATE ON vehicle
FOR EACH ROW
EXECUTE FUNCTION pms.set_updated_at();

-- ============================================================
-- 5. Trip
-- ============================================================

CREATE TABLE trip (
    trip_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id             BIGINT NOT NULL,
    trip_number           VARCHAR(80) NOT NULL,
    route_id              BIGINT,
    trip_date             DATE NOT NULL,
    shift_code            VARCHAR(30),
    vehicle_id            BIGINT,
    primary_staff_id      BIGINT,
    status                VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    planned_start_at      TIMESTAMPTZ,
    actual_start_at       TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    reconciled_at         TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ,
    cancellation_reason   VARCHAR(500),
    created_by_user_id    BIGINT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_trip_tenant_trip UNIQUE (tenant_id, trip_id),
    CONSTRAINT uq_trip_tenant_number UNIQUE (tenant_id, trip_number),

    CONSTRAINT fk_trip_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenant(tenant_id),

    CONSTRAINT fk_trip_route
        FOREIGN KEY (tenant_id, route_id)
        REFERENCES route(tenant_id, route_id),

    CONSTRAINT fk_trip_vehicle
        FOREIGN KEY (tenant_id, vehicle_id)
        REFERENCES vehicle(tenant_id, vehicle_id),

    CONSTRAINT fk_trip_primary_staff
        FOREIGN KEY (tenant_id, primary_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_trip_created_by
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_trip_status
        CHECK (status IN (
            'PLANNED',
            'LOADED',
            'DISPATCHED',
            'IN_PROGRESS',
            'COMPLETED',
            'RECONCILED',
            'CANCELLED'
        )),

    CONSTRAINT ck_trip_time_consistency
        CHECK (
            (actual_start_at IS NULL OR planned_start_at IS NULL OR actual_start_at >= planned_start_at - INTERVAL '24 hours')
            AND
            (completed_at IS NULL OR actual_start_at IS NULL OR completed_at >= actual_start_at)
            AND
            (reconciled_at IS NULL OR completed_at IS NULL OR reconciled_at >= completed_at)
        ),

    CONSTRAINT ck_trip_cancel_consistency
        CHECK (
            (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
            OR
            status <> 'CANCELLED'
        )
);

CREATE INDEX ix_trip_tenant_date_status
    ON trip (tenant_id, trip_date, status);

CREATE INDEX ix_trip_tenant_vehicle_date
    ON trip (tenant_id, vehicle_id, trip_date);

CREATE INDEX ix_trip_tenant_staff_date
    ON trip (tenant_id, primary_staff_id, trip_date);

CREATE TRIGGER trg_trip_updated_at
BEFORE UPDATE ON trip
FOR EACH ROW
EXECUTE FUNCTION pms.set_updated_at();

-- ============================================================
-- 6. Trip Staff
-- ============================================================

CREATE TABLE trip_staff (
    trip_staff_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id             BIGINT NOT NULL,
    trip_id               BIGINT NOT NULL,
    staff_id              BIGINT NOT NULL,
    trip_role             VARCHAR(30) NOT NULL,
    joined_at             TIMESTAMPTZ,
    left_at               TIMESTAMPTZ,
    is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_by_user_id   BIGINT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_trip_staff_tenant_id
        UNIQUE (tenant_id, trip_staff_id),

    CONSTRAINT uq_trip_staff_assignment
        UNIQUE (tenant_id, trip_id, staff_id, trip_role, joined_at),

    CONSTRAINT fk_trip_staff_trip
        FOREIGN KEY (tenant_id, trip_id)
        REFERENCES trip(tenant_id, trip_id),

    CONSTRAINT fk_trip_staff_staff
        FOREIGN KEY (tenant_id, staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_trip_staff_assigned_by
        FOREIGN KEY (tenant_id, assigned_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_trip_staff_role
        CHECK (trip_role IN ('DRIVER', 'DELIVERY_STAFF', 'HELPER', 'RELIEVER')),

    CONSTRAINT ck_trip_staff_period
        CHECK (left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at)
);

CREATE INDEX ix_trip_staff_trip
    ON trip_staff (tenant_id, trip_id);

CREATE INDEX ix_trip_staff_staff
    ON trip_staff (tenant_id, staff_id, joined_at);

-- ============================================================
-- 7. Trip Stop
-- ============================================================

CREATE TABLE trip_stop (
    trip_stop_id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                     BIGINT NOT NULL,
    trip_id                       BIGINT NOT NULL,
    party_id                      BIGINT NOT NULL,
    route_stop_template_id        BIGINT,
    source                        VARCHAR(30) NOT NULL,
    sortable_order                NUMERIC(18,6) NOT NULL,
    status                        VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    added_by_user_id              BIGINT,
    added_by_staff_id             BIGINT,
    added_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempted_at                  TIMESTAMPTZ,
    completed_at                  TIMESTAMPTZ,
    reason_code                   VARCHAR(50),
    notes                         VARCHAR(500),
    rescheduled_to_trip_stop_id   BIGINT,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_trip_stop_tenant_id
        UNIQUE (tenant_id, trip_stop_id),

    CONSTRAINT uq_trip_stop_trip_order
        UNIQUE (tenant_id, trip_id, sortable_order),

    CONSTRAINT fk_trip_stop_trip
        FOREIGN KEY (tenant_id, trip_id)
        REFERENCES trip(tenant_id, trip_id),

    CONSTRAINT fk_trip_stop_party
        FOREIGN KEY (tenant_id, party_id)
        REFERENCES party(tenant_id, party_id),

    CONSTRAINT fk_trip_stop_template
        FOREIGN KEY (tenant_id, route_stop_template_id)
        REFERENCES route_stop_template(tenant_id, route_stop_template_id),

    CONSTRAINT fk_trip_stop_added_by_user
        FOREIGN KEY (tenant_id, added_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_trip_stop_added_by_staff
        FOREIGN KEY (tenant_id, added_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_trip_stop_rescheduled_to
        FOREIGN KEY (tenant_id, rescheduled_to_trip_stop_id)
        REFERENCES trip_stop(tenant_id, trip_stop_id),

    CONSTRAINT ck_trip_stop_source
        CHECK (source IN (
            'ROUTE',
            'ADMIN_ADDED',
            'STAFF_ADDED',
            'CUSTOMER_ORDER',
            'AD_HOC_NEW_CUSTOMER',
            'RESCHEDULED'
        )),

    CONSTRAINT ck_trip_stop_status
        CHECK (status IN (
            'PENDING',
            'IN_SERVICE',
            'COMPLETED',
            'PARTIAL',
            'SKIPPED',
            'NOT_AVAILABLE',
            'FAILED',
            'RESCHEDULED',
            'CANCELLED'
        )),

    CONSTRAINT ck_trip_stop_order
        CHECK (sortable_order > 0),

    CONSTRAINT ck_trip_stop_actor
        CHECK (
            source = 'ROUTE'
            OR added_by_user_id IS NOT NULL
            OR added_by_staff_id IS NOT NULL
        ),

    CONSTRAINT ck_trip_stop_completion
        CHECK (
            (status IN ('COMPLETED', 'PARTIAL') AND completed_at IS NOT NULL)
            OR
            status NOT IN ('COMPLETED', 'PARTIAL')
        ),

    CONSTRAINT ck_trip_stop_reason
        CHECK (
            status NOT IN ('SKIPPED', 'NOT_AVAILABLE', 'FAILED', 'CANCELLED')
            OR reason_code IS NOT NULL
        )
);

CREATE INDEX ix_trip_stop_trip_status_order
    ON trip_stop (tenant_id, trip_id, status, sortable_order);

CREATE INDEX ix_trip_stop_party_date_support
    ON trip_stop (tenant_id, party_id, trip_id);

CREATE TRIGGER trg_trip_stop_updated_at
BEFORE UPDATE ON trip_stop
FOR EACH ROW
EXECUTE FUNCTION pms.set_updated_at();

-- ============================================================
-- 8. Trip Stop Product
-- ============================================================

CREATE TABLE trip_stop_product (
    trip_stop_product_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id            BIGINT NOT NULL,
    trip_stop_id         BIGINT NOT NULL,
    product_id           BIGINT NOT NULL,
    party_product_id     BIGINT,
    quantity_mode        VARCHAR(30) NOT NULL,
    planned_qty          NUMERIC(14,3),
    forecast_qty         NUMERIC(14,3),
    price_snapshot       NUMERIC(14,2),
    status               VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    notes                VARCHAR(500),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_trip_stop_product_tenant_id
        UNIQUE (tenant_id, trip_stop_product_id),

    CONSTRAINT uq_trip_stop_product_stop_product
        UNIQUE (tenant_id, trip_stop_id, product_id),

    CONSTRAINT fk_trip_stop_product_stop
        FOREIGN KEY (tenant_id, trip_stop_id)
        REFERENCES trip_stop(tenant_id, trip_stop_id),

    CONSTRAINT fk_trip_stop_product_product
        FOREIGN KEY (tenant_id, product_id)
        REFERENCES product(tenant_id, product_id),

    CONSTRAINT fk_trip_stop_product_party_product
        FOREIGN KEY (tenant_id, party_product_id)
        REFERENCES party_product(tenant_id, party_product_id),

    CONSTRAINT ck_trip_stop_product_quantity_mode
        CHECK (quantity_mode IN ('FIXED_PLANNED', 'RETURN_MATCHED', 'AD_HOC')),

    CONSTRAINT ck_trip_stop_product_planned_qty
        CHECK (
            (quantity_mode = 'FIXED_PLANNED' AND planned_qty IS NOT NULL AND planned_qty > 0)
            OR
            (quantity_mode <> 'FIXED_PLANNED' AND (planned_qty IS NULL OR planned_qty > 0))
        ),

    CONSTRAINT ck_trip_stop_product_forecast_qty
        CHECK (forecast_qty IS NULL OR forecast_qty > 0),

    CONSTRAINT ck_trip_stop_product_price
        CHECK (price_snapshot IS NULL OR price_snapshot >= 0),

    CONSTRAINT ck_trip_stop_product_status
        CHECK (status IN ('PENDING', 'COMPLETED', 'PARTIAL', 'CANCELLED'))
);

CREATE INDEX ix_trip_stop_product_stop
    ON trip_stop_product (tenant_id, trip_stop_id, status);

CREATE TRIGGER trg_trip_stop_product_updated_at
BEFORE UPDATE ON trip_stop_product
FOR EACH ROW
EXECUTE FUNCTION pms.set_updated_at();

-- ============================================================
-- 9. Optional helper function: validate live stop insertion
-- ============================================================
-- This is intentionally a DB guard, not a complete workflow engine.
-- The API/domain layer must still check role/permission and business config.

CREATE OR REPLACE FUNCTION pms.assert_trip_accepts_new_stop(p_tenant_id BIGINT, p_trip_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(20);
BEGIN
    SELECT status
      INTO v_status
      FROM trip
     WHERE tenant_id = p_tenant_id
       AND trip_id = p_trip_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Trip not found for tenant';
    END IF;

    IF v_status NOT IN ('PLANNED', 'LOADED', 'DISPATCHED', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Trip status % does not allow new stops', v_status;
    END IF;
END;
$$;

-- ============================================================
-- 10. Optional helper function: normalize stop order
-- ============================================================
-- Allows sparse ordering during live operations (10, 20, 25, 30...)
-- and periodic normalization when needed.

CREATE OR REPLACE FUNCTION pms.normalize_trip_stop_order(
    p_tenant_id BIGINT,
    p_trip_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    WITH ranked AS (
        SELECT
            trip_stop_id,
            ROW_NUMBER() OVER (ORDER BY sortable_order, trip_stop_id) * 10 AS new_order
        FROM trip_stop
        WHERE tenant_id = p_tenant_id
          AND trip_id = p_trip_id
    )
    UPDATE trip_stop ts
       SET sortable_order = ranked.new_order,
           updated_at = NOW()
      FROM ranked
     WHERE ts.tenant_id = p_tenant_id
       AND ts.trip_id = p_trip_id
       AND ts.trip_stop_id = ranked.trip_stop_id;
END;
$$;

-- ============================================================
-- 11. RLS
-- ============================================================

ALTER TABLE route ENABLE ROW LEVEL SECURITY;
ALTER TABLE route FORCE ROW LEVEL SECURITY;

ALTER TABLE route_stop_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stop_template FORCE ROW LEVEL SECURITY;

ALTER TABLE route_stop_product ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stop_product FORCE ROW LEVEL SECURITY;

ALTER TABLE vehicle ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle FORCE ROW LEVEL SECURITY;

ALTER TABLE trip ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip FORCE ROW LEVEL SECURITY;

ALTER TABLE trip_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_staff FORCE ROW LEVEL SECURITY;

ALTER TABLE trip_stop ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_stop FORCE ROW LEVEL SECURITY;

ALTER TABLE trip_stop_product ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_stop_product FORCE ROW LEVEL SECURITY;

CREATE POLICY route_tenant_isolation ON route
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY route_stop_template_tenant_isolation ON route_stop_template
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY route_stop_product_tenant_isolation ON route_stop_product
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY vehicle_tenant_isolation ON vehicle
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY trip_tenant_isolation ON trip
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY trip_staff_tenant_isolation ON trip_staff
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY trip_stop_tenant_isolation ON trip_stop
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY trip_stop_product_tenant_isolation ON trip_stop_product
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

-- ============================================================
-- 12. Operational state-transition guard (minimal DB protection)
-- ============================================================
-- Full state-machine rules belong in domain/application logic.
-- This trigger blocks obviously invalid backward transitions.

CREATE OR REPLACE FUNCTION pms.validate_trip_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'PLANNED' AND NEW.status IN ('LOADED', 'CANCELLED') THEN
        RETURN NEW;
    ELSIF OLD.status = 'LOADED' AND NEW.status IN ('DISPATCHED', 'CANCELLED') THEN
        RETURN NEW;
    ELSIF OLD.status = 'DISPATCHED' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED') THEN
        RETURN NEW;
    ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status IN ('COMPLETED', 'CANCELLED') THEN
        RETURN NEW;
    ELSIF OLD.status = 'COMPLETED' AND NEW.status IN ('RECONCILED') THEN
        RETURN NEW;
    ELSE
        RAISE EXCEPTION 'Invalid trip status transition: % -> %', OLD.status, NEW.status;
    END IF;
END;
$$;

CREATE TRIGGER trg_trip_status_transition
BEFORE UPDATE OF status ON trip
FOR EACH ROW
EXECUTE FUNCTION pms.validate_trip_status_transition();

-- ============================================================
-- 13. Notes for Sprint 0C / DDL v1.2
-- ============================================================
--
-- Next pass:
--   StopEvent
--   StopEventProduct
--   ExchangeException
--   PriceOverride
--   StopFollowUp
--   InventoryLocation
--   InventoryLedgerEntry
--   MoneyLedgerEntry
--   PaymentAllocation
--
-- Then:
--   TripReconciliation
--   TripStockReconciliation
--   TripCashReconciliation
--   CashHandover
--   Derived views
--
-- Key invariants for next pass:
--   - StopEvent idempotent via client UUID.
--   - Return-matched shops record actual eligible/damaged/rejected empties.
--   - Forecast quantity never posts ledger movement.
--   - Posted ledger entries are append-only.
--   - Corrections create reversal/adjustment records.
--   - Customer container balance is derived.
--   - Vehicle stock is derived.
--   - Staff cash-in-hand is derived.
--

COMMIT;
