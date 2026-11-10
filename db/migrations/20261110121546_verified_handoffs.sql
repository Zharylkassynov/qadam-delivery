ALTER TABLE qadam.orders
  ADD COLUMN route_version integer NOT NULL DEFAULT 0 CHECK(route_version>=0),
  ADD COLUMN custody_assignment_version integer,
  ADD COLUMN custody_at timestamptz;
ALTER TABLE qadam.order_events DROP CONSTRAINT order_events_kind_check;
ALTER TABLE qadam.order_events ADD CONSTRAINT order_events_kind_check CHECK(kind IN
  ('STATUS','RELEASE','ASSIGN','CANCEL','CODE_RESET','SAFETY_ENROLLED','PICKUP_VERIFIED','DROPOFF_VERIFIED',
   'HANDOFF_CODE_RESET','HANDOFF_CODE_ISSUED','HANDOFF_CODE_REJECTED','POINT_CORRECTED'));

-- Enrol deliveries already in custody without inventing a retrospective pickup proof.
UPDATE qadam.orders SET custody_assignment_version=assignment_version,custody_at=clock_timestamp()
  WHERE status IN ('PICKED_UP','IN_TRANSIT');
INSERT INTO qadam.order_events(order_id,actor_id,status,kind,reason)
  SELECT id,customer_id,status,'SAFETY_ENROLLED',
    'Заказ уже в пути при включении подтверждений. Забор задним числом не подтверждён; вручение требует проверки.'
  FROM qadam.orders WHERE status IN ('PICKED_UP','IN_TRANSIT');

CREATE TABLE qadam.order_handoffs (
  order_id uuid NOT NULL REFERENCES qadam.orders(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK(stage IN ('PICKUP','DROPOFF')),
  assignment_version integer NOT NULL,
  route_version integer NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  verifier text NOT NULL CHECK(verifier ~ '^[a-f0-9]{64}$'),
  encrypted_code text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  reset_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reset_history timestamptz[] NOT NULL DEFAULT '{}',
  verified_at timestamptz,
  PRIMARY KEY(order_id,stage),
  CHECK(expires_at>issued_at)
);
CREATE TABLE qadam.order_handoff_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES qadam.orders(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK(stage IN ('PICKUP','DROPOFF')),
  courier_id uuid NOT NULL REFERENCES qadam.users(id),
  assignment_version integer NOT NULL,
  route_version integer NOT NULL,
  code_version integer NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy double precision NOT NULL CHECK(accuracy BETWEEN 0 AND 75),
  distance_m double precision NOT NULL CHECK(distance_m BETWEEN 0 AND 150),
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  location_source text NOT NULL CHECK(location_source IN ('MINI_APP','TELEGRAM_LIVE')),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(order_id,stage,assignment_version,route_version)
);
CREATE INDEX order_handoff_proofs_courier ON qadam.order_handoff_proofs(courier_id,verified_at DESC);

ALTER TABLE qadam.order_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qadam.order_handoff_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.order_handoffs,qadam.order_handoff_proofs FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.order_handoffs,qadam.order_handoff_proofs FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT,INSERT,UPDATE ON qadam.order_handoffs TO qadam_app;
    GRANT SELECT,INSERT ON qadam.order_handoff_proofs TO qadam_app;
    CREATE POLICY handoff_server ON qadam.order_handoffs FOR ALL TO qadam_app USING(true) WITH CHECK(true);
    CREATE POLICY handoff_proof_read ON qadam.order_handoff_proofs FOR SELECT TO qadam_app USING(true);
    CREATE POLICY handoff_proof_insert ON qadam.order_handoff_proofs FOR INSERT TO qadam_app WITH CHECK(true);
  END IF;
END; $$;
