-- Application users remain private; Telegram identities never use the Data API.
ALTER TABLE qadam.users ALTER COLUMN role SET DEFAULT 'CUSTOMER';

CREATE TABLE qadam.telegram_identities (
  telegram_user_id bigint PRIMARY KEY CHECK (telegram_user_id BETWEEN 1 AND 4503599627370495),
  user_id uuid UNIQUE NOT NULL REFERENCES qadam.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qadam.telegram_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE qadam.telegram_identities FROM PUBLIC;

DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE qadam.telegram_identities FROM %I', api_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT, INSERT ON qadam.telegram_identities TO qadam_app;
    -- Only server access. Existing API handlers enforce order ownership and roles.
    CREATE POLICY telegram_server_select ON qadam.telegram_identities
      FOR SELECT TO qadam_app USING (true);
    CREATE POLICY telegram_server_insert ON qadam.telegram_identities
      FOR INSERT TO qadam_app WITH CHECK (true);
    -- Runtime can create customers but cannot set roles or activate blocked users.
    GRANT INSERT (email,name,password_hash) ON qadam.users TO qadam_app;
  END IF;
END $$;
