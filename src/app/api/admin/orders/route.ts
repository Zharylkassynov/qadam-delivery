import { listAdminOrders } from '../../../../lib/admin-orders';
import { handle, json, requireUser } from '../../../../lib/http';
import { scheduleTelegramJobs } from '../../../../lib/telegram-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const page = await listAdminOrders(await requireUser(request), Object.fromEntries(new URL(request.url).searchParams));
    scheduleTelegramJobs(); return json(page);
  });
}
