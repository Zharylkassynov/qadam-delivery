import { acceptOrder } from '../../../../../lib/orders';
import { z } from 'zod';
import { checkMutation, handle, json, requireUser,readJson } from '../../../../../lib/http';
import { scheduleTelegramJobs } from '../../../../../lib/telegram-jobs';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const input=z.object({shareContact:z.boolean().optional()}).strict().parse(await readJson(request));
    const order = await acceptOrder(actor, (await context.params).id,input.shareContact===true); scheduleTelegramJobs();
    return json({ order });
  });
}
