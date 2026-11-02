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
