CREATE TABLE qadam.business_profiles (
  user_id uuid PRIMARY KEY REFERENCES qadam.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 100),
  pickup_address text NOT NULL CHECK(char_length(pickup_address) BETWEEN 5 AND 300),
  pickup_latitude double precision NOT NULL CHECK(pickup_latitude BETWEEN -90 AND 90),
  pickup_longitude double precision NOT NULL CHECK(pickup_longitude BETWEEN -180 AND 180),
  pickup_details text NOT NULL DEFAULT '' CHECK(char_length(pickup_details)<=200),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qadam.business_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.business_profiles FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.business_profiles FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON qadam.business_profiles TO qadam_app;
    CREATE POLICY business_profiles_server ON qadam.business_profiles FOR ALL TO qadam_app USING(true) WITH CHECK(true);
  END IF;
END;
$$;

-- Nullable type preserves legacy notes without inventing a historical category.
ALTER TABLE qadam.orders
  ADD COLUMN parcel_type text CHECK(parcel_type IN ('PARCEL','FLOWERS','CAKE','GIFT','DOCUMENTS','OTHER')),
  ADD COLUMN fragile boolean NOT NULL DEFAULT false,
  ADD COLUMN surprise boolean NOT NULL DEFAULT false,
  ADD COLUMN urgent boolean NOT NULL DEFAULT false,
  ADD COLUMN card_text text CHECK(char_length(card_text)<=300),
  ADD COLUMN business_name text CHECK(char_length(business_name) BETWEEN 2 AND 100),
  ADD COLUMN pickup_details text CHECK(char_length(pickup_details)<=200),
  ADD COLUMN deliver_after timestamptz,
  ADD COLUMN deliver_before timestamptz,
  ADD CONSTRAINT order_delivery_window CHECK(
    (deliver_after IS NULL AND deliver_before IS NULL) OR
    (deliver_after IS NOT NULL AND deliver_before IS NOT NULL
      AND deliver_before>=deliver_after+interval '30 minutes'
      AND (deliver_after AT TIME ZONE 'Asia/Almaty')::date=(deliver_before AT TIME ZONE 'Asia/Almaty')::date)
  ),
  ADD CONSTRAINT scheduled_price_unavailable CHECK(deliver_after IS NULL OR price_kzt IS NULL);
CREATE INDEX orders_available_window_idx ON qadam.orders(deliver_after,deliver_before,created_at)
  WHERE courier_id IS NULL AND status='SEARCHING_FOR_COURIER';
