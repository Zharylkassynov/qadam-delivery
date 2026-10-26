import { waitUntil } from '@vercel/functions';
import { handle, json, readJson } from '../../../../lib/http';
import { processTelegramJobs, receiveTelegramUpdate, validWebhookSecret } from '../../../../lib/telegram-bot';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!validWebhookSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'))) return json({ error: 'Unauthorized' }, 401);
  return handle(async () => {
    await receiveTelegramUpdate(await readJson(request, 65536));
    waitUntil(processTelegramJobs().catch(() => console.error('Telegram worker unavailable')));
    return json({ ok: true });
  });
}
