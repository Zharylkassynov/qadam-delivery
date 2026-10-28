import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';
import { validSource } from './courier-options';
import { orderStartParameter } from './order-links';

export type TelegramIdentity = { id: string; name: string; allowsWrite?: true; source?: string; order?: string };
const invalid = () => new AppError(401, 'Не удалось подтвердить вход из Telegram. Закройте Mini App и откройте его заново через бота.');

// Validate the original query string, never initDataUnsafe or client-supplied roles.
export function verifyTelegramData(raw: string, botToken: string, now = Date.now()): TelegramIdentity {
  if (!raw || Buffer.byteLength(raw) > 12000) throw invalid();
  const fields = new URLSearchParams(raw);
  const keys = [...fields.keys()];
  if (new Set(keys).size !== keys.length) throw invalid();
  const hash = fields.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw invalid();
  fields.delete('hash');
  fields.sort();
  const check = [...fields].map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw invalid();
  const date = fields.get('auth_date') ?? '';
  const age = Math.floor(now / 1000) - Number(date);
  if (!/^\d{1,12}$/.test(date) || age < -30 || age > 3600) throw invalid();
  let user: unknown;
  try { user = JSON.parse(fields.get('user') ?? ''); } catch { throw invalid(); }
  if (!user || typeof user !== 'object' || !('id' in user) || !('first_name' in user) ||
      !Number.isSafeInteger(user.id) || Number(user.id) <= 0 || Number(user.id) > 2 ** 52 - 1 ||
      typeof user.first_name !== 'string' || !user.first_name.trim() ||
      ('is_bot' in user && user.is_bot !== false)) throw invalid();
  const last = 'last_name' in user && typeof user.last_name === 'string' ? user.last_name : '';
  const source = validSource(fields.get('start_param'));
  const order = orderStartParameter(fields.get('start_param'));
  return { id: String(user.id), name: `${user.first_name.trim()} ${last.trim()}`.trim().slice(0, 100),
    ...('allows_write_to_pm' in user && user.allows_write_to_pm === true ? { allowsWrite: true as const } : {}), ...(source ? { source } : {}), ...(order ? { order } : {}) };
}
