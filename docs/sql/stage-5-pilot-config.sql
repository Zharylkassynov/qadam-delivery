-- Approved by the owner on 2026-10-29. Installs settings ONLY; never enables pricing.
-- Deploy the paid-pilot guards before activation. TomTom retention/attribution and
-- courier economics and commercial hosting remain open conditions in STAGE_5_LAUNCH.md.
BEGIN;
SELECT pg_advisory_xact_lock(62120261018);
DO $$
DECLARE settings qadam.pricing_settings%ROWTYPE;
BEGIN
  SELECT * INTO STRICT settings FROM qadam.pricing_settings WHERE singleton FOR UPDATE;
  IF settings.active THEN
    RAISE EXCEPTION 'Pricing is active; review the live tariff instead of overwriting it';
  END IF;
  IF settings.config IS NOT NULL AND settings.config->>'version' IS DISTINCT FROM 'almaty-car-2026-10-29-v1' THEN
    RAISE EXCEPTION 'Unexpected saved tariff version; review before changing it';
  END IF;
  UPDATE qadam.pricing_settings SET active=false,config='{
    "version":"almaty-car-2026-10-29-v1",
    "minimumKzt":1200,"baseKzt":800,"perKmKzt":70,"perMinuteKzt":12,
    "roundToKzt":50,"ttlSeconds":120,"provider":"TOMTOM_V1",
    "zone":{"south":43.18,"north":43.31,"west":76.80,"east":77.05}
  }'::jsonb WHERE singleton;
END $$;
COMMIT;
SELECT active,config->>'version' AS version FROM qadam.pricing_settings WHERE singleton;
