-- Apply once before publishing courier-map code.
BEGIN;
-- One current position per courier. Existing online shifts do not imply GPS consent.
CREATE TABLE qadam.courier_presence (
  user_id uuid PRIMARY KEY REFERENCES qadam.users(id) ON DELETE CASCADE,
  sharing boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  accuracy double precision CHECK (accuracy BETWEEN 0 AND 100000),
  captured_at timestamptz,
  received_at timestamptz,
  CHECK (NOT sharing OR consent_at IS NOT NULL),
  CHECK ((latitude IS NULL)=(longitude IS NULL) AND (latitude IS NULL)=(captured_at IS NULL)
    AND (latitude IS NULL)=(received_at IS NULL))
);
CREATE INDEX courier_presence_fresh_idx ON qadam.courier_presence(captured_at,user_id) WHERE sharing;
CREATE INDEX orders_courier_active_idx ON qadam.orders(courier_id,id)
  WHERE courier_id IS NOT NULL AND status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT');
ALTER TABLE qadam.courier_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.courier_presence FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.courier_presence FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,INSERT,UPDATE ON qadam.courier_presence TO qadam_app;
    CREATE POLICY courier_presence_server ON qadam.courier_presence FOR ALL TO qadam_app USING(true) WITH CHECK(true);
  END IF;
END;
$$;
INSERT INTO public.qadam_migrations(name,checksum)
VALUES('20261028053350_courier_presence.sql','08787d26076b2eef4253fe55c1e5e6c151a0f35de488adb648f5cd71792934b6');
COMMIT;
