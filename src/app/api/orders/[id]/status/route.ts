import { statusSchema, transitionOrder } from '../../../../../lib/orders';
import { checkMutation, handle, json, readJson, requireUser } from '../../../../../lib/http';
import { scheduleTelegramJobs } from '../../../../../lib/telegram-jobs';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const input = statusSchema.parse(await readJson(request));
    const order = await transitionOrder(actor, (await context.params).id, input.status); scheduleTelegramJobs();
    return json({ order });
  });
}
