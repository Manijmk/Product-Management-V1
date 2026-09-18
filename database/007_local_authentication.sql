BEGIN;

SET search_path TO pms, public;

CREATE UNIQUE INDEX uq_app_user_tenant_login_identity
    ON app_user (tenant_id, login_identity)
    WHERE login_identity IS NOT NULL;

CREATE TABLE app_user_password_credential (
    tenant_id              BIGINT NOT NULL,
    user_id                BIGINT NOT NULL,
    password_hash          VARCHAR(512) NOT NULL,
    password_changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    failed_attempt_count   INTEGER NOT NULL DEFAULT 0,
    locked_until           TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, user_id),
    CONSTRAINT fk_password_credential_user
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES app_user(tenant_id, user_id),
    CONSTRAINT ck_password_credential_failed_attempts
        CHECK (failed_attempt_count >= 0),
    CONSTRAINT ck_password_credential_argon2id
        CHECK (password_hash LIKE '$argon2id$%')
);

CREATE TRIGGER trg_password_credential_updated_at
BEFORE UPDATE ON app_user_password_credential
FOR EACH ROW EXECUTE FUNCTION pms.set_updated_at();

ALTER TABLE app_user_password_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user_password_credential FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_app_user_password_credential
ON app_user_password_credential
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::BIGINT);

GRANT SELECT, INSERT, UPDATE ON TABLE app_user_password_credential TO pms_app;

CREATE OR REPLACE FUNCTION pms.lookup_local_password_identity(
    requested_tenant_code TEXT,
    requested_login_identity TEXT
)
RETURNS TABLE (
    tenant_id BIGINT,
    user_id BIGINT,
    display_name VARCHAR(200),
    password_hash VARCHAR(512),
    failed_attempt_count INTEGER,
    locked_until TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pms, pg_temp
AS $$
    SELECT t.tenant_id,
           u.user_id,
           u.display_name,
           c.password_hash,
           c.failed_attempt_count,
           c.locked_until
      FROM pms.tenant t
      JOIN pms.app_user u
        ON u.tenant_id = t.tenant_id
      JOIN pms.app_user_password_credential c
        ON c.tenant_id = u.tenant_id
       AND c.user_id = u.user_id
     WHERE t.tenant_code = requested_tenant_code
       AND t.status IN ('TRIAL', 'ACTIVE')
       AND u.login_identity = requested_login_identity
       AND u.status = 'ACTIVE'
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION pms.lookup_local_password_identity(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pms.lookup_local_password_identity(TEXT, TEXT) TO pms_app;

COMMIT;
