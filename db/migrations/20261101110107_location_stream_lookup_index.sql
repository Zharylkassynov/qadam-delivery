-- Covers courier deletion checks and prevents rebinding a retired Telegram message.
CREATE INDEX order_location_streams_courier_message_idx ON qadam.order_location_streams(courier_id,message_id);
