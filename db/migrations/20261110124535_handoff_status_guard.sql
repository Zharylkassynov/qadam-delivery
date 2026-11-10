-- Old deployments share this database. Their status endpoints must not provide
-- a route around verification after the new application has been published.
CREATE FUNCTION qadam.enforce_handoff_status() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,qadam AS $$
BEGIN
  -- Historical business-flow suites only: the runtime also requires a loopback
  -- URL and a dedicated *_test database. The deployed qadam_app role cannot opt out.
  IF current_database() LIKE '%\_test' ESCAPE '\'
    AND session_user<>'qadam_app'
    AND current_setting('qadam.legacy_handoff_tests',true)='on' THEN
    RETURN NEW;
  END IF;
  IF (NEW.status IN ('PICKED_UP','IN_TRANSIT') AND OLD.status NOT IN ('PICKED_UP','IN_TRANSIT'))
    OR (NEW.status='DELIVERED' AND OLD.status<>'DELIVERED') THEN
    IF NOT EXISTS(
      SELECT 1 FROM qadam.order_handoff_proofs p
      WHERE p.order_id=NEW.id AND p.courier_id=NEW.courier_id
        AND p.assignment_version=NEW.assignment_version AND p.route_version=NEW.route_version
        AND p.stage=CASE WHEN NEW.status='DELIVERED' THEN 'DROPOFF' ELSE 'PICKUP' END
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='qadam_handoff_required',MESSAGE='Verified handoff required';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION qadam.enforce_handoff_status() FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION qadam.enforce_handoff_status() FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT EXECUTE ON FUNCTION qadam.enforce_handoff_status() TO qadam_app;
  END IF;
END; $$;
CREATE TRIGGER enforce_handoff_status BEFORE UPDATE OF status ON qadam.orders
  FOR EACH ROW EXECUTE FUNCTION qadam.enforce_handoff_status();
