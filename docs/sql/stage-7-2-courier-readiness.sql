BEGIN;
SELECT pg_advisory_xact_lock(62120261018);

-- 20261102104239_courier_readiness.sql
ALTER TABLE qadam.courier_status ADD COLUMN accepting_orders boolean NOT NULL DEFAULT false;

-- Starting a shift in the previous application never silently enables new terms.
CREATE FUNCTION qadam.normalise_courier_availability() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT NEW.online THEN NEW.accepting_orders:=false; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER normalise_courier_availability BEFORE INSERT OR UPDATE OF online,accepting_orders ON qadam.courier_status
  FOR EACH ROW EXECUTE FUNCTION qadam.normalise_courier_availability();
ALTER TABLE qadam.courier_status ADD CONSTRAINT courier_status_accepting_online CHECK(NOT accepting_orders OR online);

CREATE OR REPLACE FUNCTION qadam.close_shift_location_streams() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT NEW.online THEN
    UPDATE qadam.order_location_streams SET state='STOPPED',stopped_at=clock_timestamp()
      WHERE courier_id=NEW.user_id AND state IN ('WAITING','LIVE');
    UPDATE qadam.courier_presence SET sharing=false,latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL
      WHERE user_id=NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION qadam.finish_ending_courier_shift() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.courier_id IS NOT NULL AND (NEW.courier_id IS DISTINCT FROM OLD.courier_id
    OR NEW.status NOT IN ('ACCEPTED','PICKED_UP','IN_TRANSIT')) THEN
    -- The courier lock used by APIs serializes assignment. Lock status before
    -- checking remaining deliveries, including customer cancellation paths.
    PERFORM 1 FROM qadam.courier_status WHERE user_id=OLD.courier_id FOR UPDATE;
    UPDATE qadam.courier_status s SET online=false,accepting_orders=false
      WHERE s.user_id=OLD.courier_id AND s.online AND NOT s.accepting_orders
        AND NOT EXISTS(SELECT 1 FROM qadam.orders o WHERE o.courier_id=s.user_id AND o.status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT'));
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER finish_ending_courier_shift AFTER UPDATE OF status,courier_id ON qadam.orders
  FOR EACH ROW EXECUTE FUNCTION qadam.finish_ending_courier_shift();
REVOKE ALL ON FUNCTION qadam.normalise_courier_availability(),qadam.finish_ending_courier_shift() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT INSERT(accepting_orders),UPDATE(accepting_orders) ON qadam.courier_status TO qadam_app;
  END IF;
END; $$;

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261102104239_courier_readiness.sql','7e05103549144cf205d41dcc28d4c37c4be1dbe4c22a496dde13d29129c9452e');

-- 20261102112147_explicit_shift_end.sql
ALTER TABLE qadam.courier_status ADD COLUMN end_after_delivery boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION qadam.normalise_courier_availability() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT NEW.online THEN NEW.accepting_orders:=false;NEW.end_after_delivery:=false;
  ELSIF NEW.accepting_orders THEN NEW.end_after_delivery:=false; END IF;
  RETURN NEW;
END; $$;
ALTER TABLE qadam.courier_status ADD CONSTRAINT courier_status_explicit_end
  CHECK(NOT end_after_delivery OR (online AND NOT accepting_orders));
CREATE OR REPLACE FUNCTION qadam.finish_ending_courier_shift() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.courier_id IS NOT NULL AND (NEW.courier_id IS DISTINCT FROM OLD.courier_id
    OR NEW.status NOT IN ('ACCEPTED','PICKED_UP','IN_TRANSIT')) THEN
    PERFORM 1 FROM qadam.courier_status WHERE user_id=OLD.courier_id FOR UPDATE;
    UPDATE qadam.courier_status s SET online=false,accepting_orders=false,end_after_delivery=false
      WHERE s.user_id=OLD.courier_id AND s.online AND s.end_after_delivery
        AND NOT EXISTS(SELECT 1 FROM qadam.orders o WHERE o.courier_id=s.user_id AND o.status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT'));
  END IF;
  RETURN NEW;
END; $$;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT INSERT(end_after_delivery),UPDATE(end_after_delivery) ON qadam.courier_status TO qadam_app;
  END IF;
END; $$;

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261102112147_explicit_shift_end.sql','41d5e23d279e3566aa8860e9365dfe5328ce832843ffc281d6893e7306da25b1');

COMMIT;
