-- Preserve prior proofs and permit a courier's explicit pickup confirmation.
-- A pickup without a code records the assignment and route, with no GPS evidence.
ALTER TABLE qadam.order_handoff_proofs
  ALTER COLUMN code_version DROP NOT NULL,
  DROP CONSTRAINT order_handoff_proofs_location_complete,
  ADD CONSTRAINT order_handoff_proofs_location_complete CHECK (
    (code_version IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND accuracy IS NOT NULL AND distance_m IS NOT NULL AND captured_at IS NOT NULL
      AND received_at IS NOT NULL AND location_source IS NOT NULL)
    OR
    (latitude IS NULL AND longitude IS NULL AND accuracy IS NULL AND distance_m IS NULL
      AND captured_at IS NULL AND received_at IS NULL AND location_source IS NULL
      AND ((stage='PICKUP' AND code_version IS NULL) OR (stage='DROPOFF' AND code_version IS NOT NULL)))
  );
