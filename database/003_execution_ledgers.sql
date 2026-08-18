
-- Product Management System (PMS)
-- PostgreSQL DDL v1.2 - Sprint 0C Execution + Ledgers
-- Date: 2026-08-18
--
-- Requires:
--   PMS PostgreSQL DDL v1.0 / Sprint 0A
--   PMS PostgreSQL DDL v1.1 / Sprint 0B
--
-- Scope:
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
-- Core invariants:
--   1) StopEvent is the operational truth of what happened at a stop.
--   2) Offline posting is idempotent through client_uuid.
--   3) RETURN_MATCHED deliveries record actual good/damaged/rejected empties independently.
--   4) Inventory and money ledgers are append-only.
--   5) Corrections/reversals create new rows; posted ledger rows are never edited in place.
--   6) Customer stock/container balance, vehicle stock and customer/staff money balances are derived.
--   7) Forecast quantity never posts inventory or money movement.
--   8) Price overrides and exchange exceptions have explicit audit records.
--
-- IMPORTANT:
-- Each tenant request must execute:
--   SET LOCAL app.tenant_id = '<tenant_id>';
-- inside the request transaction.

BEGIN;

SET search_path TO pms, public;

-- ============================================================
-- 0. Shared append-only guard
-- ============================================================

CREATE OR REPLACE FUNCTION pms.prevent_posted_row_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; create a reversal/correction entry instead',
        TG_TABLE_NAME;
END;
$$;

-- ============================================================
-- 1. Stop Event
-- ============================================================

CREATE TABLE stop_event (
    stop_event_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                   BIGINT NOT NULL,
    trip_id                     BIGINT NOT NULL,
    trip_stop_id                BIGINT NOT NULL,
    party_id                    BIGINT NOT NULL,

    event_type                  VARCHAR(30) NOT NULL,
    event_status                VARCHAR(20) NOT NULL DEFAULT 'POSTED',

    performed_by_staff_id       BIGINT,
    performed_by_user_id        BIGINT,

    event_time                  TIMESTAMPTZ NOT NULL,
    server_received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    client_uuid                 UUID NOT NULL,
    device_id                   VARCHAR(150),

    latitude                    NUMERIC(9,6),
    longitude                   NUMERIC(9,6),

    notes                       VARCHAR(1000),

    correction_of_event_id      BIGINT,
    correction_reason           VARCHAR(500),

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_stop_event_tenant_id
        UNIQUE (tenant_id, stop_event_id),

    CONSTRAINT uq_stop_event_client_uuid
        UNIQUE (tenant_id, client_uuid),

    CONSTRAINT fk_stop_event_trip
        FOREIGN KEY (tenant_id, trip_id)
        REFERENCES trip(tenant_id, trip_id),

    CONSTRAINT fk_stop_event_trip_stop
        FOREIGN KEY (tenant_id, trip_stop_id)
        REFERENCES trip_stop(tenant_id, trip_stop_id),

    CONSTRAINT fk_stop_event_party
        FOREIGN KEY (tenant_id, party_id)
        REFERENCES party(tenant_id, party_id),

    CONSTRAINT fk_stop_event_staff
        FOREIGN KEY (tenant_id, performed_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_stop_event_user
        FOREIGN KEY (tenant_id, performed_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_stop_event_correction
        FOREIGN KEY (tenant_id, correction_of_event_id)
        REFERENCES stop_event(tenant_id, stop_event_id),

    CONSTRAINT ck_stop_event_type
        CHECK (event_type IN (
            'DELIVERY',
            'COLLECTION_ONLY',
            'RETURN_ONLY',
            'DAMAGE',
            'REPLACEMENT',
            'CORRECTION'
        )),

    CONSTRAINT ck_stop_event_status
        CHECK (event_status IN ('POSTED', 'VOIDED_BY_REVERSAL')),

    CONSTRAINT ck_stop_event_actor
        CHECK (
            performed_by_staff_id IS NOT NULL
            OR performed_by_user_id IS NOT NULL
        ),

    CONSTRAINT ck_stop_event_latitude
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),

    CONSTRAINT ck_stop_event_longitude
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),

    CONSTRAINT ck_stop_event_correction_consistency
        CHECK (
            (event_type = 'CORRECTION'
                AND correction_of_event_id IS NOT NULL
                AND correction_reason IS NOT NULL)
            OR
            event_type <> 'CORRECTION'
        )
);

CREATE INDEX ix_stop_event_trip_stop_time
    ON stop_event (tenant_id, trip_stop_id, event_time);

CREATE INDEX ix_stop_event_party_time
    ON stop_event (tenant_id, party_id, event_time DESC);

CREATE INDEX ix_stop_event_trip_time
    ON stop_event (tenant_id, trip_id, event_time);

-- ============================================================
-- 2. Stop Event Product
-- ============================================================

CREATE TABLE stop_event_product (
    stop_event_product_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                      BIGINT NOT NULL,
    stop_event_id                  BIGINT NOT NULL,
    trip_stop_product_id           BIGINT,
    product_id                     BIGINT NOT NULL,

    quantity_mode_snapshot         VARCHAR(30) NOT NULL,
    exchange_ratio_snapshot       NUMERIC(12,4),

    full_qty_delivered             NUMERIC(14,3) NOT NULL DEFAULT 0,
    empty_qty_received_good        NUMERIC(14,3) NOT NULL DEFAULT 0,
    empty_qty_received_damaged     NUMERIC(14,3) NOT NULL DEFAULT 0,
    empty_qty_rejected             NUMERIC(14,3) NOT NULL DEFAULT 0,

    container_credit_qty           NUMERIC(14,3) NOT NULL DEFAULT 0,
    container_due_qty              NUMERIC(14,3) NOT NULL DEFAULT 0,

    price_applied                  NUMERIC(14,2),
    price_source                   VARCHAR(30),
    line_charge_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
    damage_charge_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,

    notes                          VARCHAR(1000),
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_stop_event_product_tenant_id
        UNIQUE (tenant_id, stop_event_product_id),

    CONSTRAINT uq_stop_event_product_event_product
        UNIQUE (tenant_id, stop_event_id, product_id),

    CONSTRAINT fk_stop_event_product_event
        FOREIGN KEY (tenant_id, stop_event_id)
        REFERENCES stop_event(tenant_id, stop_event_id),

    CONSTRAINT fk_stop_event_product_trip_stop_product
        FOREIGN KEY (tenant_id, trip_stop_product_id)
        REFERENCES trip_stop_product(tenant_id, trip_stop_product_id),

    CONSTRAINT fk_stop_event_product_product
        FOREIGN KEY (tenant_id, product_id)
        REFERENCES product(tenant_id, product_id),

    CONSTRAINT ck_stop_event_product_quantity_mode
        CHECK (quantity_mode_snapshot IN ('FIXED_PLANNED', 'RETURN_MATCHED', 'AD_HOC')),

    CONSTRAINT ck_stop_event_product_exchange_ratio
        CHECK (
            exchange_ratio_snapshot IS NULL
            OR exchange_ratio_snapshot > 0
        ),

    CONSTRAINT ck_stop_event_product_quantities
        CHECK (
            full_qty_delivered >= 0
            AND empty_qty_received_good >= 0
            AND empty_qty_received_damaged >= 0
            AND empty_qty_rejected >= 0
            AND container_credit_qty >= 0
            AND container_due_qty >= 0
        ),

    CONSTRAINT ck_stop_event_product_price
        CHECK (price_applied IS NULL OR price_applied >= 0),

    CONSTRAINT ck_stop_event_product_price_source
        CHECK (
            price_source IS NULL
            OR price_source IN (
                'CUSTOMER_PRICE',
                'PRODUCT_DEFAULT',
                'STAFF_OVERRIDE',
                'NO_CHARGE'
            )
        ),

    CONSTRAINT ck_stop_event_product_charges
        CHECK (
            line_charge_amount >= 0
            AND damage_charge_amount >= 0
        ),

    CONSTRAINT ck_stop_event_product_activity
        CHECK (
            full_qty_delivered > 0
            OR empty_qty_received_good > 0
            OR empty_qty_received_damaged > 0
            OR empty_qty_rejected > 0
            OR damage_charge_amount > 0
            OR line_charge_amount > 0
        )
);

CREATE INDEX ix_stop_event_product_event
    ON stop_event_product (tenant_id, stop_event_id);

CREATE INDEX ix_stop_event_product_product
    ON stop_event_product (tenant_id, product_id, created_at DESC);

-- ============================================================
-- 3. Exchange Exception
-- ============================================================

CREATE TABLE exchange_exception (
    exchange_exception_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                     BIGINT NOT NULL,
    stop_event_product_id         BIGINT NOT NULL,

    exception_type                VARCHAR(40) NOT NULL,
    quantity                      NUMERIC(14,3) NOT NULL,
    resolution                    VARCHAR(50) NOT NULL,

    authorized_by_staff_id        BIGINT,
    approved_by_user_id           BIGINT,
    approved_at                   TIMESTAMPTZ,

    notes                         VARCHAR(1000),
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_exchange_exception_tenant_id
        UNIQUE (tenant_id, exchange_exception_id),

    CONSTRAINT fk_exchange_exception_product
        FOREIGN KEY (tenant_id, stop_event_product_id)
        REFERENCES stop_event_product(tenant_id, stop_event_product_id),

    CONSTRAINT fk_exchange_exception_staff
        FOREIGN KEY (tenant_id, authorized_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_exchange_exception_user
        FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_exchange_exception_type
        CHECK (exception_type IN (
            'EXCESS_EMPTY',
            'CONTAINER_DUE',
            'STOCK_SHORTAGE',
            'DAMAGED_CONTAINER'
        )),

    CONSTRAINT ck_exchange_exception_quantity
        CHECK (quantity > 0),

    CONSTRAINT ck_exchange_exception_resolution
        CHECK (resolution IN (
            'ACCEPT_AS_CREDIT',
            'ACCEPT_ONLY_REPLACED',
            'DELIVER_WITH_CONTAINER_DUE',
            'PARTIAL_DELIVERY',
            'CHARGE_DAMAGE',
            'ACCEPT_DAMAGE_WITHOUT_CHARGE',
            'REJECT_DAMAGE'
        )),

    CONSTRAINT ck_exchange_exception_actor
        CHECK (
            authorized_by_staff_id IS NOT NULL
            OR approved_by_user_id IS NOT NULL
        )
);

CREATE INDEX ix_exchange_exception_event_product
    ON exchange_exception (tenant_id, stop_event_product_id);

-- ============================================================
-- 4. Price Override
-- ============================================================

CREATE TABLE price_override (
    price_override_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                     BIGINT NOT NULL,
    stop_event_product_id         BIGINT NOT NULL,

    standard_price                NUMERIC(14,2) NOT NULL,
    requested_price               NUMERIC(14,2) NOT NULL,

    requested_by_staff_id         BIGINT,
    requested_by_user_id          BIGINT,

    approval_status               VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    approved_by_user_id           BIGINT,
    approved_at                   TIMESTAMPTZ,

    reason                        VARCHAR(1000) NOT NULL,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_price_override_tenant_id
        UNIQUE (tenant_id, price_override_id),

    CONSTRAINT uq_price_override_event_product
        UNIQUE (tenant_id, stop_event_product_id),

    CONSTRAINT fk_price_override_event_product
        FOREIGN KEY (tenant_id, stop_event_product_id)
        REFERENCES stop_event_product(tenant_id, stop_event_product_id),

    CONSTRAINT fk_price_override_requested_by_staff
        FOREIGN KEY (tenant_id, requested_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_price_override_requested_by_user
        FOREIGN KEY (tenant_id, requested_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_price_override_approved_by
        FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_price_override_values
        CHECK (standard_price >= 0 AND requested_price >= 0),

    CONSTRAINT ck_price_override_requestor
        CHECK (
            requested_by_staff_id IS NOT NULL
            OR requested_by_user_id IS NOT NULL
        ),

    CONSTRAINT ck_price_override_status
        CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),

    CONSTRAINT ck_price_override_approval
        CHECK (
            (approval_status = 'APPROVED'
                AND approved_by_user_id IS NOT NULL
                AND approved_at IS NOT NULL)
            OR
            approval_status <> 'APPROVED'
        )
);

CREATE INDEX ix_price_override_status
    ON price_override (tenant_id, approval_status, created_at DESC);

-- ============================================================
-- 5. Stop Follow Up / Partial Continuation
-- ============================================================

CREATE TABLE stop_follow_up (
    follow_up_id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                      BIGINT NOT NULL,

    source_trip_stop_id            BIGINT NOT NULL,
    source_stop_event_id           BIGINT,
    party_id                       BIGINT NOT NULL,
    product_id                     BIGINT NOT NULL,

    remaining_qty                  NUMERIC(14,3),
    resolution_type                VARCHAR(30) NOT NULL,
    new_trip_stop_id               BIGINT,

    status                         VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    reason                         VARCHAR(1000),

    created_by_user_id             BIGINT,
    created_by_staff_id            BIGINT,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at                    TIMESTAMPTZ,

    CONSTRAINT uq_stop_follow_up_tenant_id
        UNIQUE (tenant_id, follow_up_id),

    CONSTRAINT fk_stop_follow_up_source_stop
        FOREIGN KEY (tenant_id, source_trip_stop_id)
        REFERENCES trip_stop(tenant_id, trip_stop_id),

    CONSTRAINT fk_stop_follow_up_source_event
        FOREIGN KEY (tenant_id, source_stop_event_id)
        REFERENCES stop_event(tenant_id, stop_event_id),

    CONSTRAINT fk_stop_follow_up_party
        FOREIGN KEY (tenant_id, party_id)
        REFERENCES party(tenant_id, party_id),

    CONSTRAINT fk_stop_follow_up_product
        FOREIGN KEY (tenant_id, product_id)
        REFERENCES product(tenant_id, product_id),

    CONSTRAINT fk_stop_follow_up_new_stop
        FOREIGN KEY (tenant_id, new_trip_stop_id)
        REFERENCES trip_stop(tenant_id, trip_stop_id),

    CONSTRAINT fk_stop_follow_up_created_by_user
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_stop_follow_up_created_by_staff
        FOREIGN KEY (tenant_id, created_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT ck_stop_follow_up_qty
        CHECK (remaining_qty IS NULL OR remaining_qty > 0),

    CONSTRAINT ck_stop_follow_up_resolution
        CHECK (resolution_type IN (
            'NEW_TRIP_STOP',
            'FOLLOW_UP',
            'CANCELLED'
        )),

    CONSTRAINT ck_stop_follow_up_status
        CHECK (status IN ('OPEN', 'SCHEDULED', 'RESOLVED', 'CANCELLED')),

    CONSTRAINT ck_stop_follow_up_actor
        CHECK (
            created_by_user_id IS NOT NULL
            OR created_by_staff_id IS NOT NULL
        ),

    CONSTRAINT ck_stop_follow_up_new_stop_consistency
        CHECK (
            (resolution_type = 'NEW_TRIP_STOP' AND new_trip_stop_id IS NOT NULL)
            OR
            resolution_type <> 'NEW_TRIP_STOP'
        )
);

CREATE INDEX ix_stop_follow_up_open
    ON stop_follow_up (tenant_id, status, party_id, created_at DESC);

-- ============================================================
-- 6. Inventory Location
-- ============================================================

CREATE TABLE inventory_location (
    inventory_location_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                      BIGINT NOT NULL,

    location_code                  VARCHAR(60) NOT NULL,
    name                           VARCHAR(200) NOT NULL,
    location_type                  VARCHAR(30) NOT NULL,

    vehicle_id                     BIGINT,
    party_id                       BIGINT,

    status                         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id             BIGINT,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inventory_location_tenant_id
        UNIQUE (tenant_id, inventory_location_id),

    CONSTRAINT uq_inventory_location_code
        UNIQUE (tenant_id, location_code),

    CONSTRAINT fk_inventory_location_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenant(tenant_id),

    CONSTRAINT fk_inventory_location_vehicle
        FOREIGN KEY (tenant_id, vehicle_id)
        REFERENCES vehicle(tenant_id, vehicle_id),

    CONSTRAINT fk_inventory_location_party
        FOREIGN KEY (tenant_id, party_id)
        REFERENCES party(tenant_id, party_id),

    CONSTRAINT fk_inventory_location_created_by
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT ck_inventory_location_type
        CHECK (location_type IN (
            'GODOWN',
            'VEHICLE',
            'CUSTOMER',
            'SUPPLIER',
            'CLEANING_AREA',
            'REFILL_AREA',
            'DAMAGE_AREA',
            'OTHER'
        )),

    CONSTRAINT ck_inventory_location_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),

    CONSTRAINT ck_inventory_location_reference
        CHECK (
            (location_type = 'VEHICLE' AND vehicle_id IS NOT NULL AND party_id IS NULL)
            OR
            (location_type = 'CUSTOMER' AND party_id IS NOT NULL AND vehicle_id IS NULL)
            OR
            (location_type NOT IN ('VEHICLE', 'CUSTOMER'))
        )
);

CREATE INDEX ix_inventory_location_type
    ON inventory_location (tenant_id, location_type, status);

CREATE TRIGGER trg_inventory_location_updated_at
BEFORE UPDATE ON inventory_location
FOR EACH ROW
EXECUTE FUNCTION pms.set_updated_at();

-- ============================================================
-- 7. Inventory Ledger Entry
-- ============================================================

CREATE TABLE inventory_ledger_entry (
    inventory_ledger_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                      BIGINT NOT NULL,

    product_id                     BIGINT NOT NULL,

    from_location_id               BIGINT,
    to_location_id                 BIGINT,

    from_state_id                  BIGINT,
    to_state_id                    BIGINT,

    party_id                       BIGINT,

    quantity                       NUMERIC(14,3) NOT NULL,
    event_type                     VARCHAR(40) NOT NULL,

    trip_id                        BIGINT,
    trip_stop_id                   BIGINT,
    stop_event_id                  BIGINT,

    reference_type                 VARCHAR(50),
    reference_id                   BIGINT,

    reverses_inventory_ledger_id   BIGINT,
    occurred_at                    TIMESTAMPTZ NOT NULL,

    created_by_user_id             BIGINT,
    created_by_staff_id            BIGINT,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inventory_ledger_tenant_id
        UNIQUE (tenant_id, inventory_ledger_id),

    CONSTRAINT fk_inventory_ledger_product
        FOREIGN KEY (tenant_id, product_id)
        REFERENCES product(tenant_id, product_id),

    CONSTRAINT fk_inventory_ledger_from_location
        FOREIGN KEY (tenant_id, from_location_id)
        REFERENCES inventory_location(tenant_id, inventory_location_id),

    CONSTRAINT fk_inventory_ledger_to_location
        FOREIGN KEY (tenant_id, to_location_id)
        REFERENCES inventory_location(tenant_id, inventory_location_id),

    CONSTRAINT fk_inventory_ledger_from_state
        FOREIGN KEY (from_state_id)
        REFERENCES inventory_state(inventory_state_id),

    CONSTRAINT fk_inventory_ledger_to_state
        FOREIGN KEY (to_state_id)
        REFERENCES inventory_state(inventory_state_id),

    CONSTRAINT fk_inventory_ledger_party
        FOREIGN KEY (tenant_id, party_id)
        REFERENCES party(tenant_id, party_id),

    CONSTRAINT fk_inventory_ledger_trip
        FOREIGN KEY (tenant_id, trip_id)
        REFERENCES trip(tenant_id, trip_id),

    CONSTRAINT fk_inventory_ledger_trip_stop
        FOREIGN KEY (tenant_id, trip_stop_id)
        REFERENCES trip_stop(tenant_id, trip_stop_id),

    CONSTRAINT fk_inventory_ledger_stop_event
        FOREIGN KEY (tenant_id, stop_event_id)
        REFERENCES stop_event(tenant_id, stop_event_id),

    CONSTRAINT fk_inventory_ledger_reversal
        FOREIGN KEY (tenant_id, reverses_inventory_ledger_id)
        REFERENCES inventory_ledger_entry(tenant_id, inventory_ledger_id),

    CONSTRAINT fk_inventory_ledger_created_by_user
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_inventory_ledger_created_by_staff
        FOREIGN KEY (tenant_id, created_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT ck_inventory_ledger_quantity
        CHECK (quantity > 0),

    CONSTRAINT ck_inventory_ledger_event_type
        CHECK (event_type IN (
            'PURCHASE',
            'TRIP_LOAD',
            'DELIVERY',
            'EMPTY_RETURN',
            'DAMAGE_RETURN',
            'CLEANING_IN',
            'CLEANING_OUT',
            'REFILL_IN',
            'REFILL_COMPLETE',
            'VEHICLE_RETURN',
            'STOCK_TRANSFER',
            'LOSS',
            'DAMAGE',
            'ADJUSTMENT',
            'REVERSAL'
        )),

    CONSTRAINT ck_inventory_ledger_endpoints
        CHECK (
            from_location_id IS NOT NULL
            OR to_location_id IS NOT NULL
            OR from_state_id IS NOT NULL
            OR to_state_id IS NOT NULL
        ),

    CONSTRAINT ck_inventory_ledger_no_same_location
        CHECK (
            from_location_id IS NULL
            OR to_location_id IS NULL
            OR from_location_id <> to_location_id
            OR from_state_id IS DISTINCT FROM to_state_id
        ),

    CONSTRAINT ck_inventory_ledger_actor
        CHECK (
            created_by_user_id IS NOT NULL
            OR created_by_staff_id IS NOT NULL
        ),

    CONSTRAINT ck_inventory_ledger_reversal_consistency
        CHECK (
            (event_type = 'REVERSAL' AND reverses_inventory_ledger_id IS NOT NULL)
            OR
            event_type <> 'REVERSAL'
        )
);

CREATE INDEX ix_inventory_ledger_product_time
    ON inventory_ledger_entry (tenant_id, product_id, occurred_at DESC);

CREATE INDEX ix_inventory_ledger_from_location
    ON inventory_ledger_entry (tenant_id, from_location_id, product_id, occurred_at DESC);

CREATE INDEX ix_inventory_ledger_to_location
    ON inventory_ledger_entry (tenant_id, to_location_id, product_id, occurred_at DESC);

CREATE INDEX ix_inventory_ledger_trip
    ON inventory_ledger_entry (tenant_id, trip_id, occurred_at);

CREATE INDEX ix_inventory_ledger_stop_event
    ON inventory_ledger_entry (tenant_id, stop_event_id);

CREATE UNIQUE INDEX uq_inventory_ledger_one_reversal
    ON inventory_ledger_entry (tenant_id, reverses_inventory_ledger_id)
    WHERE reverses_inventory_ledger_id IS NOT NULL;

CREATE TRIGGER trg_inventory_ledger_no_update
BEFORE UPDATE ON inventory_ledger_entry
FOR EACH ROW
EXECUTE FUNCTION pms.prevent_posted_row_mutation();

CREATE TRIGGER trg_inventory_ledger_no_delete
BEFORE DELETE ON inventory_ledger_entry
FOR EACH ROW
EXECUTE FUNCTION pms.prevent_posted_row_mutation();

-- ============================================================
-- 8. Money Ledger Entry
-- ============================================================

CREATE TABLE money_ledger_entry (
    money_ledger_id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                      BIGINT NOT NULL,

    party_id                       BIGINT,
    staff_id                       BIGINT,

    amount                         NUMERIC(14,2) NOT NULL,
    direction                      VARCHAR(10) NOT NULL,
    transaction_type               VARCHAR(40) NOT NULL,

    payment_method                 VARCHAR(30),
    account_type                   VARCHAR(30),

    trip_id                        BIGINT,
    trip_stop_id                   BIGINT,
    stop_event_id                  BIGINT,

    invoice_id                     BIGINT,

    reference_type                 VARCHAR(50),
    reference_id                   BIGINT,

    reverses_money_ledger_id       BIGINT,
    occurred_at                    TIMESTAMPTZ NOT NULL,

    created_by_user_id             BIGINT,
    created_by_staff_id            BIGINT,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_money_ledger_tenant_id
        UNIQUE (tenant_id, money_ledger_id),

    CONSTRAINT fk_money_ledger_party
        FOREIGN KEY (tenant_id, party_id)
        REFERENCES party(tenant_id, party_id),

    CONSTRAINT fk_money_ledger_staff
        FOREIGN KEY (tenant_id, staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT fk_money_ledger_trip
        FOREIGN KEY (tenant_id, trip_id)
        REFERENCES trip(tenant_id, trip_id),

    CONSTRAINT fk_money_ledger_trip_stop
        FOREIGN KEY (tenant_id, trip_stop_id)
        REFERENCES trip_stop(tenant_id, trip_stop_id),

    CONSTRAINT fk_money_ledger_stop_event
        FOREIGN KEY (tenant_id, stop_event_id)
        REFERENCES stop_event(tenant_id, stop_event_id),

    CONSTRAINT fk_money_ledger_reversal
        FOREIGN KEY (tenant_id, reverses_money_ledger_id)
        REFERENCES money_ledger_entry(tenant_id, money_ledger_id),

    CONSTRAINT fk_money_ledger_created_by_user
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_money_ledger_created_by_staff
        FOREIGN KEY (tenant_id, created_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT ck_money_ledger_amount
        CHECK (amount > 0),

    CONSTRAINT ck_money_ledger_direction
        CHECK (direction IN ('IN', 'OUT')),

    CONSTRAINT ck_money_ledger_transaction_type
        CHECK (transaction_type IN (
            'CUSTOMER_CHARGE',
            'CUSTOMER_PAYMENT',
            'DAMAGE_CHARGE',
            'STAFF_CASH_HANDOVER',
            'SALARY',
            'EXPENSE',
            'REFUND',
            'CUSTOMER_CREDIT',
            'CREDIT_ADJUSTMENT',
            'ADJUSTMENT',
            'REVERSAL'
        )),

    CONSTRAINT ck_money_ledger_payment_method
        CHECK (
            payment_method IS NULL
            OR payment_method IN (
                'CASH',
                'UPI',
                'CARD',
                'BANK_TRANSFER',
                'CHEQUE',
                'WALLET',
                'OTHER'
            )
        ),

    CONSTRAINT ck_money_ledger_account_type
        CHECK (
            account_type IS NULL
            OR account_type IN (
                'CUSTOMER_RECEIVABLE',
                'STAFF_CASH',
                'TENANT_CASH',
                'BANK',
                'EXPENSE',
                'PAYROLL',
                'OTHER'
            )
        ),

    CONSTRAINT ck_money_ledger_actor
        CHECK (
            created_by_user_id IS NOT NULL
            OR created_by_staff_id IS NOT NULL
        ),

    CONSTRAINT ck_money_ledger_reversal_consistency
        CHECK (
            (transaction_type = 'REVERSAL' AND reverses_money_ledger_id IS NOT NULL)
            OR
            transaction_type <> 'REVERSAL'
        )
);

CREATE INDEX ix_money_ledger_party_time
    ON money_ledger_entry (tenant_id, party_id, occurred_at DESC);

CREATE INDEX ix_money_ledger_staff_time
    ON money_ledger_entry (tenant_id, staff_id, occurred_at DESC);

CREATE INDEX ix_money_ledger_trip
    ON money_ledger_entry (tenant_id, trip_id, occurred_at);

CREATE INDEX ix_money_ledger_stop_event
    ON money_ledger_entry (tenant_id, stop_event_id);

CREATE UNIQUE INDEX uq_money_ledger_one_reversal
    ON money_ledger_entry (tenant_id, reverses_money_ledger_id)
    WHERE reverses_money_ledger_id IS NOT NULL;

CREATE TRIGGER trg_money_ledger_no_update
BEFORE UPDATE ON money_ledger_entry
FOR EACH ROW
EXECUTE FUNCTION pms.prevent_posted_row_mutation();

CREATE TRIGGER trg_money_ledger_no_delete
BEFORE DELETE ON money_ledger_entry
FOR EACH ROW
EXECUTE FUNCTION pms.prevent_posted_row_mutation();

-- ============================================================
-- 9. Payment Allocation
-- ============================================================

CREATE TABLE payment_allocation (
    payment_allocation_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id                      BIGINT NOT NULL,

    payment_money_ledger_id        BIGINT NOT NULL,
    charge_money_ledger_id         BIGINT NOT NULL,
    allocated_amount               NUMERIC(14,2) NOT NULL,

    created_by_user_id             BIGINT,
    created_by_staff_id            BIGINT,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payment_allocation_tenant_id
        UNIQUE (tenant_id, payment_allocation_id),

    CONSTRAINT uq_payment_allocation_pair
        UNIQUE (tenant_id, payment_money_ledger_id, charge_money_ledger_id),

    CONSTRAINT fk_payment_allocation_payment
        FOREIGN KEY (tenant_id, payment_money_ledger_id)
        REFERENCES money_ledger_entry(tenant_id, money_ledger_id),

    CONSTRAINT fk_payment_allocation_charge
        FOREIGN KEY (tenant_id, charge_money_ledger_id)
        REFERENCES money_ledger_entry(tenant_id, money_ledger_id),

    CONSTRAINT fk_payment_allocation_created_by_user
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES app_user(tenant_id, user_id),

    CONSTRAINT fk_payment_allocation_created_by_staff
        FOREIGN KEY (tenant_id, created_by_staff_id)
        REFERENCES staff(tenant_id, staff_id),

    CONSTRAINT ck_payment_allocation_amount
        CHECK (allocated_amount > 0),

    CONSTRAINT ck_payment_allocation_not_self
        CHECK (payment_money_ledger_id <> charge_money_ledger_id),

    CONSTRAINT ck_payment_allocation_actor
        CHECK (
            created_by_user_id IS NOT NULL
            OR created_by_staff_id IS NOT NULL
        )
);

CREATE INDEX ix_payment_allocation_payment
    ON payment_allocation (tenant_id, payment_money_ledger_id);

CREATE INDEX ix_payment_allocation_charge
    ON payment_allocation (tenant_id, charge_money_ledger_id);

-- ============================================================
-- 10. Guard: validate payment allocation types and amounts
-- ============================================================

CREATE OR REPLACE FUNCTION pms.validate_payment_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_payment_type VARCHAR(40);
    v_charge_type  VARCHAR(40);
    v_payment_amt  NUMERIC(14,2);
    v_charge_amt   NUMERIC(14,2);
    v_payment_allocated NUMERIC(14,2);
    v_charge_allocated  NUMERIC(14,2);
BEGIN
    SELECT transaction_type, amount
      INTO v_payment_type, v_payment_amt
      FROM money_ledger_entry
     WHERE tenant_id = NEW.tenant_id
       AND money_ledger_id = NEW.payment_money_ledger_id;

    SELECT transaction_type, amount
      INTO v_charge_type, v_charge_amt
      FROM money_ledger_entry
     WHERE tenant_id = NEW.tenant_id
       AND money_ledger_id = NEW.charge_money_ledger_id;

    IF v_payment_type NOT IN ('CUSTOMER_PAYMENT', 'CUSTOMER_CREDIT') THEN
        RAISE EXCEPTION 'Ledger % is not an allocatable customer payment/credit',
            NEW.payment_money_ledger_id;
    END IF;

    IF v_charge_type NOT IN ('CUSTOMER_CHARGE', 'DAMAGE_CHARGE') THEN
        RAISE EXCEPTION 'Ledger % is not an allocatable customer charge',
            NEW.charge_money_ledger_id;
    END IF;

    SELECT COALESCE(SUM(allocated_amount), 0)
      INTO v_payment_allocated
      FROM payment_allocation
     WHERE tenant_id = NEW.tenant_id
       AND payment_money_ledger_id = NEW.payment_money_ledger_id;

    SELECT COALESCE(SUM(allocated_amount), 0)
      INTO v_charge_allocated
      FROM payment_allocation
     WHERE tenant_id = NEW.tenant_id
       AND charge_money_ledger_id = NEW.charge_money_ledger_id;

    IF v_payment_allocated + NEW.allocated_amount > v_payment_amt THEN
        RAISE EXCEPTION 'Allocation exceeds remaining payment amount';
    END IF;

    IF v_charge_allocated + NEW.allocated_amount > v_charge_amt THEN
        RAISE EXCEPTION 'Allocation exceeds remaining charge amount';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_payment_allocation
BEFORE INSERT ON payment_allocation
FOR EACH ROW
EXECUTE FUNCTION pms.validate_payment_allocation();

-- Payment allocation is also financial history; corrections should be
-- represented by reversing financial entries / compensating allocations
-- in the application workflow rather than destructive history edits.
CREATE TRIGGER trg_payment_allocation_no_update
BEFORE UPDATE ON payment_allocation
FOR EACH ROW
EXECUTE FUNCTION pms.prevent_posted_row_mutation();

CREATE TRIGGER trg_payment_allocation_no_delete
BEFORE DELETE ON payment_allocation
FOR EACH ROW
EXECUTE FUNCTION pms.prevent_posted_row_mutation();

-- ============================================================
-- 11. RLS
-- ============================================================

ALTER TABLE stop_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_event FORCE ROW LEVEL SECURITY;

ALTER TABLE stop_event_product ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_event_product FORCE ROW LEVEL SECURITY;

ALTER TABLE exchange_exception ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_exception FORCE ROW LEVEL SECURITY;

ALTER TABLE price_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_override FORCE ROW LEVEL SECURITY;

ALTER TABLE stop_follow_up ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_follow_up FORCE ROW LEVEL SECURITY;

ALTER TABLE inventory_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_location FORCE ROW LEVEL SECURITY;

ALTER TABLE inventory_ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger_entry FORCE ROW LEVEL SECURITY;

ALTER TABLE money_ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_ledger_entry FORCE ROW LEVEL SECURITY;

ALTER TABLE payment_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocation FORCE ROW LEVEL SECURITY;

CREATE POLICY stop_event_tenant_isolation ON stop_event
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY stop_event_product_tenant_isolation ON stop_event_product
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY exchange_exception_tenant_isolation ON exchange_exception
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY price_override_tenant_isolation ON price_override
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY stop_follow_up_tenant_isolation ON stop_follow_up
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY inventory_location_tenant_isolation ON inventory_location
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY inventory_ledger_tenant_isolation ON inventory_ledger_entry
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY money_ledger_tenant_isolation ON money_ledger_entry
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

CREATE POLICY payment_allocation_tenant_isolation ON payment_allocation
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

-- ============================================================
-- 12. Derived foundation views
-- ============================================================
-- These views are intentionally basic. Final reporting/materialized
-- views can be optimized after reconciliation and invoice tables exist.

CREATE OR REPLACE VIEW stock_on_hand_view AS
WITH outbound AS (
    SELECT
        tenant_id,
        from_location_id AS inventory_location_id,
        product_id,
        from_state_id AS inventory_state_id,
        -quantity AS qty
    FROM inventory_ledger_entry
    WHERE from_location_id IS NOT NULL
      AND from_state_id IS NOT NULL
),
inbound AS (
    SELECT
        tenant_id,
        to_location_id AS inventory_location_id,
        product_id,
        to_state_id AS inventory_state_id,
        quantity AS qty
    FROM inventory_ledger_entry
    WHERE to_location_id IS NOT NULL
      AND to_state_id IS NOT NULL
)
SELECT
    tenant_id,
    inventory_location_id,
    product_id,
    inventory_state_id,
    SUM(qty) AS quantity
FROM (
    SELECT * FROM outbound
    UNION ALL
    SELECT * FROM inbound
) x
GROUP BY
    tenant_id,
    inventory_location_id,
    product_id,
    inventory_state_id;

CREATE OR REPLACE VIEW customer_container_balance_view AS
SELECT
    sep.tenant_id,
    se.party_id,
    sep.product_id,
    SUM(sep.full_qty_delivered) AS full_containers_issued,
    SUM(sep.empty_qty_received_good) AS eligible_empties_received,
    GREATEST(
        SUM(sep.full_qty_delivered) - SUM(sep.empty_qty_received_good),
        0
    ) AS container_due,
    GREATEST(
        SUM(sep.empty_qty_received_good) - SUM(sep.full_qty_delivered),
        0
    ) AS container_credit
FROM stop_event_product sep
JOIN stop_event se
  ON se.tenant_id = sep.tenant_id
 AND se.stop_event_id = sep.stop_event_id
GROUP BY
    sep.tenant_id,
    se.party_id,
    sep.product_id;

CREATE OR REPLACE VIEW customer_balance_view AS
SELECT
    tenant_id,
    party_id,
    SUM(
        CASE
            WHEN transaction_type IN ('CUSTOMER_CHARGE', 'DAMAGE_CHARGE')
                THEN amount
            WHEN transaction_type IN ('CUSTOMER_PAYMENT', 'CUSTOMER_CREDIT', 'REFUND')
                THEN -amount
            WHEN transaction_type = 'ADJUSTMENT' AND direction = 'IN'
                THEN amount
            WHEN transaction_type = 'ADJUSTMENT' AND direction = 'OUT'
                THEN -amount
            ELSE 0
        END
    ) AS outstanding_amount
FROM money_ledger_entry
WHERE party_id IS NOT NULL
GROUP BY tenant_id, party_id;

CREATE OR REPLACE VIEW staff_cash_in_hand_view AS
SELECT
    tenant_id,
    staff_id,
    SUM(
        CASE
            WHEN transaction_type = 'CUSTOMER_PAYMENT'
                 AND payment_method = 'CASH'
                 AND account_type = 'STAFF_CASH'
                THEN amount
            WHEN transaction_type = 'STAFF_CASH_HANDOVER'
                 AND account_type IN ('STAFF_CASH', 'TENANT_CASH')
                THEN -amount
            WHEN transaction_type = 'ADJUSTMENT' AND direction = 'IN'
                THEN amount
            WHEN transaction_type = 'ADJUSTMENT' AND direction = 'OUT'
                THEN -amount
            ELSE 0
        END
    ) AS cash_in_hand
FROM money_ledger_entry
WHERE staff_id IS NOT NULL
GROUP BY tenant_id, staff_id;

-- ============================================================
-- 13. Notes for next pass
-- ============================================================
--
-- DDL v1.3 / Reconciliation should add:
--   TripReconciliation
--   TripStockReconciliation
--   TripCashReconciliation
--   CashHandover
--   post-reconciliation adjustment metadata
--
-- Then prepare Codex Sprint 0 implementation package:
--   - Full DDL chain v1.0 + v1.1 + v1.2 + v1.3
--   - API contract
--   - Architecture / coding rules
--   - AGENTS.md
--   - acceptance tests
--
-- IMPORTANT business behavior to implement in service layer:
--
-- RETURN_MATCHED example:
--   good empties = 8
--   damaged empties = 1
--   exchange ratio = 1:1
--   vehicle full stock = 10
--   default suggested full delivery = 8
--
-- If only 6 full cans are available:
--   user chooses:
--      a) accept only 6 empties and deliver 6 full; or
--      b) accept all 8 empties, deliver 6 full and create container credit 2.
--
-- If customer returns fewer empties than full cans delivered:
--   delivery staff may authorize container due.
--
-- Damaged/broken cans:
--   can be charged at time-versioned damage rate,
--   accepted without charge,
--   or rejected depending on the transaction.
--
-- Partial delivery:
--   may create a linked new TripStop OR a follow-up record,
--   depending on the field decision.
--
-- New permanent customer created by staff:
--   PENDING_APPROVAL until owner/admin approval.
-- Temporary customer:
--   may be used without prior approval.
--

COMMIT;
