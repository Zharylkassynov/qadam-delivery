-- Set the two team Telegram IDs below. Run after publishing the Geoapify build.
-- This uses the approved rates from the saved configuration. Quotes are available
-- to the selected customer for seven days and only the selected courier sees offers.
BEGIN;
SELECT pg_advisory_xact_lock(62120261018);

DO $$
DECLARE
  customer_telegram_id constant bigint := 0;
  courier_telegram_id constant bigint := 0;
  demo_customer uuid;
  demo_courier uuid;
  demo_ends_at text := to_char((now() + interval '7 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  IF customer_telegram_id <= 0 OR courier_telegram_id <= 0 OR customer_telegram_id = courier_telegram_id THEN
    RAISE EXCEPTION 'Provide two distinct team Telegram IDs';
  END IF;

  SELECT u.id INTO STRICT demo_customer
  FROM qadam.telegram_identities t JOIN qadam.users u ON u.id=t.user_id
  WHERE t.telegram_user_id=customer_telegram_id AND u.active AND u.role='CUSTOMER'
    AND NOT EXISTS(SELECT 1 FROM qadam.courier_applications a WHERE a.user_id=u.id AND a.status='APPROVED')
    AND EXISTS(SELECT 1 FROM qadam.user_profiles p WHERE p.user_id=u.id AND p.phone_verified);

  SELECT u.id INTO STRICT demo_courier
  FROM qadam.telegram_identities t JOIN qadam.users u ON u.id=t.user_id
  WHERE t.telegram_user_id=courier_telegram_id AND u.active
    AND NOT EXISTS(SELECT 1 FROM qadam.courier_blocks b WHERE b.user_id=u.id AND b.blocked)
    AND EXISTS(SELECT 1 FROM qadam.courier_applications a WHERE a.user_id=u.id AND a.status='APPROVED' AND a.transport='CAR')
    AND EXISTS(SELECT 1 FROM qadam.user_profiles p WHERE p.user_id=u.id AND p.phone_verified);

  UPDATE qadam.pricing_settings
  SET active=true,
      config=(config - 'demonstration') || jsonb_build_object(
        'version','almaty-car-final-geoapify-v1','provider','GEOAPIFY_V1',
        'demonstration',jsonb_build_object('customerId',demo_customer,'courierId',demo_courier,'endsAt',demo_ends_at)
      )
  WHERE singleton AND NOT active
    AND (config - 'version' - 'provider' - 'demonstration') = '{
      "minimumKzt":1200,"baseKzt":800,"perKmKzt":70,"perMinuteKzt":12,
      "roundToKzt":50,"ttlSeconds":120,
      "zone":{"south":43.18,"north":43.31,"west":76.80,"east":77.05}
    }'::jsonb;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disable the current tariff first and verify the saved rates';
  END IF;
END $$;

COMMIT;
SELECT active,config->>'provider' AS provider,config->'demonstration'->>'endsAt' AS expires_at
FROM qadam.pricing_settings WHERE singleton;
