import { waitUntil } from '@vercel/functions';
import { handle, json, requireUser } from '../../../lib/http';
import { processTelegramJobs, telegramProfile } from '../../../lib/telegram-bot';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const profile = await telegramProfile(await requireUser(request));
    waitUntil(processTelegramJobs().catch(() => console.error('Telegram worker unavailable')));
    return json(profile);
  });
}
