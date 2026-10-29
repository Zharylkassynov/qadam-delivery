-- Stop new automatic-price orders without erasing history or active deliveries.
BEGIN;
SELECT pg_advisory_xact_lock(62120261018);
UPDATE qadam.pricing_settings SET active=false WHERE singleton;
COMMIT;
SELECT active,config->>'version' AS version FROM qadam.pricing_settings WHERE singleton;
