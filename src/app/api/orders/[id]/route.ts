import { getOrder } from '../../../../lib/orders';
import { handle, json, requireUser } from '../../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async()=>json({order:await getOrder(await requireUser(request),(await context.params).id)}));
}
