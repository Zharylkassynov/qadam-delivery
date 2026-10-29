-- No tariff is installed or enabled by this migration.
CREATE TABLE qadam.pricing_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active boolean NOT NULL DEFAULT false,
  config jsonb,
  CHECK (NOT active OR config IS NOT NULL)
);
INSERT INTO qadam.pricing_settings(singleton,active) VALUES(true,false);

CREATE TABLE qadam.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES qadam.users(id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  phone_verified boolean NOT NULL DEFAULT true CHECK (phone_verified),
  verification_source text NOT NULL DEFAULT 'TELEGRAM_CONTACT' CHECK (verification_source='TELEGRAM_CONTACT'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  last_telegram_update_id bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qadam.order_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES qadam.users(id) ON DELETE CASCADE,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  tariff_version text NOT NULL,
  price_kzt integer NOT NULL CHECK (price_kzt>=0),
  breakdown jsonb NOT NULL,
  distance_m integer NOT NULL CHECK (distance_m BETWEEN 1 AND 100000),
  duration_s integer NOT NULL CHECK (duration_s BETWEEN 1 AND 14400),
  provider text NOT NULL CHECK (provider='TOMTOM_V1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at>created_at)
);
CREATE INDEX order_quotes_owner_expiry_idx ON qadam.order_quotes(owner_id,expires_at) WHERE used_at IS NULL;

ALTER TABLE qadam.orders
  ADD COLUMN quote_id uuid UNIQUE REFERENCES qadam.order_quotes(id),
  ADD COLUMN price_kzt integer CHECK (price_kzt>=0),
  ADD COLUMN courier_payout_kzt integer CHECK (courier_payout_kzt>=0),
  ADD COLUMN platform_fee_kzt integer CHECK (platform_fee_kzt=0),
  ADD COLUMN distance_m integer CHECK (distance_m BETWEEN 1 AND 100000),
  ADD COLUMN duration_s integer CHECK (duration_s BETWEEN 1 AND 14400),
  ADD COLUMN tariff_version text,
  ADD COLUMN pricing_details jsonb,
  ADD COLUMN price_source text CHECK (price_source='route'),
  ADD COLUMN traffic_source text CHECK (traffic_source='TOMTOM_V1'),
  ADD COLUMN payer text CHECK (payer IN ('SENDER','RECIPIENT')),
  ADD COLUMN payment_method text CHECK (payment_method IN ('KASPI_TRANSFER','CASH')),
  ADD COLUMN sender_phone text,
  ADD COLUMN courier_phone text,
  ADD CONSTRAINT order_pricing_snapshot CHECK (
    (price_kzt IS NULL AND courier_payout_kzt IS NULL AND platform_fee_kzt IS NULL AND quote_id IS NULL
      AND distance_m IS NULL AND duration_s IS NULL AND tariff_version IS NULL AND pricing_details IS NULL
      AND price_source IS NULL AND traffic_source IS NULL)
    OR (price_kzt IS NOT NULL AND courier_payout_kzt IS NOT NULL AND courier_payout_kzt=price_kzt
      AND platform_fee_kzt IS NOT NULL AND platform_fee_kzt=0 AND quote_id IS NOT NULL
      AND distance_m IS NOT NULL AND duration_s IS NOT NULL AND tariff_version IS NOT NULL
      AND pricing_details IS NOT NULL AND price_source IS NOT NULL AND price_source='route'
      AND traffic_source IS NOT NULL AND traffic_source='TOMTOM_V1'
      AND payer IS NOT NULL AND payment_method IS NOT NULL AND sender_phone IS NOT NULL)
  );

-- Preserve a phone only where the old bot stored a verified own Telegram contact.
INSERT INTO qadam.user_profiles(user_id,phone)
  SELECT t.user_id,CASE WHEN c.phone LIKE '+%' THEN c.phone ELSE '+'||c.phone END
  FROM qadam.telegram_identities t JOIN qadam.telegram_bot_chats c USING(telegram_user_id)
  WHERE c.phone ~ '^\+?[1-9][0-9]{6,14}$';

ALTER TABLE qadam.pricing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE qadam.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE qadam.order_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.pricing_settings,qadam.user_profiles,qadam.order_quotes FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.pricing_settings,qadam.user_profiles,qadam.order_quotes FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    -- Runtime can read a tariff; it cannot activate or change one.
    GRANT SELECT ON qadam.pricing_settings TO qadam_app;
    CREATE POLICY pricing_settings_read ON qadam.pricing_settings FOR SELECT TO qadam_app USING(true);
    GRANT SELECT,INSERT,UPDATE ON qadam.user_profiles TO qadam_app;
    CREATE POLICY user_profiles_server ON qadam.user_profiles FOR ALL TO qadam_app USING(true) WITH CHECK(true);
    GRANT SELECT,INSERT,UPDATE,DELETE ON qadam.order_quotes TO qadam_app;
    CREATE POLICY order_quotes_server ON qadam.order_quotes FOR ALL TO qadam_app USING(true) WITH CHECK(true);
  END IF;
END;
$$;
