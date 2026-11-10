-- Install before publishing; the new server activates enforcement once, after
-- enrolling deliveries that entered custody while the previous release ran.
CREATE TABLE qadam.handoff_enforcement (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  activated_at timestamptz
);
INSERT INTO qadam.handoff_enforcement(singleton) VALUES(true);
ALTER TABLE qadam.handoff_enforcement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.handoff_enforcement FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.handoff_enforcement FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,UPDATE(activated_at) ON qadam.handoff_enforcement TO qadam_app;
    CREATE POLICY handoff_activation_read ON qadam.handoff_enforcement FOR SELECT TO qadam_app USING(true);
    CREATE POLICY handoff_activation_once ON qadam.handoff_enforcement FOR UPDATE TO qadam_app
      USING(activated_at IS NULL) WITH CHECK(activated_at IS NOT NULL);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION qadam.enforce_handoff_status() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,qadam AS $$
BEGIN
  IF current_database() LIKE '%\_test' ESCAPE '\'
    AND session_user<>'qadam_app'
    AND current_setting('qadam.legacy_handoff_tests',true)='on' THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM qadam.handoff_enforcement WHERE singleton AND activated_at IS NOT NULL) THEN RETURN NEW; END IF;
  IF (NEW.status IN ('PICKED_UP','IN_TRANSIT') AND OLD.status NOT IN ('PICKED_UP','IN_TRANSIT'))
    OR (NEW.status='DELIVERED' AND OLD.status<>'DELIVERED') THEN
    IF NOT EXISTS(SELECT 1 FROM qadam.order_handoff_proofs p
      WHERE p.order_id=NEW.id AND p.courier_id=NEW.courier_id
        AND p.assignment_version=NEW.assignment_version AND p.route_version=NEW.route_version
        AND p.stage=CASE WHEN NEW.status='DELIVERED' THEN 'DROPOFF' ELSE 'PICKUP' END) THEN
      RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='qadam_handoff_required',MESSAGE='Verified handoff required';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
