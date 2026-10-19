-- Admin membership is provisioned by the database owner, never by the web runtime.
CREATE TABLE qadam.administrators (
  user_id uuid PRIMARY KEY REFERENCES qadam.telegram_identities(user_id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE qadam.courier_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES qadam.telegram_identities(user_id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (char_length(phone) BETWEEN 7 AND 30),
  transport text NOT NULL CHECK (transport IN ('FOOT','BICYCLE','CAR')),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes)<=500),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES qadam.users(id),
  decision_reason text NOT NULL DEFAULT '' CHECK (char_length(decision_reason)<=500),
  CHECK ((status='PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL AND decision_reason='')
    OR (status='APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND decision_reason='')
    OR (status='REJECTED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND char_length(decision_reason)>=5))
);
CREATE UNIQUE INDEX courier_application_open_idx ON qadam.courier_applications(user_id)
  WHERE status IN ('PENDING','APPROVED');
CREATE INDEX courier_application_user_idx ON qadam.courier_applications(user_id,submitted_at DESC);
CREATE INDEX courier_application_queue_idx ON qadam.courier_applications(status,submitted_at DESC);
CREATE INDEX courier_application_reviewer_idx ON qadam.courier_applications(reviewed_by);
ALTER TABLE qadam.administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE qadam.courier_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qadam.administrators,qadam.courier_applications FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON qadam.administrators,qadam.courier_applications FROM %I',api_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qadam_app') THEN
    GRANT SELECT ON qadam.administrators,qadam.courier_applications TO qadam_app;
    GRANT INSERT (user_id,phone,transport,notes) ON qadam.courier_applications TO qadam_app;
    GRANT UPDATE (status,reviewed_at,reviewed_by,decision_reason) ON qadam.courier_applications TO qadam_app;
    CREATE POLICY admin_membership_server_read ON qadam.administrators FOR SELECT TO qadam_app USING (true);
    CREATE POLICY courier_application_server_read ON qadam.courier_applications FOR SELECT TO qadam_app USING (true);
    CREATE POLICY courier_application_server_submit ON qadam.courier_applications FOR INSERT TO qadam_app WITH CHECK (status='PENDING');
    CREATE POLICY courier_application_server_review ON qadam.courier_applications FOR UPDATE TO qadam_app
      USING (status='PENDING') WITH CHECK (status IN ('APPROVED','REJECTED'));
  END IF;
END $$;
