import { statusSchema, transitionOrder } from '../../../../../lib/orders';
import { checkMutation, handle, json, readJson, requireUser } from '../../../../../lib/http';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const input = statusSchema.parse(await readJson(request));
    return json({ order: await transitionOrder(actor, (await context.params).id, input.status) });
  });
}
