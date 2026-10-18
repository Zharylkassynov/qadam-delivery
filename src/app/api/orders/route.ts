import { createOrder, createOrderSchema, listOrders } from '../../../lib/orders';
import { checkMutation, handle, json, readJson, requireUser } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => json({ orders: await listOrders(await requireUser(request)) }));
}
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const input = createOrderSchema.parse(await readJson(request));
    return json({ order: await createOrder(actor, input) }, 201);
  });
}
