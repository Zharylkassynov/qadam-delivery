-- Qadam stage 7. Apply once to stage 6; verify the journal before retrying.
BEGIN;
SELECT pg_advisory_xact_lock(62120261018);

-- 20261031102814_delivery_trust.sql
-- Existing orders retain the conditions under which they were created.
ALTER TABLE qadam.orders
  ADD COLUMN photo_required boolean NOT NULL DEFAULT false,
  ADD COLUMN code_required boolean NOT NULL DEFAULT false,
  ADD COLUMN assignment_version integer NOT NULL DEFAULT 0 CHECK(assignment_version>=0);
ALTER TABLE qadam.order_events
  ADD COLUMN kind text NOT NULL DEFAULT 'STATUS' CHECK(kind IN ('STATUS','RELEASE','ASSIGN','CANCEL','CODE_RESET')),
  ADD COLUMN reason text CHECK(char_length(reason) BETWEEN 5 AND 500),
  ADD COLUMN previous_courier_id uuid REFERENCES qadam.users(id) ON DELETE SET NULL,
  ADD COLUMN next_courier_id uuid REFERENCES qadam.users(id) ON DELETE SET NULL;

CREATE TABLE qadam.courier_blocks (
  user_id uuid PRIMARY KEY REFERENCES qadam.users(id) ON DELETE CASCADE,
  blocked boolean NOT NULL,
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 5 AND 500),
  actor_id uuid NOT NULL REFERENCES qadam.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE qadam.courier_block_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES qadam.users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES qadam.users(id),
  request_key uuid NOT NULL,
  blocked boolean NOT NULL,
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 5 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,actor_id,request_key)
);
CREATE INDEX courier_block_events_user_idx ON qadam.courier_block_events(user_id,created_at DESC);

CREATE TABLE qadam.order_delivery_codes (
  order_id uuid PRIMARY KEY REFERENCES qadam.orders(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  verifier text NOT NULL CHECK(verifier ~ '^[a-f0-9]{64}$'),
  encrypted_code text NOT NULL CHECK(char_length(encrypted_code)<=256),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  reset_count integer NOT NULL DEFAULT 0 CHECK(reset_count>=0),
  reset_window_start timestamptz NOT NULL DEFAULT now(),
  reset_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE qadam.order_actions (
  order_id uuid NOT NULL REFERENCES qadam.orders(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES qadam.users(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  kind text NOT NULL,
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(order_id,actor_id,request_key)
);
CREATE TABLE qadam.order_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES qadam.orders(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES qadam.users(id),
  assignment_version integer NOT NULL CHECK(assignment_version>=0),
  request_key uuid NOT NULL,
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'UPLOADING' CHECK(state IN ('UPLOADING','READY','FAILED','RETIRED','EXPIRED')),
  file_id text,
  message_id bigint CHECK(message_id>0),
  chat_id bigint NOT NULL CHECK(chat_id<0),
  byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576),
  width integer NOT NULL CHECK(width BETWEEN 1 AND 1600),
  height integer NOT NULL CHECK(height BETWEEN 1 AND 1600),
  upload_attempts integer NOT NULL DEFAULT 1 CHECK(upload_attempts>0),
  lease_until timestamptz NOT NULL DEFAULT now()+interval '1 minute',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
  UNIQUE(order_id,assignment_version,request_key),
  CHECK(state<>'READY' OR (file_id IS NOT NULL AND message_id IS NOT NULL))
);
CREATE INDEX order_photos_current_idx ON qadam.order_photos(order_id,assignment_version,created_at DESC);
CREATE INDEX order_photos_expiry_idx ON qadam.order_photos(expires_at) WHERE file_id IS NOT NULL;
CREATE TABLE qadam.order_ratings (
  order_id uuid PRIMARY KEY REFERENCES qadam.orders(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES qadam.users(id),
  score integer NOT NULL CHECK(score BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK(char_length(comment)<=500),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A released order has a new notification generation; the old delivery receipts remain auditable.
ALTER TABLE qadam.order_notifications ADD COLUMN generation integer NOT NULL DEFAULT 0 CHECK(generation>=0);
ALTER TABLE qadam.order_notifications DROP CONSTRAINT order_notifications_order_id_user_id_kind_key;
ALTER TABLE qadam.order_notifications ADD CONSTRAINT order_notifications_generation_key UNIQUE(order_id,user_id,kind,generation);
ALTER TABLE qadam.telegram_outbox DROP CONSTRAINT telegram_outbox_method_check;
ALTER TABLE qadam.telegram_outbox ADD CONSTRAINT telegram_outbox_method_check CHECK(method IN ('sendMessage','editMessageText','answerCallbackQuery','sendPhoto'));

DO $$
DECLARE tab text; api_role text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['courier_blocks','courier_block_events','order_delivery_codes','order_actions','order_photos','order_ratings'] LOOP
    EXECUTE format('ALTER TABLE qadam.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON qadam.%I FROM PUBLIC',tab);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
        EXECUTE format('REVOKE ALL ON qadam.%I FROM %I',tab,api_role);
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
      EXECUTE format('GRANT SELECT,INSERT ON qadam.%I TO qadam_app',tab);
      IF tab IN ('courier_blocks','order_delivery_codes','order_photos') THEN
        EXECUTE format('GRANT UPDATE ON qadam.%I TO qadam_app',tab);
      END IF;
      EXECUTE format('CREATE POLICY %I ON qadam.%I FOR ALL TO qadam_app USING(true) WITH CHECK(true)',tab||'_server',tab);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT DELETE ON qadam.courier_locations TO qadam_app;
    CREATE POLICY courier_locations_server_delete ON qadam.courier_locations FOR DELETE TO qadam_app USING(true);
  END IF;
END;
$$;

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261031102814_delivery_trust.sql','ab45486acff0e0daba486db234206506bbac9f50cd4cfbe8f06c174ce0696a02');

-- 20261031135617_trust_foreign_key_indexes.sql
-- Keep privacy-related user deletion and foreign-key checks bounded as audit tables grow.
CREATE INDEX courier_blocks_actor_idx ON qadam.courier_blocks(actor_id);
CREATE INDEX courier_block_events_actor_idx ON qadam.courier_block_events(actor_id);
CREATE INDEX order_actions_actor_idx ON qadam.order_actions(actor_id);
CREATE INDEX order_photos_courier_idx ON qadam.order_photos(courier_id);
CREATE INDEX order_ratings_author_idx ON qadam.order_ratings(author_id);
CREATE INDEX order_events_previous_courier_idx ON qadam.order_events(previous_courier_id) WHERE previous_courier_id IS NOT NULL;
CREATE INDEX order_events_next_courier_idx ON qadam.order_events(next_courier_id) WHERE next_courier_id IS NOT NULL;

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261031135617_trust_foreign_key_indexes.sql','694419d4e2b72c501d4c70f3c5e254acaff4247d4f579490acb84c7a346f19b4');

-- 20261101082749_notification_rolling_compatibility.sql
-- Keep the conflict target used by the previous deployed application valid.
-- Each later search generation has its own kind, so the legacy key remains unique.
ALTER TABLE qadam.order_notifications DROP CONSTRAINT order_notifications_kind_check;
UPDATE qadam.order_notifications SET kind='AVAILABLE:'||generation::text WHERE generation>0;
ALTER TABLE qadam.order_notifications ADD CONSTRAINT order_notifications_kind_check
  CHECK ((generation=0 AND kind='AVAILABLE') OR (generation>0 AND kind='AVAILABLE:'||generation::text));
ALTER TABLE qadam.order_notifications ADD CONSTRAINT order_notifications_order_id_user_id_kind_key
  UNIQUE(order_id,user_id,kind);

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261101082749_notification_rolling_compatibility.sql','3a7f6f9bb5409028c3ef7890695159cc467d96201f663869c2af2a8d58e9f848');

COMMIT;
