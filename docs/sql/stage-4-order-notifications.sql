-- Apply once to the current Qadam database before publishing stage 4.
-- Source: db/migrations/20261027173430_order_notifications.sql
BEGIN;
CREATE TABLE qadam.courier_status (
  user_id uuid PRIMARY KEY REFERENCES qadam.users(id) ON DELETE CASCADE,
  online boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courier_status_online_idx ON qadam.courier_status(updated_at,user_id) WHERE online;

CREATE TABLE qadam.order_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES qadam.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES qadam.users(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL CHECK (chat_id>0),
  message_id bigint CHECK (message_id>0),
  kind text NOT NULL DEFAULT 'AVAILABLE' CHECK (kind='AVAILABLE'),
  closed_at timestamptz,
  closed_text text,
  UNIQUE(order_id,user_id,kind)
);
CREATE INDEX order_notifications_user_idx ON qadam.order_notifications(user_id,order_id);

ALTER TABLE qadam.orders ADD COLUMN alerted_at timestamptz;
CREATE INDEX orders_waiting_alert_idx ON qadam.orders(created_at,id)
  WHERE status='SEARCHING_FOR_COURIER' AND courier_id IS NULL AND alerted_at IS NULL;

ALTER TABLE qadam.telegram_outbox
  ADD COLUMN order_id uuid REFERENCES qadam.orders(id) ON DELETE CASCADE,
  ADD COLUMN order_notification_id bigint REFERENCES qadam.order_notifications(id) ON DELETE CASCADE;
CREATE INDEX telegram_outbox_order_pending_idx ON qadam.telegram_outbox(order_id,telegram_user_id,id)
  WHERE order_id IS NOT NULL AND sent_at IS NULL AND NOT failed;

ALTER TABLE qadam.courier_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE qadam.order_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.courier_status,qadam.order_notifications FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.courier_status,qadam.order_notifications FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,INSERT,UPDATE ON qadam.courier_status,qadam.order_notifications TO qadam_app;
    GRANT USAGE ON SEQUENCE qadam.order_notifications_id_seq TO qadam_app;
    GRANT UPDATE(alerted_at) ON qadam.orders TO qadam_app;
    CREATE POLICY courier_status_server ON qadam.courier_status FOR ALL TO qadam_app USING(true) WITH CHECK(true);
    CREATE POLICY order_notifications_server ON qadam.order_notifications FOR ALL TO qadam_app USING(true) WITH CHECK(true);
  END IF;
END;
$$;
INSERT INTO public.qadam_migrations(name,checksum)
VALUES('20261027173430_order_notifications.sql','5086c548ee78881e87fdcbf65cfb1f18ae7f4cceb3c4af6cb9d426918ab9219b');
COMMIT;
