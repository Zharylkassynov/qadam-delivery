import { applicationSchema, ownApplication, submitApplication } from '../../../lib/courier-applications';
import { checkMutation, handle, json, readJson, requireUser } from '../../../lib/http';
import { waitUntil } from '@vercel/functions';
import { processTelegramJobs } from '../../../lib/telegram-bot';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => json({ application: await ownApplication(await requireUser(request)) }));
}
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request); const actor = await requireUser(request);
    const input = applicationSchema.safeParse(await readJson(request));
    if (!input.success) return json({ error: 'Проверьте телефон, район, время, способ доставки и обязательные согласия.' }, 400);
    const application = await submitApplication(actor, input.data);
    waitUntil(processTelegramJobs().catch(() => console.error('Telegram worker unavailable')));
    return json({ application }, 201);
  });
}
