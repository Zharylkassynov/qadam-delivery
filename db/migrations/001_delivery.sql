-- Keep application tables outside public (and future Supabase Data API schemas).
CREATE SCHEMA qadam;

CREATE TABLE qadam.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('CUSTOMER', 'COURIER')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qadam.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES qadam.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON qadam.sessions(expires_at);

-- A small database-backed login limiter also works across server processes.
CREATE TABLE qadam.login_attempts (
  email text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qadam.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  customer_id uuid NOT NULL REFERENCES qadam.users(id),
  courier_id uuid REFERENCES qadam.users(id),
  request_key uuid NOT NULL,
  pickup_address text NOT NULL CHECK (char_length(pickup_address) BETWEEN 5 AND 300),
  destination_address text NOT NULL CHECK (char_length(destination_address) BETWEEN 5 AND 300),
  recipient_name text NOT NULL CHECK (char_length(recipient_name) BETWEEN 2 AND 100),
  recipient_phone text NOT NULL CHECK (char_length(recipient_phone) BETWEEN 7 AND 30),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  status text NOT NULL CHECK (status IN ('CREATED','SEARCHING_FOR_COURIER','ACCEPTED','PICKED_UP','IN_TRANSIT','DELIVERED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, request_key),
  CHECK ((status IN ('CREATED','SEARCHING_FOR_COURIER') AND courier_id IS NULL)
    OR (status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT','DELIVERED') AND courier_id IS NOT NULL)
    OR status = 'CANCELLED')
);
CREATE INDEX orders_customer_idx ON qadam.orders(customer_id, created_at DESC);
CREATE INDEX orders_courier_idx ON qadam.orders(courier_id, created_at DESC);
CREATE INDEX orders_available_idx ON qadam.orders(created_at DESC) WHERE status = 'SEARCHING_FOR_COURIER';

CREATE TABLE qadam.order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES qadam.orders(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES qadam.users(id),
  status text NOT NULL CHECK (status IN ('CREATED','SEARCHING_FOR_COURIER','ACCEPTED','PICKED_UP','IN_TRANSIT','DELIVERED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_order_idx ON qadam.order_events(order_id, id);
