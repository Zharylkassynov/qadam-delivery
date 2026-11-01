import { z } from 'zod';

// Authorisation, consent and assignment binding precede persistence in receiveLiveLocation.
const positiveId = z.number().int().positive().max(2 ** 52 - 1);
const seconds = z.number().int().positive().max(Number.MAX_SAFE_INTEGER / 1000);
const locationMessage = z.object({
  message_id: positiveId,
  date: seconds,
  edit_date: seconds.optional(),
  from: z.object({ id: positiveId, is_bot: z.boolean().optional() }),
  chat: z.object({ id: positiveId, type: z.literal('private') }),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    horizontal_accuracy: z.number().min(0).max(1500).optional(),
    live_period: z.number().int().refine(n => n >= 60 && n <= 86400 || n === 2147483647).optional(),
  }),
  // Forwarded locations and venues cannot establish the courier's own position.
  forward_origin: z.unknown().optional(),
  via_bot: z.unknown().optional(),
  sender_chat: z.unknown().optional(),
  venue: z.unknown().optional(),
  is_automatic_forward: z.boolean().optional(),
});

export type TelegramLocationInput = {
  updateId: number;
  telegramId: string;
  messageId: number;
  edited: boolean;
  state: 'LIVE' | 'STATIC' | 'EXPIRED';
  sentAt: string;
  updatedAt: string;
  expiresAt: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

/** Extracts a recent self-sent private location, not permission to use it. */
export function telegramLocationInput(input: unknown, now = Date.now()): TelegramLocationInput | null {
  const envelope = z.object({
    update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    message: z.unknown().optional(), edited_message: z.unknown().optional(),
  }).safeParse(input);
  if (!envelope.success || !Number.isFinite(now)) return null;
  const update = envelope.data;
  // An Update carries one event. Never guess between conflicting envelopes.
  if ((update.message !== undefined) === (update.edited_message !== undefined)) return null;
  const edited = update.edited_message !== undefined;
  const result = locationMessage.safeParse(edited ? update.edited_message : update.message);
  if (!result.success) return null;
  const m = result.data;
  if (m.from.is_bot || m.from.id !== m.chat.id || m.forward_origin !== undefined ||
      m.via_bot !== undefined || m.sender_chat !== undefined || m.venue !== undefined || m.is_automatic_forward) return null;
  if (edited && m.edit_date === undefined || !edited && m.edit_date !== undefined) return null;
  const updated = edited ? m.edit_date! : m.date;
  if (updated < m.date || now - updated * 1000 > 90000 || updated * 1000 - now > 30000) return null;
  const period = m.location.live_period;
  const expires = period === undefined ? null : (m.date + period) * 1000;
  return {
    updateId: update.update_id, telegramId: String(m.from.id), messageId: m.message_id, edited,
    state: expires === null ? 'STATIC' : expires <= now ? 'EXPIRED' : 'LIVE',
    sentAt: new Date(m.date * 1000).toISOString(), updatedAt: new Date(updated * 1000).toISOString(),
    expiresAt: expires === null ? null : new Date(expires).toISOString(),
    latitude: m.location.latitude, longitude: m.location.longitude, accuracy: m.location.horizontal_accuracy ?? null,
  };
}
