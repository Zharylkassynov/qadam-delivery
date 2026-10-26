-- Supabase SQL Editor: выполнить весь файл владельцу проекта.
BEGIN;
-- RLS may also be enabled in the Supabase dashboard. Keep server access explicit.
ALTER TABLE qadam.order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE qadam.order_events FROM PUBLIC;

DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE qadam.order_events FROM %I',api_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,INSERT ON TABLE qadam.order_events TO qadam_app;
    GRANT USAGE ON SEQUENCE qadam.order_events_id_seq TO qadam_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='qadam'
      AND tablename='order_events' AND policyname='order_events_server_read') THEN
      CREATE POLICY order_events_server_read ON qadam.order_events
        FOR SELECT TO qadam_app USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='qadam'
      AND tablename='order_events' AND policyname='order_events_server_insert') THEN
      CREATE POLICY order_events_server_insert ON qadam.order_events
        FOR INSERT TO qadam_app WITH CHECK (true);
    END IF;
  END IF;
END;
$$;

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261026095352_order_events_rls.sql','cbbe3ae464497a7e9a2fadaee5a38c6b1a41d991048ed75d2e1af4e65199b7ad') ON CONFLICT (name) DO NOTHING;
COMMIT;
