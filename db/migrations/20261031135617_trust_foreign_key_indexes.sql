-- Keep privacy-related user deletion and foreign-key checks bounded as audit tables grow.
CREATE INDEX courier_blocks_actor_idx ON qadam.courier_blocks(actor_id);
CREATE INDEX courier_block_events_actor_idx ON qadam.courier_block_events(actor_id);
CREATE INDEX order_actions_actor_idx ON qadam.order_actions(actor_id);
CREATE INDEX order_photos_courier_idx ON qadam.order_photos(courier_id);
CREATE INDEX order_ratings_author_idx ON qadam.order_ratings(author_id);
CREATE INDEX order_events_previous_courier_idx ON qadam.order_events(previous_courier_id) WHERE previous_courier_id IS NOT NULL;
CREATE INDEX order_events_next_courier_idx ON qadam.order_events(next_courier_id) WHERE next_courier_id IS NOT NULL;
