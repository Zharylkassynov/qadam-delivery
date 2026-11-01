-- Apply once to stage 7. Verify journal before retrying.
BEGIN;
SELECT pg_advisory_xact_lock(62120261018);
-- 20261101103834_courier_location_streams.sql
ALTER TABLE qadam.courier_presence
  ADD COLUMN auto_location_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_consent_version text,
  ADD COLUMN auto_consent_at timestamptz,
  ADD CONSTRAINT courier_presence_auto_consent CHECK(NOT auto_location_enabled OR (auto_consent_version IS NOT NULL AND auto_consent_at IS NOT NULL));
ALTER TABLE qadam.courier_locations ADD COLUMN location_source text NOT NULL DEFAULT 'MINI_APP'
  CHECK(location_source IN ('MINI_APP','TELEGRAM_LIVE'));
CREATE TABLE qadam.order_location_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES qadam.orders(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES qadam.users(id) ON DELETE CASCADE,
  assignment_version integer NOT NULL CHECK(assignment_version>=0),
  request_key uuid NOT NULL,
  telegram_user_id bigint NOT NULL CHECK(telegram_user_id>0),
  state text NOT NULL DEFAULT 'WAITING' CHECK(state IN ('WAITING','LIVE','STOPPED')),
  consent_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  message_id bigint CHECK(message_id>0),
  last_update_id bigint NOT NULL DEFAULT -1,
  last_message_at timestamptz,
  last_received_at timestamptz,
  update_count integer NOT NULL DEFAULT 0 CHECK(update_count>=0),
  stopped_at timestamptz,
  UNIQUE(order_id,courier_id,request_key),
  CHECK(expires_at<=created_at+interval '8 hours'),
  CHECK(state<>'LIVE' OR message_id IS NOT NULL)
);
CREATE UNIQUE INDEX order_location_streams_courier_current_idx ON qadam.order_location_streams(courier_id) WHERE state IN ('WAITING','LIVE');
CREATE UNIQUE INDEX order_location_streams_order_current_idx ON qadam.order_location_streams(order_id) WHERE state IN ('WAITING','LIVE');
CREATE INDEX order_location_streams_order_idx ON qadam.order_location_streams(order_id,created_at DESC);
CREATE INDEX order_location_streams_telegram_idx ON qadam.order_location_streams(telegram_user_id) WHERE state IN ('WAITING','LIVE');
ALTER TABLE qadam.order_location_streams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.order_location_streams FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.order_location_streams FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,INSERT,UPDATE ON qadam.order_location_streams TO qadam_app;
    CREATE POLICY order_location_streams_server ON qadam.order_location_streams FOR ALL TO qadam_app USING(true) WITH CHECK(true);
  END IF;
END; $$;

-- Keep sessions closed even when a previous application version performs the change.
CREATE FUNCTION qadam.close_order_location_streams() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.courier_id IS DISTINCT FROM OLD.courier_id OR NEW.assignment_version<>OLD.assignment_version
    OR NEW.status NOT IN ('ACCEPTED','PICKED_UP','IN_TRANSIT') THEN
    UPDATE qadam.order_location_streams SET state='STOPPED',stopped_at=clock_timestamp()
      WHERE order_id=NEW.id AND state IN ('WAITING','LIVE');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER close_order_location_streams AFTER UPDATE OF status,courier_id,assignment_version ON qadam.orders
  FOR EACH ROW EXECUTE FUNCTION qadam.close_order_location_streams();
CREATE FUNCTION qadam.close_shift_location_streams() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT NEW.online THEN
    UPDATE qadam.order_location_streams SET state='STOPPED',stopped_at=clock_timestamp()
      WHERE courier_id=NEW.user_id AND state IN ('WAITING','LIVE');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER close_shift_location_streams AFTER UPDATE OF online ON qadam.courier_status
  FOR EACH ROW EXECUTE FUNCTION qadam.close_shift_location_streams();
REVOKE ALL ON FUNCTION qadam.close_order_location_streams(),qadam.close_shift_location_streams() FROM PUBLIC;

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261101103834_courier_location_streams.sql','c971657d061e6f7a8bb11fd07b0fbce3d5adc547c8d7ce05c334161afb9f3981');

-- 20261101110107_location_stream_lookup_index.sql
-- Covers courier deletion checks and prevents rebinding a retired Telegram message.
CREATE INDEX order_location_streams_courier_message_idx ON qadam.order_location_streams(courier_id,message_id);

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261101110107_location_stream_lookup_index.sql','fc4faa8362e75622ee8fa04dd258578535af9a11cc3c0deeadc4e022b13b7f50');

-- 20261101112310_location_source_permissions.sql
-- courier_locations has column-level UPDATE grants; new columns need an explicit grant.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT UPDATE(location_source) ON qadam.courier_locations TO qadam_app;
  END IF;
END; $$;

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261101112310_location_source_permissions.sql','34082fe330ea7d12acab71a4af88631e868e7a5483a6ba9ddb2be623f93a7359');

COMMIT;
