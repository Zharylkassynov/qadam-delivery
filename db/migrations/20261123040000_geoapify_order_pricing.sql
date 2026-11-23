ALTER TABLE qadam.order_quotes DROP CONSTRAINT order_quotes_provider_check,
  ADD CONSTRAINT order_quotes_provider_check CHECK (provider IN ('TOMTOM_V1', 'GEOAPIFY_V1'));

ALTER TABLE qadam.orders DROP CONSTRAINT orders_traffic_source_check,
  ADD CONSTRAINT orders_traffic_source_check CHECK (traffic_source IN ('TOMTOM_V1', 'GEOAPIFY_V1')),
  DROP CONSTRAINT order_pricing_snapshot,
  ADD CONSTRAINT order_pricing_snapshot CHECK (
    (price_kzt IS NULL AND courier_payout_kzt IS NULL AND platform_fee_kzt IS NULL AND quote_id IS NULL
      AND distance_m IS NULL AND duration_s IS NULL AND tariff_version IS NULL AND pricing_details IS NULL
      AND price_source IS NULL AND traffic_source IS NULL)
    OR (price_kzt IS NOT NULL AND courier_payout_kzt IS NOT NULL AND courier_payout_kzt=price_kzt
      AND platform_fee_kzt IS NOT NULL AND platform_fee_kzt=0 AND quote_id IS NOT NULL
      AND distance_m IS NOT NULL AND duration_s IS NOT NULL AND tariff_version IS NOT NULL
      AND pricing_details IS NOT NULL AND price_source IS NOT NULL AND price_source='route'
      AND traffic_source IS NOT NULL AND traffic_source IN ('TOMTOM_V1', 'GEOAPIFY_V1')
      AND payer IS NOT NULL AND payment_method IS NOT NULL AND sender_phone IS NOT NULL)
  );
