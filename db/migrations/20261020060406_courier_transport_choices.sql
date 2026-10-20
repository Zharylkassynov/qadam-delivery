-- Expand accepted storage values without relabelling historical bicycle records.
-- New applications are restricted to the four current choices by the server.
SET LOCAL lock_timeout = '5s';
ALTER TABLE qadam.courier_applications
  DROP CONSTRAINT courier_applications_transport_check,
  ADD CONSTRAINT courier_applications_transport_check
    CHECK (transport IN ('FOOT','ELECTRIC_MOPED','MOPED','CAR','BICYCLE'));
