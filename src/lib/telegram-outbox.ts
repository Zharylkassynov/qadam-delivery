import type { PoolClient } from 'pg';

export type Db = Pick<PoolClient, 'query'>;
export type BotJob = { id: string; telegramId: string; method: string; body: Record<string, unknown>; attempts: number;
  orderId: string | null; notificationId: string | null };
export async function enqueueBotMessage(db: Db, key: string, telegramId: string, body: Record<string, unknown>, method = 'sendMessage',
  order?: { orderId: string; notificationId?: string }) {
  await db.query(`INSERT INTO qadam.telegram_outbox(dedupe_key,telegram_user_id,method,body,order_id,order_notification_id)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dedupe_key) DO NOTHING`,
  [key, telegramId, method, JSON.stringify(body), order?.orderId ?? null, order?.notificationId ?? null]);
}
