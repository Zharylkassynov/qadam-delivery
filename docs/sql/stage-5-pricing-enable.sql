-- Enable the already approved tariff. Run after checking the production routing
-- key and closing the provider and hosting conditions in STAGE_5_READINESS.md.
BEGIN;
SELECT pg_advisory_xact_lock(62120261018);

DO $$
BEGIN
  UPDATE qadam.pricing_settings
  SET active = true
  WHERE singleton
    AND config = '{
      "version":"almaty-car-2026-10-29-v1",
      "minimumKzt":1200,"baseKzt":800,"perKmKzt":70,"perMinuteKzt":12,
      "roundToKzt":50,"ttlSeconds":120,"provider":"TOMTOM_V1",
      "zone":{"south":43.18,"north":43.31,"west":76.80,"east":77.05}
    }'::jsonb;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved tariff is missing or its settings differ';
  END IF;
END $$;

COMMIT;
SELECT active, config->>'version' AS version FROM qadam.pricing_settings WHERE singleton;
