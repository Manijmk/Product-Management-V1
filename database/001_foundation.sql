-- Product Management System (PMS)
-- PostgreSQL DDL v1.0 - Sprint 0A Foundation + Product/Customer Master
-- Date: 2026-08-18
--
-- Scope:
--   Tenant, AppUser, Role, UserRole, Staff,
--   Product, InventoryState, ProductPrice, ProductDamageRate,
--   Party, PartyProduct, PartyProductPrice
--
-- Core rules embodied here:
--   1) Multi-tenant from day one.
--   2) Tenant isolation is enforced at the database layer through PostgreSQL RLS.
--   3) Route/Trip/StopEvent/Ledger tables are intentionally deferred to the next DDL pass.
--   4) Customer balances, stock balances, container balances are NOT stored here as mutable fields.
--   5) PartyProduct supports FIXED_PLANNED / RETURN_MATCHED / AD_HOC quantity modes.
--   6) Price history is time-versioned.
--   7) Staff may exist without a login.
--   8) New customer workflow supports TEMPORARY and PENDING_APPROVAL states.
--
-- IMPORTANT APPLICATION REQUIREMENT:
-- Each tenant-scoped request must set:
--   SET LOCAL app.tenant_id = '<tenant_id>';
-- before issuing tenant-owned queries inside the transaction.

BEGIN;

CREATE SCHEMA IF NOT EXISTS pms;
SET search_path TO pms, public;

CREATE OR REPLACE FUNCTION pms.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE tenant (
    tenant_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_code         VARCHAR(50) NOT NULL UNIQUE,
    name                VARCHAR(200) NOT NULL,
    business_type       VARCHAR(50) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    default_currency    CHAR(3) NOT NULL DEFAULT 'INR',
    timezone            VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
    default_language    VARCHAR(20) NOT NULL DEFAULT 'en',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_tenant_status CHECK (status IN ('TRIAL', 'ACTIVE', 'SUSPENDED', 'INACTIVE'))
);

CREATE TRIGGER trg_tenant_updated_at
BEFORE UPDATE ON tenant
FOR EACH ROW EXECUTE FUNCTION pms.set_updated_at();

CREATE TABLE app_user (
    user_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    login_identity      VARCHAR(255),
    mobile              VARCHAR(30),
    email               VARCHAR(255),
    display_name        VARCHAR(200),
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    last_login_at       TIMESTAMPTZ,
    created_by_user_id  BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_app_user_tenant_user UNIQUE (tenant_id, user_id),
    CONSTRAINT fk_app_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id),
    CONSTRAINT ck_app_user_identity CHECK (login_identity IS NOT NULL OR mobile IS NOT NULL OR email IS NOT NULL),
    CONSTRAINT ck_app_user_status CHECK (status IN ('ACTIVE', 'LOCKED', 'INACTIVE'))
);

CREATE UNIQUE INDEX uq_app_user_tenant_mobile
    ON app_user (tenant_id, mobile) WHERE mobile IS NOT NULL;
CREATE UNIQUE INDEX uq_app_user_tenant_email
    ON app_user (tenant_id, email) WHERE email IS NOT NULL;

ALTER TABLE app_user
ADD CONSTRAINT fk_app_user_created_by
FOREIGN KEY (tenant_id, created_by_user_id)
REFERENCES app_user(tenant_id, user_id);

CREATE INDEX ix_app_user_tenant_status ON app_user (tenant_id, status);
CREATE TRIGGER trg_app_user_updated_at BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION pms.set_updated_at();

CREATE TABLE role (
    role_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    role_code           VARCHAR(50) NOT NULL,
    role_name           VARCHAR(100) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_role_tenant_role UNIQUE (tenant_id, role_id),
    CONSTRAINT uq_role_tenant_code UNIQUE (tenant_id, role_code),
    CONSTRAINT fk_role_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id),
    CONSTRAINT ck_role_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
CREATE TRIGGER trg_role_updated_at BEFORE UPDATE ON role FOR EACH ROW EXECUTE FUNCTION pms.set_updated_at();

CREATE TABLE user_role (
    tenant_id           BIGINT NOT NULL,
    user_id             BIGINT NOT NULL,
    role_id             BIGINT NOT NULL,
    assigned_by_user_id BIGINT,
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, user_id, role_id),
    CONSTRAINT fk_user_role_user FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT fk_user_role_role FOREIGN KEY (tenant_id, role_id) REFERENCES role(tenant_id, role_id),
    CONSTRAINT fk_user_role_assigned_by FOREIGN KEY (tenant_id, assigned_by_user_id) REFERENCES app_user(tenant_id, user_id)
);

CREATE TABLE staff (
    staff_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    user_id             BIGINT,
    employee_code       VARCHAR(50),
    name                VARCHAR(200) NOT NULL,
    mobile              VARCHAR(30),
    staff_type          VARCHAR(50) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    joined_on           DATE,
    created_by_user_id  BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_staff_tenant_staff UNIQUE (tenant_id, staff_id),
    CONSTRAINT fk_staff_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id),
    CONSTRAINT fk_staff_user FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT fk_staff_created_by FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT ck_staff_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'LEFT'))
);
CREATE UNIQUE INDEX uq_staff_tenant_emp_code ON staff (tenant_id, employee_code) WHERE employee_code IS NOT NULL;
CREATE INDEX ix_staff_tenant_status ON staff (tenant_id, status);
CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION pms.set_updated_at();

CREATE TABLE product (
    product_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    product_code        VARCHAR(50) NOT NULL,
    name                VARCHAR(200) NOT NULL,
    unit_type           VARCHAR(20) NOT NULL,
    exchange_ratio      NUMERIC(12,4),
    active_status       VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id  BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_tenant_product UNIQUE (tenant_id, product_id),
    CONSTRAINT uq_product_tenant_code UNIQUE (tenant_id, product_code),
    CONSTRAINT fk_product_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id),
    CONSTRAINT fk_product_created_by FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT ck_product_unit_type CHECK (unit_type IN ('EXCHANGE', 'CONSUMABLE', 'DEPOSIT')),
    CONSTRAINT ck_product_exchange_ratio CHECK (
        (unit_type = 'EXCHANGE' AND exchange_ratio IS NOT NULL AND exchange_ratio > 0)
        OR (unit_type <> 'EXCHANGE' AND exchange_ratio IS NULL)
    ),
    CONSTRAINT ck_product_status CHECK (active_status IN ('ACTIVE', 'INACTIVE'))
);
CREATE INDEX ix_product_tenant_status ON product (tenant_id, active_status);
CREATE TRIGGER trg_product_updated_at BEFORE UPDATE ON product FOR EACH ROW EXECUTE FUNCTION pms.set_updated_at();

CREATE TABLE inventory_state (
    inventory_state_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                        VARCHAR(30) NOT NULL UNIQUE,
    name                        VARCHAR(100) NOT NULL,
    is_available_for_delivery   BOOLEAN NOT NULL DEFAULT FALSE,
    is_exchange_eligible        BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order                  INTEGER NOT NULL DEFAULT 0,
    active_status               VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT ck_inventory_state_status CHECK (active_status IN ('ACTIVE', 'INACTIVE'))
);

INSERT INTO inventory_state
(code, name, is_available_for_delivery, is_exchange_eligible, sort_order)
VALUES
('FULL',      'Full',      TRUE,  FALSE, 10),
('EMPTY',     'Empty',     FALSE, TRUE,  20),
('DAMAGED',   'Damaged',   FALSE, FALSE, 30),
('CLEANING',  'Cleaning',  FALSE, FALSE, 40),
('REFILL',    'Refill',    FALSE, FALSE, 50),
('LOST',      'Lost',      FALSE, FALSE, 60)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE product_price (
    product_price_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    product_id          BIGINT NOT NULL,
    price               NUMERIC(14,2) NOT NULL,
    effective_from      TIMESTAMPTZ NOT NULL,
    effective_to        TIMESTAMPTZ,
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id  BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_price_tenant_id UNIQUE (tenant_id, product_price_id),
    CONSTRAINT fk_product_price_product FOREIGN KEY (tenant_id, product_id) REFERENCES product(tenant_id, product_id),
    CONSTRAINT fk_product_price_created_by FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT ck_product_price_positive CHECK (price >= 0),
    CONSTRAINT ck_product_price_period CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT ck_product_price_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
CREATE INDEX ix_product_price_lookup ON product_price (tenant_id, product_id, effective_from DESC);

CREATE TABLE product_damage_rate (
    damage_rate_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    product_id          BIGINT NOT NULL,
    damage_type         VARCHAR(30) NOT NULL,
    rate                NUMERIC(14,2) NOT NULL,
    effective_from      TIMESTAMPTZ NOT NULL,
    effective_to        TIMESTAMPTZ,
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id  BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_damage_rate_tenant_id UNIQUE (tenant_id, damage_rate_id),
    CONSTRAINT fk_damage_rate_product FOREIGN KEY (tenant_id, product_id) REFERENCES product(tenant_id, product_id),
    CONSTRAINT fk_damage_rate_created_by FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT ck_damage_rate_type CHECK (damage_type IN ('DAMAGED', 'BROKEN', 'LOST')),
    CONSTRAINT ck_damage_rate_positive CHECK (rate >= 0),
    CONSTRAINT ck_damage_rate_period CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT ck_damage_rate_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
CREATE INDEX ix_damage_rate_lookup ON product_damage_rate (tenant_id, product_id, damage_type, effective_from DESC);

CREATE TABLE party (
    party_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    party_code          VARCHAR(50),
    name                VARCHAR(200) NOT NULL,
    party_type          VARCHAR(30) NOT NULL DEFAULT 'CUSTOMER',
    relationship_type   VARCHAR(30) NOT NULL,
    mobile              VARCHAR(30),
    alternate_mobile    VARCHAR(30),
    address_line1       VARCHAR(255),
    address_line2       VARCHAR(255),
    locality            VARCHAR(150),
    city                VARCHAR(100),
    postal_code         VARCHAR(20),
    latitude            NUMERIC(9,6),
    longitude           NUMERIC(9,6),
    customer_status     VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL',
    created_source      VARCHAR(30) NOT NULL DEFAULT 'ADMIN',
    created_by_user_id  BIGINT,
    approved_by_user_id BIGINT,
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_party_tenant_party UNIQUE (tenant_id, party_id),
    CONSTRAINT fk_party_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id),
    CONSTRAINT fk_party_created_by FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT fk_party_approved_by FOREIGN KEY (tenant_id, approved_by_user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT ck_party_type CHECK (party_type IN ('CUSTOMER')),
    CONSTRAINT ck_party_relationship CHECK (relationship_type IN ('SUBSCRIPTION_ROUTE', 'AD_HOC', 'WALK_IN')),
    CONSTRAINT ck_party_customer_status CHECK (customer_status IN ('TEMPORARY','PENDING_APPROVAL','ACTIVE','INACTIVE','REJECTED')),
    CONSTRAINT ck_party_created_source CHECK (created_source IN ('ADMIN','STAFF','IMPORT','CUSTOMER_PORTAL')),
    CONSTRAINT ck_party_latitude CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_party_longitude CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_party_approval_consistency CHECK (
        (customer_status = 'ACTIVE' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
        OR customer_status <> 'ACTIVE'
    )
);
CREATE UNIQUE INDEX uq_party_tenant_code ON party (tenant_id, party_code) WHERE party_code IS NOT NULL;
CREATE INDEX ix_party_tenant_status ON party (tenant_id, customer_status);
CREATE INDEX ix_party_tenant_mobile ON party (tenant_id, mobile);
CREATE TRIGGER trg_party_updated_at BEFORE UPDATE ON party FOR EACH ROW EXECUTE FUNCTION pms.set_updated_at();

CREATE TABLE party_product (
    party_product_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    party_id            BIGINT NOT NULL,
    product_id          BIGINT NOT NULL,
    quantity_mode       VARCHAR(30) NOT NULL,
    default_qty         NUMERIC(14,3),
    forecast_qty        NUMERIC(14,3),
    exchange_policy     VARCHAR(30),
    active_status       VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id  BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_party_product_tenant_id UNIQUE (tenant_id, party_product_id),
    CONSTRAINT uq_party_product_customer_product UNIQUE (tenant_id, party_id, product_id),
    CONSTRAINT fk_party_product_party FOREIGN KEY (tenant_id, party_id) REFERENCES party(tenant_id, party_id),
    CONSTRAINT fk_party_product_product FOREIGN KEY (tenant_id, product_id) REFERENCES product(tenant_id, product_id),
    CONSTRAINT fk_party_product_created_by FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT ck_party_product_quantity_mode CHECK (quantity_mode IN ('FIXED_PLANNED', 'RETURN_MATCHED', 'AD_HOC')),
    CONSTRAINT ck_party_product_default_qty CHECK (
        (quantity_mode = 'FIXED_PLANNED' AND default_qty IS NOT NULL AND default_qty > 0)
        OR (quantity_mode <> 'FIXED_PLANNED' AND (default_qty IS NULL OR default_qty > 0))
    ),
    CONSTRAINT ck_party_product_forecast_qty CHECK (forecast_qty IS NULL OR forecast_qty > 0),
    CONSTRAINT ck_party_product_exchange_policy CHECK (
        exchange_policy IS NULL OR exchange_policy IN ('STRICT', 'ALLOW_CONTAINER_DUE', 'STAFF_OVERRIDE')
    ),
    CONSTRAINT ck_party_product_status CHECK (active_status IN ('ACTIVE', 'INACTIVE'))
);
CREATE INDEX ix_party_product_lookup ON party_product (tenant_id, party_id, active_status);
CREATE TRIGGER trg_party_product_updated_at BEFORE UPDATE ON party_product FOR EACH ROW EXECUTE FUNCTION pms.set_updated_at();

CREATE TABLE party_product_price (
    party_product_price_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id               BIGINT NOT NULL,
    party_id                BIGINT NOT NULL,
    product_id              BIGINT NOT NULL,
    price                   NUMERIC(14,2) NOT NULL,
    effective_from          TIMESTAMPTZ NOT NULL,
    effective_to            TIMESTAMPTZ,
    approval_status         VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
    created_by_user_id      BIGINT,
    approved_by_user_id     BIGINT,
    approved_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_party_product_price_tenant_id UNIQUE (tenant_id, party_product_price_id),
    CONSTRAINT fk_party_product_price_party FOREIGN KEY (tenant_id, party_id) REFERENCES party(tenant_id, party_id),
    CONSTRAINT fk_party_product_price_product FOREIGN KEY (tenant_id, product_id) REFERENCES product(tenant_id, product_id),
    CONSTRAINT fk_party_product_price_created_by FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT fk_party_product_price_approved_by FOREIGN KEY (tenant_id, approved_by_user_id) REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT ck_party_product_price_positive CHECK (price >= 0),
    CONSTRAINT ck_party_product_price_period CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT ck_party_product_price_approval CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT ck_party_product_price_approval_consistency CHECK (
        (approval_status = 'APPROVED' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
        OR approval_status <> 'APPROVED'
    )
);
CREATE INDEX ix_party_product_price_lookup ON party_product_price (tenant_id, party_id, product_id, effective_from DESC);

-- Seed roles per tenant, e.g. OWNER / ADMIN / ROUTE_STAFF / CUSTOMER.

-- Row-Level Security
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
ALTER TABLE role FORCE ROW LEVEL SECURITY;
ALTER TABLE user_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role FORCE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff FORCE ROW LEVEL SECURITY;
ALTER TABLE product ENABLE ROW LEVEL SECURITY;
ALTER TABLE product FORCE ROW LEVEL SECURITY;
ALTER TABLE product_price ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_price FORCE ROW LEVEL SECURITY;
ALTER TABLE product_damage_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_damage_rate FORCE ROW LEVEL SECURITY;
ALTER TABLE party ENABLE ROW LEVEL SECURITY;
ALTER TABLE party FORCE ROW LEVEL SECURITY;
ALTER TABLE party_product ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_product FORCE ROW LEVEL SECURITY;
ALTER TABLE party_product_price ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_product_price FORCE ROW LEVEL SECURITY;

CREATE POLICY app_user_tenant_isolation ON app_user
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);
CREATE POLICY role_tenant_isolation ON role
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);
CREATE POLICY user_role_tenant_isolation ON user_role
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);
CREATE POLICY staff_tenant_isolation ON staff
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);
CREATE POLICY product_tenant_isolation ON product
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);
CREATE POLICY product_price_tenant_isolation ON product_price
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);
CREATE POLICY damage_rate_tenant_isolation ON product_damage_rate
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);
CREATE POLICY party_tenant_isolation ON party
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);
CREATE POLICY party_product_tenant_isolation ON party_product
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);
CREATE POLICY party_product_price_tenant_isolation ON party_product_price
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

COMMIT;

-- Next pass (DDL v1.1 / Sprint 0B):
-- Route, RouteStopTemplate, RouteStopProduct, Vehicle,
-- Trip, TripStaff, TripStop, TripStopProduct.
--
-- Following pass (DDL v1.2):
-- StopEvent, StopEventProduct, ExchangeException, PriceOverride,
-- StopFollowUp, InventoryLocation, InventoryLedgerEntry,
-- MoneyLedgerEntry, PaymentAllocation, reconciliation tables and derived views.
