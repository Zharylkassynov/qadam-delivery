import { z } from 'zod';
import { decisionSchema, reviewApplication } from '../../../../../lib/courier-applications';
import { checkMutation, handle, json, readJson, requireUser } from '../../../../../lib/http';
import { waitUntil } from '@vercel/functions';
import { processTelegramJobs } from '../../../../../lib/telegram-bot';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    checkMutation(request); const actor = await requireUser(request);
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return json({ error: 'Заявка не найдена.' }, 404);
    const input = decisionSchema.safeParse(await readJson(request));
    if (!input.success) return json({ error: 'Для отклонения укажите причину от 5 до 500 символов.' }, 400);
    const application = await reviewApplication(actor, id, input.data);
    waitUntil(processTelegramJobs().catch(() => console.error('Telegram worker unavailable')));
    return json({ application });
  });
}
