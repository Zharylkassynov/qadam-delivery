-- Keep the conflict target used by the previous deployed application valid.
-- Each later search generation has its own kind, so the legacy key remains unique.
ALTER TABLE qadam.order_notifications DROP CONSTRAINT order_notifications_kind_check;
UPDATE qadam.order_notifications SET kind='AVAILABLE:'||generation::text WHERE generation>0;
ALTER TABLE qadam.order_notifications ADD CONSTRAINT order_notifications_kind_check
  CHECK ((generation=0 AND kind='AVAILABLE') OR (generation>0 AND kind='AVAILABLE:'||generation::text));
ALTER TABLE qadam.order_notifications ADD CONSTRAINT order_notifications_order_id_user_id_kind_key
  UNIQUE(order_id,user_id,kind);
