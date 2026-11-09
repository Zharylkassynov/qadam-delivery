ALTER TABLE qadam.orders
  ADD COLUMN tracking_token text UNIQUE CHECK(tracking_token ~ '^[A-Za-z0-9_-]{43}$'),
  ADD COLUMN tracking_issued_at timestamptz,
  ADD COLUMN tracking_expires_at timestamptz,
  ADD COLUMN tracking_revoked_at timestamptz,
  ADD CONSTRAINT tracking_dates CHECK(tracking_token IS NULL OR
    (tracking_issued_at IS NOT NULL AND tracking_expires_at IS NOT NULL
     AND tracking_expires_at>tracking_issued_at
     AND tracking_expires_at<=tracking_issued_at+interval '7 days'));

CREATE TABLE qadam.recipient_location_preferences (
  user_id uuid PRIMARY KEY REFERENCES qadam.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  consent_version text,
  consented_at timestamptz,
  revoked_at timestamptz,
  CHECK(NOT enabled OR (consent_version IS NOT NULL AND consented_at IS NOT NULL AND revoked_at IS NULL))
);
ALTER TABLE qadam.recipient_location_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.recipient_location_preferences FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.recipient_location_preferences FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,INSERT,UPDATE ON qadam.recipient_location_preferences TO qadam_app;
    CREATE POLICY recipient_location_server ON qadam.recipient_location_preferences
      FOR ALL TO qadam_app USING(true) WITH CHECK(true);
  END IF;
END; $$;
