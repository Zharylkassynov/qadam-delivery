-- courier_locations has column-level UPDATE grants; new columns need an explicit grant.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT UPDATE(location_source) ON qadam.courier_locations TO qadam_app;
  END IF;
END; $$;
