import { createOrder, createOrderSchema, listOrders } from '../../../lib/orders';
import { checkMutation, handle, json, readJson, requireUser } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => { const user = await requireUser(request); return json({ orders: await listOrders(user), user }); });
}
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const input = createOrderSchema.parse(await readJson(request));
    return json({ order: await createOrder(actor, input) }, 201);
  });
}
