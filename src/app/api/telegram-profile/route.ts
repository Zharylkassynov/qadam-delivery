import { handle, json, requireUser } from '../../../lib/http';
import { telegramProfile } from '../../../lib/telegram-bot';
import { scheduleTelegramJobs } from '../../../lib/telegram-jobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const profile = await telegramProfile(await requireUser(request));
    scheduleTelegramJobs();
    return json(profile);
  });
}
