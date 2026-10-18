import { acceptOrder } from '../../../../../lib/orders';
import { checkMutation, handle, json, requireUser } from '../../../../../lib/http';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    return json({ order: await acceptOrder(actor, (await context.params).id) });
  });
}
