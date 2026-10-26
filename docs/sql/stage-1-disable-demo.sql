-- Supabase SQL Editor: выполнить владельцу после публикации этапа 1.
-- Идемпотентная очистка данных, без изменения схемы и без удаления истории.
-- Это не миграция: запись в public.qadam_migrations не требуется.
BEGIN;
WITH demo AS (SELECT id FROM qadam.users WHERE email LIKE '%@qadam.demo'),
cancelled AS (
  UPDATE qadam.orders SET status = 'CANCELLED', updated_at = now()
  WHERE customer_id IN (SELECT id FROM demo)
    AND status IN ('CREATED','SEARCHING_FOR_COURIER','ACCEPTED','PICKED_UP','IN_TRANSIT')
  RETURNING id, customer_id
)
INSERT INTO qadam.order_events(order_id, actor_id, status)
SELECT id, customer_id, 'CANCELLED' FROM cancelled;
UPDATE qadam.users SET active = false WHERE email LIKE '%@qadam.demo';
COMMIT;

-- Владелец проверяет оставшиеся открытые заказы реальных аккаунтов вручную.
SELECT number, status, created_at, left(notes, 60) AS notes
FROM qadam.orders
WHERE status IN ('CREATED','SEARCHING_FOR_COURIER','ACCEPTED','PICKED_UP','IN_TRANSIT')
ORDER BY created_at;
