import { listApplications } from '../../../../lib/courier-applications';
import { handle, json, requireUser } from '../../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => json({ applications: await listApplications(await requireUser(request)) }));
}
