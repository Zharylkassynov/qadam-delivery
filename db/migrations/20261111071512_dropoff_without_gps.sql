-- Permit code-confirmed dropoff without travelling to the destination.
-- Keep historical GPS evidence and require a complete location for pickup.
ALTER TABLE qadam.order_handoff_proofs
  ALTER COLUMN latitude DROP NOT NULL,
  ALTER COLUMN longitude DROP NOT NULL,
  ALTER COLUMN accuracy DROP NOT NULL,
  ALTER COLUMN distance_m DROP NOT NULL,
  ALTER COLUMN captured_at DROP NOT NULL,
  ALTER COLUMN received_at DROP NOT NULL,
  ALTER COLUMN location_source DROP NOT NULL,
  ADD CONSTRAINT order_handoff_proofs_location_complete CHECK (
    (latitude IS NOT NULL AND longitude IS NOT NULL AND accuracy IS NOT NULL
      AND distance_m IS NOT NULL AND captured_at IS NOT NULL
      AND received_at IS NOT NULL AND location_source IS NOT NULL)
    OR
    (stage='DROPOFF' AND latitude IS NULL AND longitude IS NULL AND accuracy IS NULL
      AND distance_m IS NULL AND captured_at IS NULL
      AND received_at IS NULL AND location_source IS NULL)
  );
