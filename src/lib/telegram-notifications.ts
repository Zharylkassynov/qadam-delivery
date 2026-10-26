import type { PoolClient } from 'pg';
import { database } from './db';
import { appOrigin } from './deployment-config';
import { botApi, BotApiError, type BotTransport } from './telegram-bot-api';
import type { CourierApplication } from './types';

type Db = Pick<PoolClient, 'query'>;
export async function enqueueBotMessage(db: Db, key: string, telegramId: string, body: Record<string, unknown>, method = 'sendMessage') {
  await db.query(`INSERT INTO qadam.telegram_outbox(dedupe_key,telegram_user_id,method,body)
    VALUES($1,$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING`, [key, telegramId, method, JSON.stringify(body)]);
}

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
    const job = (await db.query(`UPDATE qadam.telegram_outbox SET locked_until=now()+interval '60 seconds',attempts=attempts+1
      WHERE id=(SELECT id FROM qadam.telegram_outbox WHERE sent_at IS NULL AND NOT failed AND available_at<=now()
        AND (locked_until IS NULL OR locked_until<now()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,telegram_user_id::text AS "telegramId",method,body,attempts`)).rows[0];
    if (!job) return;
    try {
      await transport(job.method, job.body);
      await db.query("UPDATE qadam.telegram_outbox SET sent_at=now(),body='{}',locked_until=NULL WHERE id=$1", [job.id]);
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
