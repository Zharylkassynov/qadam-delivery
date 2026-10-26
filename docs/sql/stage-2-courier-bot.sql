-- Reproducible migration; apply only once.
BEGIN;
ALTER TABLE qadam.courier_applications
  ADD COLUMN district text CHECK (district IN ('ALATAU','ALMALY','AUEZOV','BOSTANDYK','ZHETYSU','MEDEU','NAURYZBAY','TURKSIB')),
  ADD COLUMN availability text[] NOT NULL DEFAULT '{}' CHECK (availability <@ ARRAY['MORNING','DAY','EVENING','WEEKEND']::text[]),
  ADD COLUMN age_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_at timestamptz,
  ADD COLUMN source text CHECK (source ~ '^[a-z0-9_]{1,64}$');
ALTER TABLE qadam.telegram_identities
  ADD COLUMN allows_write boolean NOT NULL DEFAULT false,
  ADD COLUMN bot_blocked_at timestamptz,
  ADD COLUMN source text CHECK (source ~ '^[a-z0-9_]{1,64}$');

-- A bot contact can arrive before the user first opens the Mini App.
CREATE TABLE qadam.telegram_bot_chats (
  telegram_user_id bigint PRIMARY KEY CHECK (telegram_user_id>0),
  phone text CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  allows_write boolean NOT NULL DEFAULT true,
  bot_blocked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE qadam.telegram_updates (
  update_id bigint PRIMARY KEY,
  payload jsonb,
  processed_at timestamptz,
  locked_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_updates_pending_idx ON qadam.telegram_updates(available_at) WHERE processed_at IS NULL;
CREATE TABLE qadam.telegram_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dedupe_key text UNIQUE NOT NULL,
  telegram_user_id bigint NOT NULL,
  method text NOT NULL CHECK (method IN ('sendMessage','editMessageText','answerCallbackQuery')),
  body jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  sent_at timestamptz,
  failed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_outbox_pending_idx ON qadam.telegram_outbox(available_at) WHERE sent_at IS NULL AND NOT failed;

ALTER TABLE qadam.telegram_bot_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE qadam.telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE qadam.telegram_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.telegram_bot_chats,qadam.telegram_updates,qadam.telegram_outbox FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.telegram_bot_chats,qadam.telegram_updates,qadam.telegram_outbox FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT INSERT (district,availability,age_confirmed,consent_at,source) ON qadam.courier_applications TO qadam_app;
    GRANT UPDATE (allows_write,bot_blocked_at,source) ON qadam.telegram_identities TO qadam_app;
    CREATE POLICY telegram_server_update ON qadam.telegram_identities FOR UPDATE TO qadam_app USING (true) WITH CHECK (true);
    GRANT SELECT,INSERT,UPDATE,DELETE ON qadam.telegram_bot_chats,qadam.telegram_updates,qadam.telegram_outbox TO qadam_app;
    GRANT USAGE ON SEQUENCE qadam.telegram_outbox_id_seq TO qadam_app;
    CREATE POLICY bot_chats_server ON qadam.telegram_bot_chats FOR ALL TO qadam_app USING (true) WITH CHECK (true);
    CREATE POLICY bot_updates_server ON qadam.telegram_updates FOR ALL TO qadam_app USING (true) WITH CHECK (true);
    CREATE POLICY bot_outbox_server ON qadam.telegram_outbox FOR ALL TO qadam_app USING (true) WITH CHECK (true);
  END IF;
END;
$$;

INSERT INTO public.qadam_migrations(name,checksum) VALUES('20261026102512_courier_bot.sql','7d571f07a055457e281842fd0f4f9d10948dbd1eccc5d075db5ebbd1d44a3068');
COMMIT;
