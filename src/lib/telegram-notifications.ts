import type { PoolClient } from 'pg';
import { database, transaction } from './db';
import { appOrigin } from './deployment-config';
import { botApi, BotApiError, type BotTransport } from './telegram-bot-api';
import type { CourierApplication } from './types';
import { enqueueBotMessage, type BotJob } from './telegram-outbox';
import { recordOrderDelivery, shouldSendOrderJob } from './order-notifications';
export { enqueueBotMessage } from './telegram-outbox';
type Db = Pick<PoolClient, 'query'>;

export async function queueApplicationSubmitted(db: Db, application: CourierApplication) {
  const admins = await db.query(`SELECT t.telegram_user_id::text AS id FROM qadam.administrators a
    JOIN qadam.users u ON u.id=a.user_id JOIN qadam.telegram_identities t ON t.user_id=a.user_id
    WHERE u.active AND t.allows_write AND t.bot_blocked_at IS NULL`);
  for (const admin of admins.rows) await enqueueBotMessage(db, `application:${application.id}:admin:${admin.id}`, admin.id, {
    chat_id: admin.id, text: `Новая заявка курьера\n${application.name}\n${application.phone}`,
    reply_markup: { inline_keyboard: [[{ text: 'Одобрить', callback_data: `app:approve:${application.id}` }], [{ text: 'Открыть в приложении', web_app: { url: `${appOrigin()}/?screen=adminApplications` } }]] },
  });
}

export async function queueApplicationDecision(db: Db, application: CourierApplication) {
  const identity = (await db.query('SELECT allows_write,bot_blocked_at FROM qadam.telegram_identities WHERE user_id=$1', [application.userId])).rows[0];
  if (!identity?.allows_write || identity.bot_blocked_at) return;
  await enqueueBotMessage(db, `application:${application.id}:decision`, application.telegramId, {
    chat_id: application.telegramId,
    text: application.status === 'APPROVED' ? 'Заявка одобрена! Открой Qadam, выбери доступный заказ и отметь каждый шаг доставки.' : `Заявка отклонена. Причина: ${application.decisionReason}\nИсправь данные и подай заявку повторно.`,
    reply_markup: { inline_keyboard: [[{ text: application.status === 'APPROVED' ? 'Открыть Qadam' : 'Подать повторно', web_app: { url: `${appOrigin()}/?screen=courier` } }]] },
  });
}

export async function drainBotOutbox(transport: BotTransport = botApi, limit = 15) {
  const db = database();
  for (let i = 0; i < limit; i++) {
    const job: BotJob | undefined = (await db.query(`UPDATE qadam.telegram_outbox SET locked_until=now()+interval '60 seconds',attempts=attempts+1
      WHERE id=(SELECT j.id FROM qadam.telegram_outbox j WHERE j.sent_at IS NULL AND NOT j.failed AND j.available_at<=now()
        AND (j.locked_until IS NULL OR j.locked_until<now())
        AND (j.order_id IS NULL OR NOT EXISTS(SELECT 1 FROM qadam.telegram_outbox earlier
          WHERE earlier.order_id=j.order_id AND earlier.telegram_user_id=j.telegram_user_id AND earlier.id<j.id
            AND earlier.sent_at IS NULL AND NOT earlier.failed))
        ORDER BY j.id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id::text,telegram_user_id::text AS "telegramId",method,body,attempts,order_id AS "orderId",order_notification_id::text AS "notificationId"`)).rows[0];
    if (!job) return;
    try {
      if (!await shouldSendOrderJob(job)) {
        await db.query("UPDATE qadam.telegram_outbox SET failed=true,body='{}',locked_until=NULL WHERE id=$1 AND attempts=$2", [job.id,job.attempts]);
        continue;
      }
      const result = await transport(job.method, job.body);
      await transaction(async client => {
        // Mutations lock the order before notification rows; preserve the same order here.
        if (job.orderId) await client.query('SELECT id FROM qadam.orders WHERE id=$1 FOR UPDATE',[job.orderId]);
        const owned = await client.query('SELECT id FROM qadam.telegram_outbox WHERE id=$1 AND attempts=$2 AND sent_at IS NULL FOR UPDATE',[job.id,job.attempts]);
        if (!owned.rowCount) return;
        await recordOrderDelivery(client,job,result);
        await client.query("UPDATE qadam.telegram_outbox SET sent_at=now(),body='{}',locked_until=NULL WHERE id=$1", [job.id]);
      });
    } catch (error) {
      const code = error instanceof BotApiError ? error.code : 503;
      if (code === 403) {
        await db.query('UPDATE qadam.telegram_identities SET bot_blocked_at=now(),allows_write=false WHERE telegram_user_id=$1', [job.telegramId]);
        await db.query('UPDATE qadam.telegram_bot_chats SET bot_blocked_at=now(),allows_write=false WHERE telegram_user_id=$1', [job.telegramId]);
      }
      const retry = error instanceof BotApiError && error.retryAfter ? error.retryAfter : Math.min(900, 2 ** job.attempts * 5);
      await db.query('UPDATE qadam.telegram_outbox SET failed=$2,locked_until=NULL,available_at=now()+$3 * interval \'1 second\' WHERE id=$1', [job.id, code === 403 || (code === 400) || job.attempts >= 8, retry]);
      console.error('Telegram delivery failed:', code);
    }
  }
}
