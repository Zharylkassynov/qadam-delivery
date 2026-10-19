import { getSession } from '../../../lib/auth';
import { requestToken, handle, json } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => json({ user: await getSession(requestToken(request)), demo: process.env.DEMO_AUTH_ENABLED === 'true' }));
}
