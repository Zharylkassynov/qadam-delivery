import { handle, json, readJson } from '../../../../lib/http';
import { receiveTelegramUpdate, validWebhookSecret } from '../../../../lib/telegram-bot';
import { scheduleTelegramJobs } from '../../../../lib/telegram-jobs';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!validWebhookSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'))) return json({ error: 'Unauthorized' }, 401);
  return handle(async () => {
    await receiveTelegramUpdate(await readJson(request, 65536));
    scheduleTelegramJobs();
    return json({ ok: true });
  });
}
