-- Application access is through authenticated server handlers, not the Data API.
REVOKE ALL ON SCHEMA qadam FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA qadam FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA qadam FROM PUBLIC;

ALTER TABLE public.qadam_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qadam_migrations FROM PUBLIC;

DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA qadam FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA qadam FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA qadam FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON TABLE public.qadam_migrations FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
