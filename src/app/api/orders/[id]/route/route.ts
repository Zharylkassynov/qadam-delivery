import { handle, json, requireUser } from '../../../../../lib/http';
import { orderRoute } from '../../../../../lib/routing';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser(request);
    return json({ route: await orderRoute(actor, (await context.params).id) });
  });
}
