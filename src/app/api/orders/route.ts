import { createOrder, createOrderSchema, listOrders } from '../../../lib/orders';
import { checkMutation, handle, json, readJson, requireUser } from '../../../lib/http';
import { scheduleTelegramJobs } from '../../../lib/telegram-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => { const user = await requireUser(request); const orders = await listOrders(user); scheduleTelegramJobs(); return json({ orders, user }); });
}
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const input = createOrderSchema.parse(await readJson(request));
    const order = await createOrder(actor, input); scheduleTelegramJobs();
    return json({ order }, 201);
  });
}
