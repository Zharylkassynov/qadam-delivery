-- Optional for orders created before map selection was introduced.
ALTER TABLE qadam.orders
  ADD COLUMN pickup_latitude double precision CHECK (pickup_latitude BETWEEN -90 AND 90),
  ADD COLUMN pickup_longitude double precision CHECK (pickup_longitude BETWEEN -180 AND 180),
  ADD COLUMN destination_latitude double precision CHECK (destination_latitude BETWEEN -90 AND 90),
  ADD COLUMN destination_longitude double precision CHECK (destination_longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT pickup_point_pair CHECK ((pickup_latitude IS NULL)=(pickup_longitude IS NULL)),
  ADD CONSTRAINT destination_point_pair CHECK ((destination_latitude IS NULL)=(destination_longitude IS NULL));

-- One last known measurement per order; no movement history is collected.
CREATE TABLE qadam.courier_locations (
  order_id uuid PRIMARY KEY REFERENCES qadam.orders(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES qadam.users(id),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy double precision CHECK (accuracy BETWEEN 0 AND 100000),
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courier_location_courier_idx ON qadam.courier_locations(courier_id);
ALTER TABLE qadam.courier_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.courier_locations FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.courier_locations FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,INSERT ON qadam.courier_locations TO qadam_app;
    GRANT UPDATE (courier_id,latitude,longitude,accuracy,captured_at,received_at) ON qadam.courier_locations TO qadam_app;
    GRANT INSERT (pickup_latitude,pickup_longitude,destination_latitude,destination_longitude) ON qadam.orders TO qadam_app;
    CREATE POLICY location_server_read ON qadam.courier_locations FOR SELECT TO qadam_app USING (true);
    CREATE POLICY location_server_insert ON qadam.courier_locations FOR INSERT TO qadam_app WITH CHECK (true);
    CREATE POLICY location_server_update ON qadam.courier_locations FOR UPDATE TO qadam_app USING (true) WITH CHECK (true);
  END IF;
END $$;
