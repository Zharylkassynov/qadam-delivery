import { listAdminOrders } from '../../../../lib/admin-orders';
import { handle, json, requireUser } from '../../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => json(await listAdminOrders(await requireUser(request), Object.fromEntries(new URL(request.url).searchParams))));
}
