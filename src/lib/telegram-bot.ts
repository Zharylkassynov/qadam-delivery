import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { database } from './db';
import { appOrigin } from './deployment-config';
import { validSource } from './courier-options';
import { reviewApplication } from './courier-applications';
import { requireAdministrator } from './administrators';
import { enqueueBotMessage, drainBotOutbox } from './telegram-notifications';
import type { BotTransport } from './telegram-bot-api';
import type { User } from './types';

const id = z.number().int().positive().max(2 ** 52 - 1);
const sender = z.object({ id, first_name: z.string().max(200).optional() });
const message = z.object({ message_id: z.number().int(), from: sender.optional(), chat: z.object({ id: z.number().int(), type: z.string() }),
  text: z.string().max(5000).optional(), contact: z.object({ user_id: id.optional(), phone_number: z.string().max(40) }).optional(),
  write_access_allowed: z.object({}).optional() });
export const updateSchema = z.object({ update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), message: message.optional(),
  callback_query: z.object({ id: z.string().max(200), from: sender, data: z.string().max(64).optional(), message: message.optional() }).optional() });
export type TelegramUpdate = z.infer<typeof updateSchema>;

export function validWebhookSecret(actual: string | null, expected = process.env.TELEGRAM_WEBHOOK_SECRET): boolean {
  if (!expected || !/^[A-Za-z0-9_-]{32,256}$/.test(expected) || !actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function receiveTelegramUpdate(input: unknown) {
  const update = updateSchema.parse(input);
  // Persist before HTTP 200; a retry never inserts a second update.
  await database().query('INSERT INTO qadam.telegram_updates(update_id,payload) VALUES($1,$2) ON CONFLICT(update_id) DO NOTHING', [update.update_id, JSON.stringify(update)]);
  return update.update_id;
}

async function permitMessages(telegramId: string, phone?: string) {
  const db = database();
  await db.query(`INSERT INTO qadam.telegram_bot_chats(telegram_user_id,phone) VALUES($1,$2)
    ON CONFLICT(telegram_user_id) DO UPDATE SET allows_write=true,bot_blocked_at=NULL,
      phone=coalesce(excluded.phone,qadam.telegram_bot_chats.phone),updated_at=now()`, [telegramId, phone ?? null]);
  await db.query('UPDATE qadam.telegram_identities SET allows_write=true,bot_blocked_at=NULL WHERE telegram_user_id=$1', [telegramId]);
}

async function handleUpdate(update: TelegramUpdate) {
  const db = database(), m = update.message;
  if (m?.from && m.chat.type === 'private' && m.chat.id === m.from.id) {
    const telegramId = String(m.from.id);
    if (m.contact?.user_id === m.from.id) {
      const phone = m.contact.phone_number.replace(/[^+\d]/g, '');
      if (/^\+?\d{7,15}$/.test(phone)) await permitMessages(telegramId, phone);
    }
    if (m.write_access_allowed) await permitMessages(telegramId);
    const start = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([^\s]+))?\s*$/.exec(m.text ?? '');
    if (start) {
      await permitMessages(telegramId);
      const source = validSource(start[1]);
      const url = new URL('/', appOrigin()); url.searchParams.set('screen', 'courier'); if (source) url.searchParams.set('src', source);
      await enqueueBotMessage(db, `update:${update.update_id}:start`, telegramId, { chat_id: telegramId,
        text: 'Qadam Delivery — доставка по Алматы.\nПодай заявку курьера или создай заказ в приложении.',
        reply_markup: { inline_keyboard: [[{ text: 'Стать курьером', web_app: { url: url.href } }], [{ text: 'Заказать доставку', web_app: { url: appOrigin() } }]] } });
    }
  }
  const callback = update.callback_query;
  if (!callback) return;
  const telegramId = String(callback.from.id);
  let text = 'Действие недоступно.', approved = false;
  const match = /^app:approve:([a-f0-9-]{36})$/.exec(callback.data ?? '');
  try {
    const row = (await db.query(`SELECT u.id,u.name,u.email,u.role FROM qadam.telegram_identities t
      JOIN qadam.users u ON u.id=t.user_id WHERE t.telegram_user_id=$1 AND u.active`, [telegramId])).rows[0] as User | undefined;
    if (!row || !callback.message || callback.message.chat.type !== 'private' || callback.message.chat.id !== callback.from.id || !match || !z.uuid().safeParse(match[1]).success) throw new Error('denied');
    await requireAdministrator(db, row);
    const application = await reviewApplication(row, match[1], { decision: 'APPROVED', reason: '' });
    text = `Одобрено: ${application.reviewer ?? row.name}`; approved = true;
  } catch { text = 'Не удалось одобрить. Проверь права и актуальное решение в приложении.'; }
  await enqueueBotMessage(db, `update:${update.update_id}:answer`, telegramId, { callback_query_id: callback.id, text: approved ? 'Заявка одобрена' : text, show_alert: !approved }, 'answerCallbackQuery');
  if (approved && callback.message) await enqueueBotMessage(db, `update:${update.update_id}:edit`, telegramId, { chat_id: callback.message.chat.id, message_id: callback.message.message_id, text }, 'editMessageText');
}

export async function processTelegramJobs(transport?: BotTransport) {
  const db = database();
  for (let i = 0; i < 8; i++) {
    const job = (await db.query(`UPDATE qadam.telegram_updates SET locked_until=now()+interval '60 seconds',attempts=attempts+1
      WHERE update_id=(SELECT update_id FROM qadam.telegram_updates WHERE processed_at IS NULL AND attempts<8 AND available_at<=now()
        AND (locked_until IS NULL OR locked_until<now()) ORDER BY update_id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING update_id,payload,attempts`)).rows[0];
    if (!job) break;
    try {
      await handleUpdate(updateSchema.parse(job.payload));
      await db.query('UPDATE qadam.telegram_updates SET processed_at=now(),payload=NULL,locked_until=NULL WHERE update_id=$1', [job.update_id]);
    } catch {
      await db.query("UPDATE qadam.telegram_updates SET locked_until=NULL,available_at=now()+interval '30 seconds' WHERE update_id=$1", [job.update_id]);
      console.error('Telegram update processing failed');
    }
  }
  await drainBotOutbox(transport);
}

export async function telegramProfile(actor: User) {
  if (!actor.telegramId) return { phone: null, allowsWrite: false };
  const row = (await database().query(`SELECT c.phone,t.allows_write AND t.bot_blocked_at IS NULL AS "allowsWrite"
    FROM qadam.telegram_identities t LEFT JOIN qadam.telegram_bot_chats c ON c.telegram_user_id=t.telegram_user_id WHERE t.user_id=$1`, [actor.id])).rows[0];
  return { phone: row?.phone ?? null, allowsWrite: row?.allowsWrite === true };
}
