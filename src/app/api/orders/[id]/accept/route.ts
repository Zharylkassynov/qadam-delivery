import { acceptOrder } from '../../../../../lib/orders';
import { checkMutation, handle, json, requireUser } from '../../../../../lib/http';
import { scheduleTelegramJobs } from '../../../../../lib/telegram-jobs';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const order = await acceptOrder(actor, (await context.params).id); scheduleTelegramJobs();
    return json({ order });
  });
}
