-- Shared limits across serverless instances; no address queries or GPS data.
CREATE TABLE qadam.service_limits (
  bucket text PRIMARY KEY CHECK (char_length(bucket)<=160),
  hits integer NOT NULL CHECK (hits>0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX service_limits_expiry_idx ON qadam.service_limits(expires_at);
ALTER TABLE qadam.service_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.service_limits FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.service_limits FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON qadam.service_limits TO qadam_app;
    CREATE POLICY service_limits_server ON qadam.service_limits FOR ALL TO qadam_app USING (true) WITH CHECK (true);
  END IF;
END $$;
